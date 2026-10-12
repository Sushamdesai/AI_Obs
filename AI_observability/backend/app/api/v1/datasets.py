from fastapi import APIRouter, HTTPException, Query, Request

from backend.app.api.v1.schemas import DatasetDetail, DatasetPreview
from backend.app.services.explorer import DatasetExplorerService
from shared.contracts import Dataset

router = APIRouter(prefix="/datasets", tags=["datasets"])


def _explorer(request: Request) -> DatasetExplorerService:
    return DatasetExplorerService(
        request.app.state.repository,
        request.app.state.providers["data_platform"],
        request.app.state.lineage_service,
    )


@router.get("", response_model=list[Dataset])
def list_datasets(request: Request) -> list[Dataset]:
    return _explorer(request).list_datasets()


@router.get("/{dataset_id}", response_model=DatasetDetail)
def get_dataset(dataset_id: str, request: Request) -> DatasetDetail:
    try:
        return _explorer(request).get_dataset(dataset_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.get("/{dataset_id}/preview", response_model=DatasetPreview)
def preview_dataset(
    dataset_id: str,
    request: Request,
    limit: int = Query(default=20, ge=1, le=100),
) -> DatasetPreview:
    try:
        return _explorer(request).preview(dataset_id, limit=limit)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
