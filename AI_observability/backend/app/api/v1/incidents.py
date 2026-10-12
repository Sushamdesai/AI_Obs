from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query, Request, status

from backend.app.api.v1.schemas import IncidentStatusUpdate
from backend.app.services.catalog import model_payload
from shared.contracts import (
    Incident,
    IncidentStatus,
    IncidentTimelineEvent,
    ObservabilityEvent,
    RCAResult,
)

router = APIRouter(prefix="/incidents", tags=["incidents"])

_ALLOWED_TRANSITIONS = {
    IncidentStatus.OPEN: {IncidentStatus.ACKNOWLEDGED, IncidentStatus.INVESTIGATING, IncidentStatus.RESOLVED},
    IncidentStatus.ACKNOWLEDGED: {IncidentStatus.INVESTIGATING, IncidentStatus.RESOLVED},
    IncidentStatus.INVESTIGATING: {IncidentStatus.ACKNOWLEDGED, IncidentStatus.RESOLVED},
    IncidentStatus.RESOLVED: {IncidentStatus.CLOSED, IncidentStatus.OPEN},
    IncidentStatus.CLOSED: set(),
}


@router.get("", response_model=list[Incident])
def list_incidents(
    request: Request,
    status_filter: IncidentStatus | None = None,
    limit: int = Query(default=100, ge=1, le=500),
) -> list[Incident]:
    records = request.app.state.repository.list("incident", limit=500)
    if status_filter is not None:
        records = [record for record in records if record.get("status") == status_filter.value]
    records.sort(key=lambda record: record.get("started_at", ""), reverse=True)
    return [Incident.model_validate(record) for record in records[:limit]]


@router.post("", response_model=Incident, status_code=status.HTTP_201_CREATED)
def create_incident(incident: Incident, request: Request) -> Incident:
    repository = request.app.state.repository
    existing = repository.get("incident", incident.incident_id)
    if existing is not None:
        raise HTTPException(status_code=409, detail="Incident ID already exists.")
    if any(timeline.incident_id != incident.incident_id for timeline in incident.timeline):
        raise HTTPException(status_code=422, detail="Timeline incident IDs must match the incident.")
    for event in incident.evidence:
        if event.dataset_id and repository.get("dataset", event.dataset_id) is None:
            raise HTTPException(status_code=404, detail=f"Unknown dataset: {event.dataset_id}")
        if event.pipeline_id and repository.get("pipeline", event.pipeline_id) is None:
            raise HTTPException(status_code=404, detail=f"Unknown pipeline: {event.pipeline_id}")
        event_payload = model_payload(event)
        previous_event = repository.get("event", str(event.event_id))
        if previous_event is not None and previous_event != event_payload:
            raise HTTPException(status_code=409, detail=f"Conflicting event ID: {event.event_id}")
        if previous_event is None:
            repository.upsert("event", str(event.event_id), event_payload)
    payload = model_payload(incident)
    repository.upsert("incident", incident.incident_id, payload)
    for timeline in incident.timeline:
        repository.upsert("incident_timeline", timeline.timeline_event_id, model_payload(timeline))
    return incident


@router.get("/{incident_id}", response_model=Incident)
def get_incident(incident_id: str, request: Request) -> Incident:
    payload = request.app.state.repository.get("incident", incident_id)
    if payload is None:
        raise HTTPException(status_code=404, detail=f"Unknown incident: {incident_id}")
    timeline = request.app.state.repository.list("incident_timeline", limit=1000)
    payload["timeline"] = [
        item for item in timeline if item.get("incident_id") == incident_id
    ]
    payload["timeline"].sort(key=lambda item: item.get("occurred_at", ""))
    return Incident.model_validate(payload)


@router.patch("/{incident_id}", response_model=Incident)
def update_incident(
    incident_id: str,
    update: IncidentStatusUpdate,
    request: Request,
) -> Incident:
    next_status = update.status
    repository = request.app.state.repository
    payload = repository.get("incident", incident_id)
    if payload is None:
        raise HTTPException(status_code=404, detail=f"Unknown incident: {incident_id}")
    current_status = IncidentStatus(payload["status"])
    if next_status != current_status and next_status not in _ALLOWED_TRANSITIONS[current_status]:
        raise HTTPException(
            status_code=409,
            detail=f"Invalid incident transition: {current_status.value} -> {next_status.value}.",
        )
    if next_status != current_status:
        payload["status"] = next_status.value
        repository.upsert("incident", incident_id, payload)
        timeline = IncidentTimelineEvent(
            timeline_event_id=f"{incident_id}:status:{uuid4()}",
            incident_id=incident_id,
            occurred_at=datetime.now(UTC),
            event_type=f"status_{next_status.value}",
            message=update.message or f"Incident status changed to {next_status.value}.",
        )
        repository.upsert(
            "incident_timeline", timeline.timeline_event_id, model_payload(timeline)
        )
    return get_incident(incident_id, request)


@router.get("/{incident_id}/events", response_model=list[ObservabilityEvent])
def get_incident_events(incident_id: str, request: Request) -> list[ObservabilityEvent]:
    incident = request.app.state.repository.get("incident", incident_id)
    if incident is None:
        raise HTTPException(status_code=404, detail=f"Unknown incident: {incident_id}")
    return [ObservabilityEvent.model_validate(event) for event in incident.get("evidence", [])]


@router.get("/{incident_id}/rca", response_model=RCAResult)
def get_incident_rca(incident_id: str, request: Request) -> RCAResult:
    payload = request.app.state.repository.get("rca_result", incident_id)
    if payload is None:
        raise HTTPException(status_code=404, detail=f"No RCA result found for incident: {incident_id}")
    return RCAResult.model_validate(payload)
