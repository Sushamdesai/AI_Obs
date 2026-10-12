import { FormEvent, useMemo, useState } from "react";
import { ArrowRight, Bot, CircleAlert, CornerDownLeft, FileSearch, GitBranch, LockKeyhole, Send, Sparkles, X } from "lucide-react";
import { Link } from "react-router-dom";
import { apiGet, ApiRequestError } from "../api/client";
import { apiConfig } from "../api/config";
import { useLineOfBusiness } from "../LineOfBusinessContext";
import {
  useAgentFindings,
  useDatasets,
  useEvents,
  useHealth,
  useIncidents,
  useLineage,
  useRemediationPlans,
  useSlaStatuses,
} from "../api/queries";
import type {
  AgentFinding,
  Dataset,
  Incident,
  LineageGraph,
  LineageNode,
  ObservabilityEvent,
  RCAResult,
  RemediationPlan,
  SLAStatus,
} from "../api/contracts";
import { EmptyNotice, ErrorNotice, LoadingNotice } from "./Notice";

const suggestedQuestions = [
  "Why is Fraud/Risk Scoring degraded?",
  "What caused the Claims incident?",
  "Which downstream products are affected?",
  "Show the evidence.",
  "Are any SLAs at risk?",
  "What remediation is recommended?",
];

type Reference = { label: string; href: string; kind: "incident" | "dataset" | "lineage" | "evidence" | "remediation" | "product" };
type ConversationMessage = {
  id: number;
  question: string;
  answer: string;
  references: Reference[];
  detail?: string;
};

type DataContext = {
  incidents: Incident[];
  events: ObservabilityEvent[];
  graph: LineageGraph;
  datasets: Dataset[];
  slas: SLAStatus[];
  findings: AgentFinding[];
  plans: RemediationPlan[];
  slasAvailable: boolean;
  plansAvailable: boolean;
  findingsAvailable: boolean;
};

const activeIncidentStates = new Set(["open", "acknowledged", "investigating"]);
const productTypes = new Set(["data_product", "ai_product", "report"]);
const inputTypes = new Set(["dataset", "feature"]);

