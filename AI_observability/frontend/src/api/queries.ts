import { useQuery } from "@tanstack/react-query";
import { apiConfig } from "./config";
import { apiGet } from "./client";
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
  SimulatorStatus,
  VerificationResult,
} from "./contracts";

export const queryKeys = {
  health: ["health"] as const,
  sources: ["sources"] as const,
  datasets: ["datasets"] as const,
  datasetDetail: (datasetId: string) => ["dataset-detail", datasetId] as const,
  datasetPreview: (datasetId: string, limit: number) => ["dataset-preview", datasetId, limit] as const,
  incidents: ["incidents"] as const,
  incidentDetail: (incidentId: string) => ["incident-detail", incidentId] as const,
  incidentRca: (incidentId: string) => ["incident-rca", incidentId] as const,
  remediationPlans: (incidentId?: string) => ["remediation-plans", incidentId ?? "all"] as const,
  verifications: (planId: string) => ["verifications", planId] as const,
  events: ["events"] as const,
  lineage: ["lineage"] as const,
  slas: ["sla"] as const,
  quality: ["quality"] as const,
  findings: (incidentId?: string) => ["agent-findings", incidentId ?? "all"] as const,
  simulator: ["simulator"] as const,
};

const pollingOptions = {
  refetchInterval: apiConfig.refreshIntervalMs,
  refetchIntervalInBackground: false,
  staleTime: apiConfig.refreshIntervalMs / 2,
  retry: 1,
};

export function useHealth() {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: ({ signal }) => apiGet<HealthResponse>("/health", signal),
    ...pollingOptions,
  });
}

export function useSources() {
  return useQuery({
    queryKey: queryKeys.sources,
    queryFn: ({ signal }) => apiGet<DataSource[]>("/sources", signal),
    ...pollingOptions,
  });
}

export function useDatasets() {
  return useQuery({
    queryKey: queryKeys.datasets,
    queryFn: ({ signal }) => apiGet<Dataset[]>("/datasets", signal),
    ...pollingOptions,
  });
}

export function useDatasetDetail(datasetId: string) {
  return useQuery({
    queryKey: queryKeys.datasetDetail(datasetId),
    queryFn: ({ signal }) => apiGet<DatasetDetail>(`/datasets/${encodeURIComponent(datasetId)}`, signal),
    enabled: Boolean(datasetId),
    ...pollingOptions,
  });
}

export function useDatasetPreview(datasetId: string, limit = 10) {
  const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)));
  return useQuery({
    queryKey: queryKeys.datasetPreview(datasetId, safeLimit),
    queryFn: ({ signal }) => apiGet<DatasetPreview>(
      `/datasets/${encodeURIComponent(datasetId)}/preview?limit=${safeLimit}`,
      signal,
    ),
    enabled: Boolean(datasetId),
    ...pollingOptions,
  });
}

export function useIncidents() {
  return useQuery({
    queryKey: queryKeys.incidents,
    queryFn: ({ signal }) => apiGet<Incident[]>("/incidents", signal),
    ...pollingOptions,
  });
}

export function useIncidentDetail(incidentId: string) {
  return useQuery({
    queryKey: queryKeys.incidentDetail(incidentId),
    queryFn: ({ signal }) => apiGet<Incident>(`/incidents/${encodeURIComponent(incidentId)}`, signal),
    enabled: Boolean(incidentId),
    ...pollingOptions,
  });
}

export function useIncidentRca(incidentId: string) {
  return useQuery({
    queryKey: queryKeys.incidentRca(incidentId),
    queryFn: ({ signal }) => apiGet<RCAResult>(`/incidents/${encodeURIComponent(incidentId)}/rca`, signal),
    enabled: Boolean(incidentId),
    ...pollingOptions,
  });
}

export function useRemediationPlans(incidentId?: string) {
  const query = new URLSearchParams({ limit: "500" });
  if (incidentId) query.set("incident_id", incidentId);
  return useQuery({
    queryKey: queryKeys.remediationPlans(incidentId),
    queryFn: ({ signal }) => apiGet<RemediationPlan[]>(`/remediation?${query}`, signal),
    ...pollingOptions,
  });
}

export function useVerifications(planId: string) {
  return useQuery({
    queryKey: queryKeys.verifications(planId),
    queryFn: ({ signal }) => apiGet<VerificationResult[]>(
      `/remediation/${encodeURIComponent(planId)}/verification`,
      signal,
    ),
    enabled: Boolean(planId),
    ...pollingOptions,
  });
}

export function useEvents() {
  return useQuery({
    queryKey: queryKeys.events,
    queryFn: ({ signal }) => apiGet<ObservabilityEvent[]>("/events", signal),
    ...pollingOptions,
  });
}

export function useQuality() {
  return useQuery({
    queryKey: queryKeys.quality,
    queryFn: ({ signal }) => apiGet<QualityResult[]>("/quality", signal),
    ...pollingOptions,
  });
}

export function useLineage() {
  return useQuery({
    queryKey: queryKeys.lineage,
    queryFn: ({ signal }) => apiGet<LineageGraph>("/lineage", signal),
    ...pollingOptions,
  });
}

export function useSlaStatuses() {
  return useQuery({
    queryKey: queryKeys.slas,
    queryFn: ({ signal }) => apiGet<SLAStatus[]>("/sla", signal),
    ...pollingOptions,
  });
}

export function useSimulatorStatus() {
  return useQuery({
    queryKey: queryKeys.simulator,
    queryFn: ({ signal }) => apiGet<SimulatorStatus>("/simulator", signal),
    ...pollingOptions,
  });
}

export function useAgentFindings(incidentId?: string) {
  const query = new URLSearchParams({ limit: "500" });
  if (incidentId) query.set("incident_id", incidentId);
  return useQuery({
    queryKey: queryKeys.findings(incidentId),
    queryFn: ({ signal }) => apiGet<AgentFinding[]>(`/agents/findings?${query}`, signal),
    ...pollingOptions,
  });
}
