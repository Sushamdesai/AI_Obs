from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from pydantic import BaseModel, ConfigDict, Field

from shared.contracts import (
    AgentFinding,
    ConfidenceFactor,
    DatasetHealth,
    Incident,
    LineageGraph,
    ObservabilityEvent,
    PipelineRun,
    QualityResult,
    RCAResult,
    RemediationPlan,
    SLAStatus,
    SchemaVersion,
    VerificationResult,
)


class AgentModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class InvestigationInput(AgentModel):
    incident: Incident
    events: list[ObservabilityEvent] = Field(default_factory=list, max_length=500)
    quality_results: list[QualityResult] = Field(default_factory=list, max_length=500)
    dataset_health: list[DatasetHealth] = Field(default_factory=list, max_length=500)
    schema_versions: list[SchemaVersion] = Field(default_factory=list, max_length=500)
    pipeline_runs: list[PipelineRun] = Field(default_factory=list, max_length=500)
    sla_statuses: list[SLAStatus] = Field(default_factory=list, max_length=500)
    lineage_graph: LineageGraph | None = None
    historical_signatures: dict[str, str] = Field(default_factory=dict)
    verification_before: DatasetHealth | None = None
    verification_after: DatasetHealth | None = None
    verification_pipeline_status: str | None = None
    verification_schema_stable: bool | None = None
    verification_volume_ok: bool | None = None
    verification_product_states: dict[str, str] = Field(default_factory=dict)
    verification_required_quality_score: float = Field(default=0.95, ge=0, le=1)


class AnalysisStatus(StrEnum):
    COMPLETE = "complete"
    INSUFFICIENT_EVIDENCE = "insufficient_evidence"


class AgentRunStatus(StrEnum):
    SUCCEEDED = "succeeded"
    FALLBACK = "fallback"
    INSUFFICIENT_EVIDENCE = "insufficient_evidence"
    FAILED = "failed"


class RootCauseReport(AgentModel):
    incident_id: str
    status: AnalysisStatus
    root_cause_summary: str
    root_node: str | None = None
    evidence_ids: list[str] = Field(default_factory=list)
    considered_hypotheses: list[str] = Field(default_factory=list)
    confidence_score: float = Field(ge=0, le=1)
    confidence_factors: list[ConfidenceFactor] = Field(default_factory=list)
    explanation: str
    rca_result: RCAResult


class LineageImpactReport(AgentModel):
    incident_id: str
    root_node: str | None = None
    impacted_node_ids: list[str] = Field(default_factory=list)
    impacted_products: list[str] = Field(default_factory=list)
    unaffected_products: list[str] = Field(default_factory=list)
    evidence_ids: list[str] = Field(default_factory=list)
    explanation: str


class InsuranceContextReport(AgentModel):
    incident_id: str
    affected_domains: list[str] = Field(default_factory=list)
    operational_context: str
    limitations: str
    evidence_ids: list[str] = Field(default_factory=list)


class SLADatasetAssessment(AgentModel):
    sla_id: str
    dataset_id: str
    state: str
    target_freshness_seconds: int
    current_freshness_seconds: float | None
    seconds_overdue: float | None
    deadline_at: datetime | None


class SLAAssessment(AgentModel):
    incident_id: str
    assessments: list[SLADatasetAssessment] = Field(default_factory=list)
    explanation: str
    evidence_ids: list[str] = Field(default_factory=list)


class SafeRemediationAction(StrEnum):
    RESTORE_SOURCE_BEHAVIOR = "restore_source_behavior"
    REPROCESS_CONTROLLED_BATCH = "reprocess_controlled_batch"
    RERUN_VALIDATION = "rerun_validation"
    REFRESH_AFFECTED_DATASETS = "refresh_affected_synthetic_datasets"


class RemediationProposal(AgentModel):
    plan: RemediationPlan
    safe_actions: list[SafeRemediationAction]
    execution_performed: bool = False
    explanation: str


class AgentExecutionRecord(AgentModel):
    run_id: str
    agent_name: str
    started_at: datetime
    ended_at: datetime
    status: AgentRunStatus
    evidence_ids: list[str] = Field(default_factory=list)
    finding_id: str | None = None
    provider_used: str
    latency_ms: float = Field(ge=0)
    error: str | None = None


class InvestigationResult(AgentModel):
    incident_id: str
    findings: list[AgentFinding] = Field(default_factory=list)
    root_cause: RootCauseReport
    lineage_impact: LineageImpactReport
    insurance_context: InsuranceContextReport
    sla_assessment: SLAAssessment
    remediation: RemediationProposal
    verification: VerificationResult | None = None
    runs: list[AgentExecutionRecord]


__all__ = [
    "AgentExecutionRecord",
    "AgentRunStatus",
    "AnalysisStatus",
    "InsuranceContextReport",
    "InvestigationInput",
    "InvestigationResult",
    "LineageImpactReport",
    "RemediationProposal",
    "RootCauseReport",
    "SLAAssessment",
    "SLADatasetAssessment",
    "SafeRemediationAction",
]
