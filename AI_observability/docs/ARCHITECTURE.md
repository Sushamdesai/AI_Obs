# Architecture Overview

## Design intent

InsuraObserve AI is a data observability platform for synthetic motor insurance data. The platform observes six parallel source systems without assuming a linear data flow. The core product is a lineage-first health surface that prioritizes dataset quality, freshness, volume, SLA, and incident impact over infrastructure metrics.

## Architectural layers

1. Source simulators: synthetic insurance data producers for claims, policies, customers, payments, bureau, and telematics.
2. Data platform abstraction: `local` or `databricks` provider with bronze, silver, and gold layers.
3. Observability engine: custom Python engine plus optional Dynatrace/OpenTelemetry adapters.
4. Agent layer: deterministic evidence-based reasoning and optional Gemini augmentation.
5. API layer: FastAPI endpoints under `/api/v1/` exposing health, datasets, incidents, lineage, SLA, and remediation interfaces.
6. Frontend: React + TypeScript UI for the Data Command Center, lineage DAG, dataset explorer, and incident center.

## Domain boundaries

- Line of business is supported as metadata on all assets.
- Each dataset remains autonomous; the platform supports multiple convergence points via data products.
- All failures are introduced in simulation data generation; no direct dashboard health mutation is permitted.

## Shared contracts

All modules rely on shared Pydantic contracts defined under `shared/contracts.py` and documented in `docs/API_CONTRACT.md` and `docs/EVENT_SCHEMA.md`.

The API serves deterministic development fixtures under `/api/v1/dev/`. This gives backend, agent, and frontend contributors usable source, dataset, event, and lineage data before simulator loops or vendor integrations exist.

## Bootable foundation

- Run locally with `python -m pip install -r requirements.txt` then `python -m uvicorn backend.app.main:app --reload --env-file .env` (after copying `.env.example` to `.env`).
- Run tests with `python -m pytest -q`.
- Application metadata uses PostgreSQL in Docker and runs through Alembic migrations at startup; standalone local development uses `.local/metadata.sqlite3` when `DATABASE_URL` is blank. Business records remain in the data-platform provider.
- API health is independent of external providers; external adapters report `not_configured` until a real connection is implemented and verified.

## Member 1 data platform implementation

- `simulator/` produces deterministic, seedable synthetic batches for the six independent motor sources, validates controlled failure injection, and can run at a configurable interval.
- `LocalDataPlatformProvider` stores append-only batch records in SQLite. It writes raw bronze, typed/validated silver, feature datasets, and synthetic gold product inputs.
- The data processing example is explanatory only; it does not represent underwriting or fraud decisions.
- Canonical pipeline events are returned per cycle and may be published to a caller-supplied event sink. This module emits evidence but does not implement observability detection or change UI state.
- Databricks SQL setup is an explicit, additive script. The provider remains `not_configured` and uses local fallback until a tested Databricks SQL client is added.

## Backend persistence and APIs

- PostgreSQL stores metadata and observability state only: catalog contracts, health/quality summaries, schema versions, pipeline runs, metrics/events, lineage, incidents/timelines, agent findings/RCA, SLA, remediation, and verification records.
- Data rows are read from the configured data-platform provider; they are not copied into metadata storage. Dataset preview is capped at 100 rows and omits sensitive-looking fields.
- FastAPI routes call backend services, which use the data-platform and observability provider interfaces. External credentials are never exposed to clients.
- Lineage traversal uses visited sets and simple-path cycle checks; path enumeration has explicit bounds.

## Agent workflow

- The workflow separates anomaly, RCA, lineage impact, insurance context, SLA, remediation proposal, and verification responsibilities.
- Agents consume typed events, quality/health/SLA summaries, pipeline/schema evidence, and the canonical lineage graph; raw datasets are not sent to Gemini.
- Confidence and lineage impact remain deterministic. Gemini can add only a validated narrative, and provider errors fall back to deterministic explanations.
- Remediation is proposal-only and requires human approval. Verification checks health, quality, freshness, pipeline, schema, volume, and affected-product results.
- Each invocation returns structured per-agent execution records and accepts a persistence callback for backend/Agent Center integration.

## Non-goals for this phase

- No production-grade Databricks integration implementation
- No fake vendor connectivity claims
- No complete UI polish
- No autonomous destructive remediation actions

## Boot flow

- `docker compose up --build` starts the Postgres and backend services.
- The API exposes `/api/v1/health` in local demo mode.
- Provider configuration flows from `.env` and environment variables only.
