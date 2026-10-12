from fastapi import APIRouter, HTTPException, Query, Request

from shared.contracts import Pipeline, PipelineRun

router = APIRouter(prefix="/pipelines", tags=["pipelines"])


@router.get("", response_model=list[Pipeline])
def list_pipelines(request: Request) -> list[Pipeline]:
    return [Pipeline.model_validate(item) for item in request.app.state.repository.list("pipeline")]


@router.get("/runs", response_model=list[PipelineRun])
def list_pipeline_runs(
    request: Request,
    pipeline_id: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
) -> list[PipelineRun]:
    runs = request.app.state.repository.list("pipeline_run", limit=500)
    if pipeline_id is not None:
        if request.app.state.repository.get("pipeline", pipeline_id) is None:
            raise HTTPException(status_code=404, detail=f"Unknown pipeline: {pipeline_id}")
        runs = [run for run in runs if run.get("pipeline_id") == pipeline_id]
    runs.sort(key=lambda run: run.get("started_at", ""), reverse=True)
    return [PipelineRun.model_validate(run) for run in runs[:limit]]


@router.get("/{pipeline_id}", response_model=Pipeline)
def get_pipeline(pipeline_id: str, request: Request) -> Pipeline:
    payload = request.app.state.repository.get("pipeline", pipeline_id)
    if payload is None:
        raise HTTPException(status_code=404, detail=f"Unknown pipeline: {pipeline_id}")
    return Pipeline.model_validate(payload)
