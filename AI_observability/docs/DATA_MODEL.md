# Data Model

## Core object model

- Source systems: `claims`, `policies`, `customers`, `payments`, `bureau`, `telematics`
- Lakes and layers: `bronze`, `silver`, `gold`
- Data products: `claims_analytics`, `customer_360`, `fraud_features`, `risk_scoring`
- Line of business: `motor`

## Canonical data platform tables

- `bronze.claims`, `bronze.policies`, `bronze.customers`, `bronze.payments`, `bronze.bureau`, `bronze.telematics`
- `silver.claims`, `silver.policies`, `silver.customers`, `silver.payments`, `silver.bureau`, `silver.telematics`
- `gold.claims_analytics`, `gold.customer_360`, `gold.fraud_features`, `gold.risk_scoring`

Deterministic development fixtures include the canonical bronze and silver tables, gold products, plus the risk and driving feature datasets used by the lineage graph.

## Shared metadata

Every dataset, lineage node, and incident should carry:

- `line_of_business`
- `source_system`
- `dataset_name`
- `schema_version`
- `observed_at_utc`
- `correlation_id`

## Canonical shared contracts

The stable Pydantic contract module (`shared/contracts.py`) defines `DataSource`, `Pipeline`, `PipelineRun`, `Dataset`, `DatasetHealth`, `QualityResult`, `DataMetric`, `SchemaVersion`, `LineageNode`, `LineageEdge`, `LineageGraph`, `ObservabilityEvent`, `Incident`, `IncidentTimelineEvent`, `AgentFinding`, `RCAResult`, `ConfidenceFactor`, `SLAStatus`, `RemediationPlan`, and `VerificationResult`.

Enums are serialized using snake_case string values. All datetime fields require a timezone and normalize to UTC. New shared-contract changes require coordination across all five members.

## Data quality expectations

- Quality checks are deterministic and traceable.
- Freshness and volume anomalies should map to evidence before LLM interpretation.
- Synthetic data must avoid real customer PII.

## Local processing behavior

- Bronze records preserve raw generated values, including controlled bad values during an injected scenario.
- Silver rows require essential fields and valid source relationships, are deduplicated within the batch, normalize numeric types, and include schema/LOB metadata. Rejected rows remain observable through counts and canonical quality measurements.
- Gold outputs are synthetic representations: claims analytics, customer aggregates, risk/telematics feature inputs, fraud features, and risk-scoring inputs. They are not production insurance decisions.
- SQLite stores batches using `(dataset_id, batch_id, record_id)` keys; repeat writes for the same batch/record are idempotent.
