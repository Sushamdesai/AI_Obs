from __future__ import annotations

import json
from datetime import UTC, datetime
from urllib.error import HTTPError

import pytest

from agents.contracts import AgentRunStatus, AnalysisStatus, InvestigationInput
from agents.gemini import GeminiLLMProvider, GeminiProviderError
from agents.workflow import AgentOrchestrator
from backend.app.providers.fixtures import EVENT_FIXTURES_BY_TYPE, FIXTURE_TIME, MOTOR_LINEAGE
from shared.contracts import (
    DatasetHealth,
    HealthState,
    Incident,
    IncidentStatus,
    PipelineRun,
    SLAStatus,
    SchemaVersion,
)


def make_context(*, verify: bool = False) -> InvestigationInput:
    event = EVENT_FIXTURES_BY_TYPE["quality_failure"]
    incident = Incident(
        incident_id="incident:claims-quality",
        title="Claims quality failure",
        status=IncidentStatus.OPEN,
        severity=event.severity,
        started_at=event.occurred_at,
        evidence=[event],
        correlated_node_ids=["silver.claims"],
    )
    context = InvestigationInput(
        incident=incident,
        events=[event],
        lineage_graph=MOTOR_LINEAGE,
        sla_statuses=[
            SLAStatus(
                sla_id="sla:silver.claims",
                dataset_id="silver.claims",
                state=HealthState.CRITICAL,
                target_freshness_seconds=100,
                current_freshness_seconds=150,
                observed_at=FIXTURE_TIME,
            )
        ],
    )
    if verify:
        context = context.model_copy(
            update={
                "verification_before": DatasetHealth(
                    dataset_id="silver.claims",
                    state=HealthState.DEGRADED,
                    quality_score=0.62,
                    freshness_seconds=150,
                    observed_at=FIXTURE_TIME,
                ),
                "verification_after": DatasetHealth(
                    dataset_id="silver.claims",
                    state=HealthState.HEALTHY,
                    quality_score=0.99,
                    freshness_seconds=50,
                    observed_at=datetime.now(UTC),
                ),
                "verification_pipeline_status": "succeeded",
                "verification_schema_stable": True,
                "verification_volume_ok": True,
                "verification_product_states": {
                    "gold.claims_analytics": "healthy",
                    "gold.customer_360": "healthy",
                },
            }
        )
    return context


def test_deterministic_workflow_is_typed_evidence_grounded_and_logged() -> None:
    records = []
    result = AgentOrchestrator(record_sink=records.append).investigate(make_context())

    assert result.root_cause.status == AnalysisStatus.COMPLETE
    assert result.root_cause.root_node == "silver.claims"
    assert result.root_cause.confidence_score > 0
    assert result.root_cause.rca_result.evidence_event_ids == [
        EVENT_FIXTURES_BY_TYPE["quality_failure"].event_id
    ]
    assert result.lineage_impact.impacted_products == [
        "gold.claims_analytics",
        "gold.customer_360",
        "gold.feature_store",
        "ai.fraud_risk_scoring",
    ]
    assert set(result.insurance_context.affected_domains) == {
        "Claims",
        "Claims Analytics",
        "Customer 360",
        "Fraud/Risk Scoring",
    }
    assert result.sla_assessment.assessments[0].seconds_overdue == 50
    assert result.remediation.plan.requires_human_approval is True
    assert result.remediation.plan.approved is None
    assert result.remediation.execution_performed is False
    assert result.verification is None
    assert len(result.runs) == 7
    assert records == result.runs
    assert result.runs[-1].status == AgentRunStatus.INSUFFICIENT_EVIDENCE
    assert all(run.latency_ms >= 0 and run.started_at <= run.ended_at for run in result.runs)


def test_insufficient_evidence_does_not_invent_a_root_cause() -> None:
    incident = Incident(
        incident_id="incident:empty",
        title="No evidence",
        status=IncidentStatus.OPEN,
        started_at=FIXTURE_TIME,
    )

    result = AgentOrchestrator().investigate(
        InvestigationInput(incident=incident, lineage_graph=MOTOR_LINEAGE)
    )

    assert result.root_cause.status == AnalysisStatus.INSUFFICIENT_EVIDENCE
    assert result.root_cause.root_node is None
    assert result.root_cause.evidence_ids == []
    assert result.root_cause.confidence_score == 0
    assert result.findings == []


def test_rca_uses_schema_and_pipeline_state_and_deterministic_historical_signatures() -> None:
    incident = Incident(
        incident_id="incident:schema",
        title="Schema change",
        status=IncidentStatus.OPEN,
        started_at=FIXTURE_TIME,
    )
    schema_context = InvestigationInput(
        incident=incident,
        lineage_graph=MOTOR_LINEAGE,
        schema_versions=[
            SchemaVersion(
                dataset_id="bronze.claims",
                version="1.0",
                fields={"claim_id": "string", "policy_id": "string"},
                observed_at=FIXTURE_TIME,
            ),
            SchemaVersion(
                dataset_id="bronze.claims",
                version="1.1",
                fields={"claim_id": "string", "policy_id": "integer"},
                observed_at=FIXTURE_TIME.replace(hour=FIXTURE_TIME.hour + 1),
            ),
        ],
    )
    schema_result = AgentOrchestrator().investigate(schema_context)
    assert schema_result.root_cause.root_node == "bronze.claims"
    assert "schema change" in schema_result.root_cause.root_cause_summary.lower()
    assert any(finding.agent_name == "DataAnomalyAgent" for finding in schema_result.findings)

    event = EVENT_FIXTURES_BY_TYPE["pipeline_failure"]
    pipeline_context = InvestigationInput(
        incident=incident.model_copy(
            update={"incident_id": "incident:pipeline", "evidence": [event]}
        ),
        events=[event],
        lineage_graph=MOTOR_LINEAGE,
        pipeline_runs=[
            PipelineRun(
                run_id="policies-ingestion-run-failed",
                pipeline_id="policies-ingestion",
                status="failed",
                started_at=FIXTURE_TIME,
                completed_at=FIXTURE_TIME,
            )
        ],
        historical_signatures={
            "silver.policies": "pipeline_failure|dataset.quality_score,dataset.row_count"
        },
    )
    pipeline_result = AgentOrchestrator().investigate(pipeline_context)
    assert pipeline_result.root_cause.root_node == "silver.policies"
    signature_factor = next(
        factor
        for factor in pipeline_result.root_cause.confidence_factors
        if factor.name == "signature_match"
    )
    assert signature_factor.score == 1


