import type {
  AgentFinding,
  DataSource,
  Dataset,
  DatasetDetail,
  DatasetPreview,
  HealthResponse,
  Incident,
  LineageGraph,
  ObservabilityEvent,
  QualityResult,
  RCAResult,
  RemediationPlan,
  SLAStatus,
  SimulatorCycleRequest,
  SimulatorCycleResponse,
  SimulatorStatus,
  VerificationResult,
} from "./contracts";

const observedAt = "2026-10-09T08:30:00Z";

const sources: DataSource[] = [
  ["claims", "Claims", "transactional"],
  ["policies", "Policy", "transactional"],
  ["customers", "Customer CRM", "crm"],
  ["payments", "Payments", "transactional"],
  ["bureau", "Bureau", "file"],
  ["telematics", "Telematics", "stream"],
].map(([source_id, name, source_type]) => ({
  source_id,
  name,
  source_type,
  line_of_business: "motor",
  status: "healthy",
  attributes: { fixture: true },
}));

const sourceNames = ["claims", "policies", "customers", "payments", "bureau", "telematics"];
const productDatasetSpecs: Array<{
  dataset_id: string;
  name: string;
  layer: Dataset["layer"];
  source_id: string | null;
}> = [
  { dataset_id: "feature.risk_features", name: "Risk Features", layer: "feature", source_id: "bureau" },
  { dataset_id: "feature.driving_features", name: "Driving Features", layer: "feature", source_id: "telematics" },
  { dataset_id: "gold.claims_analytics", name: "Claims Analytics", layer: "gold", source_id: null },
  { dataset_id: "gold.customer_360", name: "Customer 360", layer: "gold", source_id: null },
  { dataset_id: "gold.feature_store", name: "Feature Store", layer: "gold", source_id: null },
  { dataset_id: "gold.fraud_features", name: "Fraud Features", layer: "gold", source_id: null },
  { dataset_id: "gold.risk_scoring", name: "Risk Scoring", layer: "gold", source_id: null },
];

const datasets: Dataset[] = [
  ...(["bronze", "silver"] as const).flatMap((layer) =>
    sourceNames.map((source) => ({
      dataset_id: `${layer}.${source}`,
      name: `${layer}.${source}`,
      layer,
      source_id: source,
      line_of_business: "motor",
      schema_version: "1.0",
      description: "Contract-matching development fixture.",
      attributes: { fixture: true },
    })),
  ),
  ...productDatasetSpecs.map(({ dataset_id, name, layer, source_id }) => ({
    dataset_id,
    name,
    layer,
    source_id,
    line_of_business: "motor",
    schema_version: "1.0",
    description: "Contract-matching development fixture.",
    attributes: { fixture: true },
  })),
];

const eventTypes = [
  ["healthy_dataset", "info", "resolved", "silver.claims", "Healthy baseline fixture."],
  ["quality_failure", "error", "detected", "silver.claims", "Synthetic claims quality failure."],
  ["schema_drift", "warning", "detected", "bronze.claims", "Claims schema differs from baseline."],
  ["volume_anomaly", "warning", "detected", "feature.driving_features", "Telematics volume is below baseline."],
  ["freshness_violation", "error", "detected", "silver.payments", "Payments freshness target exceeded."],
  ["pipeline_failure", "critical", "detected", "silver.policies", "Policy ingestion failed."],
] as const;

const events: ObservabilityEvent[] = eventTypes.map(
  ([event_type, severity, status, dataset_id, message], index) => ({
    event_id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    event_type,
    occurred_at: observedAt,
    correlation_id: `fixture-correlation-${event_type}`,
    run_id: `fixture-run-${String(index + 1).padStart(3, "0")}`,
    source_id: dataset_id.split(".")[1],
    pipeline_id: event_type === "pipeline_failure" ? "policies-ingestion" : null,
    dataset_id,
    line_of_business: "motor",
    severity,
    status,
    metrics: [
      { name: "dataset.row_count", value: 1000 },
      { name: "dataset.quality_score", value: event_type === "healthy_dataset" ? 0.99 : 0.62 },
    ],
    attributes: { fixture: true },
    message,
  }),
);

