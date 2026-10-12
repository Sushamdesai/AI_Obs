# InsuraObserve AI

InsuraObserve AI is an architecture-first Data Observability platform for synthetic insurance data. The project is intentionally scoped to a local/demo-ready foundation for the insurance domain, with provider adapters for Databricks, Dynatrace, OpenTelemetry, and Gemini while ensuring the core system works without any vendor dependency.

## Goals

- Observe synthetic motor insurance datasets from claims, policies, CRM, payments, bureau, and telematics.
- Support data quality, freshness, volume, lineage, SLA, incident correlation, and agent-led RCA.
- Keep the observability engine vendor-neutral and intentionally modular.
- Ensure local/demo mode works without Databricks, Dynatrace, or Gemini.
- Keep intelligence grounded in evidence instead of raw insurance datasets in LLM prompts.

## Monorepo layout

- `backend/` – FastAPI service and API contract.
- `shared/` – canonical Pydantic schemas and domain contracts.
- `observability/` – deterministic data-quality, freshness, volume, schema-drift, anomaly, health, incident-correlation, and confidence engines.
- `simulator/` – synthetic live data generation and failure injection.
- `agents/` – orchestration and evidence-grounded investigation agents.
- `frontend/` – React + TypeScript data-observability application with shared UI system, API client, and backend-backed product screens.
- `docs/` – architecture, API, data model, provider strategy, and team ownership documents.
- `tests/` – validation boundaries for shared schemas and endpoints.

## Quick start