export function AskAIExperience({ compact = false, onClose }: { compact?: boolean; onClose?: () => void }) {
  const { lineOfBusiness } = useLineOfBusiness();
  const healthQuery = useHealth();
  const incidentsQuery = useIncidents();
  const eventsQuery = useEvents();
  const lineageQuery = useLineage();
  const datasetsQuery = useDatasets();
  const slasQuery = useSlaStatuses();
  const findingsQuery = useAgentFindings();
  const plansQuery = useRemediationPlans();
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [requestError, setRequestError] = useState("");
  const isLoading = [incidentsQuery, eventsQuery, lineageQuery, datasetsQuery, slasQuery, findingsQuery, plansQuery]
    .some((query) => query.isLoading);
  const hasCoreError = incidentsQuery.isError || eventsQuery.isError || lineageQuery.isError;
  const context = useMemo<DataContext | null>(() => {
    if (!incidentsQuery.data || !eventsQuery.data || !lineageQuery.data) return null;
    const incidents = incidentsQuery.data.filter((incident) => incident.line_of_business === lineOfBusiness);
    const events = eventsQuery.data.filter((event) => event.line_of_business === lineOfBusiness);
    const datasets = (datasetsQuery.data ?? []).filter((dataset) => dataset.line_of_business === lineOfBusiness);
    const datasetIds = new Set(datasets.map((dataset) => dataset.dataset_id));
    const nodes = lineageQuery.data.nodes.filter((node) => node.line_of_business === lineOfBusiness);
    const nodeIds = new Set(nodes.map((node) => node.node_id));
    const evidenceIds = new Set(events.map((event) => event.event_id));
    const incidentIds = new Set(incidents.map((incident) => incident.incident_id));
    return {
      incidents,
      events,
      graph: {
        ...lineageQuery.data,
        line_of_business: lineOfBusiness,
        nodes,
        edges: lineageQuery.data.edges.filter((edge) =>
          nodeIds.has(edge.source_node_id) && nodeIds.has(edge.target_node_id),
        ),
      },
      datasets,
      slas: (slasQuery.data ?? []).filter((sla) => datasetIds.has(sla.dataset_id)),
      findings: (findingsQuery.data ?? []).filter((finding) =>
        finding.evidence_event_ids.some((eventId) => evidenceIds.has(eventId)),
      ),
      plans: (plansQuery.data ?? []).filter((plan) => incidentIds.has(plan.incident_id)),
      slasAvailable: !slasQuery.isError,
      plansAvailable: !plansQuery.isError,
      findingsAvailable: !findingsQuery.isError,
    };
  }, [
    datasetsQuery.data,
    eventsQuery.data,
    findingsQuery.data,
    findingsQuery.isError,
    incidentsQuery.data,
    lineageQuery.data,
    lineOfBusiness,
    plansQuery.data,
    plansQuery.isError,
    slasQuery.data,
    slasQuery.isError,
  ]);

  const sendQuestion = async (submittedQuestion: string) => {
    const cleanQuestion = submittedQuestion.trim();
    if (!cleanQuestion || sending) return;
    setQuestion("");
    setRequestError("");
    setSending(true);
    try {
      const message = await buildConversationMessage(cleanQuestion, context, messages.length + 1);
      setMessages((previous) => [...previous, message]);
    } catch (error) {
      setQuestion(cleanQuestion);
      setRequestError(error instanceof Error ? error.message : "The backend request failed. No answer was generated.");
    } finally {
      setSending(false);
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void sendQuestion(question);
  };

  return (
    <section className={`ask-ai-experience${compact ? " ask-ai-experience-compact" : ""}`} aria-label="Ask your data platform AI">
      <header className="ask-ai-header">
        <div className="ask-ai-heading">
          <span className="ask-ai-heading-icon"><Sparkles size={18} /></span>
          <div>
            <p className="eyebrow">EVIDENCE-FIRST INVESTIGATION</p>
            <h2 id="ask-ai-title">{compact ? "Ask the platform" : "Evidence conversation"}</h2>
            <p>Ask about data health, lineage, incidents, freshness, and remediation.</p>
          </div>
        </div>
        {compact && onClose && <button className="icon-button" type="button" onClick={onClose} aria-label="Close AI panel"><X size={17} /></button>}
      </header>

      <div className="ask-ai-provider-diagnostics" aria-label="Answer provider diagnostics">
        <span className="ask-ai-provider-mark"><Bot size={13} />Answer mode <strong>DETERMINISTIC</strong></span>
        <span>Gemini: not invoked · provider usage is not exposed by the current API</span>
      </div>
      {!apiConfig.mockMode && (
        <div className="ask-ai-contract-note">
          <LockKeyhole size={14} />
          <span>The backend has no conversational endpoint yet. This experience synthesizes concise answers from documented FastAPI evidence APIs; it does not call Gemini or expose hidden reasoning.</span>
        </div>
      )}
      {[datasetsQuery, slasQuery, findingsQuery, plansQuery].some((query) => query.isError) && (
        <div className="ask-ai-contract-note"><CircleAlert size={14} /><span>Some optional evidence APIs are unavailable. Answers will label unavailable records rather than treating them as empty.</span></div>
      )}
      {healthQuery.isError && <div className="ask-ai-contract-note"><CircleAlert size={14} /><span>Provider diagnostics could not be loaded; answers remain deterministic evidence summaries.</span></div>}
      {healthQuery.data?.providers.llm === "not_configured" && (
        <div className="ask-ai-contract-note"><CircleAlert size={14} /><span>The backend reports its LLM provider is not configured. Evidence summaries remain available; no Gemini call is made by the browser.</span></div>
      )}

      <div className="ask-ai-thread" aria-live="polite">
        {messages.length === 0 ? (
          <div className="ask-ai-welcome">
            <span className="ask-ai-welcome-icon"><FileSearch size={21} /></span>
            <h3>Investigate with evidence, not guesses</h3>
            <p>Answers are composed from current backend incidents, events, lineage, SLAs, findings, and saved remediation plans. Missing evidence is called out explicitly.</p>
            <div className="ask-ai-suggestions" aria-label="Suggested questions">
              {suggestedQuestions.map((suggestion) => (
                <button type="button" key={suggestion} onClick={() => void sendQuestion(suggestion)} disabled={isLoading || sending}>
                  <span>{suggestion}</span><ArrowRight size={13} />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="ask-ai-message-list">
            {messages.map((message) => <MessageCard key={message.id} message={message} />)}
          </div>
        )}
        {isLoading && <LoadingNotice label="Loading current backend evidence…" />}
        {hasCoreError && <ErrorNotice message="Incident, event, or lineage evidence could not be loaded. Check FastAPI availability before asking." />}
        {!isLoading && context && context.incidents.length === 0 && messages.length === 0 && (
          <EmptyNotice message="No backend incidents are currently available. You can still ask about data products and freshness." />
        )}
        {requestError && <ErrorNotice message={requestError} />}
      </div>

      <form className="ask-ai-composer" onSubmit={onSubmit}>
        <label className="sr-only" htmlFor={compact ? "ask-ai-question-panel" : "ask-ai-question-page"}>Ask a data platform question</label>
        <textarea
          id={compact ? "ask-ai-question-panel" : "ask-ai-question-page"}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask about an incident, product, evidence, or SLA…"
          rows={compact ? 2 : 3}
          disabled={isLoading || sending || hasCoreError}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void sendQuestion(question);
            }
          }}
        />
        <div className="ask-ai-composer-footer">
          <span><CornerDownLeft size={12} /> Enter to send · Shift+Enter for a new line</span>
          <button type="submit" disabled={!question.trim() || isLoading || sending || hasCoreError}>
            <Send size={14} />{sending ? "Checking…" : "Ask"}
          </button>
        </div>
      </form>
      {compact && <Link className="ask-ai-full-page-link" to="/ask-ai" onClick={onClose}>Open full investigation workspace<ArrowRight size={13} /></Link>}
      {!compact && <p className="ask-ai-privacy-note"><LockKeyhole size={13} />Only synthetic observability metadata is used. No raw business datasets are submitted.</p>}
    </section>
  );
}

async function buildConversationMessage(
  question: string,
  context: DataContext | null,
  id: number,
): Promise<ConversationMessage> {
  if (!context) {
    return {
      id,
      question,
      answer: "Backend evidence is still loading or unavailable. I did not generate an answer without incident, event, and lineage context.",
      references: [],
    };
  }

  const normalized = question.toLowerCase();
  const product = findProduct(normalized, context.graph.nodes);
  const incident = findIncident(normalized, context.incidents);
  const relevantIncident = incident ?? (product
    ? context.incidents.find((item) => activeIncidentStates.has(item.status) && incidentImpactsProduct(item, product, context.graph))
    : undefined);
  const references: Reference[] = [];
  const evidence = relevantIncident?.evidence ?? context.events.filter((event) => event.status === "detected");
  const evidenceIds = new Set(evidence.map((event) => event.event_id));
  const findings = context.findings.filter((finding) =>
    finding.evidence_event_ids.some((eventId) => evidenceIds.has(eventId)),
  );
  const relevantPlans = context.plans.filter((plan) =>
    relevantIncident ? plan.incident_id === relevantIncident.incident_id : true,
  ).sort((left, right) => right.created_at.localeCompare(left.created_at));
  const answerLines: string[] = [];
  let detail: string | undefined;

  if (/(sla|fresh|deadline|at risk)/.test(normalized)) {
    const atRisk = context.slas.filter((sla) =>
      sla.state !== "healthy" ||
      (sla.current_freshness_seconds != null && sla.current_freshness_seconds > sla.target_freshness_seconds),
    );
    if (!context.slasAvailable) {
      answerLines.push("Freshness SLA data could not be loaded from the backend, so I cannot determine which datasets are at risk.");
    } else if (!context.slas.length) {
      answerLines.push("No SLA records were returned by the backend, so I cannot assess freshness risk.");
    } else if (!atRisk.length) {
      answerLines.push(`${context.slas.length} dataset freshness SLA record(s) are available; none are currently marked at risk or beyond target.`);
    } else {
      answerLines.push(`${atRisk.length} of ${context.slas.length} dataset freshness SLA record(s) are at risk based on backend state or observed age exceeding target.`);
      for (const sla of atRisk.slice(0, 6)) {
        const dataset = context.datasets.find((item) => item.dataset_id === sla.dataset_id);
        const age = sla.current_freshness_seconds == null ? "age unavailable" : formatDuration(sla.current_freshness_seconds);
        const target = formatDuration(sla.target_freshness_seconds);
        const excess = sla.current_freshness_seconds == null
          ? ""
          : sla.current_freshness_seconds > sla.target_freshness_seconds
            ? `, ${formatDuration(sla.current_freshness_seconds - sla.target_freshness_seconds)} over target`
            : "";
        answerLines.push(`${dataset?.name ?? sla.dataset_id}: ${sla.state}; observed age ${age}, target ${target}${excess}.`);
        references.push({ label: `Dataset · ${dataset?.name ?? sla.dataset_id}`, href: `/datasets?dataset_id=${encodeURIComponent(sla.dataset_id)}`, kind: "dataset" });
      }
    }
    references.push({ label: "SLA & Data Products", href: "/sla", kind: "product" });
  } else if (/(remediation|recommend|fix|resolve)/.test(normalized)) {
    if (relevantPlans.length) {
      const plan = relevantPlans[0];
      answerLines.push(`Saved remediation plan: ${plan.recommendation}`);
      answerLines.push(`Approval state: ${plan.approved === true ? "approved" : plan.approved === false ? "rejected" : "awaiting human approval"}. No remediation action was executed by this answer.`);
      references.push({ label: `Remediation · ${plan.plan_id}`, href: `/incidents?incident_id=${encodeURIComponent(plan.incident_id)}#incident-remediation`, kind: "remediation" });
    } else if (!context.plansAvailable) {
      answerLines.push("Saved remediation plan records could not be loaded from the backend. No recommendation is inferred.");
    } else {
      answerLines.push("There is no saved remediation plan for the selected incident in the backend response. I will not invent a remediation recommendation.");
    }
    if (relevantIncident) references.push(incidentReference(relevantIncident));
  } else if (/(evidence|show|event|proof)/.test(normalized)) {
    if (!evidence.length) {
      answerLines.push("No detected event evidence was returned by the backend.");
    } else {
      answerLines.push(`Backend evidence contains ${evidence.length} event(s)${relevantIncident ? ` for ${relevantIncident.title}` : ""}:`);
      for (const event of evidence.slice(0, 8)) {
        answerLines.push(`${event.event_type.replaceAll("_", " ")} · ${event.message}`);
        references.push(eventReference(event, relevantIncident));
      }
    }
  } else if (/(downstream|affected|impact|consumer)/.test(normalized)) {
    if (product) {
      answerLines.push(`${product.label} is the selected lineage product. Its upstream inputs are listed in SLA & Data Products; it has no downstream product nodes in the current graph.`);
      references.push({ label: `Product · ${product.label}`, href: `/sla?product_id=${encodeURIComponent(product.node_id)}`, kind: "product" });
    } else {
      const incidentsToAssess = relevantIncident
        ? [relevantIncident]
        : context.incidents.filter((item) => activeIncidentStates.has(item.status));
      if (!incidentsToAssess.length) {
        answerLines.push("No active incidents are available to calculate impact. Select a source or dataset to inspect its lineage.");
      } else if (incidentsToAssess.length > 1 && !incident) {
        answerLines.push("There are multiple active incidents. Their impacts are calculated separately below; unrelated signals are not combined into one cause.");
      }
      for (const item of incidentsToAssess.slice(0, 6)) {
        const anchorIds = new Set([
          ...item.correlated_node_ids,
          ...item.evidence.flatMap((event) => event.dataset_id ? [event.dataset_id] : []),
        ]);
        const impactedNodes = walkDownstream(anchorIds, context.graph);
        const impactedProducts = impactedNodes.filter((node) => productTypes.has(node.node_type));
        answerLines.push(`${item.title}: ${impactedProducts.length
          ? impactedProducts.map((node) => node.label).join(", ")
          : "no downstream product nodes reported"} (lineage reachability).`);
        references.push(incidentReference(item));
        const anchor = item.correlated_node_ids[0] ?? item.evidence.find((event) => event.dataset_id)?.dataset_id;
        if (anchor) references.push({ label: `Lineage · ${item.title}`, href: `/lineage?anchor=${encodeURIComponent(anchor)}`, kind: "lineage" });
        impactedProducts.slice(0, 4).forEach((node) => references.push({
          label: `Product · ${node.label}`,
          href: `/sla?product_id=${encodeURIComponent(node.node_id)}`,
          kind: "product",
        }));
      }
    }
  } else if (product) {
    const dependencies = getProductInputs(product.node_id, context.graph);
    answerLines.push(`${product.label} is reported as ${product.health.toUpperCase()} by the backend lineage graph.`);
    const unhealthyInputs = dependencies.filter((node) =>
      node.health === "degraded" || node.health === "critical" ||
      context.slas.some((sla) => sla.dataset_id === node.node_id &&
        (sla.state !== "healthy" || (sla.current_freshness_seconds != null && sla.current_freshness_seconds > sla.target_freshness_seconds))),
    );
    if (unhealthyInputs.length) {
      answerLines.push(`Relevant dependency signals: ${unhealthyInputs.map((node) => {
        const sla = context.slas.find((item) => item.dataset_id === node.node_id);
        const ageText = sla?.current_freshness_seconds != null && sla.current_freshness_seconds > sla.target_freshness_seconds
          ? `; freshness ${formatDuration(sla.current_freshness_seconds)} vs ${formatDuration(sla.target_freshness_seconds)} target`
          : "";
        return `${node.label} is ${node.health}${ageText}`;
      }).join("; ")}.`);
    } else if (dependencies.length) {
      answerLines.push(dependencies.every((node) => node.health === "healthy")
        ? "All lineage-reported dataset/feature inputs are healthy; no non-healthy dependency signal was found."
        : "No specific unhealthy dataset/feature dependency could be confirmed from available backend records.");
    } else {
      answerLines.push("The backend lineage graph does not report dataset/feature dependencies for this product.");
    }
    references.push({ label: `Product · ${product.label}`, href: `/sla?product_id=${encodeURIComponent(product.node_id)}`, kind: "product" });
    references.push({ label: "Product lineage", href: `/lineage?anchor=${encodeURIComponent(product.node_id)}`, kind: "lineage" });
    dependencies.slice(0, 6).forEach((node) => references.push({
      label: `Dataset · ${node.label}`,
      href: `/datasets?dataset_id=${encodeURIComponent(node.node_id)}`,
      kind: "dataset",
    }));
    if (relevantIncident) {
      answerLines.push(`A linked active incident is present: ${relevantIncident.title}.`);
      references.push(incidentReference(relevantIncident));
    }
  } else if (/(caused|cause|why|incident)/.test(normalized)) {
    if (!relevantIncident) {
      answerLines.push("No matching incident was found in the current backend response. Select a known incident or ask about a named data product.");
    } else {
      const rca = await tryGetRca(relevantIncident.incident_id);
      if (rca) {
        answerLines.push(`Persisted RCA summary: ${rca.suspected_root_cause}`);
        answerLines.push(`Deterministic confidence: ${Math.round(rca.confidence_score * 100)}%, with ${rca.confidence_factors.length} recorded factor(s).`);
        if (rca.evidence_event_ids.length) {
          const rcaEvents = relevantIncident.evidence.filter((event) => rca.evidence_event_ids.includes(event.event_id));
          rcaEvents.forEach((event) => references.push(eventReference(event, relevantIncident)));
        }
      } else {
        answerLines.push("No persisted RCA record is available. The related event evidence reports:");
        relevantIncident.evidence.slice(0, 5).forEach((event) => {
          answerLines.push(`${event.event_type.replaceAll("_", " ")} · ${event.message}`);
          references.push(eventReference(event, relevantIncident));
        });
        if (findings.length) answerLines.push(`Evidence-linked agent finding: ${findings[0].summary}`);
        else if (!context.findingsAvailable) answerLines.push("Agent-finding records could not be loaded.");
        answerLines.push("These are observed signals, not a confirmed root-cause conclusion.");
      }
      references.push(incidentReference(relevantIncident));
      const datasetId = relevantIncident.evidence.find((event) => event.dataset_id)?.dataset_id;
      if (datasetId) references.push({ label: `Dataset · ${datasetId}`, href: `/datasets?dataset_id=${encodeURIComponent(datasetId)}`, kind: "dataset" });
    }
  } else {
    answerLines.push("I can answer questions about a named product, incident cause, downstream impact, evidence, freshness SLAs, or saved remediation plans. Try one of the suggested questions.");
  }

  if (/(caused|cause|why|incident)/.test(normalized) && relevantIncident && !references.some((reference) => reference.kind === "incident")) {
    references.push(incidentReference(relevantIncident));
  }
  if (relevantIncident && !/(sla|fresh|deadline|at risk|remediation|recommend|fix|resolve)/.test(normalized)) {
    references.push(incidentReference(relevantIncident));
  }
  if (!references.length && context.graph.nodes.length) {
    references.push({ label: "Browse lineage", href: "/lineage", kind: "lineage" });
  }

  return {
    id,
    question,
    answer: answerLines.join("\n"),
    references: dedupeReferences(references),
    detail,
  };
}

async function tryGetRca(incidentId: string): Promise<RCAResult | null> {
  try {
    return await apiGet<RCAResult>(`/incidents/${encodeURIComponent(incidentId)}/rca`);
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) return null;
    if (apiConfig.mockMode && error instanceof Error && error.message.includes("no RCA fixture")) return null;
    throw new Error("The backend RCA request failed, so no root-cause answer was generated.");
  }
}

