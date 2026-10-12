from fastapi import APIRouter, HTTPException, Request

from shared.contracts import DataSource

router = APIRouter(prefix="/sources", tags=["sources"])


@router.get("", response_model=list[DataSource])
def list_sources(request: Request) -> list[DataSource]:
    return [
        DataSource.model_validate(payload)
        for payload in request.app.state.repository.list("source")
    ]


@router.get("/{source_id}", response_model=DataSource)
def get_source(source_id: str, request: Request) -> DataSource:
    payload = request.app.state.repository.get("source", source_id)
    if payload is None:
        raise HTTPException(status_code=404, detail=f"Unknown source: {source_id}")
    return DataSource.model_validate(payload)
