from __future__ import annotations

from backend.app.persistence.repository import MetadataRepository
from backend.app.providers.fixtures import (
    DATASET_HEALTH,
    DATASETS,
    EVENT_FIXTURES,
    LINEAGE_EDGES,
    LINEAGE_NODES,
    PIPELINE_RUNS,
    PIPELINES,
    QUALITY_RESULTS,
    SCHEMA_VERSIONS,
    SOURCES,
)
from observability.processor import DataObservabilityEngine
from shared.contracts import (
    AgentFinding,
    Pipeline,
    SLAStatus,
)


def model_payload(value) -> dict:
    return value.model_dump(mode="json")


def seed_catalog(repository: MetadataRepository) -> None:
    seed_groups = (
        ("source", SOURCES, "source_id"),
        ("dataset", DATASETS, "dataset_id"),
        (
            "pipeline",
            [
                *PIPELINES,
                Pipeline(
                    pipeline_id="gold-curation",
                    name="Gold Data Product Curation",
                    source_id="claims",
                ),
            ],
            "pipeline_id",
        ),
        ("pipeline_run", PIPELINE_RUNS, "run_id"),
        ("dataset_health", DATASET_HEALTH, "dataset_id"),
        ("quality_result", QUALITY_RESULTS, "check_id"),
        ("schema_version", SCHEMA_VERSIONS, "dataset_id"),
        ("lineage_node", LINEAGE_NODES, "node_id"),
        ("lineage_edge", LINEAGE_EDGES, None),
    )
    for kind, models, id_field in seed_groups:
        for index, model in enumerate(models):
            record_id = getattr(model, id_field) if id_field else f"{model.source_node_id}:{model.target_node_id}:{index}"
            if repository.get(kind, str(record_id)) is None:
                repository.upsert(kind, str(record_id), model_payload(model))

    for event in EVENT_FIXTURES:
        event_payload = model_payload(event)
        if repository.get("event", str(event.event_id)) is None:
            repository.upsert("event", str(event.event_id), event_payload)
    results = DataObservabilityEngine().process_events(EVENT_FIXTURES)
    for finding in results.findings:
        payload = model_payload(
            AgentFinding(
                finding_id=f"observability:{finding.finding_id}",
                agent_name="custom_observability",
                summary=f"{finding.category}: {'; '.join(finding.evidence)}",
                evidence_event_ids=[finding.event.event_id],
                created_at=finding.event.occurred_at,
            )
        )
        if repository.get("agent_finding", payload["finding_id"]) is None:
            repository.upsert("agent_finding", payload["finding_id"], payload)
    for correlated in results.incidents:
        incident_payload = model_payload(correlated.incident)
        if repository.get("incident", incident_payload["incident_id"]) is None:
            repository.upsert("incident", incident_payload["incident_id"], incident_payload)
        for timeline in correlated.incident.timeline:
            timeline_payload = model_payload(timeline)
            if repository.get("incident_timeline", timeline.timeline_event_id) is None:
                repository.upsert("incident_timeline", timeline.timeline_event_id, timeline_payload)
        confidence = DataObservabilityEngine().confidence_engine.to_rca_result(correlated.incident)
        rca_payload = model_payload(confidence)
        if repository.get("rca_result", rca_payload["incident_id"]) is None:
            repository.upsert("rca_result", rca_payload["incident_id"], rca_payload)

    for health in DATASET_HEALTH:
        sla_id = f"freshness:{health.dataset_id}"
        if repository.get("sla_status", sla_id) is None:
            sla = SLAStatus(
                sla_id=sla_id,
                dataset_id=health.dataset_id,
                state=health.state,
                target_freshness_seconds=300,
                current_freshness_seconds=health.freshness_seconds,
                observed_at=health.observed_at,
            )
            payload = model_payload(sla)
            repository.upsert("sla_status", payload["sla_id"], payload)
