import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  Bot,
  Check,
  CircleAlert,
  Clock3,
  Database,
  FileSearch,
  GitBranch,
  ShieldCheck,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Workflow,
} from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { apiConfig } from "../api/config";
import { apiSend } from "../api/client";
import { useLineOfBusiness } from "../LineOfBusinessContext";
import {
  queryKeys,
  useDatasets,
  useIncidentDetail,
  useIncidentRca,
  useIncidents,
  useLineage,
  useRemediationPlans,
  useSlaStatuses,
  useVerifications,
} from "../api/queries";
import type {
  Incident,
  IncidentStatus,
  LineageNode,
  RemediationPlan,
  VerificationResult,
} from "../api/contracts";
import { EmptyNotice, ErrorNotice, LoadingNotice } from "./Notice";
import { StatusPill } from "./StatusPill";

type TimelineEntry =
  | { kind: "evidence"; id: string; occurred_at: string; message: string; detail: string; severity: Incident["severity"] }
  | { kind: "timeline"; id: string; occurred_at: string; message: string; detail: string };

const activeStates: IncidentStatus[] = ["open", "acknowledged", "investigating"];
const activeState = (status: IncidentStatus) => activeStates.includes(status);

export function IncidentCenterPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { lineOfBusiness, setLineOfBusiness } = useLineOfBusiness();
  const incidentsQuery = useIncidents();
  const datasetsQuery = useDatasets();
  const lineageQuery = useLineage();
  const slasQuery = useSlaStatuses();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [severityFilter, setSeverityFilter] = useState("all");
  const selectedId = searchParams.get("incident_id") ?? "";
  const incidentDetailQuery = useIncidentDetail(selectedId);
  const rcaQuery = useIncidentRca(selectedId);
  const plansQuery = useRemediationPlans(selectedId);
  const incident = incidentDetailQuery.data;
  const rca = rcaQuery.data;
  const plans = (plansQuery.data ?? []).slice().sort((left, right) => right.created_at.localeCompare(left.created_at));
  const selectedPlan = plans[0];
  const verificationQuery = useVerifications(selectedPlan?.plan_id ?? "");
  const verification = verificationQuery.data?.[0];
  const lineIncidents = (incidentsQuery.data ?? []).filter((item) =>
    item.line_of_business === lineOfBusiness,
  );

  useEffect(() => {
    if (!selectedId || !incident) return;
    if (incident.line_of_business !== lineOfBusiness) setLineOfBusiness(incident.line_of_business);
  }, [incident, lineOfBusiness, selectedId, setLineOfBusiness]);

  useEffect(() => {
    if (selectedId || lineIncidents.length === 0) return;
    setSearchParams({ incident_id: lineIncidents[0].incident_id }, { replace: true });
  }, [lineIncidents, selectedId, setSearchParams]);

  const visibleIncidents = lineIncidents.filter((item) => {
    const query = search.trim().toLowerCase();
    return (statusFilter === "all" || (statusFilter === "active" ? activeState(item.status) : item.status === statusFilter)) &&
      (severityFilter === "all" || item.severity === severityFilter) &&
      (!query || item.incident_id.toLowerCase().includes(query) || item.title.toLowerCase().includes(query));
  });

  const impact = useMemo(() => {
    const graph = lineageQuery.data;
    if (!incident || !graph) return { nodes: [] as LineageNode[], products: [] as LineageNode[], unaffected: [] as LineageNode[] };
    const anchorIds = new Set([
      ...incident.correlated_node_ids,
      ...incident.evidence.flatMap((event) => event.dataset_id ? [event.dataset_id] : []),
    ]);
    const nodeMap = new Map(graph.nodes.map((node) => [node.node_id, node]));
    const frontier = [...anchorIds];
    const visited = new Set(anchorIds);
    while (frontier.length) {
      const current = frontier.shift()!;
      for (const edge of graph.edges) {
        if (edge.source_node_id !== current || visited.has(edge.target_node_id)) continue;
        visited.add(edge.target_node_id);
        frontier.push(edge.target_node_id);
      }
    }
    const nodes = [...visited].map((id) => nodeMap.get(id)).filter((node): node is LineageNode => Boolean(node));
    const products = nodes.filter((node) => ["data_product", "ai_product", "report"].includes(node.node_type));
    const unaffected = graph.nodes.filter((node) =>
      ["data_product", "ai_product", "report"].includes(node.node_type) &&
      !visited.has(node.node_id) &&
      node.line_of_business === incident.line_of_business,
    );
    return { nodes, products, unaffected };
  }, [incident, lineageQuery.data]);

  const affectedDatasetIds = new Set([
    ...impact.nodes.filter((node) => node.node_type === "dataset").map((node) => node.node_id),
    ...(incident?.evidence.flatMap((event) => event.dataset_id ? [event.dataset_id] : []) ?? []),
  ]);
  const affectedDatasets = (datasetsQuery.data ?? []).filter((dataset) => affectedDatasetIds.has(dataset.dataset_id));
  const affectedSlas = (slasQuery.data ?? []).filter((sla) => affectedDatasetIds.has(sla.dataset_id));
  const timelineEntries: TimelineEntry[] = incident ? [
    ...incident.evidence.map((event) => ({
      kind: "evidence" as const,
      id: event.event_id,
      occurred_at: event.occurred_at,
      message: event.message,
      detail: [
        event.event_type.replaceAll("_", " "),
        event.dataset_id,
        event.pipeline_id ? `pipeline ${event.pipeline_id}` : null,
        event.run_id ? `run ${event.run_id}` : null,
      ].filter(Boolean).join(" · "),
      severity: event.severity,
    })),
    ...incident.timeline.map((entry) => ({
      kind: "timeline" as const,
      id: entry.timeline_event_id,
      occurred_at: entry.occurred_at,
      message: entry.message,
      detail: entry.event_type.replaceAll("_", " "),
    })),
  ].sort((left, right) => left.occurred_at.localeCompare(right.occurred_at)) : [];

  const refreshIncidentQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.remediationPlans(selectedId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.incidentDetail(selectedId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.incidents }),
    ]);
  };
  const createPlanMutation = useMutation({
    mutationFn: (plan: RemediationPlan) => apiSend<RemediationPlan>("POST", "/remediation", plan),
    onSuccess: refreshIncidentQueries,
  });
  const approvalMutation = useMutation({
    mutationFn: ({ planId, approved }: { planId: string; approved: boolean }) =>
      apiSend<RemediationPlan>("PATCH", `/remediation/${encodeURIComponent(planId)}/approval`, { approved }),
    onSuccess: refreshIncidentQueries,
  });

  const selectIncident = (item: Incident) => setSearchParams({ incident_id: item.incident_id });
  const generatePlan = () => {
    if (!incident) return;
    createPlanMutation.mutate({
      plan_id: `plan-${globalThis.crypto.randomUUID()}`,
      incident_id: incident.incident_id,
      recommendation: remediationRecommendation(incident),
      requires_human_approval: true,
      approved: null,
      mode: "simulate",
      created_at: new Date().toISOString(),
    });
  };

  return (
    <div className="page-stack">
      <div className="page-intro">
        <div>
          <p className="eyebrow">GROUNDED INCIDENT INVESTIGATION</p>
          <h1>AI Incident Intelligence</h1>
          <p className="intro-copy">Inspect evidence, lineage impact, deterministic confidence factors, and human-approved remediation—without overstating causality.</p>
        </div>
        <div className="updated-meta"><span className="live-dot live-dot-on" />Refreshing every {Math.round(apiConfig.refreshIntervalMs / 1000)} seconds</div>
      </div>

      {incidentsQuery.isLoading && <LoadingNotice label="Loading incident records from the backend…" />}
      {incidentsQuery.isError && <ErrorNotice message="Incident records could not be loaded. Check the FastAPI connection." />}
      {incidentsQuery.isSuccess && incidentsQuery.data.length === 0 && <EmptyNotice message="No incidents have been recorded by the backend." />}

      {incidentsQuery.data && incidentsQuery.data.length > 0 && (
        <section className="incident-center-layout" aria-label="Incident intelligence and selected incident">
          <aside className="panel incident-queue">
            <div className="incident-queue-head">
              <div><p className="eyebrow">INVESTIGATION QUEUE</p><h2>{visibleIncidents.length} incidents</h2></div>
              <CircleAlert size={18} />
            </div>
            <label className="incident-search">
              <FileSearch size={14} aria-hidden="true" />
              <span className="sr-only">Search incidents</span>
              <input aria-label="Search incidents" placeholder="Search title or incident ID" value={search} onChange={(event) => setSearch(event.target.value)} />
            </label>
            <div className="incident-filters">
              <label><span>Status</span><select aria-label="Filter incidents by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="active">Active</option><option value="all">All statuses</option>
                {(["open", "acknowledged", "investigating", "resolved", "closed"] as IncidentStatus[]).map((value) => <option key={value} value={value}>{label(value)}</option>)}
              </select></label>
              <label><span>Severity</span><select aria-label="Filter incidents by severity" value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value)}>
                <option value="all">All severities</option>
                {["critical", "error", "warning", "info"].map((value) => <option key={value} value={value}>{label(value)}</option>)}
              </select></label>
            </div>
            <div className="incident-list">
              {visibleIncidents.map((item) => (
                <button
                  className={`incident-list-item${selectedId === item.incident_id ? " incident-list-item-selected" : ""}`}
                  key={item.incident_id}
                  onClick={() => selectIncident(item)}
                  aria-pressed={selectedId === item.incident_id}
                >
                  <span className={`incident-severity-mark severity-mark-${item.severity}`} />
                  <span className="incident-list-copy"><strong>{item.title}</strong><small>{item.incident_id}</small><small>{formatDate(item.started_at)} · {label(item.line_of_business)}</small></span>
                  <StatusPill value={item.severity} />
                </button>
              ))}
              {visibleIncidents.length === 0 && <EmptyNotice message="No incidents match the selected filters." />}
            </div>
          </aside>

          <main className="incident-detail-column" aria-label="Selected incident details">
            {!selectedId && <EmptyNotice message="Select an incident to review its evidence and impact." />}
            {selectedId && incidentDetailQuery.isLoading && <LoadingNotice label="Loading incident evidence and timeline…" />}
            {incidentDetailQuery.isError && <ErrorNotice message={`Incident details could not be loaded for ${selectedId}.`} />}
            {incident && (
              <>
                <section className="panel incident-hero-card">
                  <div className="incident-title-row">
                    <div className="incident-title-copy"><p className="eyebrow">INCIDENT · {incident.incident_id}</p><h2>{incident.title}</h2></div>
                    <div className="incident-primary-status"><StatusPill value={incident.severity} /><StatusPill value={incident.status} /></div>
                  </div>
                  <div className="incident-meta-row">
                    <span><Clock3 size={14} />Detected {formatDate(incident.started_at)}</span>
                    <span><Activity size={14} />{label(incident.line_of_business)} line of business</span>
                    <span><FileSearch size={14} />{incident.evidence.length} linked evidence events</span>
                  </div>
                  <div className="incident-hero-actions">
                    <a href="#incident-evidence"><FileSearch size={14} />Show Evidence</a>
                    <Link to={lineageHref(incident)}><GitBranch size={14} />Show Lineage</Link>
                    <a href="#incident-remediation"><Workflow size={14} />Open Remediation</a>
                  </div>
                </section>

                <section className="incident-intelligence-grid">
                  <article className="panel incident-rca-panel">
                    <div className="incident-panel-head"><div><p className="eyebrow">EVIDENCE-GROUNDED ANALYSIS</p><h3>Root-cause assessment</h3></div><Sparkles size={17} /></div>
                    {rcaQuery.isLoading && <LoadingNotice label="Loading backend RCA result…" />}
                    {rcaQuery.isError && <div className="inline-warning"><CircleAlert size={15} /><span>No RCA result is currently supplied for this incident. The interface will not infer a root cause.</span></div>}
                    {rca && (
                      <>
                        <p className="incident-rca-summary">{rca.suspected_root_cause}</p>
                        <div className="incident-root-line">
                          <span>Root node</span>
                          <strong>Not supplied by the RCA contract</strong>
                          <small>Evidence-linked datasets and graph impact are listed separately below.</small>
                        </div>
                        <div className="confidence-summary">
                          <div><span>Deterministic confidence</span><strong>{formatPercent(rca.confidence_score)}</strong></div>
                          <div className="confidence-track" role="img" aria-label={`Deterministic confidence ${formatPercent(rca.confidence_score)}`}><span style={{ width: `${clampPercent(rca.confidence_score)}%` }} /></div>
                          <small>Score and factors come from the backend RCA result; this UI does not calculate or reinterpret them.</small>
                        </div>
                        <div className="confidence-factor-list" aria-label="Confidence factors">
                          {rca.confidence_factors.map((factor) => (
                            <div className="confidence-factor" key={factor.name}>
                              <div><strong>{label(factor.name)}</strong><span>{formatPercent(factor.score)}</span></div>
                              <p>{factor.explanation}</p>
                            </div>
                          ))}
                          {rca.confidence_factors.length === 0 && <p className="incident-muted">No confidence factors were returned.</p>}
                        </div>
                        <p className="incident-causality-note">“Suspected” reflects the RCA contract. Evidence supports an assessment, not proof of causality.</p>
                      </>
                    )}
                  </article>

                  <article className="panel incident-business-panel">
                    <div className="incident-panel-head"><div><p className="eyebrow">MOTOR INSURANCE CONTEXT</p><h3>Operational context</h3></div><Bot size={17} /></div>
                    <p>{businessContext(affectedDatasets.map((dataset) => dataset.name), incident.evidence, incident.line_of_business)}</p>
                    <div className="incident-impact-pair">
                      <ImpactList title="Affected data products" nodes={impact.products} empty="No downstream data products were identified by the lineage graph." />
                      <ImpactList title="Unaffected context" nodes={impact.unaffected.slice(0, 4)} empty="No unaffected products to contrast in the current graph." />
                    </div>
                    <p className="incident-context-caveat">Context is limited to the synthetic data estate and observed graph. It does not represent actual customer impact or insurance decisions.</p>
                  </article>
                </section>

                <section className="incident-analysis-grid">
                  <article className="panel incident-evidence-panel" id="incident-evidence">
                    <div className="incident-panel-head"><div><p className="eyebrow">OBSERVED FACTS</p><h3>Correlated-event timeline / causal sequence</h3></div><FileSearch size={17} /></div>
                    <p className="incident-muted">Chronological ordering only; timestamps do not by themselves establish cause.</p>
                    {incident.evidence.length === 0 && <EmptyNotice message="This incident has no linked event evidence." />}
                    <div className="incident-evidence-list">
                      {incident.evidence.map((event) => (
                        <article className="incident-evidence-card" id={`event-${event.event_id}`} key={event.event_id}>
                          <div className="incident-evidence-top"><StatusPill value={event.severity} /><time>{formatDate(event.occurred_at)}</time></div>
                          <strong>{event.message}</strong>
                          <code>{event.event_type} · {event.event_id}</code>
                          <div className="incident-evidence-tags">
                            {event.dataset_id && <Link to={`/datasets?dataset_id=${encodeURIComponent(event.dataset_id)}`}><Database size={12} />{event.dataset_id}</Link>}
                            {event.pipeline_id && <span><Workflow size={12} />{event.pipeline_id}</span>}
                            {event.run_id && <span>Run {event.run_id}</span>}
                            {event.correlation_id && <span>Correlation {event.correlation_id}</span>}
                          </div>
                          {event.metrics.length > 0 && <div className="incident-metrics">{event.metrics.map((metric) => <span key={`${event.event_id}-${metric.name}`}><small>{label(metric.name)}</small><strong>{String(metric.value)}{metric.unit ? ` ${metric.unit}` : ""}</strong></span>)}</div>}
                        </article>
                      ))}
                    </div>
                  </article>

                  <article className="panel incident-timeline-panel">
                    <div className="incident-panel-head"><div><p className="eyebrow">CHRONOLOGICAL RECORD</p><h3>Correlated-event timeline</h3></div><Clock3 size={17} /></div>
                    {timelineEntries.length > 0 ? (
                      <ol className="incident-timeline">
                        {timelineEntries.map((entry) => (
                          <li key={`${entry.kind}-${entry.id}`} className={entry.kind === "evidence" ? "timeline-evidence" : "timeline-record"}>
                            <span className="timeline-point">{entry.kind === "evidence" ? <CircleAlert size={12} /> : <Activity size={12} />}</span>
                            <time>{formatDate(entry.occurred_at)}</time>
                            <strong>{entry.message}</strong>
                            <small>{entry.detail}</small>
                          </li>
                        ))}
                      </ol>
                    ) : <EmptyNotice message="No event or timeline sequence is available." />}
                    {incident.timeline.length === 0 && <p className="incident-muted">No additional operator or lifecycle timeline entries were returned.</p>}
                  </article>
                </section>

                <section className="incident-analysis-grid">
                  <article className="panel incident-impact-panel">
                    <div className="incident-panel-head"><div><p className="eyebrow">LINEAGE-DERIVED SCOPE</p><h3>Affected datasets</h3></div><ArrowDownRight size={17} /></div>
                    {lineageQuery.isError && <ErrorNotice message="Lineage is unavailable; downstream impact cannot be evaluated." />}
                    {datasetsQuery.isError && <ErrorNotice message="Dataset catalog is unavailable; dataset labels and links may be incomplete." />}
                    {affectedDatasets.length > 0 ? (
                      <div className="affected-dataset-list">
                        {affectedDatasets.map((dataset) => {
                          const node = impact.nodes.find((item) => item.node_id === dataset.dataset_id);
                          return <Link key={dataset.dataset_id} to={`/datasets?dataset_id=${encodeURIComponent(dataset.dataset_id)}`}><span><Database size={14} /><strong>{dataset.name}</strong><small>{dataset.layer} · {dataset.dataset_id}</small></span><StatusPill value={node?.health ?? "unknown"} /><ArrowRight size={14} /></Link>;
                        })}
                      </div>
                    ) : <p className="incident-muted">{incident.evidence.some((event) => event.dataset_id) ? "No matching catalog entries; direct evidence still names affected datasets." : "The incident has no dataset identifiers to map."}</p>}
                    <div className="incident-anchor-list">
                      <h4>Evidence-linked graph nodes</h4>
                      {incident.correlated_node_ids.length > 0
                        ? incident.correlated_node_ids.map((nodeId) => <Link key={nodeId} to={`/lineage?anchor=${encodeURIComponent(nodeId)}`}>{lineageQuery.data?.nodes.find((node) => node.node_id === nodeId)?.label ?? nodeId}<GitBranch size={12} /></Link>)
                        : <p className="incident-muted">No correlated graph nodes supplied.</p>}
                    </div>
                  </article>

                  <article className="panel incident-sla-panel">
                    <div className="incident-panel-head"><div><p className="eyebrow">DATA SERVICE COMMITMENTS</p><h3>SLA state</h3></div><Clock3 size={17} /></div>
                    {slasQuery.isError && <ErrorNotice message="SLA statuses could not be loaded." />}
                    {affectedSlas.length > 0 ? affectedSlas.map((sla) => (
                      <div className="incident-sla-row" key={sla.sla_id}>
                        <div><strong>{datasetsQuery.data?.find((dataset) => dataset.dataset_id === sla.dataset_id)?.name ?? sla.dataset_id}</strong><small>Target {formatDuration(sla.target_freshness_seconds)} · observed {formatDate(sla.observed_at)}</small></div>
                        <StatusPill value={sla.state} />
                        <span>{sla.current_freshness_seconds == null ? "Age not reported" : `Age ${formatDuration(sla.current_freshness_seconds)}`}</span>
                      </div>
                    )) : <p className="incident-muted">No SLA status is reported for this incident’s affected datasets.</p>}
                  </article>
                </section>

                <section className="panel incident-remediation-panel" id="incident-remediation">
                  <div className="incident-panel-head"><div><p className="eyebrow">HUMAN-IN-THE-LOOP</p><h3>Remediation & verification</h3></div><ShieldCheck size={17} /></div>
                  {plansQuery.isLoading && <LoadingNotice label="Loading remediation plans…" />}
                  {plansQuery.isError && <ErrorNotice message="Remediation plans could not be loaded." />}
                  {plansQuery.data?.length === 0 && (
                    <div className="incident-remediation-empty">
                      <p>No remediation plan is stored for this incident yet. Generate a reviewable plan; generation does not execute data changes.</p>
                      <button className="incident-primary-button" onClick={generatePlan} disabled={createPlanMutation.isPending}>
                        <Workflow size={14} />{createPlanMutation.isPending ? "Generating…" : "Generate Remediation"}
                      </button>
                    </div>
                  )}
                  {createPlanMutation.isError && <ErrorNotice message={createPlanMutation.error.message || "Remediation plan could not be created."} />}
                  {selectedPlan && (
                    <>
                      <div className="remediation-plan-card">
                        <div className="remediation-plan-top"><div><code>{selectedPlan.plan_id}</code><p>{selectedPlan.recommendation}</p></div><PlanStatus plan={selectedPlan} /></div>
                        <div className="remediation-plan-meta"><span>Mode: {label(selectedPlan.mode)}</span><span>Created {formatDate(selectedPlan.created_at)}</span><span>Human approval required: {selectedPlan.requires_human_approval ? "Yes" : "No"}</span></div>
                        {selectedPlan.approved === null && (
                          <div className="remediation-approval-actions">
                            <button className="incident-approve-button" onClick={() => approvalMutation.mutate({ planId: selectedPlan.plan_id, approved: true })} disabled={approvalMutation.isPending}><ThumbsUp size={14} />Approve</button>
                            <button className="incident-reject-button" onClick={() => approvalMutation.mutate({ planId: selectedPlan.plan_id, approved: false })} disabled={approvalMutation.isPending}><ThumbsDown size={14} />Reject</button>
                          </div>
                        )}
                        {selectedPlan.approved === false && (
                          <button className="incident-primary-button" onClick={generatePlan} disabled={createPlanMutation.isPending}>
                            <Workflow size={14} />{createPlanMutation.isPending ? "Generating…" : "Generate New Plan"}
                          </button>
                        )}
                        {approvalMutation.isError && <ErrorNotice message={approvalMutation.error.message || "The approval decision could not be saved."} />}
                      </div>
                      <div className="verification-result">
                        <div><Check size={15} /><strong>Post-remediation verification</strong></div>
                        {verificationQuery.isLoading && <LoadingNotice label="Loading verification results…" />}
                        {verificationQuery.isError && <ErrorNotice message="Verification results could not be loaded." />}
                        {verification
                          ? <VerificationCard result={verification} />
                          : <p className="incident-muted">{selectedPlan.approved === true ? "Approved plan has no recorded verification result yet." : selectedPlan.approved === false ? "Plan was rejected; no verification is expected." : "Verification is unavailable until a remediation action is approved and independently verified."}</p>}
                      </div>
                    </>
                  )}
                </section>
              </>
            )}
          </main>
        </section>
      )}
    </div>
  );
}

