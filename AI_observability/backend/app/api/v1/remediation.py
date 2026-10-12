from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query, Request, status

from backend.app.api.v1.schemas import ApprovalUpdate
from backend.app.services.catalog import model_payload
from shared.contracts import (
    IncidentTimelineEvent,
    RemediationPlan,
    VerificationResult,
)

router = APIRouter(prefix="/remediation", tags=["remediation"])


@router.get("", response_model=list[RemediationPlan])
def list_remediation_plans(
    request: Request,
    incident_id: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
) -> list[RemediationPlan]:
    plans = request.app.state.repository.list("remediation_plan", limit=500)
    if incident_id:
        plans = [plan for plan in plans if plan.get("incident_id") == incident_id]
    return [RemediationPlan.model_validate(plan) for plan in plans[:limit]]


@router.post("", response_model=RemediationPlan, status_code=status.HTTP_201_CREATED)
def create_remediation_plan(plan: RemediationPlan, request: Request) -> RemediationPlan:
    repository = request.app.state.repository
    if repository.get("remediation_plan", plan.plan_id) is not None:
        raise HTTPException(status_code=409, detail="Remediation plan ID already exists.")
    if repository.get("incident", plan.incident_id) is None:
        raise HTTPException(status_code=404, detail=f"Unknown incident: {plan.incident_id}")
    if plan.approved is True:
        raise HTTPException(status_code=422, detail="A remediation plan must be approved in a separate action.")
    plan.requires_human_approval = True
    plan.approved = None
    payload = model_payload(plan)
    repository.upsert("remediation_plan", plan.plan_id, payload)
    return plan


@router.get("/{plan_id}", response_model=RemediationPlan)
def get_remediation_plan(plan_id: str, request: Request) -> RemediationPlan:
    payload = request.app.state.repository.get("remediation_plan", plan_id)
    if payload is None:
        raise HTTPException(status_code=404, detail=f"Unknown remediation plan: {plan_id}")
    return RemediationPlan.model_validate(payload)


@router.patch("/{plan_id}/approval", response_model=RemediationPlan)
def update_plan_approval(plan_id: str, update: ApprovalUpdate, request: Request) -> RemediationPlan:
    repository = request.app.state.repository
    payload = repository.get("remediation_plan", plan_id)
    if payload is None:
        raise HTTPException(status_code=404, detail=f"Unknown remediation plan: {plan_id}")
    payload["approved"] = update.approved
    repository.upsert("remediation_plan", plan_id, payload)
    incident_id = payload["incident_id"]
    timeline = IncidentTimelineEvent(
        timeline_event_id=f"{incident_id}:remediation:{uuid4()}",
        incident_id=incident_id,
        occurred_at=datetime.now(UTC),
        event_type="remediation_approved" if update.approved else "remediation_rejected",
        message=f"Remediation plan {plan_id} {'approved' if update.approved else 'rejected'} by an operator.",
    )
    repository.upsert("incident_timeline", timeline.timeline_event_id, model_payload(timeline))
    return RemediationPlan.model_validate(payload)


@router.post("/{plan_id}/verification", response_model=VerificationResult, status_code=status.HTTP_201_CREATED)
def store_verification(plan_id: str, result: VerificationResult, request: Request) -> VerificationResult:
    repository = request.app.state.repository
    plan = repository.get("remediation_plan", plan_id)
    if plan is None:
        raise HTTPException(status_code=404, detail=f"Unknown remediation plan: {plan_id}")
    if plan["approved"] is not True:
        raise HTTPException(status_code=409, detail="Remediation must be approved before verification is recorded.")
    if result.plan_id != plan_id:
        raise HTTPException(status_code=422, detail="Verification plan_id must match the URL.")
    payload = model_payload(result)
    repository.upsert("verification_result", f"{plan_id}:{result.verified_at}", payload)
    return result


@router.get("/{plan_id}/verification", response_model=list[VerificationResult])
def list_verifications(plan_id: str, request: Request) -> list[VerificationResult]:
    if request.app.state.repository.get("remediation_plan", plan_id) is None:
        raise HTTPException(status_code=404, detail=f"Unknown remediation plan: {plan_id}")
    results = [
        item
        for item in request.app.state.repository.list("verification_result", limit=500)
        if item.get("plan_id") == plan_id
    ]
    results.sort(key=lambda item: item.get("verified_at", ""), reverse=True)
    return [VerificationResult.model_validate(item) for item in results]
