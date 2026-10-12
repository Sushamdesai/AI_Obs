from datetime import UTC, datetime
from uuid import UUID

import pytest
from pydantic import ValidationError

from backend.app.providers.fixtures import DATASETS, EVENT_FIXTURES, MOTOR_LINEAGE
from shared.contracts import DataSource, ObservabilityEvent


def test_contract_schema_serialization_uses_snake_case() -> None:
    source = DataSource(source_id="claims", name="Claims", source_type="transactional")
    assert source.model_dump(mode="json") == {
        "source_id": "claims",
        "name": "Claims",
        "source_type": "transactional",
        "line_of_business": "motor",
        "status": "healthy",
        "attributes": {},
    }


def test_event_contract_requires_valid_uuid_and_timestamp() -> None:
    event = EVENT_FIXTURES[0]
    serialized = event.model_dump(mode="json")
    restored = ObservabilityEvent.model_validate(serialized)
    assert isinstance(restored.event_id, UUID)
    assert restored.occurred_at == datetime(2026, 10, 9, 8, 30, tzinfo=UTC)
    with pytest.raises(ValidationError):
        ObservabilityEvent.model_validate({**serialized, "event_id": "not-a-uuid"})
    with pytest.raises(ValidationError):
        ObservabilityEvent.model_validate(
            {**serialized, "occurred_at": "2026-10-09T08:30:00"}
        )


def test_dataset_fixture_covers_canonical_layers_and_insurance_sources() -> None:
    dataset_ids = {dataset.dataset_id for dataset in DATASETS}
    for layer in ("bronze", "silver"):
        for source in ("claims", "policies", "customers", "payments", "bureau", "telematics"):
            assert f"{layer}.{source}" in dataset_ids
    assert {
        "gold.claims_analytics",
        "gold.customer_360",
        "gold.fraud_features",
        "gold.risk_scoring",
    } <= dataset_ids
    assert all(dataset.line_of_business == "motor" for dataset in DATASETS)


def test_all_required_deterministic_event_scenarios_exist() -> None:
    assert {event.event_type for event in EVENT_FIXTURES} == {
        "healthy_dataset",
        "quality_failure",
        "schema_drift",
        "volume_anomaly",
        "freshness_violation",
        "pipeline_failure",
    }


def test_lineage_fixture_is_closed_and_contains_required_convergence() -> None:
    node_ids = {node.node_id for node in MOTOR_LINEAGE.nodes}
    assert len(node_ids) == len(MOTOR_LINEAGE.nodes)
    assert all(edge.source_node_id in node_ids for edge in MOTOR_LINEAGE.edges)
    assert all(edge.target_node_id in node_ids for edge in MOTOR_LINEAGE.edges)
    edges = {(edge.source_node_id, edge.target_node_id) for edge in MOTOR_LINEAGE.edges}
    assert ("source.claims", "ingestion.claims") in edges
    assert ("ingestion.claims", "schema.claims") in edges
    assert ("schema.claims", "quality.claims") in edges
    assert ("quality.claims", "bronze.claims") in edges
    assert ("bronze.claims", "silver.claims") in edges
    assert ("silver.customers", "gold.customer_360") in edges
    assert ("feature.risk_features", "gold.feature_store") in edges
    assert ("feature.driving_features", "gold.feature_store") in edges
    assert ("gold.feature_store", "ai.fraud_risk_scoring") in edges


def test_lineage_fixture_contains_all_source_chains_and_gold_products() -> None:
    edges = {(edge.source_node_id, edge.target_node_id) for edge in MOTOR_LINEAGE.edges}
    required_edges = {
        ("source.policies", "ingestion.policies"),
        ("ingestion.policies", "quality.policies"),
        ("quality.policies", "silver.policies"),
        ("source.customers", "ingestion.customers"),
        ("ingestion.customers", "quality.customers"),
        ("quality.customers", "silver.customers"),
        ("source.payments", "ingestion.payments"),
        ("ingestion.payments", "quality.payments"),
        ("quality.payments", "silver.payments"),
        ("source.bureau", "landing.bureau"),
        ("landing.bureau", "quality.bureau"),
        ("quality.bureau", "feature.risk_features"),
        ("source.telematics", "ingestion.telematics"),
        ("ingestion.telematics", "quality.telematics"),
        ("quality.telematics", "feature.driving_features"),
        ("silver.claims", "gold.claims_analytics"),
        ("silver.policies", "gold.claims_analytics"),
        ("silver.claims", "gold.customer_360"),
        ("silver.policies", "gold.customer_360"),
        ("silver.customers", "gold.customer_360"),
        ("silver.payments", "gold.customer_360"),
    }
    assert required_edges <= edges
