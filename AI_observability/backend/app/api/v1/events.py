from fastapi import APIRouter, HTTPException, Query, Request, status

from backend.app.services.event_ingestion import EventIngestionService
from shared.contracts import ObservabilityEvent

router = APIRouter(prefix="/events", tags=["events"])


def _service(request: Request) -> EventIngestionService:
    return EventIngestionService(
        request.app.state.repository,
        request.app.state.providers["data_platform"],
        request.app.state.providers["observability"],
    )


@router.get("", response_model=list[ObservabilityEvent])
def list_events(
    request: Request,
    dataset_id: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
) -> list[ObservabilityEvent]:
    events = request.app.state.repository.list("event", limit=1000)
    if dataset_id is not None:
        if request.app.state.repository.get("dataset", dataset_id) is None:
            raise HTTPException(status_code=404, detail=f"Unknown dataset: {dataset_id}")
        events = [event for event in events if event.get("dataset_id") == dataset_id]
    events.sort(key=lambda event: event.get("occurred_at", ""), reverse=True)
    return [ObservabilityEvent.model_validate(event) for event in events[:limit]]


@router.post("", response_model=ObservabilityEvent, status_code=status.HTTP_202_ACCEPTED)
def ingest_event(event: ObservabilityEvent, request: Request) -> ObservabilityEvent:
    try:
        _service(request).ingest([event])
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return event
