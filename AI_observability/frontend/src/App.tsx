import {
  Activity,
  ArrowRight,
  Bot,
  Boxes,
  CircleAlert,
  Clock3,
  Database,
  GitBranch,
  HeartPulse,
  ListTodo,
  Radio,
  Search,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Workflow,
} from "lucide-react";
import { useState } from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";
import { apiConfig } from "./api/config";
import { LineOfBusinessProvider, useLineOfBusiness } from "./LineOfBusinessContext";
import {
  useAgentFindings,
  useDatasets,
  useEvents,
  useHealth,
  useIncidents,
  useLineage,
  useSlaStatuses,
  useSources,
} from "./api/queries";
import { AppShell } from "./components/AppShell";
import { EmptyNotice, ErrorNotice, LoadingNotice } from "./components/Notice";
import { MetricCard } from "./components/MetricCard";
import { StatusPill } from "./components/StatusPill";
import { LineagePage } from "./components/LineagePage";
import { DatasetExplorerPage } from "./components/DatasetExplorerPage";
import { IncidentCenterPage } from "./components/IncidentCenterPage";
import { AgentCenterPage } from "./components/AgentCenterPage";
import { SlaProductsPage } from "./components/SlaProductsPage";
import { AskAIPage } from "./components/AskAIPage";
import { SimulatorPage } from "./components/SimulatorPage";
import { QualityPage } from "./components/QualityPage";
import type { HealthState, Incident, LineageNode } from "./api/contracts";

export default function App() {
  return (
    <LineOfBusinessProvider>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<CommandCenter />} />
          <Route path="sources" element={<SourcesPage />} />
          <Route path="lineage" element={<LineagePage />} />
          <Route path="datasets" element={<DatasetExplorerPage />} />
          <Route path="incidents" element={<IncidentCenterPage />} />
          <Route path="agent-center" element={<AgentCenterPage />} />
          <Route path="agents" element={<AgentCenterPage />} />
          <Route path="sla" element={<SlaProductsPage />} />
          <Route path="ask-ai" element={<AskAIPage />} />
          <Route path="simulator" element={<SimulatorPage />} />
          <Route path="quality" element={<QualityPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </LineOfBusinessProvider>
  );
}

