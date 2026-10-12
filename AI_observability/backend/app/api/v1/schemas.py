from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from shared.contracts import (
    Dataset,
    DatasetHealth,
    IncidentStatus,
    LineageNode,
    PipelineRun,
    QualityResult,
    SchemaVersion,
)


class DatasetDetail(BaseModel):
    dataset: Dataset
    platform: str
    health: DatasetHealth | None = None
    quality: QualityResult | None = None
    schema_versions: list[SchemaVersion] = Field(default_factory=list)
    last_run: PipelineRun | None = None
    upstream: list[LineageNode] = Field(default_factory=list)
    downstream: list[LineageNode] = Field(default_factory=list)
    consumers: list[LineageNode] = Field(default_factory=list)
    row_count: int = Field(ge=0)


class DatasetPreview(BaseModel):
    dataset_id: str
    row_count: int = Field(ge=0)
    returned_count: int = Field(ge=0)
    records: list[dict[str, Any]]
    truncated: bool


class IncidentStatusUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: IncidentStatus
    message: str = Field(default="", max_length=500)


class SimulatorCycleRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    cycles: int = Field(default=1, ge=1, le=5)
    batch_size: int | None = Field(default=None, ge=1, le=500)
    seed: int = Field(default=17, ge=0, le=2_147_483_647)
    failure_scenarios: list[str] = Field(default_factory=list, max_length=6)


class SimulatorCycleResponse(BaseModel):
    cycles: list[dict[str, Any]]
    event_count: int = Field(ge=0)


class ApprovalUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    approved: bool