function findProduct(question: string, nodes: LineageNode[]): LineageNode | undefined {
  const candidates = nodes.filter((node) => productTypes.has(node.node_type));
  const aliases: Record<string, string[]> = {
    "Fraud/Risk Scoring": ["fraud/risk scoring", "fraud risk scoring", "risk scoring", "fraud scoring"],
    "Claims Analytics": ["claims analytics"],
    "Customer 360": ["customer 360", "customer360"],
    "Feature Store": ["feature store"],
  };
  return candidates.find((node) => {
    const normalizedLabel = node.label.toLowerCase();
    const names = aliases[node.label] ?? [normalizedLabel];
    return names.some((name) => question.includes(name));
  });
}

function findIncident(question: string, incidents: Incident[]): Incident | undefined {
  const active = incidents.filter((incident) => activeIncidentStates.has(incident.status));
  const terms = question.split(/[^a-z0-9]+/).filter((term) => term.length > 2);
  const scored = active.map((incident) => {
    const content = `${incident.title} ${incident.evidence.map((event) => `${event.event_type} ${event.message} ${event.dataset_id ?? ""}`).join(" ")}`.toLowerCase();
    return { incident, score: terms.reduce((score, term) => score + (content.includes(term) ? 1 : 0), 0) };
  }).sort((left, right) => right.score - left.score || right.incident.started_at.localeCompare(left.incident.started_at));
  return scored[0]?.score ? scored[0].incident : undefined;
}

