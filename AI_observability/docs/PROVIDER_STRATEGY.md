# Provider Strategy

## Data platform

- Preferred: Databricks when available.
- Local fallback: `LocalDataPlatformProvider` enabling demo and architecture testing without vendor dependencies.
- Abstraction: `DataPlatformProvider` with `LOCAL` and `DATABRICKS` implementations.
- Local provider serves the shared deterministic source, dataset, and lineage fixtures.
- Databricks adapter is a contract boundary only and reports `not_configured`, even when credentials are present, until a client is implemented and tested.
- Local demo storage uses SQLite with `.local/insuraobserve.sqlite3` by default; set `LOCAL_DATA_PATH=:memory:` for an ephemeral store.
- `databricks/setup.sql` is additive and idempotent, and must be run manually after review. No DDL is executed at application startup.

## Observability

- Preferred: Dynatrace when configured and genuinely available.
- Secondary: vendor-neutral OpenTelemetry export boundary; OpenMetadata and OpenLineage remain future adapter options.
- Fallback: custom Python observability engine.
- The custom engine provides deterministic quality, freshness, volume, schema-drift, anomaly, health-evaluation, incident-correlation, and verification results without external services.
- Local adapter stores canonical typed events and exposes findings, correlated incidents, and confidence results in memory.
- Dynatrace reads `DYNATRACE_URL` and `DYNATRACE_API_TOKEN` from environment configuration and exports sanitized event metadata to the Events API. It reports `not_configured` until successful delivery, or `unavailable` after a failed delivery; local processing remains active.
- OpenTelemetry export requires `OTEL_EXPORTER_OTLP_ENDPOINT` and a supplied exporter. No SDK, collector, OpenMetadata, or OpenLineage service is required for the local demo.
- External exporters receive allowlisted event metadata and numeric data/pipeline metrics only; raw event messages and arbitrary attributes are excluded.
- Confidence is deterministic, not LLM-generated. Weights: temporal correlation 0.20, lineage proximity 0.25, anomaly strength 0.20, signature match 0.20, evidence consistency 0.15.

## LLM

- Preferred: Gemini when configured.
- Fallback: `DeterministicFallbackProvider`.
- Rule: do not send raw insurance datasets directly to LLMs. Prepare structured evidence only.
- The agent-owned Gemini adapter reads `GEMINI_API_KEY` and optional `GEMINI_MODEL` from the environment, sends only allowlisted event identifiers/types, dataset and pipeline IDs, severity/status, timestamps, and numeric observability metrics, and never sends event messages, arbitrary attributes, or dataset rows.
- Gemini responses are parsed into a strict structured narrative and checked against observed evidence. Quota, authentication, timeout, network, and malformed-response errors use the deterministic RCA narrative instead; confidence, evidence IDs, and lineage remain deterministic.
- Gemini is reported `not_configured` until a successful request has actually completed. Configuration alone is not reported as a tested connection.
- The deterministic provider works offline. Agent execution records include agent name, timing, status, evidence IDs, finding ID, provider, latency, and sanitized error code; `AgentOrchestrator` returns them and supports an injected persistence sink for backend/Agent Center integration.

## Failure behavior

- Optional export failures degrade gracefully while local event processing continues.
- The application never falsely declares a provider connection when it is absent.
- Core health checks must remain available in local mode.
- `/api/v1/health` exposes provider statuses independently of API health.
