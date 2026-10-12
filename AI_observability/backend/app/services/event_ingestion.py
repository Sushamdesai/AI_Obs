from __future__ import annotations

from datetime import UTC, datetime
import json
from math import isfinite
from typing import Sequence

from backend.app.persistence.repository import MetadataRepository
from backend.app.services.catalog import model_payload
from observability.engines import EventFinding
from observability.processor import DataObservabilityEngine
from shared.contracts import (
    AgentFinding,
    DatasetHealth,
    HealthState,
    ObservabilityEvent,
    QualityResult,
    SchemaVersion,
    SLAStatus,
)


class EventIngestionService:
    def __init__(
        self,
        repository: MetadataRepository,
        data_provider,
        observability_provider,
        engine: DataObservabilityEngine | None = None,
    ) -> None:
        self.repository = repository
        self.data_provider = data_provider
        self.observability_provider = observability_provider
        self.engine = engine or DataObservabilityEngine()

    def ingest(self, events: Sequence[ObservabilityEvent]) -> None:
        if not events:
            return
        for event in events:
            self._validate_metrics(event)
            if event.dataset_id and self.repository.get("dataset", event.dataset_id) is None:
                raise KeyError(f"Unknown dataset: {event.dataset_id}")
            if event.pipeline_id and self.repository.get("pipeline", event.pipeline_id) is None:
                raise KeyError(f"Unknown pipeline: {event.pipeline_id}")
        for event in events:
            payload = model_payload(event)
            self.repository.upsert("event", str(event.event_id), payload)
            for metric in event.metrics:
                metric_payload = model_payload(metric)
                metric_payload["event_id"] = str(event.event_id)
                self.repository.upsert(
                    "data_metric",
                    f"{event.event_id}:{metric.name}",
                    metric_payload,
                )
            self.observability_provider.publish_event(event)
            self._persist_measurement(event)
        self.process_persisted_events()

    def process_persisted_events(self) -> None:
        events = [
            ObservabilityEvent.model_validate(payload)
            for payload in self.repository.list("event", limit=1000)
        ]
        lineage_graph = self._lineage_graph()
        results = self.engine.process_events(events, lineage_graph=lineage_graph)
        for finding in results.findings:
            self._persist_finding(finding)
        for correlated in results.incidents:
            incident = correlated.incident
            existing = self.repository.get("incident", incident.incident_id)
            if existing is not None:
                incident.status = existing["status"]
            payload = model_payload(incident)
            self.repository.upsert("incident", incident.incident_id, payload)
            for timeline in incident.timeline:
                timeline_payload = model_payload(timeline)
                self.repository.upsert(
                    "incident_timeline", timeline.timeline_event_id, timeline_payload
                )
            rca = self.engine.confidence_engine.to_rca_result(incident)
            rca_payload = model_payload(rca)
            self.repository.upsert("rca_result", incident.incident_id, rca_payload)

    def _persist_finding(self, finding: EventFinding) -> None:
        model = AgentFinding(
            finding_id=f"observability:{finding.finding_id}",
            agent_name="custom_observability",
            summary=f"{finding.category}: {'; '.join(finding.evidence)}",
            evidence_event_ids=[finding.event.event_id],
            created_at=finding.event.occurred_at,
        )
        payload = model_payload(model)
        self.repository.upsert("agent_finding", model.finding_id, payload)

    def _persist_measurement(self, event: ObservabilityEvent) -> None:
        metrics = {metric.name: metric.value for metric in event.metrics}
        if not event.dataset_id:
            return
        now = event.occurred_at
        quality_score = metrics.get("dataset.quality_score")
        rejected = metrics.get("pipeline.records_rejected", 0)
        previous_health_payload = self.repository.get("dataset_health", event.dataset_id)
        previous_health = DatasetHealth.model_validate(previous_health_payload) if previous_health_payload else None
        if isinstance(quality_score, (int, float)):
            score = max(0.0, min(1.0, float(quality_score)))
            rejected_count = int(rejected)
            result = QualityResult(
                check_id=f"event:{event.event_id}:quality",
                dataset_id=event.dataset_id,
                passed=score >= 0.8 and rejected_count == 0,
                score=score,
                evaluated_at=now,
                failed_records=rejected_count,
                message="Quality measurement derived from the canonical pipeline event.",
                attributes={"source_event_id": str(event.event_id)},
            )
            self.repository.upsert("quality_result", result.check_id, model_payload(result))
            row_count = metrics.get("dataset.row_count")
            quality_state = HealthState.HEALTHY if result.passed else HealthState.DEGRADED
            if previous_health and previous_health.state == HealthState.CRITICAL:
                quality_state = HealthState.CRITICAL
            health = DatasetHealth(
                dataset_id=event.dataset_id,
                state=quality_state,
                quality_score=score,
                freshness_seconds=previous_health.freshness_seconds if previous_health else None,
                row_count=(
                    int(row_count)
                    if isinstance(row_count, (int, float)) and row_count >= 0
                    else (previous_health.row_count if previous_health else None)
                ),
                observed_at=now,
            )
            self.repository.upsert(
                "dataset_health", event.dataset_id, model_payload(health)
            )
        freshness = metrics.get("dataset.freshness_seconds")
        if isinstance(freshness, (int, float)) and freshness >= 0:
            sla_id = f"freshness:{event.dataset_id}"
            previous_payload = self.repository.get("sla_status", sla_id)
            target = previous_payload["target_freshness_seconds"] if previous_payload else 300
            state = (
                HealthState.CRITICAL
                if freshness > target
                else (
                    HealthState.DEGRADED
                    if previous_health and previous_health.quality_score is not None
                    and previous_health.quality_score < 0.8
                    else HealthState.HEALTHY
                )
            )
            sla = SLAStatus(
                sla_id=sla_id,
                dataset_id=event.dataset_id,
                state=state,
                target_freshness_seconds=target,
                current_freshness_seconds=float(freshness),
                observed_at=now,
            )
            self.repository.upsert("sla_status", sla_id, model_payload(sla))
            health = DatasetHealth(
                dataset_id=event.dataset_id,
                state=state,
                quality_score=previous_health.quality_score if previous_health else None,
                freshness_seconds=float(freshness),
                row_count=previous_health.row_count if previous_health else None,
                observed_at=now,
            )
            self.repository.upsert("dataset_health", event.dataset_id, model_payload(health))
        if event.event_type == "schema_version":
            schema = self._schema_for_event(event)
            if schema is not None:
                self.repository.upsert(
                    "schema_version",
                    f"{schema.dataset_id}:{schema.version}",
                    model_payload(schema),
                )

    def _schema_for_event(self, event: ObservabilityEvent) -> SchemaVersion | None:
        if not event.dataset_id:
            return None
        version = str(event.attributes.get("version", "1.0"))
        records = self.data_provider.get_records(event.dataset_id, limit=1, latest_batch_only=True)
        fields = {
            key: type(value).__name__
            for key, value in (records[0].items() if records else ())
            if not key.startswith("_")
        }
        return SchemaVersion(
            dataset_id=event.dataset_id,
            version=version,
            fields=fields,
            observed_at=event.occurred_at,
        )

    def _lineage_graph(self):
        from shared.contracts import LineageEdge, LineageGraph, LineageNode

        return LineageGraph(
            nodes=[LineageNode.model_validate(item) for item in self.repository.list("lineage_node")],
            edges=[LineageEdge.model_validate(item) for item in self.repository.list("lineage_edge")],
            generated_at=datetime.now(UTC),
        )

    @staticmethod
    def _validate_metrics(event: ObservabilityEvent) -> None:
        if not 1 <= len(event.event_type) <= 128:
            raise ValueError("event_type must contain between 1 and 128 characters.")
        if len(event.message) > 2000:
            raise ValueError("message must not exceed 2000 characters.")
        if len(json.dumps(event.attributes, separators=(",", ":"))) > 16_384:
            raise ValueError("attributes must not exceed 16384 serialized characters.")
        metric_names = [metric.name for metric in event.metrics]
        if len(metric_names) != len(set(metric_names)):
            raise ValueError("An event must not contain duplicate metric names.")
        bounded_unit_metrics = {"dataset.quality_score", "dataset.null_rate", "dataset.duplicate_rate"}
        nonnegative_metrics = {
            "dataset.row_count",
            "dataset.freshness_seconds",
            "pipeline.duration",
            "pipeline.records_in",
            "pipeline.records_out",
            "pipeline.records_failed",
            "pipeline.records_rejected",
        }
        for metric in event.metrics:
            if not 1 <= len(metric.name) <= 128:
                raise ValueError("metric names must contain between 1 and 128 characters.")
            if metric.name in bounded_unit_metrics | nonnegative_metrics:
                value = metric.value
                if isinstance(value, bool) or not isinstance(value, (int, float)) or not isfinite(float(value)):
                    raise ValueError(f"Metric {metric.name} must be a finite number.")
                if metric.name in bounded_unit_metrics and not 0 <= value <= 1:
                    raise ValueError(f"Metric {metric.name} must be between 0 and 1.")
                if metric.name in nonnegative_metrics and value < 0:
                    raise ValueError(f"Metric {metric.name} must be non-negative.")
                if metric.name in {
                    "dataset.row_count",
                    "pipeline.records_in",
                    "pipeline.records_out",
                    "pipeline.records_failed",
                    "pipeline.records_rejected",
                } and not float(value).is_integer():
                    raise ValueError(f"Metric {metric.name} must be an integer.")
