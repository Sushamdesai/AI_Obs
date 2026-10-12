from fastapi import APIRouter, HTTPException, Query, Request, status

from shared.contracts import QualityResult

router = APIRouter(prefix="/quality", tags=["quality"])


@router.get("", response_model=list[QualityResult])
def list_quality_results(
    request: Request,
    dataset_id: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
) -> list[QualityResult]:
    results = request.app.state.repository.list("quality_result", limit=500)
    if dataset_id is not None:
        if request.app.state.repository.get("dataset", dataset_id) is None:
            raise HTTPException(status_code=404, detail=f"Unknown dataset: {dataset_id}")
        results = [item for item in results if item.get("dataset_id") == dataset_id]
    results.sort(key=lambda item: item.get("evaluated_at", ""), reverse=True)
    return [QualityResult.model_validate(item) for item in results[:limit]]


@router.post("", response_model=QualityResult, status_code=status.HTTP_201_CREATED)
def record_quality_result(result: QualityResult, request: Request) -> QualityResult:
    if request.app.state.repository.get("dataset", result.dataset_id) is None:
        raise HTTPException(status_code=404, detail=f"Unknown dataset: {result.dataset_id}")
    payload = result.model_dump(mode="json")
    request.app.state.repository.upsert("quality_result", result.check_id, payload)
    return result