function CommandCenter() {
  const { lineOfBusiness } = useLineOfBusiness();
  const health = useHealth();
  const sources = useSources();
  const datasets = useDatasets();
  const incidents = useIncidents();
  const events = useEvents();
  const lineage = useLineage();
  const slas = useSlaStatuses();
  const findings = useAgentFindings();
  const sections = [health, sources, datasets, incidents, events, lineage, slas, findings];
  const selectedSources = sources.data?.filter((source) => source.line_of_business === lineOfBusiness) ?? [];
  const selectedDatasets = datasets.data?.filter((dataset) => dataset.line_of_business === lineOfBusiness) ?? [];
  const selectedIncidents = incidents.data?.filter((incident) => incident.line_of_business === lineOfBusiness) ?? [];
  const selectedEvents = events.data?.filter((event) => event.line_of_business === lineOfBusiness) ?? [];
  const graphNodes = lineage.data?.nodes.filter((node) => node.line_of_business === lineOfBusiness) ?? [];
  const graphNodeIds = new Set(graphNodes.map((node) => node.node_id));
  const graphEdges = (lineage.data?.edges ?? []).filter((edge) =>
    graphNodeIds.has(edge.source_node_id) && graphNodeIds.has(edge.target_node_id),
  );
  const activeIncidents = selectedIncidents.filter((incident) =>
    ["open", "acknowledged", "investigating"].includes(incident.status),
  );
  const attentionIncidents = [...activeIncidents]
    .sort((a, b) => b.started_at.localeCompare(a.started_at))
    .slice(0, 4);
  const activeCriticalCount = activeIncidents.filter((incident) => incident.severity === "critical").length;
  const scopedDatasetIds = new Set(selectedDatasets.map((dataset) => dataset.dataset_id));
  const selectedSlas = slas.data?.filter((sla) => scopedDatasetIds.has(sla.dataset_id)) ?? [];
  const atRiskSlas = selectedSlas.filter((sla) =>
    sla.state !== "healthy" ||
    (sla.current_freshness_seconds != null && sla.current_freshness_seconds > sla.target_freshness_seconds),
  );
  const schemaSignals = selectedEvents.filter((event) =>
    event.event_type.toLowerCase().includes("schema") && event.status === "detected",
  );
  const qualityMetrics = selectedEvents.flatMap((event) =>
    event.metrics
      .filter((metric) => metric.name === "dataset.quality_score" && typeof metric.value === "number")
      .map((metric) => metric.value as number),
  );
  const qualityScore = qualityMetrics.length
    ? qualityMetrics.reduce((sum, value) => sum + (value <= 1 ? value * 100 : value), 0) / qualityMetrics.length
    : null;
  const healthySources = selectedSources.filter((source) => source.status === "healthy").length;
  const sourceProblems = selectedSources.filter((source) => source.status !== "healthy").length;
  const sourceNodes = graphNodes.filter((node) => node.node_type === "source");
  const datasetNodes = graphNodes.filter((node) => ["dataset", "feature"].includes(node.node_type));
  const pipelineNodes = graphNodes.filter((node) => ["pipeline", "job"].includes(node.node_type));
  const productNodes = graphNodes.filter((node) => ["data_product", "ai_product"].includes(node.node_type));
  const unhealthyNodes = graphNodes.filter((node) => ["degraded", "critical"].includes(node.health));
  const overallHealth = getOverallHealth(
    [...selectedSources.map((source) => source.status), ...graphNodes.map((node) => node.health)],
    activeIncidents,
  );
  const selectedEventIds = new Set(selectedEvents.map((event) => event.event_id));
  const scopedFindings = findings.data?.filter((finding) =>
    finding.evidence_event_ids.some((eventId) => selectedEventIds.has(eventId)),
  ) ?? [];
  const failed = sections.filter((query) => query.isError).length;
  const loading = sections.some((query) => query.isLoading);
  const healthLabel = overallHealth === "unknown"
    ? "Health unavailable"
    : overallHealth === "healthy"
      ? "Platform healthy"
      : overallHealth === "critical"
        ? "Critical data health"
        : overallHealth === "degraded"
          ? "Degraded data health"
          : "Data health waiting";
  const hasLineData =
    selectedSources.length > 0 ||
    selectedDatasets.length > 0 ||
    selectedIncidents.length > 0 ||
    graphNodes.length > 0;

  return (
    <div className="page-stack">
      <div className="page-intro">
        <div>
          <p className="eyebrow">AI DATA PLATFORM COMMAND CENTER</p>
          <h1>Platform command center</h1>
          <p className="intro-copy">Evidence-led health, lineage impact, and human attention for your insurance data products.</p>
        </div>
        <div className="command-controls">
          <div className="updated-meta">
            <span className={`live-dot ${health.isSuccess ? "live-dot-on" : ""}`} />
            Refreshes every {Math.round(apiConfig.refreshIntervalMs / 1000)} seconds
          </div>
        </div>
      </div>

      {loading && <LoadingNotice label="Connecting to the FastAPI data platform…" />}
      {failed > 0 && (
        <ErrorNotice message={`${failed} API resource${failed === 1 ? "" : "s"} could not refresh. Displayed values may be incomplete; check the API connection.`} />
      )}

      <section className={`platform-health-banner health-banner-${overallHealth}`} aria-label="Overall data platform health">
        <div className="platform-health-icon"><HeartPulse size={21} /></div>
        <div className="platform-health-copy">
          <p className="eyebrow">OVERALL DATA HEALTH · {formatLineOfBusiness(lineOfBusiness)}</p>
          <h2>{healthLabel}</h2>
          <p>
            {overallHealth === "unknown"
              ? "Health is not yet available from the connected API."
              : `${unhealthyNodes.length} degraded or critical lineage nodes · ${activeIncidents.length} active incidents · ${atRiskSlas.length} SLA warnings`}
          </p>
        </div>
        <StatusPill value={overallHealth} />
        <div className="banner-refresh">FastAPI-backed · auto refresh {Math.round(apiConfig.refreshIntervalMs / 1000)}s</div>
      </section>

      {!loading && !hasLineData && !failed && (
        <EmptyNotice message="No platform records are available for this line of business yet." />
      )}

      <section className="metric-grid command-metrics" aria-label="Data platform health summary">
        <MetricCard
          label="Healthy sources"
          value={sources.data ? `${healthySources} / ${selectedSources.length}` : "—"}
          note={sources.data ? (sourceProblems ? `${sourceProblems} need attention` : `${healthySources} of ${selectedSources.length} report healthy`) : "Source status unavailable"}
          icon={Radio}
          tone={sourceProblems ? "warning" : "default"}
        />
        <MetricCard
          label="Data quality score"
          value={qualityScore == null ? "—" : `${Math.round(qualityScore)}%`}
          note={qualityMetrics.length ? `Evidence from ${qualityMetrics.length} event metric${qualityMetrics.length === 1 ? "" : "s"}` : "No quality score in event feed"}
          icon={ShieldCheck}
          tone={qualityScore != null && selectedEvents.some((event) => event.event_type.toLowerCase().includes("quality") && event.severity === "error") ? "warning" : "default"}
        />
        <MetricCard
          label="Active incidents"
          value={incidents.data ? activeIncidents.length : "—"}
          note={activeCriticalCount ? `${activeCriticalCount} critical · human review needed` : "Open investigations"}
          icon={CircleAlert}
          tone={activeCriticalCount ? "critical" : activeIncidents.length ? "warning" : "default"}
        />
        <MetricCard
          label="SLA at risk"
          value={slas.data ? atRiskSlas.length : "—"}
          note={slas.data ? "Freshness targets outside healthy state" : "Freshness status unavailable"}
          icon={Clock3}
          tone={atRiskSlas.length ? "warning" : "default"}
        />
      </section>

      <section className="command-signal-strip" aria-label="Additional platform signals">
        <div className="signal-card">
          <Workflow size={16} />
          <div><span>Pipeline health</span><strong>{pipelineNodes.length ? `${pipelineNodes.filter((node) => node.health === "healthy").length} healthy · ${pipelineNodes.length - pipelineNodes.filter((node) => node.health === "healthy").length} need attention` : "Not exposed by API"}</strong></div>
        </div>
        <div className="signal-card">
          <Database size={16} />
          <div><span>Dataset health</span><strong>{datasetNodes.length ? `${datasetNodes.filter((node) => node.health === "healthy").length} healthy · ${datasetNodes.filter((node) => node.health !== "healthy").length} need attention` : "No dataset health records"}</strong></div>
        </div>
        <div className="signal-card">
          <TriangleAlert size={16} />
          <div><span>Freshness · schema signals</span><strong>{atRiskSlas.length} stale / at risk · {schemaSignals.length} schema incident{schemaSignals.length === 1 ? "" : "s"}</strong></div>
        </div>
      </section>

      <section className="command-grid command-intelligence-grid">
        <article className="panel products-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">LINEAGE-GROUNDED IMPACT</p>
              <h2>Data product health</h2>
            </div>
            <Link className="text-link" to="/lineage">Explore lineage <ArrowRight size={15} /></Link>
          </div>
          <p className="panel-copy">Health is read from canonical lineage nodes; downstream products reflect observed dependencies.</p>
          {lineage.isLoading && <LoadingNotice label="Loading product lineage and health…" />}
          {lineage.isError && <ErrorNotice message="Product health could not be loaded because lineage is unavailable." />}
          {lineage.data && productNodes.length > 0 && (
            <div className="product-health-grid">
              {productNodes.map((node) => {
                const upstreamCount = getUpstreamCount(node.node_id, graphEdges);
                const impacted = node.health === "critical" || node.health === "degraded";
                return (
                  <article className={`product-health-card ${impacted ? "product-impacted" : ""}`} key={node.node_id}>
                    <div className="product-card-heading">
                      <span className="product-card-icon"><Boxes size={16} /></span>
                      <StatusPill value={node.health} />
                    </div>
                    <h3>{node.label}</h3>
                    <p>{upstreamCount} upstream dependencies · {impacted ? "lineage reports impact" : "no reported lineage degradation"}</p>
                    {impacted && <span className="product-attention">Review downstream impact</span>}
                  </article>
                );
              })}
            </div>
          )}
          {lineage.data && productNodes.length === 0 && <EmptyNotice message="The lineage graph contains no data-product nodes for this line of business." />}
        </article>

        <article className="panel agent-status-panel">
          <div className="panel-heading">
            <div><p className="eyebrow">AGENTIC DATA OBSERVABILITY</p><h2>Agent activity & approvals</h2></div>
            <Bot size={18} className="muted-icon" />
          </div>
          <div className="agent-activity-counts">
            <div><strong>{findings.data ? scopedFindings.length : "—"}</strong><span>evidence findings</span></div>
            <div><strong>Unavailable</strong><span>execution states · API gap</span></div>
          </div>
          {findings.isLoading && <LoadingNotice label="Loading agent evidence…" />}
          {findings.isError && <ErrorNotice message="Agent findings could not be loaded." />}
          {findings.data && scopedFindings.length > 0 && (
            <ul className="finding-list">
              {scopedFindings.slice(0, 3).map((finding) => (
                <li key={finding.finding_id}><Sparkles size={14} /><span><strong>{finding.agent_name}</strong>{finding.summary}</span></li>
              ))}
            </ul>
          )}
          <p className="capability-note">Runtime states and remediation approval records are not exposed by the current API; no agent activity is inferred.</p>
          <div className="agent-links">
            <Link className="text-link" to="/agent-center">Open Agent Center <ArrowRight size={14} /></Link>
            <Link className="text-link" to="/incidents"><ListTodo size={14} /> Review incidents</Link>
          </div>
        </article>
      </section>

      <section className="bottom-grid">
        <article className="panel incidents-panel attention-panel">
          <div className="panel-heading">
            <div><p className="eyebrow">HUMAN ATTENTION</p><h2>Active incidents & platform insights</h2></div>
            <Link className="text-link" to="/incidents">Incident Center <ArrowRight size={15} /></Link>
          </div>
          {incidents.isLoading && <LoadingNotice label="Loading active incident records…" />}
          {incidents.isError && <ErrorNotice message="Active incidents could not be loaded." />}
          {incidents.data && attentionIncidents.length > 0 && (
            <div className="incident-list">
              {attentionIncidents.map((incident) => (
                <IncidentRow
                  incident={incident}
                  impactedProducts={getImpactedProducts(incident, graphNodes, graphEdges)}
                  key={incident.incident_id}
                />
              ))}
            </div>
          )}
          {incidents.data && attentionIncidents.length === 0 && <EmptyNotice message="No active incidents require review." />}
          <div className="attention-summary">
            <span><TriangleAlert size={14} /> {schemaSignals.length} detected schema change{schemaSignals.length === 1 ? "" : "s"}</span>
            <span><Clock3 size={14} /> {atRiskSlas.length} dataset freshness target{atRiskSlas.length === 1 ? "" : "s"} at risk</span>
            <span><ListTodo size={14} /> Remediation approval feed unavailable</span>
          </div>
        </article>
        <article className="panel focus-panel insight-panel">
          <div className="panel-heading">
            <div><p className="eyebrow">OBSERVABILITY EVIDENCE</p><h2>What the platform knows</h2></div>
            <Activity size={18} className="muted-icon" />
          </div>
          <div className="focus-content">
            <div className="focus-icon"><Sparkles size={18} /></div>
            <p>Deterministic event evidence establishes what changed; the lineage graph shows which products depend on affected datasets.</p>
            <div className="focus-proof">
              <span><ShieldCheck size={14} /> {selectedEvents.length} event evidence records in this view</span>
              <span><GitBranch size={14} /> {sourceNodes.length} source nodes · {graphEdges.length} verified dependencies</span>
              <span><Activity size={14} /> Historical trend is not supplied by the API</span>
            </div>
            <Link to="/quality" className="focus-link">Inspect data-quality signals <ArrowRight size={15} /></Link>
          </div>
        </article>
      </section>
    </div>
  );
}

