from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ContractModel(BaseModel):
    model_config = ConfigDict(use_enum_values=True, extra="forbid")

    @field_validator("*", mode="after")
    @classmethod
    def normalize_datetimes_to_utc(cls, value: Any) -> Any:
        if isinstance(value, datetime):
            if value.tzinfo is None or value.utcoffset() is None:
                raise ValueError("Datetime values must include a timezone.")
            return value.astimezone(UTC)
        return value


class HealthState(StrEnum):
    HEALTHY = "healthy"
    DEGRADED = "degraded"
    CRITICAL = "critical"
    WAITING = "waiting"
    UNKNOWN = "unknown"


class Severity(StrEnum):
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"
    CRITICAL = "critical"


class EventStatus(StrEnum):
    DETECTED = "detected"
    ACKNOWLEDGED = "acknowledged"
    RESOLVED = "resolved"


class ProviderStatus(StrEnum):
    READY = "ready"
    NOT_CONFIGURED = "not_configured"


class PipelineRunStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class IncidentStatus(StrEnum):
    OPEN = "open"
    ACKNOWLEDGED = "acknowledged"
    INVESTIGATING = "investigating"
    RESOLVED = "resolved"
    CLOSED = "closed"


class DatasetLayer(StrEnum):
    BRONZE = "bronze"
    SILVER = "silver"
    GOLD = "gold"
    FEATURE = "feature"


class LineageNodeType(StrEnum):
    SOURCE = "source"
    INGESTION = "ingestion"
    PIPELINE = "pipeline"
    JOB = "job"
    SCHEMA = "schema"
    DATASET = "dataset"
    QUALITY_CHECK = "quality_check"
    TRANSFORMATION = "transformation"
    FEATURE = "feature"
    DATA_PRODUCT = "data_product"
    AI_PRODUCT = "ai_product"
    REPORT = "report"


class DataSource(ContractModel):
    source_id: str
    name: str
    source_type: str
    line_of_business: str = "motor"
    status: HealthState = HealthState.HEALTHY
    attributes: dict[str, Any] = Field(default_factory=dict)


class Pipeline(ContractModel):
    pipeline_id: str
    name: str
    source_id: str
    line_of_business: str = "motor"
    schedule_interval_seconds: int | None = Field(default=None, ge=1)


class PipelineRun(ContractModel):
    run_id: str
    pipeline_id: str
    status: PipelineRunStatus
    started_at: datetime
    completed_at: datetime | None = None
    records_in: int = Field(default=0, ge=0)
    records_out: int = Field(default=0, ge=0)
    records_failed: int = Field(default=0, ge=0)
    correlation_id: str | None = None


class Dataset(ContractModel):
    dataset_id: str
    name: str
    layer: DatasetLayer
    source_id: str | None = None
    line_of_business: str = "motor"
    schema_version: str = "1.0"
    description: str = ""
    attributes: dict[str, Any] = Field(default_factory=dict)


class DatasetHealth(ContractModel):
    dataset_id: str
    state: HealthState = HealthState.UNKNOWN
    quality_score: float | None = Field(default=None, ge=0, le=1)
    freshness_seconds: float | None = Field(default=None, ge=0)
    row_count: int | None = Field(default=None, ge=0)
    observed_at: datetime


class QualityResult(ContractModel):
    check_id: str
    dataset_id: str
    passed: bool
    score: float = Field(ge=0, le=1)
    evaluated_at: datetime
    failed_records: int = Field(default=0, ge=0)
    message: str = ""
    attributes: dict[str, Any] = Field(default_factory=dict)


class DataMetric(ContractModel):
    name: str
    value: float | int | str | bool
    unit: str | None = None
    observed_at: datetime | None = None


class SchemaVersion(ContractModel):
    dataset_id: str
    version: str
    fields: dict[str, str]
    observed_at: datetime


class LineageNode(ContractModel):
    node_id: str
    node_type: LineageNodeType
    label: str
    line_of_business: str = "motor"
    health: HealthState = HealthState.UNKNOWN
    metadata: dict[str, Any] = Field(default_factory=dict)


class LineageEdge(ContractModel):
    source_node_id: str
    target_node_id: str
    relationship: str
    metadata: dict[str, Any] = Field(default_factory=dict)


class LineageGraph(ContractModel):
    nodes: list[LineageNode]
    edges: list[LineageEdge]
    line_of_business: str = "motor"
    generated_at: datetime


class ObservabilityEvent(ContractModel):
    event_id: UUID
    event_type: str
    occurred_at: datetime
    correlation_id: str
    run_id: str | None = None
    source_id: str | None = None
    pipeline_id: str | None = None
    dataset_id: str | None = None
    line_of_business: str = "motor"
    severity: Severity = Severity.INFO
    status: EventStatus = EventStatus.DETECTED
    metrics: list[DataMetric] = Field(default_factory=list)
    attributes: dict[str, Any] = Field(default_factory=dict)
    message: str


class IncidentTimelineEvent(ContractModel):
    timeline_event_id: str
    incident_id: str
    occurred_at: datetime
    event_type: str
    message: str
    correlation_id: str | None = None


class Incident(ContractModel):
    incident_id: str
    title: str
    status: IncidentStatus = IncidentStatus.OPEN
    severity: Severity = Severity.WARNING
    line_of_business: str = "motor"
    started_at: datetime
    evidence: list[ObservabilityEvent] = Field(default_factory=list)
    timeline: list[IncidentTimelineEvent] = Field(default_factory=list)
    correlated_node_ids: list[str] = Field(default_factory=list)


class AgentFinding(ContractModel):
    finding_id: str
    agent_name: str
    summary: str
    evidence_event_ids: list[UUID] = Field(default_factory=list)
    created_at: datetime


class ConfidenceFactor(ContractModel):
    name: str
    score: float = Field(ge=0, le=1)
    explanation: str


class RCAResult(ContractModel):
    incident_id: str
    suspected_root_cause: str
    confidence_score: float = Field(ge=0, le=1)
    confidence_factors: list[ConfidenceFactor] = Field(default_factory=list)
    evidence_event_ids: list[UUID] = Field(default_factory=list)
    generated_at: datetime


class SLAStatus(ContractModel):
    sla_id: str
    dataset_id: str
    state: HealthState = HealthState.UNKNOWN
    target_freshness_seconds: int = Field(ge=1)
    current_freshness_seconds: float | None = Field(default=None, ge=0)
    observed_at: datetime


class RemediationPlan(ContractModel):
    plan_id: str
    incident_id: str
    recommendation: str
    requires_human_approval: bool = True
    approved: bool | None = None
    mode: str = "simulate"
    created_at: datetime


class VerificationResult(ContractModel):
    plan_id: str
    verified: bool
    verified_at: datetime
    checks: list[str] = Field(default_factory=list)
    message: str = ""


class HealthCheck(ContractModel):
    name: str
    status: HealthState
    details: str = ""


class HealthResponse(ContractModel):
    status: HealthState
    service_name: str
    version: str
    demo_mode: bool
    providers: dict[str, ProviderStatus]
    checks: list[HealthCheck] = Field(default_factory=list)
    correlation_id: str


class APIError(ContractModel):
    code: str
    message: str
    details: Any = None
    correlation_id: str | None = None


# Compatibility names retained while modules migrate to the canonical contracts.
ServiceHealthCheck = HealthCheck
DatasetSignal = DataMetric
IncidentEvidence = ObservabilityEvent
AgentEvidence = AgentFinding
RemediationProposal = RemediationPlan
