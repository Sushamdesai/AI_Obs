import { useEffect, useMemo } from "react";
import {
  Activity,
  Bot,
  CircleAlert,
  Clock3,
  FileSearch,
  GitBranch,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { apiConfig } from "../api/config";
import { useLineOfBusiness } from "../LineOfBusinessContext";
import {
  useAgentFindings,
  useIncidentDetail,
  useIncidentRca,
  useIncidents,
  useLineage,
  useRemediationPlans,
  useSlaStatuses,
  useVerifications,
} from "../api/queries";
import type { AgentFinding, Incident, LineageNode } from "../api/contracts";
import { EmptyNotice, ErrorNotice, LoadingNotice } from "./Notice";
import { StatusPill } from "./StatusPill";

type AgentStage = {
  name: string;
  responsibility: string;
  artifactLabel: string;
  icon: typeof Activity;
};

const stages: AgentStage[] = [
  { name: "DataAnomalyAgent", responsibility: "Summarizes deterministic quality, freshness, volume, schema, and pipeline signals.", artifactLabel: "Evidence-linked findings", icon: Activity },
  { name: "DataRCAAgent", responsibility: "Assesses root-cause hypotheses using evidence; confidence remains deterministic.", artifactLabel: "Persisted RCA artifact", icon: Sparkles },
  { name: "LineageImpactAgent", responsibility: "Identifies impacted and unaffected downstream products from backend lineage.", artifactLabel: "Lineage graph context", icon: GitBranch },
  { name: "InsuranceContextAgent", responsibility: "Explains established insurance-data impact cautiously and states limitations.", artifactLabel: "Persisted context finding", icon: Bot },
  { name: "SLAAgent", responsibility: "Uses backend freshness targets and observed SLA states.", artifactLabel: "SLA input status", icon: Clock3 },
  { name: "RemediationAgent", responsibility: "Creates safe remediation proposals; actions require human approval.", artifactLabel: "Persisted remediation plan", icon: Workflow },
  { name: "VerificationAgent", responsibility: "Checks deterministic results after approved remediation.", artifactLabel: "Persisted verification result", icon: ShieldCheck },
];

export function AgentCenterPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { lineOfBusiness, setLineOfBusiness } = useLineOfBusiness();
  const incidentsQuery = useIncidents();
  const lineageQuery = useLineage();
  const slasQuery = useSlaStatuses();
  const incidentId = searchParams.get("incident_id") ?? "";
  const incidentQuery = useIncidentDetail(incidentId);
  const findingsQuery = useAgentFindings(incidentId || undefined);
  const rcaQuery = useIncidentRca(incidentId);
  const plansQuery = useRemediationPlans(incidentId || undefined);
  const incidents = (incidentsQuery.data ?? []).filter((item) =>
    item.line_of_business === lineOfBusiness,
  );
  const incident = incidentQuery.data;
  const findings = findingsQuery.data ?? [];
  const rca = rcaQuery.data;
  const plans = (plansQuery.data ?? []).slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
  const currentPlan = plans[0];
  const verificationQuery = useVerifications(currentPlan?.plan_id ?? "");
  const verification = verificationQuery.data?.[0];

  useEffect(() => {
    if (incidentId || incidents.length === 0) return;
    setSearchParams({ incident_id: incidents[0].incident_id }, { replace: true });
  }, [incidentId, incidents, setSearchParams]);

  useEffect(() => {
    if (incident && incident.line_of_business !== lineOfBusiness) {
      setLineOfBusiness(incident.line_of_business);
    }
  }, [incident, lineOfBusiness, setLineOfBusiness]);

  const evidenceIds = useMemo(
    () => new Set((incident?.evidence ?? []).map((event) => event.event_id)),
    [incident],
  );
  const scopedFindings = findings.filter((finding) =>
    finding.evidence_event_ids.some((eventId) => evidenceIds.has(eventId)),
  );
  const dataAnomalyFindings = scopedFindings.filter((finding) => finding.agent_name === "DataAnomalyAgent");
  const impactedNodes = useMemo(() => {
    if (!incident || !lineageQuery.data) return [] as LineageNode[];
    const seeds = new Set([
      ...incident.correlated_node_ids,
      ...incident.evidence.flatMap((event) => event.dataset_id ? [event.dataset_id] : []),
    ]);
    const reached = new Set(seeds);
    const pending = [...seeds];
    while (pending.length) {
      const nodeId = pending.shift()!;
      for (const edge of lineageQuery.data.edges) {
        if (edge.source_node_id !== nodeId || reached.has(edge.target_node_id)) continue;
        reached.add(edge.target_node_id);
        pending.push(edge.target_node_id);
      }
    }
    const nodes = new Map(lineageQuery.data.nodes.map((node) => [node.node_id, node]));
    return [...reached].map((id) => nodes.get(id)).filter((node): node is LineageNode => Boolean(node));
  }, [incident, lineageQuery.data]);
  const productLabels = impactedNodes
    .filter((node) => ["data_product", "ai_product", "report"].includes(node.node_type))
    .map((node) => node.label);
  const relevantSlas = (slasQuery.data ?? []).filter((sla) =>
    impactedNodes.some((node) => node.node_id === sla.dataset_id),
  );

  const findingFor = (name: string) => scopedFindings.find((finding) => finding.agent_name === name);
  const linkedFindingIds = new Set(scopedFindings.map((finding) => finding.finding_id));
  const planFinding = findingFor("RemediationAgent");
  const verificationFinding = findingFor("VerificationAgent");

  const stageArtifact = (name: string): string | null => {
    if (name === "DataAnomalyAgent" && dataAnomalyFindings.length) {
      return dataAnomalyFindings.map((item) => item.summary).join(" ");
    }
    if (name === "DataRCAAgent" && rca) {
      return rca.suspected_root_cause;
    }
    if (name === "LineageImpactAgent" && lineageQuery.data) {
      return productLabels.length
        ? `The graph places ${productLabels.join(", ")} downstream of the incident-linked node(s). This is graph context, not an agent execution record.`
        : "The current lineage graph reports no downstream product nodes for the incident-linked node(s).";
    }
    if (name === "SLAAgent" && relevantSlas.length) {
      return `${relevantSlas.length} backend SLA status record(s) are available for incident-linked datasets; this is input data, not an SLA agent execution result.`;
    }
    if (name === "RemediationAgent" && currentPlan) return currentPlan.recommendation;
    if (name === "VerificationAgent" && verification) return verification.message || (verification.verified ? "Verification passed." : "Verification did not pass.");
    const finding = findingFor(name);
    return finding?.summary ?? null;
  };

  const stageHasOutput = (name: string): boolean => {
    if (name === "DataAnomalyAgent") return dataAnomalyFindings.length > 0;
    if (name === "DataRCAAgent") return Boolean(rca);
    if (name === "LineageImpactAgent") return Boolean(lineageQuery.data);
    if (name === "SLAAgent") return relevantSlas.length > 0;
    if (name === "RemediationAgent") return Boolean(currentPlan);
    if (name === "VerificationAgent") return Boolean(verification);
    return Boolean(findingFor(name));
  };

  const isVerificationWaiting = !verification && currentPlan?.approved !== true;
  const verificationGateMessage = !currentPlan
    ? "Waiting for an approved remediation plan before verification."
    : currentPlan.approved === false
      ? "Remediation was rejected; verification waits for a revised approved plan."
      : "Waiting for human approval before verification.";
  const selectIncident = (selected: Incident) => setSearchParams({ incident_id: selected.incident_id });

  const mainError =
    incidentsQuery.isError || (incidentId && incidentQuery.isError) ||
    (incidentId && findingsQuery.isError);

  return (
    <div className="page-stack">
      <div className="page-intro">
        <div>
          <p className="eyebrow">GROUNDED MULTI-AGENT WORKFLOW</p>
          <h1>Agentic AI Center</h1>
          <p className="intro-copy">Follow the investigation stages, their evidence-backed artifacts, and human approval gates. Execution telemetry is shown only when the backend records it.</p>
        </div>
        <div className="updated-meta"><span className="live-dot live-dot-on" />Refreshing every {Math.round(apiConfig.refreshIntervalMs / 1000)} seconds</div>
      </div>

      {incidentsQuery.isLoading && <LoadingNotice label="Loading incident-linked investigations…" />}
      {mainError && <ErrorNotice message="Incident or agent finding data could not be loaded. Check the FastAPI connection." />}
      {incidentsQuery.isSuccess && incidents.length === 0 && <EmptyNotice message="No backend incidents are available to anchor an agent workflow." />}

      {incidents.length > 0 && (
        <>
          <section className="panel agent-workflow-shell">
            <div className="agent-workflow-heading">
              <div>
                <p className="eyebrow">ORCHESTRATION</p>
                <h2><Workflow size={18} />AgentOrchestrator</h2>
                <p>Workflow stages are contract-defined. Stage state below is not inferred from persisted findings or RCA outputs.</p>
              </div>
              <div className="agent-orchestrator-status"><StatusPill value="waiting" /><small>Execution-state API not available</small></div>
            </div>
            <label className="agent-incident-select">
              <span>Incident-linked workflow</span>
              <select aria-label="Select incident workflow" value={incidentId} onChange={(event) => {
                const selected = incidents.find((item) => item.incident_id === event.target.value);
                if (selected) selectIncident(selected);
              }}>
                {incidents.map((item) => <option key={item.incident_id} value={item.incident_id}>{item.title} · {item.incident_id}</option>)}
              </select>
            </label>
            <div className="agent-stage-list" aria-label="Agent workflow stages">
              {stages.map((stage, index) => {
                const Icon = stage.icon;
                const hasOutput = stageHasOutput(stage.name);
                const stageOutput = stageArtifact(stage.name);
                const stageFinding = findingFor(stage.name);
                const waitingOnApproval = stage.name === "VerificationAgent" && isVerificationWaiting;
                return (
                  <article className={`agent-stage-card${hasOutput ? " agent-stage-has-output" : ""}`} key={stage.name}>
                    <div className="agent-stage-index">{String(index + 1).padStart(2, "0")}</div>
                    <div className="agent-stage-main">
                      <div className="agent-stage-title-row">
                        <span className="agent-stage-icon"><Icon size={16} /></span>
                        <div><h3>{stage.name}</h3><p>{stage.responsibility}</p></div>
                        <StatusPill value={waitingOnApproval ? "waiting" : "waiting"} />
                      </div>
                      <div className="agent-stage-meta">
                        <span>{hasOutput ? stage.artifactLabel : "No persisted output"}</span>
                        <span>Provider: not reported</span>
                        <span>Start/end/duration: not reported</span>
                      </div>
                      {waitingOnApproval && <div className="agent-stage-gate"><Clock3 size={13} />{verificationGateMessage}</div>}
                      {stageOutput && <p className="agent-stage-output">{stageOutput}</p>}
                      {!stageOutput && stage.name === "InsuranceContextAgent" && <p className="agent-stage-placeholder">No persisted insurance-context agent finding is available for this incident.</p>}
                      {!stageOutput && stage.name === "DataRCAAgent" && rcaQuery.isError && <p className="agent-stage-placeholder">No RCA artifact was returned; no execution state or root-cause output is inferred.</p>}
                      {!stageOutput && stage.name === "LineageImpactAgent" && lineageQuery.isError && <p className="agent-stage-placeholder">Lineage data could not be loaded, so no impact output is shown.</p>}
                      {stageFinding && <div className="agent-stage-links"><FindingLink finding={stageFinding} incidentId={incidentId} /><EvidenceLinks evidenceIds={stageFinding.evidence_event_ids} incidentId={incidentId} /></div>}
                      {stage.name === "DataRCAAgent" && rca && (
                        <div className="agent-stage-links">
                          <span className="agent-artifact-link"><Sparkles size={12} />RCA · {Math.round(rca.confidence_score * 100)}% deterministic confidence</span>
                          <EvidenceLinks evidenceIds={rca.evidence_event_ids} incidentId={incidentId} />
                        </div>
                      )}
                      {stage.name === "RemediationAgent" && currentPlan && (
                        <div className="agent-stage-links"><Link className="agent-artifact-link" to={`/incidents?incident_id=${encodeURIComponent(incidentId)}#incident-remediation`}><Workflow size={12} />{currentPlan.plan_id} · {currentPlan.approved === true ? "approved" : currentPlan.approved === false ? "rejected" : "awaiting approval"}</Link>{planFinding && <FindingLink finding={planFinding} incidentId={incidentId} />}</div>
                      )}
                      {stage.name === "VerificationAgent" && verification && (
                        <div className="agent-stage-links"><span className="agent-artifact-link"><ShieldCheck size={12} />{verification.verified ? "Verified" : "Not verified"}</span>{verificationFinding && <FindingLink finding={verificationFinding} incidentId={incidentId} />}</div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="agent-lower-grid">
            <article className="panel agent-run-panel">
              <div className="agent-panel-title"><div><p className="eyebrow">EXECUTION TELEMETRY</p><h2>Recent executions</h2></div><Activity size={17} /></div>
              <div className="agent-no-executions">
                <span><Clock3 size={18} /></span>
                <strong>No execution records reported</strong>
                <p>The current backend has findings and RCA APIs, but no orchestration or agent-execution listing API. Run status, provider, timestamps, latency, and execution errors are therefore not available here.</p>
              </div>
            </article>

            <article className="panel agent-artifacts-panel">
              <div className="agent-panel-title"><div><p className="eyebrow">PERSISTED OUTPUTS</p><h2>Evidence & findings</h2></div><FileSearch size={17} /></div>
              {findingsQuery.isLoading && <LoadingNotice label="Loading incident-linked findings…" />}
              {findingsQuery.isError && <ErrorNotice message="Agent findings could not be loaded." />}
              {scopedFindings.length > 0 ? (
                <div className="agent-findings-list">
                  {scopedFindings.map((finding) => <FindingCard key={finding.finding_id} finding={finding} incidentId={incidentId} />)}
                </div>
              ) : <EmptyNotice message="No persisted agent findings reference this incident's evidence events." />}
              {incident && incident.evidence.length > 0 && (
                <div className="agent-evidence-summary">
                  <h3>Incident evidence</h3>
                  {incident.evidence.slice(0, 5).map((event) => (
                    <Link key={event.event_id} to={`/incidents?incident_id=${encodeURIComponent(incidentId)}#incident-evidence`} className="agent-evidence-row">
                      <span><CircleAlert size={13} /><strong>{event.message}</strong></span>
                      <small>{event.event_type} · {event.event_id}</small>
                    </Link>
                  ))}
                </div>
              )}
            </article>
          </section>

          {rcaQuery.isError && <p className="agent-contract-note">RCA result unavailable for this incident. No substitute generated by the frontend.</p>}
          {slasQuery.isError && <p className="agent-contract-note">SLA input records could not be loaded. SLA agent output is not inferred.</p>}
          {plansQuery.isError && <p className="agent-contract-note">Remediation plan records could not be loaded; no remediation execution is assumed.</p>}
          {verificationQuery.isError && <p className="agent-contract-note">Verification records could not be loaded.</p>}
          {currentPlan?.approved === true && !verification && !verificationQuery.isLoading && (
            <p className="agent-contract-note">Remediation is approved; the Verification Agent stage remains WAITING until a backend verification result is recorded.</p>
          )}
          {linkedFindingIds.size === 0 && <p className="agent-contract-note">Persisted findings are filtered to event IDs attached to the selected incident.</p>}
        </>
      )}
    </div>
  );
}

function FindingCard({ finding, incidentId }: { finding: AgentFinding; incidentId: string }) {
  return (
    <article className="agent-finding-card" id={`finding-${finding.finding_id}`}>
      <div><strong>{finding.agent_name}</strong><time>{formatDate(finding.created_at)}</time></div>
      <p>{finding.summary}</p>
      <FindingLink finding={finding} incidentId={incidentId} />
    </article>
  );
}

function FindingLink({ finding, incidentId }: { finding: AgentFinding; incidentId: string }) {
  return <Link className="agent-artifact-link" to={`/agent-center?incident_id=${encodeURIComponent(incidentId)}#finding-${encodeURIComponent(finding.finding_id)}`}><Bot size={12} />Finding {finding.finding_id}</Link>;
}

function EvidenceLinks({ evidenceIds, incidentId }: { evidenceIds: string[]; incidentId: string }) {
  if (evidenceIds.length === 0) return <span className="agent-evidence-none">No evidence IDs attached</span>;
  return <span className="agent-evidence-inline"><FileSearch size={12} />Evidence {evidenceIds.map((id, index) => <Link key={id} to={`/incidents?incident_id=${encodeURIComponent(incidentId)}#event-${encodeURIComponent(id)}`}>{index > 0 ? ", " : ""}{id}</Link>)}</span>;
}

function formatDate(value: string): string {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? "Not reported" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(timestamp);
}