function ImpactList({ title, nodes, empty }: { title: string; nodes: LineageNode[]; empty: string }) {
  return (
    <div className="impact-list">
      <h4>{title}<span>{nodes.length}</span></h4>
      {nodes.length ? nodes.map((node) => <div key={node.node_id}><span>{node.label}</span><StatusPill value={node.health} /></div>) : <p>{empty}</p>}
    </div>
  );
}

function PlanStatus({ plan }: { plan: RemediationPlan }) {
  const value = plan.approved === true ? "approved" : plan.approved === false ? "rejected" : "waiting";
  return <StatusPill value={value} />;
}

function VerificationCard({ result }: { result: VerificationResult }) {
  return (
    <div className={`verification-card ${result.verified ? "verification-passed" : "verification-failed"}`}>
      <StatusPill value={result.verified ? "healthy" : "critical"} />
      <strong>{result.message || (result.verified ? "Verification passed." : "Verification did not pass.")}</strong>
      <time>{formatDate(result.verified_at)}</time>
      {result.checks.length > 0 && <ul>{result.checks.map((check) => <li key={check}>{check}</li>)}</ul>}
    </div>
  );
}

function remediationRecommendation(incident: Incident): string {
  const directDatasets = [...new Set(incident.evidence.flatMap((event) => event.dataset_id ? [event.dataset_id] : []))];
  return directDatasets.length
    ? `Review the evidence and validation for ${directDatasets.join(", ")}, then reprocess affected synthetic data only after human approval.`
    : "Review the linked event evidence and propose a non-destructive synthetic-data remediation after human approval.";
}

