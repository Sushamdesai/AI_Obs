# API Contract

All APIs use the versioned prefix `/api/v1/`.

## Core endpoints

### `GET /api/v1/health`
Returns API health, demo mode, correlation ID, and provider configuration state. `ready` means the local deterministic adapter can be used. `not_configured` means an optional external provider is unavailable; it does not make the local API unhealthy.

Example response:

```json
{
  "status": "healthy",
  "service_name": "InsuraObserve AI",
  "version": "0.1.0",
  "demo_mode": true,
  "providers": {
    "data_platform": "ready",
    "observability": "ready",
    "llm": "ready"
  },
  "checks": [
    {
      "name": "api",
      "status": "healthy",
      "details": "API is ready."
    },
    {
      "name": "metadata_database",
      "status": "healthy",
      "details": "Metadata database is ready."
    }
  ],
  "correlation_id": "generated-or-request-supplied-id"
}
```

### Development fixture endpoints

`/api/v1/dev/` hosts deterministic, read-only fixtures for sources, pipelines, pipeline runs, datasets, health, quality, schema versions, lineage, and event samples. These endpoints use the canonical shared Pydantic contracts and do not invoke external providers. Unknown event fixture names return a structured `404` error.

## Backend endpoints

| Route | Contract |
|---|---|
| `GET /api/v1/sources[/{source_id}]` | `DataSource` list or one source |
| `GET /api/v1/datasets` | `Dataset[]` |
| `GET /api/v1/datasets/{dataset_id}` | Dataset detail: dataset, platform, health, latest quality, schema history, last run, lineage neighbors/consumers, row count |
| `GET /api/v1/datasets/{dataset_id}/preview?limit=20` | Capped `DatasetPreview`; `limit` is 1–100 |
| `GET /api/v1/pipelines` | `Pipeline[]` |
| `GET /api/v1/pipelines/runs?pipeline_id=...&limit=100` | `PipelineRun[]` |
| `GET /api/v1/lineage?anchor=...` | Full or anchor-reachable `LineageGraph` |
| `GET /api/v1/lineage/upstream/{node_id}` / `downstream/{node_id}` | Reachable `LineageNode[]` |
| `GET /api/v1/lineage/paths?source=...&target=...` | Bounded simple paths as node-ID arrays |
| `GET /api/v1/lineage/blast-radius/{node_id}` | Reachable downstream `LineageNode[]` |
| `GET /api/v1/quality?dataset_id=...` / `POST /api/v1/quality` | `QualityResult[]` / persisted `QualityResult` |
| `GET /api/v1/events?dataset_id=...` / `POST /api/v1/events` | Canonical `ObservabilityEvent[]` / ingest and process one event |
| `/api/v1/incidents` | List/create `Incident`; `GET /{id}`, `GET /{id}/events`, `GET /{id}/rca`, and `PATCH /{id}` for status transitions |
| `/api/v1/agents/findings` | List or persist `AgentFinding`; `/api/v1/agents/rca/{incident_id}` gets or stores an `RCAResult` |
| `/api/v1/sla` | List or persist `SLAStatus`; `GET /{sla_id}` retrieves one |
| `/api/v1/remediation` | List/create `RemediationPlan`; `GET /{plan_id}` retrieves one plan, `/{plan_id}/approval` records human approval, and `/{plan_id}/verification` records or lists `VerificationResult` records |
| `GET /api/v1/simulator` / `POST /api/v1/simulator/cycles` | Demo status and bounded synthetic cycles with optional deterministic failure scenarios |

Invalid entities return structured `404` errors; invalid query/body values return structured `422` errors. Incident lifecycle transitions are validated. Remediation requires a separate human approval action before verification can be recorded.

## Persistence

PostgreSQL is the shared metadata database; Alembic migrations run at application startup. A standalone local run falls back to `.local/metadata.sqlite3` if `DATABASE_URL` is blank. Metadata, observability results, and incident state are persisted; full business data remains behind the data-platform provider.

## Response conventions

- Use UTC timestamps.
- Always include a correlation ID where available.
- Use structured error payloads with `code`, `message`, `details`, and `correlation_id`.
- Do not expose raw vendor credentials or PII.