function SourcesPage() {
  const [filter, setFilter] = useState<"all" | "running" | "paused" | "waiting" | "attention">("all");
  const { lineOfBusiness } = useLineOfBusiness();
  const sources = useSources();
  const events = useEvents();
  const datasets = useDatasets();
  const slas = useSlaStatuses();

  const sourceRows = (sources.data ?? []).filter((source) =>
    source.line_of_business === lineOfBusiness,
  ).map((source) => {
    const sourceDatasets = (datasets.data ?? []).filter((dataset) => dataset.source_id === source.source_id);
    const sourceDatasetIds = new Set(sourceDatasets.map((dataset) => dataset.dataset_id));
    const sourceEvents = (events.data ?? [])
      .filter((event) => event.source_id === source.source_id || (event.dataset_id && sourceDatasetIds.has(event.dataset_id)))
      .sort((left, right) => right.occurred_at.localeCompare(left.occurred_at));
    const latestEvent = sourceEvents[0];
    const explicitState = readSourceState(source.attributes);
    const runState = explicitState ?? (source.status === "waiting" ? "waiting" : latestEvent ? "running" : "waiting");
    const sourceSlas = (slas.data ?? []).filter((sla) => sourceDatasetIds.has(sla.dataset_id));
    const freshnessReported = sourceSlas.length > 0;
    const freshnessWarning = sourceSlas.some((sla) =>
      sla.state !== "healthy" ||
      (sla.current_freshness_seconds != null && sla.current_freshness_seconds > sla.target_freshness_seconds),
    );
    const qualityValues = sourceEvents.flatMap((event) =>
      (event.event_type.toLowerCase().includes("quality") || event.event_type.toLowerCase().includes("healthy_dataset")
        ? event.metrics
        : [])
        .filter((metric) => metric.name === "dataset.quality_score" && typeof metric.value === "number")
        .map((metric) => metric.value as number),
    );
    const quality = qualityValues.length
      ? qualityValues.reduce((sum, value) => sum + (value <= 1 ? value * 100 : value), 0) / qualityValues.length
      : null;
    const latestRecordCount = latestEvent?.metrics.find((metric) => metric.name === "dataset.row_count")?.value;
    const healthNeedsAttention = source.status === "critical" || source.status === "degraded";
    const eventNeedsAttention = sourceEvents.some((event) =>
      event.status === "detected" && ["warning", "error", "critical"].includes(event.severity),
    );

    return {
      source,
      sourceDatasets,
      sourceEvents,
      latestEvent,
      runState,
      freshnessReported,
      freshnessWarning,
      quality,
      latestRecordCount,
      healthNeedsAttention,
      eventNeedsAttention,
    };
  });

  const visibleSources = sourceRows.filter(({ runState, healthNeedsAttention, eventNeedsAttention, freshnessWarning, quality }) => {
    switch (filter) {
      case "running":
        return runState === "running";
      case "paused":
        return runState === "paused";
      case "waiting":
        return runState === "waiting";
      case "attention":
        return healthNeedsAttention || eventNeedsAttention || freshnessWarning || (quality !== null && quality < 80);
      case "all":
        return true;
    }
  });
  const isLoading = sources.isLoading || events.isLoading || datasets.isLoading || slas.isLoading;
  const failedCount = [sources, events, datasets, slas].filter((query) => query.isError).length;
  const runningCount = sourceRows.filter((row) => row.runState === "running").length;
  const pausedCount = sourceRows.filter((row) => row.runState === "paused").length;
  const waitingCount = sourceRows.filter((row) => row.runState === "waiting").length;
  const attentionCount = sourceRows.filter((row) =>
    row.healthNeedsAttention || row.eventNeedsAttention || row.freshnessWarning || (row.quality !== null && row.quality < 80),
  ).length;

  return (
    <div className="page-stack">
      <div className="page-intro">
        <div>
          <p className="eyebrow">SYNTHETIC LIVE SOURCE ESTATE</p>
          <h1>Data Sources</h1>
          <p className="intro-copy">Connected insurance feeds and their latest observed data signals. Source state comes from FastAPI; no upload controls.</p>
        </div>
        <div className="updated-meta"><span className="live-dot live-dot-on" />Refreshing every {Math.round(apiConfig.refreshIntervalMs / 1000)} seconds</div>
      </div>

      {isLoading && <LoadingNotice label="Connecting to source, event, dataset, and freshness APIs…" />}
      {failedCount > 0 && <ErrorNotice message={`${failedCount} source inventory feed${failedCount === 1 ? "" : "s"} could not refresh. Some source summaries may be incomplete.`} />}

      <section className="source-summary-grid" aria-label="Source state summary">
        <SourceSummary label="Running" value={sources.data ? runningCount : "—"} status="running" />
        <SourceSummary label="Paused" value={sources.data ? pausedCount : "—"} status="paused" />
        <SourceSummary label="Waiting" value={sources.data ? waitingCount : "—"} status="waiting" />
        <SourceSummary label="Needs attention" value={sources.data ? attentionCount : "—"} status="degraded" />
      </section>

      <section className="panel source-inventory-panel">
        <div className="source-toolbar">
          <div>
            <p className="eyebrow">CONNECTED SOURCE SYSTEMS</p>
            <h2>{sources.data ? `${sourceRows.length} sources` : "Source inventory"}</h2>
          </div>
          <label className="source-filter">
            <Search size={14} aria-hidden="true" />
            <span className="sr-only">Filter data sources</span>
            <select aria-label="Filter data sources" value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}>
              <option value="all">All states</option>
              <option value="running">Running</option>
              <option value="paused">Paused</option>
              <option value="waiting">Waiting</option>
              <option value="attention">Needs attention</option>
            </select>
          </label>
        </div>

        {sources.isError && !sources.data && <ErrorNotice message="Source inventory could not be loaded from FastAPI." />}
        {sources.data && sourceRows.length === 0 && <EmptyNotice message={`No source systems are registered for ${formatLineOfBusiness(lineOfBusiness)}.`} />}
        {sources.data && sourceRows.length > 0 && visibleSources.length === 0 && (
          <EmptyNotice message={`No sources match the ${filter === "attention" ? "needs attention" : filter} filter.`} />
        )}
        {visibleSources.length > 0 && (
          <div className="source-card-grid">
            {visibleSources.map((row) => (
              <SourceCard
                key={row.source.source_id}
                {...row}
              />
            ))}
          </div>
        )}
        <p className="source-footnote">RUNNING is inferred only when a source has an observed event or run. Missing run evidence is shown as WAITING; unknown health is never promoted to healthy.</p>
      </section>
      {apiConfig.mockMode && <p className="mock-label">Explicit development fixture mode · synthetic data only</p>}
    </div>
  );
}