const degradedNodeIds = new Set([
  "quality.claims",
  "silver.claims",
  "gold.claims_analytics",
  "gold.customer_360",
  "gold.feature_store",
  "ai.fraud_risk_scoring",
]);

const nodes: LineageGraph["nodes"] = [
  ["source.claims", "source", "Claims"],
  ["ingestion.claims", "ingestion", "Claims Ingestion"],
  ["schema.claims", "schema", "Claims Schema"],
  ["quality.claims", "quality_check", "Claims Quality"],
  ["bronze.claims", "dataset", "Bronze Claims"],
  ["silver.claims", "dataset", "Silver Claims"],
  ["source.policies", "source", "Policy"],
  ["ingestion.policies", "ingestion", "Policy Ingestion"],
  ["quality.policies", "quality_check", "Policy Quality"],
  ["silver.policies", "dataset", "Silver Policy"],
  ["source.customers", "source", "Customer CRM"],
  ["ingestion.customers", "ingestion", "Customer Ingestion"],
  ["quality.customers", "quality_check", "Customer Quality"],
  ["silver.customers", "dataset", "Silver Customer"],
  ["source.payments", "source", "Payments"],
  ["ingestion.payments", "ingestion", "Payment Ingestion"],
  ["quality.payments", "quality_check", "Payment Quality"],
  ["silver.payments", "dataset", "Silver Payments"],
  ["source.bureau", "source", "Bureau"],
  ["landing.bureau", "ingestion", "File Landing"],
  ["quality.bureau", "quality_check", "Bureau Quality"],
  ["feature.risk_features", "feature", "Risk Features"],
  ["source.telematics", "source", "Telematics"],
  ["ingestion.telematics", "ingestion", "Stream Ingestion"],
  ["quality.telematics", "quality_check", "Telematics Quality"],
  ["feature.driving_features", "feature", "Driving Features"],
  ["gold.claims_analytics", "data_product", "Claims Analytics"],
  ["gold.customer_360", "data_product", "Customer 360"],
  ["gold.feature_store", "data_product", "Feature Store"],
  ["ai.fraud_risk_scoring", "ai_product", "Fraud/Risk Scoring"],
].map(([node_id, node_type, label]) => ({
  node_id,
  node_type: node_type as LineageGraph["nodes"][number]["node_type"],
  label,
  line_of_business: "motor",
  health: degradedNodeIds.has(node_id) ? "degraded" as const : "healthy" as const,
  metadata: { fixture: true },
}));

const edgeSpecs = [
  ["source.claims", "ingestion.claims", "feeds"],
  ["ingestion.claims", "schema.claims", "produces_schema"],
  ["schema.claims", "quality.claims", "validates_schema"],
  ["quality.claims", "bronze.claims", "validates"],
  ["bronze.claims", "silver.claims", "transforms_to"],
  ["source.policies", "ingestion.policies", "feeds"],
  ["ingestion.policies", "quality.policies", "feeds"],
  ["quality.policies", "silver.policies", "validates"],
  ["source.customers", "ingestion.customers", "feeds"],
  ["ingestion.customers", "quality.customers", "feeds"],
  ["quality.customers", "silver.customers", "validates"],
  ["source.payments", "ingestion.payments", "feeds"],
  ["ingestion.payments", "quality.payments", "feeds"],
  ["quality.payments", "silver.payments", "validates"],
  ["source.bureau", "landing.bureau", "lands_file"],
  ["landing.bureau", "quality.bureau", "feeds"],
  ["quality.bureau", "feature.risk_features", "produces"],
  ["source.telematics", "ingestion.telematics", "streams_to"],
  ["ingestion.telematics", "quality.telematics", "feeds"],
  ["quality.telematics", "feature.driving_features", "produces"],
  ["silver.claims", "gold.claims_analytics", "contributes_to"],
  ["silver.policies", "gold.claims_analytics", "contributes_to"],
  ["silver.claims", "gold.customer_360", "contributes_to"],
  ["silver.policies", "gold.customer_360", "contributes_to"],
  ["silver.customers", "gold.customer_360", "contributes_to"],
  ["silver.payments", "gold.customer_360", "contributes_to"],
  ["silver.claims", "gold.feature_store", "contributes_to"],
  ["silver.policies", "gold.feature_store", "contributes_to"],
  ["feature.risk_features", "gold.feature_store", "contributes_to"],
  ["feature.driving_features", "gold.feature_store", "contributes_to"],
  ["gold.feature_store", "ai.fraud_risk_scoring", "feeds"],
] as const;

