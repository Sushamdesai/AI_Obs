from fastapi import APIRouter, HTTPException, Query, Request, status

from backend.app.services.catalog import model_payload
from shared.contracts import AgentFinding, RCAResult

router = APIRouter(prefix="/agents", tags=["agents"])


@router.get("/findings", response_model=list[AgentFinding])
def list_findings(
    request: Request,
    incident_id: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
) -> list[AgentFinding]:
    findings = request.app.state.repository.list("agent_finding", limit=500)
    if incident_id:
        incident = request.app.state.repository.get("incident", incident_id)
        if incident is None:
            raise HTTPException(status_code=404, detail=f"Unknown incident: {incident_id}")
        evidence_ids = {event["event_id"] for event in incident.get("evidence", [])}
        findings = [
            finding
            for finding in findings
            if evidence_ids.intersection(finding.get("evidence_event_ids", []))
        ]
    return [AgentFinding.model_validate(item) for item in findings[:limit]]


@router.post("/findings", response_model=AgentFinding, status_code=status.HTTP_201_CREATED)
def store_finding(finding: AgentFinding, request: Request) -> AgentFinding:
    if request.app.state.repository.get("agent_finding", finding.finding_id) is not None:
        raise HTTPException(status_code=409, detail="Finding ID already exists.")
    for event_id in finding.evidence_event_ids:
        if request.app.state.repository.get("event", str(event_id)) is None:
            raise HTTPException(status_code=404, detail=f"Unknown evidence event: {event_id}")
    payload = model_payload(finding)
    request.app.state.repository.upsert("agent_finding", finding.finding_id, payload)
    return finding


@router.get("/rca/{incident_id}", response_model=RCAResult)
def get_rca(incident_id: str, request: Request) -> RCAResult:
    payload = request.app.state.repository.get("rca_result", incident_id)
    if payload is None:
        raise HTTPException(status_code=404, detail=f"No RCA result found for incident: {incident_id}")
    return RCAResult.model_validate(payload)


@router.put("/rca/{incident_id}", response_model=RCAResult)
def store_rca(incident_id: str, result: RCAResult, request: Request) -> RCAResult:
    if result.incident_id != incident_id:
        raise HTTPException(status_code=422, detail="RCA incident_id must match the URL.")
    if request.app.state.repository.get("incident", incident_id) is None:
        raise HTTPException(status_code=404, detail=f"Unknown incident: {incident_id}")
    incident = request.app.state.repository.get("incident", incident_id)
    incident_event_ids = {event["event_id"] for event in incident.get("evidence", [])}
    if not {str(event_id) for event_id in result.evidence_event_ids}.issubset(incident_event_ids):
        raise HTTPException(status_code=422, detail="RCA evidence must belong to the referenced incident.")
    payload = model_payload(result)
    request.app.state.repository.upsert("rca_result", incident_id, payload)
    return result