function SourceSummary({ label, value, status }: { label: string; value: number | string; status: "running" | "paused" | "waiting" | "degraded" }) {
  return (
    <article className={`source-summary source-summary-${status}`}>
      <span className="source-summary-dot" />
      <div><strong>{value}</strong><span>{label}</span></div>
    </article>
  );
}

function SourceCard({
  source,
  sourceDatasets,
  sourceEvents,
  latestEvent,
  runState,
  freshnessReported,
  freshnessWarning,
  quality,
  latestRecordCount,
  healthNeedsAttention,
  eventNeedsAttention,
}: {
  source: { source_id: string; name: string; source_type: string; line_of_business: string; status: HealthState; attributes: Record<string, unknown> };
  sourceDatasets: Array<{ dataset_id: string; name: string }>;
  sourceEvents: Array<{ event_id: string }>;
  latestEvent?: { occurred_at: string; run_id?: string | null };
  runState: "running" | "paused" | "waiting";
  freshnessReported: boolean;
  freshnessWarning: boolean;
  quality: number | null;
  latestRecordCount: string | number | boolean | undefined;
  healthNeedsAttention: boolean;
  eventNeedsAttention: boolean;
}) {
  const stateLabel = runState.toUpperCase();
  const statusValue = healthNeedsAttention ? source.status : runState;
  const mode = sourceMode(source.source_type);
  const runLabel = latestEvent?.run_id ?? "No observed run";
  const recordLabel = typeof latestRecordCount === "number"
    ? latestRecordCount.toLocaleString()
    : typeof latestRecordCount === "string"
      ? latestRecordCount
      : "No record metric";

  return (
    <article className="source-card">
      <div className="source-card-top">
        <div className="source-identity">
          <span className="source-icon"><Database size={17} /></span>
          <div><h3>{source.name}</h3><span>{source.source_id}</span></div>
        </div>
        <StatusPill value={statusValue} />
      </div>
      <div className="source-mode"><span>Source mode</span><strong>{mode}</strong><span className="synthetic-tag">Synthetic</span></div>
      <div className="source-state-line">
        <span className={`source-state-indicator state-${runState}`} />
        <strong>{stateLabel}</strong>
        <span>·</span>
        <span>Health</span>
        <StatusPill value={source.status} />
      </div>
      <div className="source-details-grid">
        <div><span>Last update</span><strong>{latestEvent ? formatRelative(latestEvent.occurred_at) : "Waiting for first event"}</strong></div>
        <div><span>Latest batch / run</span><strong title={runLabel}>{runLabel}</strong></div>
        <div><span>Latest record metric</span><strong>{recordLabel}</strong></div>
        <div><span>Observed events</span><strong>{sourceEvents.length || "No events yet"}</strong></div>
        <div><span>Event signals</span><strong className={eventNeedsAttention ? "source-warning-text" : ""}>{eventNeedsAttention ? "Detected issue" : sourceEvents.length ? "No active alerts" : "No event evidence"}</strong></div>
        <div><span>Freshness</span><strong className={freshnessWarning ? "source-warning-text" : ""}>{freshnessWarning ? "At risk" : freshnessReported ? "Within reported target" : "Unknown"}</strong></div>
        <div><span>Quality</span><strong className={quality !== null && quality < 80 ? "source-warning-text" : ""}>{quality === null ? "No score reported" : `${Math.round(quality <= 1 ? quality * 100 : quality)}%`}</strong></div>
      </div>
      <div className="source-card-footer">
        <span>{sourceDatasets.length ? `${sourceDatasets.length} related dataset${sourceDatasets.length === 1 ? "" : "s"}` : "No dataset mapping"}</span>
        <Link to={`/lineage?anchor=source.${encodeURIComponent(source.source_id)}`} aria-label={`View ${source.name} pipeline and lineage`}>
          View Pipeline / Lineage <ArrowRight size={14} />
        </Link>
      </div>
    </article>
  );
}