function businessContext(datasetNames: string[], evidence: Incident["evidence"], lineOfBusiness: string): string {
  const businessLabel = lineOfBusiness.split(/[_\s-]+/).filter(Boolean).map((part) =>
    part.charAt(0).toUpperCase() + part.slice(1),
  ).join(" ");
  if (datasetNames.length === 0) return `The incident is part of the ${businessLabel} synthetic data-observability estate; affected business data could not be resolved from the available evidence.`;
  const entities = datasetNames.join(", ");
  const signalKinds = [...new Set(evidence.map((event) => event.event_type.replaceAll("_", " ")))].join(", ");
  return `Observed signals (${signalKinds || "incident evidence"}) are linked to ${entities}. These datasets support downstream ${businessLabel} analytics and data products; this context describes data dependencies only and does not establish customer or underwriting impact.`;
}

function lineageHref(incident: Incident): string {
  const anchor = incident.correlated_node_ids[0] ?? incident.evidence.find((event) => event.dataset_id)?.dataset_id;
  return anchor ? `/lineage?anchor=${encodeURIComponent(anchor)}` : "/lineage";
}

function label(value: string): string {
  return value.replaceAll("_", " ").replaceAll("-", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatDate(value: string): string {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? "Not reported" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(timestamp);
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} sec`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

function formatPercent(value: number): string {
  return `${Math.round(clampPercent(value))}%`;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value * 100));
}
