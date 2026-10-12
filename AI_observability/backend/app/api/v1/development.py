from fastapi import APIRouter, HTTPException

from backend.app.providers.fixtures import (
    DATASET_HEALTH,
    DATASETS,
    EVENT_FIXTURES,
    EVENT_FIXTURES_BY_TYPE,
    MOTOR_LINEAGE,
    PIPELINE_RUNS,
    PIPELINES,
    QUALITY_RESULTS,
    SCHEMA_VERSIONS,
    SOURCES,
)
from shared.contracts import (
    DataSource,
    Dataset,
    DatasetHealth,
    LineageGraph,
    ObservabilityEvent,
    Pipeline,
    PipelineRun,
    QualityResult,
    SchemaVersion,
)

router = APIRouter(prefix="/dev", tags=["development fixtures"])


@router.get("/sources", response_model=list[DataSource])
def get_fixture_sources() -> list[DataSource]:
    return [source.model_copy(deep=True) for source in SOURCES]


@router.get("/pipelines", response_model=list[Pipeline])
def get_fixture_pipelines() -> list[Pipeline]:
    return [pipeline.model_copy(deep=True) for pipeline in PIPELINES]


@router.get("/pipeline-runs", response_model=list[PipelineRun])
def get_fixture_pipeline_runs() -> list[PipelineRun]:
    return [run.model_copy(deep=True) for run in PIPELINE_RUNS]


@router.get("/datasets", response_model=list[Dataset])
def get_fixture_datasets() -> list[Dataset]:
    return [dataset.model_copy(deep=True) for dataset in DATASETS]


@router.get("/dataset-health", response_model=list[DatasetHealth])
def get_fixture_dataset_health() -> list[DatasetHealth]:
    return [health.model_copy(deep=True) for health in DATASET_HEALTH]


@router.get("/quality-results", response_model=list[QualityResult])
def get_fixture_quality_results() -> list[QualityResult]:
    return [result.model_copy(deep=True) for result in QUALITY_RESULTS]


@router.get("/schema-versions", response_model=list[SchemaVersion])
def get_fixture_schema_versions() -> list[SchemaVersion]:
    return [version.model_copy(deep=True) for version in SCHEMA_VERSIONS]


@router.get("/lineage", response_model=LineageGraph)
def get_fixture_lineage() -> LineageGraph:
    return MOTOR_LINEAGE.model_copy(deep=True)


@router.get("/events", response_model=list[ObservabilityEvent])
def get_fixture_events() -> list[ObservabilityEvent]:
    return [event.model_copy(deep=True) for event in EVENT_FIXTURES]


@router.get("/events/{event_type}", response_model=ObservabilityEvent)
def get_fixture_event(event_type: str) -> ObservabilityEvent:
    event = EVENT_FIXTURES_BY_TYPE.get(event_type)
    if event is None:
        raise HTTPException(status_code=404, detail=f"Unknown fixture event type: {event_type}")
    return event.model_copy(deep=True)
