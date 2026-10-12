# InsuraObserve AI frontend

React + TypeScript application for the Motor Insurance data-observability workspace. The frontend calls FastAPI only; provider credentials and direct Databricks, Dynatrace, Gemini, OpenMetadata, or OpenLineage connections are not used in the browser.

## Run locally

From the repository root:

```powershell
Set-Location frontend
npm install
Copy-Item .env.example .env
npm run dev
```

Vite proxies `/api` to `http://127.0.0.1:8000` by default. Set `VITE_API_ORIGIN` to change the FastAPI origin. The backend should be running on port 8000; its versioned API base defaults to `/api/v1`.

`VITE_REFRESH_INTERVAL_MS` controls dashboard polling (minimum 5 seconds; default 15 seconds). `VITE_DEMO_MOCKS=true` explicitly selects deterministic, contract-shaped overview fixtures. The default is real API mode; failed requests appear as API errors rather than silently falling back to fixture data.

## Checks

```powershell
npm test
npm run build
```

## Current phase

The responsive application shell, navigation, API client/query cache, provider diagnostics, status and loading components, persistent Ask AI entry, AI Data Platform Command Center, Data Sources inventory, interactive Live Data Lineage graph, Dataset Explorer, and AI Incident Intelligence screen are established. The app shell owns the shared line-of-business selection; it is populated from backend records and applied consistently to command-center summaries, sources, lineage, datasets, quality evidence, incidents, agent context, SLA products, and Ask AI. Motor is the currently available fixture domain. The selection persists across in-app navigation, while an explicit `line_of_business` URL parameter remains shareable.

Loading states pair an accessible live status message with decorative skeleton placeholders. Skeleton animation respects the user's reduced-motion preference.

The Data Sources view uses backend source, event, dataset, SLA, and lineage records. RUNNING requires observed activity or an explicit source run state; absent run evidence is WAITING. Freshness and quality remain unknown unless corresponding API evidence exists. Status filters distinguish running, paused, waiting, and sources with health/freshness/event attention. Source cards link to the lineage route with the source anchor.

The Data Quality & Observability screen uses `GET /api/v1/quality`, `/events`, `/datasets`, `/sla`, `/incidents`, and `/lineage` to show backend-evaluated check results, freshness commitments, and detector evidence with cross-links. Its pass percentage summarizes returned pass/fail records only; no synthetic chart or client-side quality result is presented in live API mode.

The Lineage graph is built from the backend `LineageGraph` nodes and edges at runtime. It calculates a directed left-to-right layout, maps contract node types and backend health states, and supports zoom, pan, fit, search/anchor, node details, upstream/downstream highlighting, health/type filters, shared line-of-business context, and active-incident impact highlighting. Node health is never propagated in the browser; unaffected downstream products retain the health supplied by the backend.

The Dataset Explorer uses `GET /api/v1/datasets`, `GET /api/v1/datasets/{dataset_id}`, and the bounded `GET /api/v1/datasets/{dataset_id}/preview?limit=10` API. It supports name/ID search, layer filtering, shared line-of-business context, backend health/quality/freshness/schema/run details, lineage and incident links, and a small synthetic preview. Preview fields with sensitive-looking names are excluded again before display. Provider connectivity is shown separately from dataset health. The current dataset detail API's `platform` field reports readiness (`ready` or `not_configured`), not provider identity; the frontend explicitly displays provider identity as unavailable rather than guessing LOCAL or DATABRICKS. The same detail/preview UI contract is used irrespective of provider.

The Incident Center uses the incident detail and RCA APIs, lineage graph, dataset/SLA data, and remediation plan, approval, and verification endpoints. It shows backend RCA confidence and factors, event evidence, a timestamp-sorted incident/event timeline, graph-derived affected products, explicit unaffected context when present, Motor data context, and remediation/verification state. Timeline ordering is not treated as causal proof; the current RCA contract has no dedicated root-node field, so the UI marks that item as unavailable and separately shows evidence-linked graph nodes. Remediation generation creates a simulated plan only; approval/rejection is a human action, and no data-changing task is run by the frontend.

Pipeline inventory/execution state, agent runtime state, and historical health trends are not supplied by the current backend contract. The Command Center calls these out as unavailable rather than inferring status or generating a trend. Agent findings are shown only when their evidence references events in the selected line of business.

The Agentic AI Center shows the seven contract-defined workflow stages for a selected incident, persisted findings/RCA/remediation/verification where available, and graph/SLA context clearly labeled as inputs rather than agent outputs. Since the backend does not expose orchestration or agent execution records, stage states remain WAITING and provider, start/end/duration, latency, and error metadata are explicitly unavailable; no executions are fabricated. Verification remains gated on an approved plan and a recorded verification result.

The Ask Your Data Platform AI page and persistent shell panel provide deterministic conversational summaries over the documented FastAPI incidents, events, lineage, dataset, SLA, finding, RCA, and remediation APIs. Responses link to source records and never show hidden reasoning. There is no conversational LLM endpoint in the current backend contract, so the UI explicitly reports DETERMINISTIC API-evidence synthesis and does not call Gemini; true Gemini-versus-fallback attribution and quota handling require a backend conversation endpoint to return that metadata.

The isolated Demo Control Center reads `GET /api/v1/simulator`, sources, and events, and starts a bounded synthetic cycle or requests one of the six documented failure scenarios using `POST /api/v1/simulator/cycles`. Scenario requests require confirmation and are acknowledged without changing frontend health, lineage, or incident state; those remain sourced from ordinary observability APIs. The current backend does not expose continuous worker state, pause/resume, reset, or generation-interval controls, so those capabilities are explicitly unavailable rather than simulated.

The SLA & Data Products screen lists data and AI products directly from the backend lineage graph, selects each product to show its transitive dataset/feature inputs and backend-reported health, and links active incidents only when evidence/lineage reaches that product. Dataset freshness cards use the SLA API's target, observed age, and state; over-target duration is a deterministic comparison of those returned values. The current API has no product-level deadline or completion forecast, so neither is predicted or inferred.