const lineage: LineageGraph = {
  nodes,
  edges: edgeSpecs.map(([source_node_id, target_node_id, relationship]) => ({
    source_node_id,
    target_node_id,
    relationship,
    metadata: {},
  })),
  line_of_business: "motor",
  generated_at: observedAt,
};

const health: HealthResponse = {
  status: "healthy",
  service_name: "InsuraObserve AI",
  version: "0.1.0",
  demo_mode: true,
  providers: { data_platform: "ready", observability: "ready", llm: "ready" },
  checks: [
    { name: "api", status: "healthy", details: "API is ready." },
    { name: "metadata_database", status: "healthy", details: "Metadata database is ready." },
    { name: "data_platform", status: "healthy", details: "ready" },
    { name: "observability", status: "healthy", details: "ready" },
    { name: "llm", status: "healthy", details: "ready" },
  ],
  correlation_id: "fixture-correlation",
};

const incidents: Incident[] = events
  .filter((event) => event.status === "detected")
  .map((event, index) => ({
    incident_id: `fixture-incident-${index + 1}`,
    title: event.message,
    status: "open",
    severity: event.severity,
    line_of_business: "motor",
    started_at: event.occurred_at,
    evidence: [event],
    timeline: [],
    correlated_node_ids: event.dataset_id ? [event.dataset_id] : [],
  }));

const remediationPlans: RemediationPlan[] = [{
  plan_id: "fixture-remediation-claims-quality",
  incident_id: "fixture-incident-1",
  recommendation: "Review the synthetic claims policy_id validation rule, then reprocess the affected batch after human approval.",
  requires_human_approval: true,
  approved: null,
  mode: "simulate",
  created_at: observedAt,
}];

const verifications: VerificationResult[] = [];
const simulatorStatus: SimulatorStatus = { enabled: true, last_cycles: [] };

function createRca(incidentId: string): RCAResult | undefined {
  const incident = incidents.find((item) => item.incident_id === incidentId);
  if (!incident) return undefined;
  const targetEvent = incident.evidence[0];
  const directDataset = datasets.find((dataset) => dataset.dataset_id === targetEvent?.dataset_id);
  const evidencePhrase = targetEvent?.message ?? "No linked event evidence is available.";
  return {
    incident_id: incidentId,
    suspected_root_cause: directDataset
      ? `${directDataset.name} is directly referenced by this incident's synthetic evidence. The evidence identifies an affected dataset, not a proven upstream cause.`
      : evidencePhrase,
    confidence_score: targetEvent ? 0.78 : 0,
    confidence_factors: targetEvent ? [
      { name: "temporal_correlation", score: 0.8, explanation: "Incident detection time aligns with its linked event." },
      { name: "lineage_proximity", score: 0.7, explanation: "The event is attached to a dataset that can be traced in lineage." },
      { name: "anomaly_strength", score: 0.8, explanation: "The event has a warning-or-higher severity signal." },
      { name: "signature_match", score: 0.75, explanation: "The event type is a named data-observability signal." },
      { name: "evidence_consistency", score: 0.85, explanation: "Incident evidence contains the event used by this finding." },
    ] : [],
    evidence_event_ids: incident.evidence.map((event) => event.event_id),
    generated_at: observedAt,
  };
}

const slas: SLAStatus[] = datasets.map((dataset) => ({
  sla_id: `sla:${dataset.dataset_id}`,
  dataset_id: dataset.dataset_id,
  state: dataset.dataset_id === "silver.payments" ? "degraded" : "healthy",
  target_freshness_seconds: 3600,
  current_freshness_seconds: dataset.dataset_id === "silver.payments" ? 5400 : 60,
  observed_at: observedAt,
}));