def test_verification_requires_health_quality_freshness_pipeline_schema_volume_and_products() -> None:
    context = make_context(verify=True)
    context = context.model_copy(
        update={
            "sla_statuses": [
                SLAStatus(
                    sla_id="sla:silver.claims",
                    dataset_id="silver.claims",
                    state=HealthState.HEALTHY,
                    target_freshness_seconds=100,
                    current_freshness_seconds=50,
                    observed_at=FIXTURE_TIME,
                )
            ]
        }
    )

    result = AgentOrchestrator().investigate(context)

    assert result.verification is not None
    assert result.verification.verified is True
    assert all(check.endswith(":passed") for check in result.verification.checks)

    failed_context = context.model_copy(update={"verification_schema_stable": False})
    failed = AgentOrchestrator().investigate(failed_context)
    assert failed.verification is not None
    assert failed.verification.verified is False
    assert "schema_stable:failed" in failed.verification.checks


def test_gemini_adapter_sends_allowlisted_evidence_and_parses_success() -> None:
    captured = {}
    response_text = json.dumps(
        {
            "root_cause_summary": "quality_failure affected silver.claims.",
            "explanation": "This wording is grounded in the supplied event type and dataset.",
        }
    )

    def transport(request, timeout):
        captured["request"] = request
        captured["timeout"] = timeout
        return json.dumps(
            {
                "candidates": [
                    {"content": {"parts": [{"text": response_text}]}}
                ]
            }
        ).encode()

    provider = GeminiLLMProvider(
        api_key="test-secret",
        model="gemini-test",
        transport=transport,
    )
    output = provider.generate_finding(
        [
            {
                "task": "Return a structured cause summary.",
                "evidence": [
                    {
                        "event_id": "event-1",
                        "event_type": "quality_failure",
                        "dataset_id": "silver.claims",
                        "message": "Synthetic raw secret should not be sent",
                        "attributes": {"customer_name": "Synthetic raw secret"},
                        "metrics": [{"name": "dataset.quality_score", "value": 0.6}],
                    }
                ],
            }
        ]
    )

    sent_body = captured["request"].data.decode()
    assert json.loads(output) == json.loads(response_text)
    assert "test-secret" not in captured["request"].full_url
    assert captured["request"].get_header("X-goog-api-key") == "test-secret"
    assert "Synthetic raw secret" not in sent_body
    assert "customer_name" not in sent_body
    assert provider.availability == "available"
    assert provider.status.value == "ready"


@pytest.mark.parametrize(
    ("exception", "code"),
    [
        (HTTPError("https://example.invalid", 429, "quota", {}, None), "quota_exceeded"),
        (TimeoutError(), "network_or_timeout"),
    ],
)
def test_gemini_adapter_reports_provider_failures_without_secret_leak(exception, code) -> None:
    def transport(request, timeout):
        raise exception

    provider = GeminiLLMProvider(api_key="do-not-log", transport=transport)
    with pytest.raises(GeminiProviderError) as caught:
        provider.generate_finding([{"event_type": "quality_failure"}])
    assert caught.value.code == code
    assert "do-not-log" not in str(caught.value)
    assert provider.availability == "unavailable"


class FakeGeminiProvider:
    provider_name = "gemini"

    def __init__(self, response: str) -> None:
        self.response = response

    def generate_finding(self, evidence) -> str:
        return self.response


def test_malformed_gemini_response_uses_deterministic_rca_fallback() -> None:
    result = AgentOrchestrator(
        FakeGeminiProvider('{"root_cause_summary": "not complete"}')
    ).investigate(make_context())

    rca_run = next(run for run in result.runs if run.agent_name == "DataRCAAgent")
    assert rca_run.status == AgentRunStatus.FALLBACK
    assert rca_run.provider_used == "deterministic"
    assert rca_run.error == "invalid_structured_response"
    assert "data-quality check" in result.root_cause.root_cause_summary


def test_valid_gemini_narrative_only_augments_evidence_grounded_rca() -> None:
    provider = FakeGeminiProvider(
        json.dumps(
            {
                "root_cause_summary": "quality_failure was observed in silver.claims.",
                "explanation": "The supplied quality_failure signal concerns silver.claims only.",
            }
        )
    )

    result = AgentOrchestrator(provider).investigate(make_context())

    rca_run = next(run for run in result.runs if run.agent_name == "DataRCAAgent")
    assert rca_run.status == AgentRunStatus.SUCCEEDED
    assert rca_run.provider_used == "gemini"
    assert result.root_cause.root_node == "silver.claims"
    assert result.root_cause.rca_result.evidence_event_ids == [
        EVENT_FIXTURES_BY_TYPE["quality_failure"].event_id
    ]
    assert result.root_cause.rca_result.confidence_score == result.root_cause.confidence_score
