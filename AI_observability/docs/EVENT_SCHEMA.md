# Event Schema

## Envelope

```json
{
  "event_id": "uuid",
  "event_type": "data_quality_changed",
  "occurred_at": "2026-10-09T08:30:00Z",
  "correlation_id": "run-abc123",
  "run_id": "claims-run-001",
  "source_id": "claims",
  "pipeline_id": "claims-ingestion",
  "dataset_id": "silver.claims",
  "line_of_business": "motor",
  "severity": "warning",
  "status": "detected",
  "metrics": [
    {"name": "dataset.quality_score", "value": 0.91}
  ],
  "attributes": {},
  "message": "Dataset quality changed."
}
```

The event envelope is represented by `shared.contracts.ObservabilityEvent`. All fixture event IDs and timestamps are deterministic. Event IDs are UUIDs; timestamps are timezone-aware UTC.

## Supported signal families

- `dataset.row_count`
- `dataset.null_rate`
- `dataset.duplicate_rate`
- `dataset.quality_score`
- `dataset.freshness_seconds`
- `dataset.schema_version`
- `pipeline.status`
- `pipeline.duration`
- `pipeline.records_in`
- `pipeline.records_out`
- `pipeline.records_failed`
- `pipeline.records_rejected`

Canonical demo fixtures are `healthy_dataset`, `quality_failure`, `schema_drift`, `volume_anomaly`, `freshness_violation`, and `pipeline_failure`. Retrieve them from `GET /api/v1/dev/events` or by fixture name.

## Event handling rules

- Events are emitted by deterministic calculations first.
- Vendor integrations are optional and cannot override core event semantics.
- An incident may aggregate multiple related signals under one root cause.
