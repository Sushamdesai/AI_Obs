from fastapi import APIRouter, HTTPException, Request, status

from backend.app.services.catalog import model_payload
from shared.contracts import SLAStatus

router = APIRouter(prefix="/sla", tags=["sla"])


@router.get("", response_model=list[SLAStatus])
def list_sla_statuses(request: Request, dataset_id: str | None = None) -> list[SLAStatus]:
    statuses = request.app.state.repository.list("sla_status", limit=500)
    if dataset_id is not None:
        if request.app.state.repository.get("dataset", dataset_id) is None:
            raise HTTPException(status_code=404, detail=f"Unknown dataset: {dataset_id}")
        statuses = [item for item in statuses if item.get("dataset_id") == dataset_id]
    return [SLAStatus.model_validate(item) for item in statuses]


@router.post("", response_model=SLAStatus, status_code=status.HTTP_201_CREATED)
def store_sla_status(sla: SLAStatus, request: Request) -> SLAStatus:
    if request.app.state.repository.get("dataset", sla.dataset_id) is None:
        raise HTTPException(status_code=404, detail=f"Unknown dataset: {sla.dataset_id}")
    payload = model_payload(sla)
    request.app.state.repository.upsert("sla_status", sla.sla_id, payload)
    return sla


@router.get("/{sla_id}", response_model=SLAStatus)
def get_sla_status(sla_id: str, request: Request) -> SLAStatus:
    payload = request.app.state.repository.get("sla_status", sla_id)
    if payload is None:
        raise HTTPException(status_code=404, detail=f"Unknown SLA: {sla_id}")
    return SLAStatus.model_validate(payload)