function getProductInputs(productId: string, graph: LineageGraph): LineageNode[] {
  const visited = new Set([productId]);
  const pending = [productId];
  const inputNodes = new Map<string, LineageNode>();
  const nodeById = new Map(graph.nodes.map((node) => [node.node_id, node]));
  while (pending.length) {
    const target = pending.pop();
    if (!target) continue;
    graph.edges.forEach((edge) => {
      if (edge.target_node_id !== target || visited.has(edge.source_node_id)) return;
      visited.add(edge.source_node_id);
      pending.push(edge.source_node_id);
      const node = nodeById.get(edge.source_node_id);
      if (node && inputTypes.has(node.node_type)) inputNodes.set(node.node_id, node);
    });
  }
  return [...inputNodes.values()].sort((left, right) => left.label.localeCompare(right.label));
}

function walkDownstream(anchorIds: Set<string>, graph: LineageGraph): LineageNode[] {
  const visited = new Set(anchorIds);
  const pending = [...anchorIds];
  while (pending.length) {
    const current = pending.pop();
    if (!current) continue;
    graph.edges.forEach((edge) => {
      if (edge.source_node_id !== current || visited.has(edge.target_node_id)) return;
      visited.add(edge.target_node_id);
      pending.push(edge.target_node_id);
    });
  }
  const nodeById = new Map(graph.nodes.map((node) => [node.node_id, node]));
  return [...visited].map((nodeId) => nodeById.get(nodeId)).filter((node): node is LineageNode => Boolean(node));
}