const qualityResults: QualityResult[] = datasets.map((dataset) => {
  const failed = dataset.dataset_id === "silver.claims";
  return {
    check_id: `fixture-quality-${dataset.dataset_id}`,
    dataset_id: dataset.dataset_id,
    passed: !failed,
    score: failed ? 0.62 : 0.99,
    evaluated_at: observedAt,
    failed_records: failed ? 12 : 0,
    message: failed
      ? "Synthetic claims quality failure: policy reference validation failed for 12 records."
      : "Synthetic required-field and relationship checks passed.",
    attributes: { fixture: true, checks: ["required_fields", "relationship_integrity"] },
  };
});

const findings: AgentFinding[] = events
  .filter((event) => event.event_type === "quality_failure")
  .map((event): AgentFinding => ({
    finding_id: "fixture-finding-claims-quality",
    agent_name: "DataRCAAgent",
    summary: "Claims quality failure is present in synthetic event evidence; inspect policy_id validation before downstream refresh.",
    evidence_event_ids: [event.event_id],
    created_at: observedAt,
  }));

function createDatasetDetail(datasetId: string): DatasetDetail | undefined {
  const dataset = datasets.find((item) => item.dataset_id === datasetId);
  if (!dataset) return undefined;
  const node = lineage.nodes.find((item) => item.node_id === datasetId);
  const upstream: LineageGraph["nodes"] = [];
  const downstream: LineageGraph["nodes"] = [];
  if (node) {
    const visitedUpstream = new Set([node.node_id]);
    const pendingUpstream = [node.node_id];
    while (pendingUpstream.length) {
      const current = pendingUpstream.pop()!;
      for (const edge of lineage.edges.filter((item) => item.target_node_id === current)) {
        if (visitedUpstream.has(edge.source_node_id)) continue;
        visitedUpstream.add(edge.source_node_id);
        pendingUpstream.push(edge.source_node_id);
        const parent = lineage.nodes.find((item) => item.node_id === edge.source_node_id);
        if (parent) upstream.push(parent);
      }
    }
    const visitedDownstream = new Set([node.node_id]);
    const pendingDownstream = [node.node_id];
    while (pendingDownstream.length) {
      const current = pendingDownstream.pop()!;
      for (const edge of lineage.edges.filter((item) => item.source_node_id === current)) {
        if (visitedDownstream.has(edge.target_node_id)) continue;
        visitedDownstream.add(edge.target_node_id);
        pendingDownstream.push(edge.target_node_id);
        const child = lineage.nodes.find((item) => item.node_id === edge.target_node_id);
        if (child) downstream.push(child);
      }
    }
  }
  const state = dataset.dataset_id === "silver.policies"
    ? "critical"
    : dataset.dataset_id === "silver.claims" || dataset.dataset_id === "silver.payments"
      ? "degraded"
      : "healthy";
  const qualityScore = dataset.dataset_id === "silver.claims" ? 0.62 : 0.99;
  return {
    dataset,
    platform: "ready",
    health: {
      dataset_id: datasetId,
      state,
      quality_score: qualityScore,
      freshness_seconds: dataset.dataset_id === "silver.payments" ? 5400 : 60,
      row_count: 1000,
      observed_at: observedAt,
    },
    quality: {
      check_id: `fixture-quality-${datasetId}`,
      dataset_id: datasetId,
      passed: state === "healthy",
      score: qualityScore,
      evaluated_at: observedAt,
      failed_records: state === "healthy" ? 0 : 12,
      message: state === "healthy" ? "Synthetic quality checks passed." : "Synthetic fixture contains observed quality issues.",
      attributes: { fixture: true },
    },
    schema_versions: [{
      dataset_id: datasetId,
      version: dataset.schema_version,
      fields: {
        record_id: "string",
        source_id: "string",
        observed_at: "datetime",
        metric_value: "float",
      },
      observed_at: observedAt,
    }],
    last_run: {
      run_id: `fixture-run-${datasetId}`,
      pipeline_id: dataset.source_id ? `${dataset.source_id}-ingestion` : "gold-curation",
      status: state === "critical" ? "failed" : "succeeded",
      started_at: observedAt,
      completed_at: observedAt,
      records_in: 1000,
      records_out: state === "critical" ? 0 : 988,
      records_failed: state === "critical" ? 1000 : state === "degraded" ? 12 : 0,
      correlation_id: `fixture-correlation-${datasetId}`,
    },
    upstream,
    downstream,
    consumers: downstream.filter((item) => ["data_product", "ai_product", "report"].includes(item.node_type)),
    row_count: 1000,
  };
}