Python 3.11+ is required (the container uses Python 3.12).

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
python -m uvicorn backend.app.main:app --reload --env-file .env
```

Verify API health from another terminal:

```powershell
Invoke-RestMethod http://localhost:8000/api/v1/health
```

The API applies Alembic migrations at startup. PostgreSQL is the shared metadata store; standalone local development falls back to `.local/metadata.sqlite3` when `DATABASE_URL` is blank. Business records remain in the data-platform provider. Docker starts the API and PostgreSQL:

```powershell
docker compose up --build
```

## Frontend development

With the backend running, start the React workspace in a second terminal:

```powershell
Set-Location frontend
npm install
Copy-Item .env.example .env
npm run dev
```

The frontend uses the FastAPI `/api/v1` boundary through the Vite `/api` proxy. Run `npm test` and `npm run build` from `frontend/`. Contract-shaped mock data is available only when `VITE_DEMO_MOCKS=true` is explicitly set in `frontend/.env`.

Docker configures its backend to use the PostgreSQL service. For a local API process connecting to a separately started local PostgreSQL instance, set:

```powershell
$env:DATABASE_URL = "postgresql+psycopg://insuraobserve@localhost:5432/insuraobserve"
```

The bundled PostgreSQL service uses local-only `trust` authentication. Do not expose or reuse this configuration outside isolated local development.

To run Alembic migrations manually against the configured `DATABASE_URL`:

```powershell
python -m alembic upgrade head
```

## Development fixture APIs

The `/api/v1/dev/` endpoints expose deterministic contract-backed fixtures:

- `GET /api/v1/dev/sources`
- `GET /api/v1/dev/pipelines`
- `GET /api/v1/dev/pipeline-runs`
- `GET /api/v1/dev/datasets`
- `GET /api/v1/dev/dataset-health`
- `GET /api/v1/dev/quality-results`
- `GET /api/v1/dev/schema-versions`
- `GET /api/v1/dev/lineage`
- `GET /api/v1/dev/events`
- `GET /api/v1/dev/events/{event_type}`

These are development fixtures, not live integration claims or mutable simulator controls.

## Backend domain APIs

The versioned backend serves sources, datasets and bounded previews, pipelines/runs, lineage traversals, quality results, events, incidents/timelines/RCA, agent findings, SLA, remediation/verification, and bounded simulator cycles. See [docs/API_CONTRACT.md](docs/API_CONTRACT.md) for request/response contracts. Dataset previews are limited to 100 records.

## Synthetic source simulation

Run a bounded local pipeline demonstration:

```powershell
python -m simulator --cycles 2
```

Run continuously until `Ctrl+C`:

```powershell
python -m simulator
```

Each cycle independently generates synthetic claims, policies, customers, payments, bureau, and telematics batches, then writes bronze and validated silver records to SQLite and produces explainable gold data products. The default local SQLite file is `.local/insuraobserve.sqlite3` (ignored by Git). Set `LOCAL_DATA_PATH=:memory:` for ephemeral in-memory storage. Batch size and interval are configurable through `SIMULATOR_BATCH_SIZE` and `SIMULATOR_INTERVAL_SECONDS`, or the `--batch-size` and `--interval-seconds` CLI options.

Failure scenarios are disabled by default. For example, run two cycles with bad claims references on both cycles:

```powershell
python -m simulator --cycles 2 --failure CLAIMS_QUALITY_FAILURE
```

Available injection flags: `CLAIMS_QUALITY_FAILURE`, `SCHEMA_DRIFT`, `TELEMATICS_VOLUME_DROP`, `FRESHNESS_VIOLATION`, `PII_PROCESSING_FAILURE`, and `PIPELINE_DELAY`. These alter generated batches or pipeline update behavior; they do not directly set UI or observability health.

## Provider strategy

- Data platform provider: `local` or `databricks`
- Observability provider: `local`, `dynatrace`, or `opensource`
- LLM provider: `deterministic` or `gemini`

The application never hard-codes secrets. Provider integrations are opt-in via environment variables and adapter boundaries. The local adapter stores canonical events and exposes deterministic findings, correlated incidents, and confidence results. Dynatrace uses its Events API only when `DYNATRACE_URL` and `DYNATRACE_API_TOKEN` are set; it reports `not_configured` until a successful delivery, and reports `unavailable` on HTTP/network failure without interrupting local processing. The vendor-neutral OpenTelemetry adapter requires an endpoint and a supplied exporter; it has no mandatory SDK or collector dependency.

External adapters export allowlisted event metadata and numeric data/pipeline metrics only. Event messages and arbitrary attributes are never exported. Deterministic confidence weights are temporal correlation 0.20, lineage proximity 0.25, anomaly strength 0.20, signature match 0.20, and evidence consistency 0.15. No LLM computes confidence.

## Architecture principles

- Synthetic insurance data only.
- No real customer PII.
- Redistribute data products per line of business with `line_of_business` metadata.
- Use UTC internally and add correlation IDs to all signals.
- Prefer deterministic calculations before LLM narrative additions.
- Human approval is required for consequential remediation in the MVP.
- Agent workflows consume typed observability evidence; they do not inspect raw datasets. RCA confidence and lineage impact are deterministic, Gemini can only augment a validated narrative, and remediation proposals never execute automatically.

## Test suite

```powershell
python -m pytest -q
python -m compileall backend shared observability simulator agents tests
```

## Manual prerequisites

- Python 3.11+ for local development; Docker uses Python 3.12
- Docker Desktop or Docker Engine for the shared PostgreSQL setup
- Optional: Databricks credentials and Dynatrace configuration only when actually testing those integrations

## Databricks setup

`databricks/setup.sql` contains additive, idempotent `CREATE ... IF NOT EXISTS` statements for the configured catalog and bronze/silver/gold tables. Review and run it explicitly in Databricks; the application never runs DDL automatically. Environment variables are `DATABRICKS_HOST`, `DATABRICKS_HTTP_PATH`, `DATABRICKS_TOKEN`, and `DATABRICKS_CATALOG`. The current provider has no live Databricks client, so it reports `not_configured` and serves the local SQLite fallback even when valid-looking settings are supplied.

## TODOs for later phases

- Wire agent execution records into persistent backend storage and the Agent Center API.
- Implement detailed React screens for lineage, incident center, and agent center.
- Add real-time simulator-driven demo scenarios and playbook tests.
- Add opt-in live Dynatrace and OpenTelemetry integration tests when credentials and an exporter are explicitly available.
