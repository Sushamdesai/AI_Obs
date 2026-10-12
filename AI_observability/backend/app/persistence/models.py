from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import DateTime, JSON, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class PayloadRecord(Base):
    __abstract__ = True

    record_id: Mapped[str] = mapped_column(String(256), primary_key=True)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC)
    )


class SourceRecord(PayloadRecord):
    __tablename__ = "sources"


class DatasetRecord(PayloadRecord):
    __tablename__ = "datasets"


class PipelineRecord(PayloadRecord):
    __tablename__ = "pipelines"


class PipelineRunRecord(PayloadRecord):
    __tablename__ = "pipeline_runs"


class DatasetHealthRecord(PayloadRecord):
    __tablename__ = "dataset_health"


class DataMetricRecord(PayloadRecord):
    __tablename__ = "data_metrics"


class QualityResultRecord(PayloadRecord):
    __tablename__ = "quality_results"


class SchemaVersionRecord(PayloadRecord):
    __tablename__ = "schema_versions"


class LineageNodeRecord(PayloadRecord):
    __tablename__ = "lineage_nodes"


class LineageEdgeRecord(PayloadRecord):
    __tablename__ = "lineage_edges"


class EventRecord(PayloadRecord):
    __tablename__ = "observability_events"


class IncidentRecord(PayloadRecord):
    __tablename__ = "incidents"


class IncidentTimelineRecord(PayloadRecord):
    __tablename__ = "incident_timeline"


class AgentFindingRecord(PayloadRecord):
    __tablename__ = "agent_findings"


class RCAResultRecord(PayloadRecord):
    __tablename__ = "rca_results"


class SLATrackingRecord(PayloadRecord):
    __tablename__ = "sla_statuses"


class RemediationPlanRecord(PayloadRecord):
    __tablename__ = "remediation_plans"


class VerificationResultRecord(PayloadRecord):
    __tablename__ = "verification_results"


RECORD_MODELS = {
    "source": SourceRecord,
    "dataset": DatasetRecord,
    "pipeline": PipelineRecord,
    "pipeline_run": PipelineRunRecord,
    "dataset_health": DatasetHealthRecord,
    "data_metric": DataMetricRecord,
    "quality_result": QualityResultRecord,
    "schema_version": SchemaVersionRecord,
    "lineage_node": LineageNodeRecord,
    "lineage_edge": LineageEdgeRecord,
    "event": EventRecord,
    "incident": IncidentRecord,
    "incident_timeline": IncidentTimelineRecord,
    "agent_finding": AgentFindingRecord,
    "rca_result": RCAResultRecord,
    "sla_status": SLATrackingRecord,
    "remediation_plan": RemediationPlanRecord,
    "verification_result": VerificationResultRecord,
}