function createDatasetPreview(datasetId: string, limit: number): DatasetPreview | undefined {
  const detail = createDatasetDetail(datasetId);
  if (!detail) return undefined;
  const count = Math.min(Math.max(1, Math.floor(limit) || 10), 100);
  const total = detail.row_count;
  const records = Array.from({ length: Math.min(count, total) }, (_, index) => ({
    record_id: `synthetic-${datasetId.replaceAll(".", "-")}-${String(index + 1).padStart(3, "0")}`,
    dataset_id: datasetId,
    source_id: detail.dataset.source_id ?? "curated",
    metric_value: Number((0.7 + index * 0.01).toFixed(2)),
    observed_at: observedAt,
  }));
  return {
    dataset_id: datasetId,
    row_count: total,
    returned_count: records.length,
    records,
    truncated: records.length < total,
  };
}

export function getMockResponse<T>(path: string): T {
  const [pathname, query = ""] = path.split("?", 2);
  if (pathname === "/agents/findings") {
    const incidentId = new URLSearchParams(query).get("incident_id");
    if (!incidentId) return findings as T;
    const incident = incidents.find((item) => item.incident_id === incidentId);
    if (!incident) throw new Error(`Mock mode has no incident fixture for ${incidentId}.`);
    const incidentEventIds = new Set(incident.evidence.map((event) => event.event_id));
    return findings.filter((finding) => finding.evidence_event_ids.some((eventId) => incidentEventIds.has(eventId))) as T;
  }
  const incidentMatch = pathname.match(/^\/incidents\/([^/]+)(?:\/(rca|events))?$/);
  if (incidentMatch) {
    const incidentId = decodeURIComponent(incidentMatch[1]);
    const incident = incidents.find((item) => item.incident_id === incidentId);
    if (!incident) throw new Error(`Mock mode has no incident fixture for ${incidentId}.`);
    if (incidentMatch[2] === "rca") {
      const rca = createRca(incidentId);
      if (!rca) throw new Error(`Mock mode has no RCA fixture for ${incidentId}.`);
      return rca as T;
    }
    if (incidentMatch[2] === "events") return incident.evidence as T;
    return { ...incident, timeline: incident.timeline.slice().sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)) } as T;
  }
  if (pathname === "/remediation") {
    const incidentId = new URLSearchParams(query).get("incident_id");
    return remediationPlans.filter((plan) => !incidentId || plan.incident_id === incidentId) as T;
  }
  const verificationMatch = pathname.match(/^\/remediation\/([^/]+)\/verification$/);
  if (verificationMatch) {
    const planId = decodeURIComponent(verificationMatch[1]);
    if (!remediationPlans.some((plan) => plan.plan_id === planId)) {
      throw new Error(`Mock mode has no remediation fixture for ${planId}.`);
    }
    return verifications.filter((result) => result.plan_id === planId) as T;
  }
  const datasetMatch = pathname.match(/^\/datasets\/(.+?)(\/preview)?$/);
  if (datasetMatch) {
    const datasetId = decodeURIComponent(datasetMatch[1]);
    const preview = datasetMatch[2] === "/preview";
    const detail = createDatasetDetail(datasetId);
    if (!detail) throw new Error(`Mock mode has no dataset fixture for ${datasetId}.`);
    if (!preview) return detail as T;
    const limit = Number(new URLSearchParams(query).get("limit") ?? 10);
    const response = createDatasetPreview(datasetId, limit);
    if (!response) throw new Error(`Mock mode has no preview fixture for ${datasetId}.`);
    return response as T;
  }
  const responses: Record<string, unknown> = {
    "/health": health,
    "/sources": sources,
    "/datasets": datasets,
    "/incidents": incidents,
    "/events": events,
    "/quality": qualityResults,
    "/lineage": lineage,
    "/sla": slas,
    "/simulator": simulatorStatus,
  };
  if (!(pathname in responses)) {
    throw new Error(`Mock mode does not provide a response for ${pathname}.`);
  }
  return responses[pathname] as T;
}