function readSourceState(attributes: Record<string, unknown>): "running" | "paused" | "waiting" | null {
  const value = attributes.run_state ?? attributes.state;
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase();
  return ["running", "paused", "waiting"].includes(normalized)
    ? normalized as "running" | "paused" | "waiting"
    : null;
}

function sourceMode(sourceType: string): string {
  switch (sourceType.toLowerCase()) {
    case "transactional":
      return "Transactional batches";
    case "crm":
      return "CRM change feed";
    case "file":
      return "File landing feed";
    case "stream":
      return "Event stream";
    default:
      return sourceType.replaceAll("_", " ");
  }
}

function IncidentRow({ incident, impactedProducts }: { incident: Incident; impactedProducts: string[] }) {
  return (
    <div className="incident-row">
      <span className={`severity-mark severity-${incident.severity}`} />
      <div className="incident-main">
        <strong>{incident.title}</strong>
        <span>{incident.evidence[0]?.dataset_id ?? incident.incident_id} <i>·</i> {impactedProducts.length ? `Impacts ${impactedProducts.join(", ")}` : "Product impact not established"}</span>
      </div>
      <StatusPill value={incident.status} />
      <time dateTime={incident.started_at}>{formatRelative(incident.started_at)}</time>
    </div>
  );
}

function getOverallHealth(states: HealthState[], activeIncidents: Incident[]): HealthState {
  if (states.length === 0) return "unknown";
  if (states.includes("critical") || activeIncidents.some((incident) => incident.severity === "critical")) return "critical";
  if (states.includes("degraded") || activeIncidents.length > 0) return "degraded";
  if (states.includes("waiting")) return "waiting";
  return "healthy";
}

