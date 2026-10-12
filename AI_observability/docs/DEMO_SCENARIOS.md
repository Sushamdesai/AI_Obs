# Demo Scenarios

## Healthy baseline
- All source simulators emit deterministic premium-quality batches.
- Lineage graph is green and consistent.
- No incident is active.
- Run two cycles with `python -m simulator --cycles 2`; SQLite stores bronze, silver, and product batches locally.

## Claims quality failure
- Generator introduces controlled nulls or mismatched claim statuses.
- Enable with `python -m simulator --cycles 2 --failure CLAIMS_QUALITY_FAILURE`.
- Silver claims quality drops.
- Incident correlates with downstream fraud feature impact.

## Schema drift
- `policy_id` becomes null or renamed temporarily.
- Enable with `python -m simulator --cycles 2 --failure SCHEMA_DRIFT`.
- Observability engine triggers schema drift alerts.
- RCA traces to source ingestion drift rather than a direct pipeline crash.

## Telematics volume drop
- Telematics feeds underproduce rows.
- Enable with `python -m simulator --cycles 2 --failure TELEMATICS_VOLUME_DROP`.
- Freshness and volume monitors trigger a degraded state.
- Impact surfaces in the fraud feature and risk scoring datasets.

## Freshness violation
- A pipeline delays updates beyond the configured SLA.
- Enable with `python -m simulator --cycles 2 --failure FRESHNESS_VIOLATION`.
- Incident center shows delayed data freshness and SLA risk.

## Approved remediation path
- Agent prepares recommendations.
- Human approves or rejects.
- Safe simulation verifies expected data restoration.
- Incident closes when verification metrics recover.

## Other controlled pipeline scenarios

- `PII_PROCESSING_FAILURE` rejects selected synthetic rows during the simulated masking check; it does not introduce real PII.
- `PIPELINE_DELAY` pauses selected/all pipeline processing for a bounded configurable delay.
