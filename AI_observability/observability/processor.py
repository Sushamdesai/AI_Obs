from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Mapping, Sequence

from observability.engines import (
    AnomalyDetector,
    ConfidenceEngine,
    CorrelatedIncident,
    EventFinding,
    IncidentCorrelationEngine,
)
from shared.contracts import LineageGraph, ObservabilityEvent, RCAResult


@dataclass
class EventProcessingResult:
    findings: list[EventFinding] = field(default_factory=list)
    incidents: list[CorrelatedIncident] = field(default_factory=list)
    confidence_results: list[RCAResult] = field(default_factory=list)


class DataObservabilityEngine:
    """Consumes canonical events and produces deterministic findings/incidents."""

    def __init__(
        self,
        *,
        anomaly_detector: AnomalyDetector | None = None,
        correlation_engine: IncidentCorrelationEngine | None = None,
        confidence_engine: ConfidenceEngine | None = None,
    ) -> None:
        self.anomaly_detector = anomaly_detector or AnomalyDetector()
        self.correlation_engine = correlation_engine or IncidentCorrelationEngine()
        self.confidence_engine = confidence_engine or ConfidenceEngine()

    def process_events(
        self,
        events: Sequence[ObservabilityEvent],
        *,
        lineage_graph: LineageGraph | None = None,
        volume_anomalies: Mapping[str, bool] | None = None,
        schema_drifts: Mapping[str, bool] | None = None,
        generated_at: datetime | None = None,
    ) -> EventProcessingResult:
        volume_anomalies = volume_anomalies or {}
        schema_drifts = schema_drifts or {}
        findings = [
            finding
            for event in events
            for finding in self.anomaly_detector.detect(
                event,
                volume_anomalous=volume_anomalies.get(str(event.event_id), False),
                schema_drifted=schema_drifts.get(str(event.event_id), False),
            )
        ]
        incidents = self.correlation_engine.correlate(events, lineage_graph=lineage_graph)
        at = generated_at or datetime.now(UTC)
        confidence_results = [
            self.confidence_engine.to_rca_result(
                incident.incident,
                lineage_graph=lineage_graph,
                generated_at=at,
            )
            for incident in incidents
        ]
        return EventProcessingResult(
            findings=findings,
            incidents=incidents,
            confidence_results=confidence_results,
        )

    def process_event(self, event: ObservabilityEvent) -> list[EventFinding]:
        return self.process_events([event]).findings
