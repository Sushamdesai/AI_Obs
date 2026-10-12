from datetime import UTC, datetime
from uuid import UUID

from shared.contracts import (
    DataMetric,
    DataSource,
    Dataset,
    DatasetLayer,
    DatasetHealth,
    EventStatus,
    HealthState,
    LineageEdge,
    LineageGraph,
    LineageNode,
    ObservabilityEvent,
    Pipeline,
    PipelineRun,
    QualityResult,
    SchemaVersion,
    Severity,
)

FIXTURE_TIME = datetime(2026, 10, 9, 8, 30, tzinfo=UTC)

SOURCES = [
    DataSource(source_id="claims", name="Claims", source_type="transactional"),
    DataSource(source_id="policies", name="Policy", source_type="transactional"),
    DataSource(source_id="customers", name="Customer CRM", source_type="crm"),
    DataSource(source_id="payments", name="Payments", source_type="transactional"),
    DataSource(source_id="bureau", name="Bureau", source_type="file"),
    DataSource(source_id="telematics", name="Telematics", source_type="stream"),
]

PIPELINES = [
    Pipeline(pipeline_id=f"{source.source_id}-ingestion", name=f"{source.name} Ingestion", source_id=source.source_id)
    for source in SOURCES
]

_source_by_dataset = {
    "claims": "claims",
    "policies": "policies",
    "customers": "customers",
    "payments": "payments",
    "bureau": "bureau",
    "telematics": "telematics",
}
DATASETS = [
    Dataset(
        dataset_id=f"{layer}.{source_name}",
        name=f"{layer}.{source_name}",
        layer=DatasetLayer(layer),
        source_id=_source_by_dataset[source_name],
    )
    for layer in ("bronze", "silver")
    for source_name in _source_by_dataset
] + [
    Dataset(dataset_id="feature.risk_features", name="Risk Features", layer=DatasetLayer.FEATURE, source_id="bureau"),
    Dataset(
        dataset_id="feature.driving_features",
        name="Driving Features",
        layer=DatasetLayer.FEATURE,
        source_id="telematics",
    ),
    Dataset(dataset_id="gold.claims_analytics", name="Claims Analytics", layer=DatasetLayer.GOLD),
    Dataset(dataset_id="gold.customer_360", name="Customer 360", layer=DatasetLayer.GOLD),
    Dataset(dataset_id="gold.fraud_features", name="Fraud Features", layer=DatasetLayer.GOLD),
    Dataset(dataset_id="gold.risk_scoring", name="Risk Scoring", layer=DatasetLayer.GOLD),
    Dataset(dataset_id="gold.feature_store", name="Feature Store", layer=DatasetLayer.GOLD),
]

DATASET_HEALTH = [
    DatasetHealth(
        dataset_id=dataset.dataset_id,
        state=HealthState.HEALTHY,
        quality_score=0.99,
        freshness_seconds=60,
        row_count=1000,
        observed_at=FIXTURE_TIME,
    )
    for dataset in DATASETS
]

QUALITY_RESULTS = [
    QualityResult(
        check_id=f"{dataset.dataset_id}-baseline-quality",
        dataset_id=dataset.dataset_id,
        passed=True,
        score=0.99,
        evaluated_at=FIXTURE_TIME,
        message="Deterministic healthy fixture.",
    )
    for dataset in DATASETS
]

SCHEMA_VERSIONS = [
    SchemaVersion(
        dataset_id="bronze.claims",
        version="1.0",
        fields={"claim_id": "string", "policy_id": "string", "claim_status": "string"},
        observed_at=FIXTURE_TIME,
    )
]

PIPELINE_RUNS = [
    PipelineRun(
        run_id=f"{pipeline.pipeline_id}-run-001",
        pipeline_id=pipeline.pipeline_id,
        status="succeeded",
        started_at=FIXTURE_TIME,
        completed_at=FIXTURE_TIME,
        records_in=1000,
        records_out=1000,
        correlation_id=f"corr-{pipeline.source_id}-001",
    )
    for pipeline in PIPELINES
]

_node_specs = [
    ("source.claims", "source", "Claims"),
    ("ingestion.claims", "ingestion", "Claims Ingestion"),
    ("schema.claims", "schema", "Claims Schema"),
    ("quality.claims", "quality_check", "Claims Quality"),
    ("bronze.claims", "dataset", "Bronze Claims"),
    ("silver.claims", "dataset", "Silver Claims"),
    ("source.policies", "source", "Policy"),
    ("ingestion.policies", "ingestion", "Policy Ingestion"),
    ("quality.policies", "quality_check", "Policy Quality"),
    ("silver.policies", "dataset", "Silver Policy"),
    ("source.customers", "source", "Customer CRM"),
    ("ingestion.customers", "ingestion", "Customer Ingestion"),
    ("quality.customers", "quality_check", "Customer Quality"),
    ("silver.customers", "dataset", "Silver Customer"),
    ("source.payments", "source", "Payments"),
    ("ingestion.payments", "ingestion", "Payment Ingestion"),
    ("quality.payments", "quality_check", "Payment Quality"),
    ("silver.payments", "dataset", "Silver Payments"),
    ("source.bureau", "source", "Bureau"),
    ("landing.bureau", "ingestion", "File Landing"),
    ("quality.bureau", "quality_check", "Bureau Quality"),
    ("feature.risk_features", "feature", "Risk Features"),
    ("source.telematics", "source", "Telematics"),
    ("ingestion.telematics", "ingestion", "Stream Ingestion"),
    ("quality.telematics", "quality_check", "Telematics Quality"),
    ("feature.driving_features", "feature", "Driving Features"),
    ("gold.claims_analytics", "data_product", "Claims Analytics"),
    ("gold.customer_360", "data_product", "Customer 360"),
    ("gold.feature_store", "data_product", "Feature Store"),
    ("ai.fraud_risk_scoring", "ai_product", "Fraud/Risk Scoring"),
]

