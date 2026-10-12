# Security

## Mandatory rules

- No secrets in source code.
- No real customer PII or production data.
- Only synthetic insurance values should be used.
- Environment variables power all external credentials.
- Human approval is required before consequential remediation.
- The optional Compose-only PostgreSQL dependency uses local `trust` authentication and is strictly for isolated development; never expose it or reuse it in shared/production deployments.

## Provider safety

- Databricks, Dynatrace, and Gemini are optional and must not be treated as required dependencies.
- All vendor integrations are adapter-based and degrade gracefully.
- Failure to connect is treated as a configuration state, not a successful integration.

## Data handling and logging

- Use structured logs with correlation IDs and run IDs.
- Prefer deterministic evidence and avoid sending raw datasets to LLMs.
- Keep logs free of sensitive payload content; use sanitized summaries.
- Frontend access is limited to configured local development origins. Provider credentials are read server-side only and are not included in API models.
- Dataset preview is bounded to at most 100 records and filters sensitive-looking field names. The backend is designed for synthetic data and does not replace authentication in a production deployment.
- SQLAlchemy repositories use bound parameters. PostgreSQL migrations create metadata tables only; data-platform business rows are not copied into PostgreSQL.
