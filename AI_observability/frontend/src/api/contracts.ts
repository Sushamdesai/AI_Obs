export type HealthState =
  | "healthy"
  | "degraded"
  | "critical"
  | "waiting"
  | "unknown";

export type Severity = "info" | "warning" | "error" | "critical";
export type IncidentStatus =
  | "open"
  | "acknowledged"
  | "investigating"
  | "resolved"
  | "closed";

export interface HealthResponse {
  status: HealthState;
  service_name: string;
  version: string;
  demo_mode: boolean;
  providers: Record<string, "ready" | "not_configured">;
  checks: Array<{ name: string; status: HealthState; details: string }>;
  correlation_id: string;
}

export interface SimulatorCycleSummary {
  cycle_number: number;
  run_id: string;
  source_counts: Record<string, number>;
  silver_counts: Record<string, number>;
  gold_counts: Record<string, number>;
  rejected_counts: Record<string, number>;
  event_count: number;
}

export interface SimulatorStatus {
  enabled: boolean;
  last_cycles: SimulatorCycleSummary[];
}

export interface SimulatorCycleRequest {
  cycles: number;
  batch_size?: number;
  seed?: number;
  failure_scenarios: string[];
}

export interface SimulatorCycleResponse {
  cycles: SimulatorCycleSummary[];
  event_count: number;
}

export interface DataSource {
  source_id: string;
  name: string;
  source_type: string;
  line_of_business: string;
  status: HealthState;
  attributes: Record<string, unknown>;
}

export interface Dataset {
  dataset_id: string;
  name: string;
  layer: "bronze" | "silver" | "gold" | "feature";
  source_id?: string | null;
  line_of_business: string;
  schema_version: string;
  description: string;
  attributes: Record<string, unknown>;
}

export interface DatasetHealth {
  dataset_id: string;
  state: HealthState;
  quality_score?: number | null;
  freshness_seconds?: number | null;
  row_count?: number | null;
  observed_at: string;
}

export interface QualityResult {
  check_id: string;
  dataset_id: string;
  passed: boolean;
  score: number;
  evaluated_at: string;
  failed_records: number;
  message: string;
  attributes: Record<string, unknown>;
}

export interface SchemaVersion {
  dataset_id: string;
  version: string;
  fields: Record<string, string>;
  observed_at: string;
}

export interface PipelineRun {
  run_id: string;
  pipeline_id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  started_at: string;
  completed_at?: string | null;
  records_in: number;
  records_out: number;
  records_failed: number;
  correlation_id?: string | null;
}

export interface DatasetDetail {
  dataset: Dataset;
  platform: string;
  health?: DatasetHealth | null;
  quality?: QualityResult | null;
  schema_versions: SchemaVersion[];
  last_run?: PipelineRun | null;
  upstream: LineageNode[];
  downstream: LineageNode[];
  consumers: LineageNode[];
  row_count: number;
}

export interface DatasetPreview {
  dataset_id: string;
  row_count: number;
  returned_count: number;
  records: Array<Record<string, unknown>>;
  truncated: boolean;
}

export interface LineageNode {
  node_id: string;
  node_type:
    | "source"
    | "ingestion"
    | "pipeline"
    | "job"
    | "schema"
    | "dataset"
    | "quality_check"
    | "transformation"
    | "feature"
    | "data_product"
    | "ai_product"
    | "report";
  label: string;
  line_of_business: string;
  health: HealthState;
  metadata: Record<string, unknown>;
}

export interface LineageEdge {
  source_node_id: string;
  target_node_id: string;
  relationship: string;
  metadata: Record<string, unknown>;
}

export interface LineageGraph {
  nodes: LineageNode[];
  edges: LineageEdge[];
  line_of_business: string;
  generated_at: string;
}

export interface DataMetric {
  name: string;
  value: number | string | boolean;
  unit?: string | null;
  observed_at?: string | null;
}

export interface ObservabilityEvent {
  event_id: string;
  event_type: string;
  occurred_at: string;
  correlation_id: string;
  run_id?: string | null;
  source_id?: string | null;
  pipeline_id?: string | null;
  dataset_id?: string | null;
  line_of_business: string;
  severity: Severity;
  status: "detected" | "acknowledged" | "resolved";
  metrics: DataMetric[];
  attributes: Record<string, unknown>;
  message: string;
}

export interface Incident {
  incident_id: string;
  title: string;
  status: IncidentStatus;
  severity: Severity;
  line_of_business: string;
  started_at: string;
  evidence: ObservabilityEvent[];
  timeline: Array<{
    timeline_event_id: string;
    incident_id: string;
    occurred_at: string;
    event_type: string;
    message: string;
    correlation_id?: string | null;
  }>;
  correlated_node_ids: string[];
}

export interface ConfidenceFactor {
  name: string;
  score: number;
  explanation: string;
}

export interface RCAResult {
  incident_id: string;
  suspected_root_cause: string;
  confidence_score: number;
  confidence_factors: ConfidenceFactor[];
  evidence_event_ids: string[];
  generated_at: string;
}

export interface RemediationPlan {
  plan_id: string;
  incident_id: string;
  recommendation: string;
  requires_human_approval: boolean;
  approved: boolean | null;
  mode: string;
  created_at: string;
}

export interface VerificationResult {
  plan_id: string;
  verified: boolean;
  verified_at: string;
  checks: string[];
  message: string;
}

export interface SLAStatus {
  sla_id: string;
  dataset_id: string;
  state: HealthState;
  target_freshness_seconds: number;
  current_freshness_seconds?: number | null;
  observed_at: string;
}

export interface AgentFinding {
  finding_id: string;
  agent_name: string;
  summary: string;
  evidence_event_ids: string[];
  created_at: string;
}

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
  detail?: string;
  correlation_id?: string | null;
}

export interface DashboardSnapshot {
  health: HealthResponse;
  sources: DataSource[];
  datasets: Dataset[];
  incidents: Incident[];
  events: ObservabilityEvent[];
  lineage: LineageGraph;
  slas: SLAStatus[];
  findings: AgentFinding[];
}