LINEAGE_NODES = [
    LineageNode(
        node_id=node_id,
        node_type=node_type,
        label=label,
        health=HealthState.HEALTHY,
        metadata={"fixture": True},
    )
    for node_id, node_type, label in _node_specs
]

_edge_specs = [
    ("source.claims", "ingestion.claims", "feeds"),
    ("ingestion.claims", "schema.claims", "produces_schema"),
    ("schema.claims", "quality.claims", "validates_schema"),
    ("quality.claims", "bronze.claims", "validates"),
    ("bronze.claims", "silver.claims", "transforms_to"),
    ("source.policies", "ingestion.policies", "feeds"),
    ("ingestion.policies", "quality.policies", "feeds"),
    ("quality.policies", "silver.policies", "validates"),
    ("source.customers", "ingestion.customers", "feeds"),
    ("ingestion.customers", "quality.customers", "feeds"),
    ("quality.customers", "silver.customers", "validates"),
    ("source.payments", "ingestion.payments", "feeds"),
    ("ingestion.payments", "quality.payments", "feeds"),
    ("quality.payments", "silver.payments", "validates"),
    ("source.bureau", "landing.bureau", "lands_file"),
    ("landing.bureau", "quality.bureau", "feeds"),
    ("quality.bureau", "feature.risk_features", "produces"),
    ("source.telematics", "ingestion.telematics", "streams_to"),
    ("ingestion.telematics", "quality.telematics", "feeds"),
    ("quality.telematics", "feature.driving_features", "produces"),
    ("silver.claims", "gold.claims_analytics", "contributes_to"),
    ("silver.policies", "gold.claims_analytics", "contributes_to"),
    ("silver.claims", "gold.customer_360", "contributes_to"),
    ("silver.policies", "gold.customer_360", "contributes_to"),
    ("silver.customers", "gold.customer_360", "contributes_to"),
    ("silver.payments", "gold.customer_360", "contributes_to"),
    ("silver.claims", "gold.feature_store", "contributes_to"),
    ("silver.policies", "gold.feature_store", "contributes_to"),
    ("feature.risk_features", "gold.feature_store", "contributes_to"),
    ("feature.driving_features", "gold.feature_store", "contributes_to"),
    ("gold.feature_store", "ai.fraud_risk_scoring", "feeds"),
]

LINEAGE_EDGES = [
    LineageEdge(source_node_id=source, target_node_id=target, relationship=relationship)
    for source, target, relationship in _edge_specs
]

MOTOR_LINEAGE = LineageGraph(
    nodes=LINEAGE_NODES,
    edges=LINEAGE_EDGES,
    line_of_business="motor",
    generated_at=FIXTURE_TIME,
)

_event_types = (
    ("healthy_dataset", Severity.INFO, EventStatus.RESOLVED, "silver.claims", "Healthy dataset baseline."),
    ("quality_failure", Severity.ERROR, EventStatus.DETECTED, "silver.claims", "Claim policy_id null-rate threshold exceeded."),
    ("schema_drift", Severity.WARNING, EventStatus.DETECTED, "bronze.claims", "Claims schema version differs from expected version."),
    ("volume_anomaly", Severity.WARNING, EventStatus.DETECTED, "feature.driving_features", "Telematics volume is below the baseline."),
    ("freshness_violation", Severity.ERROR, EventStatus.DETECTED, "silver.payments", "Payments dataset exceeded its freshness target."),
    ("pipeline_failure", Severity.CRITICAL, EventStatus.DETECTED, "silver.policies", "Policy ingestion pipeline failed."),
)

EVENT_FIXTURES = [
    ObservabilityEvent(
        event_id=UUID(f"00000000-0000-4000-8000-{index:012d}"),
        event_type=event_type,
        occurred_at=FIXTURE_TIME,
        correlation_id=f"fixture-correlation-{event_type}",
        run_id=f"fixture-run-{index:03d}",
        source_id=dataset.split(".")[-1],
        pipeline_id="policy-ingestion" if event_type == "pipeline_failure" else None,
        dataset_id=dataset,
        line_of_business="motor",
        severity=severity,
        status=status,
        metrics=[
            DataMetric(name="dataset.row_count", value=1000),
            DataMetric(name="dataset.quality_score", value=0.99 if event_type == "healthy_dataset" else 0.62),
        ],
        attributes={"fixture": True},
        message=message,
    )
    for index, (event_type, severity, status, dataset, message) in enumerate(_event_types, start=1)
]

EVENT_FIXTURES_BY_TYPE = {event.event_type: event for event in EVENT_FIXTURES}
