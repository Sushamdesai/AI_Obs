from __future__ import annotations

import json
import time
from datetime import UTC, datetime, timedelta
from typing import Callable, TypeVar
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from agents.contracts import (
    AgentExecutionRecord,
    AgentRunStatus,
    AnalysisStatus,
    InsuranceContextReport,
    InvestigationInput,
    InvestigationResult,
    LineageImpactReport,
    RemediationProposal,
    RootCauseReport,
    SLAAssessment,
    SLADatasetAssessment,
    SafeRemediationAction,
)
from agents.gemini import GeminiLLMProvider, GeminiProviderError
from backend.app.providers.base import LLMProvider
from backend.app.providers.llm import DeterministicLLMProvider
from backend.app.services.lineage import LineageService
from observability.engines import (
    ConfidenceEngine,
    SchemaDriftDetector,
    VerificationEngine,
)
from shared.contracts import (
    AgentFinding,
    DatasetHealth,
    HealthState,
    Incident,
    IncidentStatus,
    ObservabilityEvent,
    RCAResult,
    RemediationPlan,
    SchemaVersion,
    VerificationResult,
)

T = TypeVar("T")


class NarrativeAugmentation(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    root_cause_summary: str = Field(min_length=10, max_length=500)
    explanation: str = Field(min_length=10, max_length=1000)


class DataAnomalyAgent:
    name = "DataAnomalyAgent"
    responsibility = "Summarize deterministic anomaly evidence without inferring unsupported causes."
    allowed_tools = ("canonical event contracts", "quality and dataset-health findings")
    failure_behavior = "Record a failed execution and let the orchestrator surface the error."

    def run(self, context: InvestigationInput) -> list[AgentFinding]:
        events = _events(context)
        findings: list[AgentFinding] = []
        for event in events:
            if event.status == "resolved" or (event.severity == "info" and event.event_type == "healthy_dataset"):
                continue
            findings.append(
                AgentFinding(
                    finding_id=f"{context.incident.incident_id}:anomaly:{event.event_id}",
                    agent_name=self.name,
                    summary=(
                        f"Observed {event.event_type} for {event.dataset_id or event.pipeline_id or 'an unscoped asset'} "
                        f"with {event.severity} severity."
                    ),
                    evidence_event_ids=[event.event_id],
                    created_at=datetime.now(UTC),
                )
            )
        for quality in context.quality_results:
            if not quality.passed:
                related_events = [event for event in events if event.dataset_id == quality.dataset_id]
                findings.append(
                    AgentFinding(
                        finding_id=f"{context.incident.incident_id}:quality:{quality.check_id}",
                        agent_name=self.name,
                        summary=(
                            f"Quality check {quality.check_id} failed for {quality.dataset_id} "
                            f"with score {quality.score:.3f}."
                        ),
                        evidence_event_ids=[event.event_id for event in related_events],
                        created_at=datetime.now(UTC),
                    )
                )
        for health in context.dataset_health:
            if health.state in {HealthState.DEGRADED, HealthState.CRITICAL}:
                findings.append(
                    AgentFinding(
                        finding_id=f"{context.incident.incident_id}:health:{health.dataset_id}",
                        agent_name=self.name,
                        summary=f"Dataset {health.dataset_id} is {health.state.value}.",
                        evidence_event_ids=[
                            event.event_id for event in events if event.dataset_id == health.dataset_id
                        ],
                        created_at=datetime.now(UTC),
                    )
                )
        for sla in context.sla_statuses:
            if (
                sla.current_freshness_seconds is not None
                and sla.current_freshness_seconds > sla.target_freshness_seconds
            ):
                findings.append(
                    AgentFinding(
                        finding_id=f"{context.incident.incident_id}:sla:{sla.sla_id}",
                        agent_name=self.name,
                        summary=(
                            f"Dataset {sla.dataset_id} freshness is {sla.current_freshness_seconds:g}s, "
                            f"above its {sla.target_freshness_seconds}s target."
                        ),
                        evidence_event_ids=[
                            event.event_id for event in events if event.dataset_id == sla.dataset_id
                        ],
                        created_at=datetime.now(UTC),
                    )
                )
        for run in context.pipeline_runs:
            if run.status == "failed":
                findings.append(
                    AgentFinding(
                        finding_id=f"{context.incident.incident_id}:pipeline:{run.run_id}",
                        agent_name=self.name,
                        summary=f"Pipeline run {run.run_id} failed for {run.pipeline_id}.",
                        evidence_event_ids=[
                            event.event_id for event in events if event.pipeline_id == run.pipeline_id
                        ],
                        created_at=datetime.now(UTC),
                    )
                )
        for dataset_id, change in _schema_changes(context):
            findings.append(
                AgentFinding(
                    finding_id=f"{context.incident.incident_id}:schema:{dataset_id}:{change}",
                    agent_name=self.name,
                    summary=f"Schema change {change} was detected for {dataset_id}.",
                    evidence_event_ids=[
                        event.event_id for event in events if event.dataset_id == dataset_id
                    ],
                    created_at=datetime.now(UTC),
                )
            )
        return findings


class DataRCAAgent:
    name = "DataRCAAgent"
    responsibility = "Rank evidence-backed root-cause hypotheses and calculate confidence deterministically."
    allowed_tools = ("ConfidenceEngine", "structured Gemini narrative adapter")
    failure_behavior = "Return INSUFFICIENT_EVIDENCE when signals are absent; Gemini errors use deterministic RCA."

    _CAUSES = {
        "quality_failure": "A deterministic data-quality check reported invalid or missing values.",
        "schema_drift": "The observed schema differs from its recorded baseline.",
        "volume_anomaly": "Observed record volume deviates from the monitored baseline.",
        "freshness_violation": "The dataset exceeded its configured freshness threshold.",
        "pipeline_failure": "The source pipeline emitted a failure signal.",
    }

    def __init__(self, confidence_engine: ConfidenceEngine | None = None) -> None:
        self.confidence_engine = confidence_engine or ConfidenceEngine()

    def run(
        self, context: InvestigationInput, provider: LLMProvider
    ) -> tuple[RootCauseReport, str, str | None]:
        events = _events(context)
        failed_quality = [result for result in context.quality_results if not result.passed]
        failed_health = [
            item for item in context.dataset_health
            if item.state in {HealthState.DEGRADED, HealthState.CRITICAL}
        ]
        late_slas = [
            item for item in context.sla_statuses
            if item.current_freshness_seconds is not None
            and item.current_freshness_seconds > item.target_freshness_seconds
        ]
        failed_runs = [run for run in context.pipeline_runs if run.status == "failed"]
        schema_changes = _schema_changes(context)
        evidence_events = [
            event
            for event in events
            if event.status != "resolved"
            and (event.event_type in self._CAUSES or event.severity in {"warning", "error", "critical"})
        ]
        now = datetime.now(UTC)

        if not (
            evidence_events
            or failed_quality
            or failed_health
            or late_slas
            or failed_runs
            or schema_changes
        ):
            empty_rca = RCAResult(
                incident_id=context.incident.incident_id,
                suspected_root_cause="Insufficient evidence to identify a root cause.",
                confidence_score=0,
                evidence_event_ids=[],
                generated_at=now,
            )
            return (
                RootCauseReport(
                    incident_id=context.incident.incident_id,
                    status=AnalysisStatus.INSUFFICIENT_EVIDENCE,
                    root_cause_summary="Insufficient evidence to identify a root cause.",
                    evidence_ids=[],
                    confidence_score=0,
                    explanation="No event or failed quality result was supplied to support an RCA.",
                    rca_result=empty_rca,
                ),
                "deterministic",
                None,
            )

        cause_events = sorted(
            evidence_events,
            key=lambda event: (
                event.event_type not in self._CAUSES,
                -_severity_rank(event),
                event.occurred_at,
                str(event.event_id),
            ),
        )
        primary = cause_events[0] if cause_events else None
        root_dataset = (
            primary.dataset_id
            if primary is not None
            else failed_quality[0].dataset_id if failed_quality
            else schema_changes[0][0] if schema_changes
            else failed_health[0].dataset_id if failed_health
            else late_slas[0].dataset_id if late_slas
            else None
        )
        root_node = _root_node(primary, context) or _dataset_root_node(root_dataset, context)
        if primary is None and failed_runs:
            root_node = _pipeline_root_node(failed_runs[0].pipeline_id, context) or root_node
        hypotheses = list(
            dict.fromkeys(
                self._CAUSES.get(event.event_type, f"Investigate the observed {event.event_type} signal.")
                for event in cause_events
            )
        )
        if failed_quality:
            hypotheses.extend(
                f"Quality check failure for {result.dataset_id} ({result.check_id})."
                for result in failed_quality
            )
        hypotheses.extend(
            f"Schema for {dataset_id} changed: {change}."
            for dataset_id, change in schema_changes
        )
        hypotheses.extend(
            f"Pipeline run {run.run_id} failed for {run.pipeline_id}."
            for run in failed_runs
        )
        hypotheses.extend(
            f"Dataset {health.dataset_id} has {health.state.value} health."
            for health in failed_health
        )
        hypotheses.extend(
            f"Dataset {sla.dataset_id} freshness exceeded its {sla.target_freshness_seconds}s target."
            for sla in late_slas
        )
        hypotheses = list(dict.fromkeys(hypotheses))
        if primary is not None:
            summary = (
                f"{self._CAUSES.get(primary.event_type, 'An observability signal was detected')} "
                f"Evidence points to {primary.dataset_id or primary.pipeline_id or 'an unscoped asset'}."
            )
            explanation = "This hypothesis is supported only by the supplied event and quality evidence."
        elif failed_quality:
            summary = f"A deterministic quality check failed for {failed_quality[0].dataset_id}."
            explanation = "No related observability event was supplied; causal scope remains limited."
        elif schema_changes:
            summary = f"A schema change was detected for {schema_changes[0][0]}."
            explanation = "The comparison is limited to supplied schema versions."
        elif failed_runs:
            summary = f"Pipeline run {failed_runs[0].run_id} failed for {failed_runs[0].pipeline_id}."
            explanation = "The failed pipeline run is the only supplied root-cause signal."
        elif late_slas:
            summary = f"Dataset {late_slas[0].dataset_id} exceeded its supplied freshness target."
            explanation = "The age and target are supplied SLA measurements."
        else:
            summary = f"Dataset {failed_health[0].dataset_id} has degraded or critical health."
            explanation = "The dataset health state is the only supplied root-cause signal."

        confidence_score = 0.0
        confidence_factors = []
        if evidence_events:
            confidence_score, confidence_factors = self.confidence_engine.assess(
                evidence_events,
                lineage_graph=context.lineage_graph,
                signature_match=_signature_match(evidence_events, context),
            )

        provider_used = "deterministic"
        provider_error: str | None = None
        if isinstance(provider, GeminiLLMProvider) or getattr(provider, "provider_name", None) == "gemini":
            prepared = [
                {
                    "task": "Return an evidence-grounded RCA summary and explanation as JSON.",
                    "evidence": [
                        {
                            "event_id": str(event.event_id),
                            "event_type": event.event_type,
                            "dataset_id": event.dataset_id,
                            "pipeline_id": event.pipeline_id,
                            "severity": str(event.severity),
                            "status": str(event.status),
                            "occurred_at": event.occurred_at.isoformat(),
                            "metrics": [
                                {"name": metric.name, "value": metric.value}
                                for metric in event.metrics
                                if metric.name.startswith(("dataset.", "pipeline."))
                            ],
                        }
                        for event in evidence_events[:20]
                    ],
                }
            ]
            try:
                narrative = NarrativeAugmentation.model_validate_json(
                    provider.generate_finding(prepared)
                )
                if not _narrative_is_grounded(narrative, evidence_events, hypotheses):
                    raise ValueError("model narrative did not match supplied evidence")
                summary = narrative.root_cause_summary
                explanation = narrative.explanation
                provider_used = "gemini"
            except (GeminiProviderError, ValidationError, ValueError, TimeoutError, OSError) as error:
                provider_error = _safe_provider_error(error)
                provider_used = "deterministic"

        event_ids = [event.event_id for event in evidence_events]
        evidence_ids = [str(event_id) for event_id in event_ids]
        evidence_ids.extend(result.check_id for result in failed_quality)
        evidence_ids.extend(f"schema:{dataset_id}:{change}" for dataset_id, change in schema_changes)
        evidence_ids.extend(run.run_id for run in failed_runs)
        evidence_ids.extend(item.dataset_id for item in failed_health)
        evidence_ids.extend(item.sla_id for item in late_slas)
        rca = RCAResult(
            incident_id=context.incident.incident_id,
            suspected_root_cause=summary,
            confidence_score=confidence_score,
            confidence_factors=confidence_factors,
            evidence_event_ids=event_ids,
            generated_at=now,
        )
        return (
            RootCauseReport(
                incident_id=context.incident.incident_id,
                status=AnalysisStatus.COMPLETE,
                root_cause_summary=summary,
                root_node=root_node,
                evidence_ids=list(dict.fromkeys(evidence_ids)),
                considered_hypotheses=hypotheses,
                confidence_score=confidence_score,
                confidence_factors=confidence_factors,
                explanation=explanation,
                rca_result=rca,
            ),
            provider_used,
            provider_error,
        )


class LineageImpactAgent:
    name = "LineageImpactAgent"
    responsibility = "Calculate downstream impact from the canonical lineage graph."
    allowed_tools = ("LineageService.get_downstream", "LineageService.get_upstream")
    failure_behavior = "Return unknown impact if graph or verified root node is unavailable."

    def run(self, context: InvestigationInput, root_node: str | None) -> LineageImpactReport:
        graph = context.lineage_graph
        impacted_ids: list[str] = []
        evidence_ids = [str(event.event_id) for event in _events(context)]
        if graph is not None and root_node is not None:
            service = LineageService(graph)
            impacted_ids = [node.node_id for node in service.calculate_blast_radius(root_node)]
        product_types = {"data_product", "ai_product", "report"}
        product_nodes = [
            node.node_id for node in graph.nodes if str(node.node_type) in product_types
        ] if graph else []
        impacted_products = [node_id for node_id in product_nodes if node_id in impacted_ids]
        unaffected = [node_id for node_id in product_nodes if node_id not in impacted_ids]
        return LineageImpactReport(
            incident_id=context.incident.incident_id,
            root_node=root_node,
            impacted_node_ids=impacted_ids,
            impacted_products=impacted_products,
            unaffected_products=unaffected,
            evidence_ids=evidence_ids,
            explanation=(
                "Impact was traversed from the evidence-selected root using the supplied lineage graph."
                if graph is not None and root_node is not None
                else "No verified lineage path was available; downstream impact is unknown."
            ),
        )


class InsuranceContextAgent:
    name = "InsuranceContextAgent"
    responsibility = "Translate established technical impact into cautious synthetic motor-domain context."
    allowed_tools = ("lineage impact report", "source and product name mapping")
    failure_behavior = "Use cautious generic wording and state synthetic-POC limitations."

    _DOMAINS = {
        "claims": "Claims",
        "policies": "Policies",
        "customers": "Customers/CRM",
        "payments": "Payments",
        "bureau": "Bureau/Risk Features",
        "telematics": "Telematics/Driving Features",
        "customer_360": "Customer 360",
        "claims_analytics": "Claims Analytics",
        "fraud": "Fraud/Risk Scoring",
        "risk": "Fraud/Risk Scoring",
    }

    def run(
        self, context: InvestigationInput, impact: LineageImpactReport
    ) -> InsuranceContextReport:
        names: list[str] = []
        candidates = [
            *(event.dataset_id or "" for event in _events(context)),
            *(impact.impacted_node_ids),
        ]
        for candidate in candidates:
            for token, label in self._DOMAINS.items():
                if token in candidate.lower() and label not in names:
                    names.append(label)
        domains = names or ["Motor insurance data operations"]
        products = ", ".join(impact.impacted_products) or "no downstream product has been established"
        return InsuranceContextReport(
            incident_id=context.incident.incident_id,
            affected_domains=domains,
            operational_context=(
                f"The synthetic evidence indicates a data-observability issue in {', '.join(domains)}. "
                f"Lineage lists {products} as downstream products."
            ),
            limitations=(
                "This is a synthetic POC interpretation, not evidence of real customer impact, "
                "an underwriting decision, or a legal conclusion."
            ),
            evidence_ids=impact.evidence_ids,
        )


class SLAAgent:
    name = "SLAAgent"
    responsibility = "Calculate freshness target overrun and deadlines from supplied SLA measurements."
    allowed_tools = ("SLAStatus contract",)
    failure_behavior = "Report no assessments when no SLA measurements are supplied; infer no targets."

    def run(self, context: InvestigationInput) -> SLAAssessment:
        assessments: list[SLADatasetAssessment] = []
        for sla in context.sla_statuses:
            current = sla.current_freshness_seconds
            overdue = max(0.0, current - sla.target_freshness_seconds) if current is not None else None
            remaining = sla.target_freshness_seconds - current if current is not None else None
            deadline = sla.observed_at + timedelta(seconds=remaining) if remaining is not None else None
            assessments.append(
                SLADatasetAssessment(
                    sla_id=sla.sla_id,
                    dataset_id=sla.dataset_id,
                    state=str(sla.state),
                    target_freshness_seconds=sla.target_freshness_seconds,
                    current_freshness_seconds=current,
                    seconds_overdue=overdue,
                    deadline_at=deadline,
                )
            )
        return SLAAssessment(
            incident_id=context.incident.incident_id,
            assessments=assessments,
            explanation=(
                "Overrun and remaining time are arithmetic comparisons with each supplied freshness target; "
                "no probability or unconfigured SLA target was inferred."
            ),
            evidence_ids=[sla.sla_id for sla in context.sla_statuses],
        )


class RemediationAgent:
    name = "RemediationAgent"
    responsibility = "Propose reversible synthetic-demo actions that require explicit human approval."
    allowed_tools = ("synthetic source behavior controls", "bounded reprocessing and validation")
    failure_behavior = "Return a proposal only; never invoke an action or bypass human approval."

    def run(self, context: InvestigationInput, root_cause: RootCauseReport) -> RemediationProposal:
        event_types = {event.event_type for event in _events(context)}
        actions = {SafeRemediationAction.RERUN_VALIDATION}
        if event_types.intersection({"quality_failure", "schema_drift", "pipeline_failure"}):
            actions.add(SafeRemediationAction.REPROCESS_CONTROLLED_BATCH)
        if event_types.intersection({"freshness_violation", "volume_anomaly", "schema_drift"}):
            actions.add(SafeRemediationAction.REFRESH_AFFECTED_DATASETS)
        if event_types.intersection({"pipeline_failure", "quality_failure"}):
            actions.add(SafeRemediationAction.RESTORE_SOURCE_BEHAVIOR)
        plan = RemediationPlan(
            plan_id=f"agent-plan:{context.incident.incident_id}:{uuid4()}",
            incident_id=context.incident.incident_id,
            recommendation=(
                "After operator review, use the listed synthetic-demo action(s), rerun deterministic "
                "validation, and verify affected outputs."
            ),
            requires_human_approval=True,
            approved=None,
            mode="simulate",
            created_at=datetime.now(UTC),
        )
        return RemediationProposal(
            plan=plan,
            safe_actions=sorted(actions, key=lambda action: action.value),
            execution_performed=False,
            explanation=(
                "This is a proposal only. No source, provider, dataset, or external system was changed."
            ),
        )


class VerificationAgent:
    name = "VerificationAgent"
    responsibility = "Evaluate post-remediation health against deterministic checks and explicit criteria."
    allowed_tools = ("VerificationEngine", "pipeline, schema, volume and affected-product evidence")
    failure_behavior = "Return no verification result until before/after dataset health is supplied."

    def __init__(self, engine: VerificationEngine | None = None) -> None:
        self.engine = engine or VerificationEngine()

    def run(
        self, context: InvestigationInput, plan_id: str
    ) -> VerificationResult | None:
        before = context.verification_before
        after = context.verification_after
        if before is None or after is None:
            return None
        base = self.engine.verify(
            plan_id,
            before,
            after,
            required_state=HealthState.HEALTHY,
            required_quality_score=context.verification_required_quality_score,
            required_max_freshness_seconds=next(
            (
                sla.target_freshness_seconds
                for sla in context.sla_statuses
                if sla.dataset_id == after.dataset_id
            ),
            None,
            ),
        )
        checks = list(base.checks)
        freshness_target_available = any(
            sla.dataset_id == after.dataset_id for sla in context.sla_statuses
        )
        extras = {
            "freshness_target_available": freshness_target_available,
            "pipeline_succeeded": context.verification_pipeline_status
            in {"succeeded", "success", "completed"},
            "schema_stable": context.verification_schema_stable is True,
            "volume_within_bounds": context.verification_volume_ok is True,
            "affected_products_healthy": bool(context.verification_product_states)
            and all(state == HealthState.HEALTHY.value for state in context.verification_product_states.values()),
        }
        checks.extend(
            f"{name}:{'passed' if passed else 'failed'}"
            for name, passed in extras.items()
        )
        verified = base.verified and all(extras.values())
        return VerificationResult(
            plan_id=plan_id,
            verified=verified,
            verified_at=datetime.now(UTC),
            checks=checks,
            message=(
                "All configured post-remediation verification checks passed."
                if verified
                else "One or more post-remediation health, pipeline, schema, volume, or product checks did not pass."
            ),
        )


class AgentOrchestrator:
    """Runs the explicit evidence-first workflow and records one audit row per agent."""

    def __init__(
        self,
        llm_provider: LLMProvider | None = None,
        *,
        confidence_engine: ConfidenceEngine | None = None,
        verification_engine: VerificationEngine | None = None,
        record_sink: Callable[[AgentExecutionRecord], None] | None = None,
    ) -> None:
        self.llm_provider = llm_provider or DeterministicLLMProvider()
        self.confidence_engine = confidence_engine or ConfidenceEngine()
        self.verification_engine = verification_engine or VerificationEngine()
        self.record_sink = record_sink
        self.runs: list[AgentExecutionRecord] = []
        self.data_anomaly_agent = DataAnomalyAgent()
        self.data_rca_agent = DataRCAAgent(self.confidence_engine)
        self.lineage_impact_agent = LineageImpactAgent()
        self.insurance_context_agent = InsuranceContextAgent()
        self.sla_agent = SLAAgent()
        self.remediation_agent = RemediationAgent()
        self.verification_agent = VerificationAgent(self.verification_engine)

    def investigate(self, context: InvestigationInput) -> InvestigationResult:
        self.runs = []
        evidence_ids = _evidence_ids(context)
        findings = self._execute(
            self.data_anomaly_agent.name,
            evidence_ids,
            lambda: self.data_anomaly_agent.run(context),
            provider_used="deterministic",
            finding_id=f"{context.incident.incident_id}:anomaly",
        )
        if findings is None:
            raise RuntimeError("Data anomaly agent failed; see its execution record.")
        root_result = self._execute(
            self.data_rca_agent.name,
            evidence_ids,
            lambda: self.data_rca_agent.run(context, self.llm_provider),
            provider_used=getattr(self.llm_provider, "provider_name", "deterministic"),
        )
        if root_result is None:
            raise RuntimeError("Data RCA agent failed; see its execution record.")
        root_cause, _, _ = root_result

        impact = self._execute(
            self.lineage_impact_agent.name,
            evidence_ids,
            lambda: self.lineage_impact_agent.run(context, root_cause.root_node),
            provider_used="deterministic",
            finding_id=f"{context.incident.incident_id}:lineage-impact",
        )
        if impact is None:
            raise RuntimeError("Lineage impact agent failed; see its execution record.")
        insurance = self._execute(
            self.insurance_context_agent.name,
            impact.evidence_ids,
            lambda: self.insurance_context_agent.run(context, impact),
            provider_used="deterministic",
            finding_id=f"{context.incident.incident_id}:insurance-context",
        )
        if insurance is None:
            raise RuntimeError("Insurance context agent failed; see its execution record.")
        sla = self._execute(
            self.sla_agent.name,
            [status.sla_id for status in context.sla_statuses],
            lambda: self.sla_agent.run(context),
            provider_used="deterministic",
            finding_id=f"{context.incident.incident_id}:sla",
        )
        if sla is None:
            raise RuntimeError("SLA agent failed; see its execution record.")
        remediation = self._execute(
            self.remediation_agent.name,
            evidence_ids,
            lambda: self.remediation_agent.run(context, root_cause),
            provider_used="deterministic",
            finding_id=f"{context.incident.incident_id}:remediation",
        )
        if remediation is None:
            raise RuntimeError("Remediation agent failed; see its execution record.")

        verification = self._execute(
            self.verification_agent.name,
            evidence_ids,
            lambda: self.verification_agent.run(context, remediation.plan.plan_id),
            provider_used="deterministic",
            finding_id=f"{context.incident.incident_id}:verification",
            insufficient=(
                context.verification_before is None or context.verification_after is None
            ),
        )
        return InvestigationResult(
            incident_id=context.incident.incident_id,
            findings=findings,
            root_cause=root_cause,
            lineage_impact=impact,
            insurance_context=insurance,
            sla_assessment=sla,
            remediation=remediation,
            verification=verification,
            runs=list(self.runs),
        )

    def _execute(
        self,
        agent_name: str,
        evidence_ids: list[str],
        action: Callable[[], T],
        *,
        provider_used: str,
        finding_id: str | None = None,
        insufficient: bool = False,
    ) -> T | None:
        started_at = datetime.now(UTC)
        start = time.perf_counter()
        error = None
        try:
            result = action()
            status = AgentRunStatus.INSUFFICIENT_EVIDENCE if insufficient else AgentRunStatus.SUCCEEDED
            if agent_name == DataAnomalyAgent.name and isinstance(result, list) and result:
                finding_id = result[0].finding_id
            if agent_name == DataRCAAgent.name and isinstance(result, tuple):
                report, provider_used, provider_error = result
                finding_id = f"{report.incident_id}:rca"
                error = provider_error
                if provider_error:
                    status = AgentRunStatus.FALLBACK
                elif report.status == AnalysisStatus.INSUFFICIENT_EVIDENCE:
                    status = AgentRunStatus.INSUFFICIENT_EVIDENCE
            if (
                agent_name == VerificationAgent.name
                and isinstance(result, VerificationResult)
                and not result.verified
            ):
                status = AgentRunStatus.FAILED
                error = "verification_checks_failed"
        except Exception as exception:
            result = None
            error = _safe_provider_error(exception)
            status = AgentRunStatus.FAILED
        ended_at = datetime.now(UTC)
        record = AgentExecutionRecord(
            run_id=str(uuid4()),
            agent_name=agent_name,
            started_at=started_at,
            ended_at=ended_at,
            status=status,
            evidence_ids=list(dict.fromkeys(evidence_ids)),
            finding_id=finding_id,
            provider_used=provider_used,
            latency_ms=round((time.perf_counter() - start) * 1000, 3),
            error=error,
        )
        self.runs.append(record)
        if self.record_sink is not None:
            self.record_sink(record)
        return result


def _events(context: InvestigationInput) -> list[ObservabilityEvent]:
    combined = [*context.incident.evidence, *context.events]
    unique = {str(event.event_id): event for event in combined}
    return sorted(unique.values(), key=lambda event: (event.occurred_at, str(event.event_id)))


def _evidence_ids(context: InvestigationInput) -> list[str]:
    identifiers = [str(event.event_id) for event in _events(context)]
    identifiers.extend(result.check_id for result in context.quality_results)
    identifiers.extend(item.dataset_id for item in context.dataset_health)
    identifiers.extend(
        f"schema:{item.dataset_id}:{item.version}" for item in context.schema_versions
    )
    identifiers.extend(run.run_id for run in context.pipeline_runs)
    identifiers.extend(status.sla_id for status in context.sla_statuses)
    return list(dict.fromkeys(identifiers))


def _root_node(
    event: ObservabilityEvent | None, context: InvestigationInput
) -> str | None:
    graph = context.lineage_graph
    if graph is None or event is None:
        return None
    node_ids = {node.node_id for node in graph.nodes}
    candidates = [event.dataset_id, event.pipeline_id]
    if event.pipeline_id:
        source = event.pipeline_id.removesuffix("-ingestion")
        candidates.append(f"ingestion.{source}")
    return next((candidate for candidate in candidates if candidate in node_ids), None)


def _dataset_root_node(dataset_id: str | None, context: InvestigationInput) -> str | None:
    if dataset_id is None or context.lineage_graph is None:
        return None
    node_ids = {node.node_id for node in context.lineage_graph.nodes}
    return dataset_id if dataset_id in node_ids else None


def _pipeline_root_node(pipeline_id: str, context: InvestigationInput) -> str | None:
    if context.lineage_graph is None:
        return None
    node_ids = {node.node_id for node in context.lineage_graph.nodes}
    source = pipeline_id.removesuffix("-ingestion")
    candidates = (pipeline_id, f"ingestion.{source}")
    return next((candidate for candidate in candidates if candidate in node_ids), None)


def _schema_changes(context: InvestigationInput) -> list[tuple[str, str]]:
    by_dataset: dict[str, list[SchemaVersion]] = {}
    for version in context.schema_versions:
        by_dataset.setdefault(version.dataset_id, []).append(version)
    detector = SchemaDriftDetector()
    changes: list[tuple[str, str]] = []
    for dataset_id, versions in by_dataset.items():
        ordered = sorted(versions, key=lambda version: (version.observed_at, version.version))
        for previous, current in zip(ordered, ordered[1:]):
            comparison = detector.detect(dataset_id, current, baseline=previous)
            changes.extend(
                (dataset_id, f"{change.change_type}:{change.field_name}")
                for change in comparison.changes
            )
    return changes


def _signature_match(
    events: list[ObservabilityEvent], context: InvestigationInput
) -> float | None:
    comparisons = []
    for event in events:
        expected = context.historical_signatures.get(event.dataset_id or "")
        if expected is None:
            continue
        observed = f"{event.event_type}|{','.join(sorted(metric.name for metric in event.metrics))}"
        comparisons.append(float(expected == observed))
    return sum(comparisons) / len(comparisons) if comparisons else None


def _severity_rank(event: ObservabilityEvent) -> int:
    return {"info": 0, "warning": 1, "error": 2, "critical": 3}.get(str(event.severity), 0)


def _narrative_is_grounded(
    narrative: NarrativeAugmentation,
    events: list[ObservabilityEvent],
    hypotheses: list[str],
) -> bool:
    allowed_tokens = {
        token.lower()
        for event in events
        for token in (event.event_type, event.dataset_id or "", event.pipeline_id or "")
        if token
    }
    text = f"{narrative.root_cause_summary} {narrative.explanation}".lower()
    return any(token in text for token in allowed_tokens) and bool(hypotheses)


def _safe_provider_error(error: Exception) -> str:
    code = getattr(error, "code", None)
    if isinstance(code, str) and code.replace("_", "").isalnum():
        return code[:64]
    if isinstance(error, ValidationError):
        return "invalid_structured_response"
    if isinstance(error, TimeoutError):
        return "timeout"
    return type(error).__name__.lower()[:64]


__all__ = [
    "AgentOrchestrator",
    "DataAnomalyAgent",
    "DataRCAAgent",
    "InsuranceContextAgent",
    "LineageImpactAgent",
    "RemediationAgent",
    "SLAAgent",
    "VerificationAgent",
]