function incidentImpactsProduct(incident: Incident, product: LineageNode, graph: LineageGraph): boolean {
  const anchors = new Set([
    ...incident.correlated_node_ids,
    ...incident.evidence.flatMap((event) => event.dataset_id ? [event.dataset_id] : []),
  ]);
  return walkDownstream(anchors, graph).some((node) => node.node_id === product.node_id);
}

function incidentReference(incident: Incident): Reference {
  return { label: `Incident · ${incident.title}`, href: `/incidents?incident_id=${encodeURIComponent(incident.incident_id)}`, kind: "incident" };
}

function eventReference(event: ObservabilityEvent, incident?: Incident): Reference {
  return {
    label: `Evidence · ${event.event_type.replaceAll("_", " ")}`,
    href: incident
      ? `/incidents?incident_id=${encodeURIComponent(incident.incident_id)}#event-${encodeURIComponent(event.event_id)}`
      : "/incidents",
    kind: "evidence",
  };
}

function dedupeReferences(references: Reference[]): Reference[] {
  return [...new Map(references.map((reference) => [`${reference.href}:${reference.label}`, reference])).values()];
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "not reported";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(seconds % 3600 === 0 ? 0 : 1)}h`;
  return `${(seconds / 86400).toFixed(seconds % 86400 === 0 ? 0 : 1)}d`;
}

function MessageCard({ message }: { message: ConversationMessage }) {
  return (
    <article className="ask-ai-conversation-message">
      <div className="ask-ai-user-question"><span><Bot size={13} /></span><strong>{message.question}</strong></div>
      <div className="ask-ai-answer">
        <div className="ask-ai-answer-label"><Sparkles size={13} />Evidence summary <span>DETERMINISTIC</span></div>
        <p>{message.answer}</p>
        {message.detail && <small>{message.detail}</small>}
        {message.references.length > 0 && (
          <div className="ask-ai-references" aria-label="Answer references">
            {message.references.map((reference) => (
              <Link key={`${reference.href}:${reference.label}`} to={reference.href} className={`ask-ai-reference ask-ai-reference-${reference.kind}`}>
                {reference.kind === "lineage" ? <GitBranch size={12} /> : reference.kind === "evidence" ? <FileSearch size={12} /> : <ArrowRight size={12} />}
                {reference.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}