export async function sendMockRequest<T>(
  method: "POST" | "PATCH",
  path: string,
  body: unknown,
): Promise<T> {
  if (method === "POST" && path === "/simulator/cycles") {
    const request = body as SimulatorCycleRequest;
    if (!Number.isInteger(request.cycles) || request.cycles < 1 || request.cycles > 5) {
      throw new Error("cycles must be between 1 and 5.");
    }
    if (request.failure_scenarios.length > 6 || new Set(request.failure_scenarios).size !== request.failure_scenarios.length) {
      throw new Error("failure_scenarios must contain at most six unique scenarios.");
    }
    const allowedScenarios = new Set([
      "CLAIMS_QUALITY_FAILURE",
      "SCHEMA_DRIFT",
      "TELEMATICS_VOLUME_DROP",
      "FRESHNESS_VIOLATION",
      "PII_PROCESSING_FAILURE",
      "PIPELINE_DELAY",
    ]);
    if (request.failure_scenarios.some((scenario) => !allowedScenarios.has(scenario))) {
      throw new Error("Unknown simulator failure scenario.");
    }
    const lastCycle = simulatorStatus.last_cycles.at(-1)?.cycle_number ?? -1;
    const cycles: SimulatorCycleResponse["cycles"] = Array.from({ length: request.cycles }, (_, index) => ({
      cycle_number: lastCycle + index + 1,
      run_id: `mock-motor-${String(lastCycle + index + 2).padStart(8, "0")}`,
      source_counts: Object.fromEntries(sourceNames.map((source) => [source, 12])),
      silver_counts: Object.fromEntries(sourceNames.map((source) => [source, 12])),
      gold_counts: { claims_analytics: 24, customer_360: 48, fraud_features: 48, risk_scoring: 48 },
      rejected_counts: Object.fromEntries(sourceNames.map((source) => [source, 0])),
      event_count: 0,
    }));
    simulatorStatus.last_cycles = [...simulatorStatus.last_cycles, ...cycles].slice(-5);
    return { cycles, event_count: 0 } as T;
  }
  const approvalMatch = path.match(/^\/remediation\/([^/]+)\/approval$/);
  if (method === "PATCH" && approvalMatch) {
    const planId = decodeURIComponent(approvalMatch[1]);
    const plan = remediationPlans.find((item) => item.plan_id === planId);
    if (!plan) throw new Error(`Mock mode has no remediation fixture for ${planId}.`);
    const update = body as { approved?: unknown };
    if (typeof update.approved !== "boolean") throw new Error("Approval must be true or false.");
    plan.approved = update.approved;
    return { ...plan } as T;
  }
  if (method === "POST" && path === "/remediation") {
    const plan = body as RemediationPlan;
    if (!incidents.some((item) => item.incident_id === plan.incident_id)) {
      throw new Error(`Mock mode has no incident fixture for ${plan.incident_id}.`);
    }
    if (remediationPlans.some((item) => item.plan_id === plan.plan_id)) {
      throw new Error(`Remediation plan ${plan.plan_id} already exists.`);
    }
    if (plan.approved === true) throw new Error("A remediation plan must be approved in a separate action.");
    const created = { ...plan, requires_human_approval: true, approved: null };
    remediationPlans.unshift(created);
    return created as T;
  }
  if (method === "POST") {
    const verificationMatch = path.match(/^\/remediation\/([^/]+)\/verification$/);
    if (verificationMatch) {
      const planId = decodeURIComponent(verificationMatch[1]);
      const plan = remediationPlans.find((item) => item.plan_id === planId);
      if (!plan || plan.approved !== true) throw new Error("Remediation must be approved before verification.");
      const result = body as VerificationResult;
      if (result.plan_id !== planId) throw new Error("Verification plan_id must match the URL.");
      verifications.unshift(result);
      return result as T;
    }
  }
  throw new Error(`Mock mode does not support ${method} ${path}.`);
}
