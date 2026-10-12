# Team Ownership

## Member 1 — Simulator and Data Platform
- Owns the simulator and source model.
- Owns the data-platform adapter implementations and data platform fixtures in `backend/app/providers/data_platform.py` and `backend/app/providers/fixtures.py`.
- Validates bronze/silver/gold dataset contracts.

## Member 2 — Observability Engine and Adapters
- Owns `observability/`, telemetry, and custom Python observability engine.
- Maintains Dynatrace/open-source adapters and OpenTelemetry instrumentation.
- Defends graceful degradation in local and demo modes.

## Member 3 — Backend, Store, and Contracts
- Owns FastAPI, PostgreSQL integration, lineage API/persistence, and API behavior.
- Owns the canonical shared contract definitions in `shared/contracts.py`; contract changes require coordination and review from all five members.
- Coordinates stability of shared domain services.

## Member 4 — Agent Intelligence
- Owns `agents/`, the orchestrator, evidence preparation, incident analysis, and RCA confidence.
- Verifies that all agent conclusions are evidence-grounded.
- Maintains the deterministic fallback path for local operation.

## Member 5 — Frontend Experience
- Owns `frontend/`, the React + TypeScript DAG and health products.
- Provides the command-center, incident center, and lineage visualizations.
- Ensures that dashboards reflect data health rather than infrastructure health.

## Shared responsibility
- Shared contracts, release quality gates, and cross-cutting security review.
- Changes to shared/core contracts are coordinated across all five members before merging because these contracts are the parallel-work compatibility boundary.