function getUpstreamCount(nodeId: string, edges: Array<{ source_node_id: string; target_node_id: string }>): number {
  const visited = new Set<string>();
  const pending = [nodeId];
  while (pending.length) {
    const target = pending.pop();
    if (!target) continue;
    for (const edge of edges) {
      if (edge.target_node_id === target && !visited.has(edge.source_node_id)) {
        visited.add(edge.source_node_id);
        pending.push(edge.source_node_id);
      }
    }
  }
  return visited.size;
}

function getImpactedProducts(incident: Incident, nodes: LineageNode[], edges: Array<{ source_node_id: string; target_node_id: string }>): string[] {
  const visited = new Set(incident.correlated_node_ids);
  const pending = [...visited];
  while (pending.length) {
    const source = pending.pop();
    if (!source) continue;
    for (const edge of edges) {
      if (edge.source_node_id === source && !visited.has(edge.target_node_id)) {
        visited.add(edge.target_node_id);
        pending.push(edge.target_node_id);
      }
    }
  }
  return nodes
    .filter((node) => visited.has(node.node_id) && ["data_product", "ai_product"].includes(node.node_type))
    .map((node) => node.label);
}

function formatLineOfBusiness(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatRelative(value: string): string {
  const elapsed = Math.max(0, Date.now() - Date.parse(value));
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value));
}
