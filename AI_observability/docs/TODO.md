# TODOs for Later Phases

- Agree any shared-contract changes with all five members before merging.
- Implement the Databricks SQL client after separately defining and testing its integration scope.
- Add more robust schema-specific validation contracts as shared schemas evolve.
- Add backend agent-execution telemetry and a conversational endpoint that reports structured provider/fallback metadata; the frontend currently presents persisted evidence and deterministic summaries only.
- Add product-level deadline/forecast and historical-health APIs before presenting those values in the frontend.
- Add continuous simulator worker controls (status, pause/resume, reset, and configured interval) only if those are approved as backend capabilities; current UI supports bounded cycle requests only.
- Add end-to-end demo scenarios for healthy baseline, anomalies, human-approved remediation, and verified recovery.
- Run optional live PostgreSQL, Databricks, Dynatrace, and OpenTelemetry integration tests when those services are configured.
