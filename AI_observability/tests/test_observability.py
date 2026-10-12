from datetime import UTC, datetime, timedelta
import json
from uuid import uuid4

import pytest

from backend.app.config import Settings
from backend.app.providers.base import ProviderStatus
from backend.app.providers.factory import build_observability_provider
from backend.app.providers.fixtures import EVENT_FIXTURES_BY_TYPE
from observability.engines import (
    AnomalyDetector,
    ConfidenceEngine,
    DataQualityEngine,
    DatasetHealthEvaluator,
    FreshnessEngine,
    IncidentCorrelationEngine,
    QualityCheck,
    SchemaDriftDetector,
    VerificationEngine,
    VolumeMonitor,
)
from observability.processor import DataObservabilityEngine
from observability.providers import (
    DynatraceObservabilityProvider,
    LocalObservabilityProvider,
    OpenSourceObservabilityProvider,
    OpenTelemetryObservabilityProvider,
)
from shared.contracts import DatasetHealth, HealthState


NOW = datetime(2026, 10, 9, 8, 30, tzinfo=UTC)


def test_quality_engine_runs_configurable_checks_with_transparent_scores() -> None:
    result = DataQualityEngine().evaluate(
        "silver.claims",
        [
            {"claim_id": "c1", "policy_id": "p1", "amount": 100, "status": "open"},
            {"claim_id": "c2", "policy_id": None, "amount": -1, "status": "unknown"},
            {"claim_id": "c2", "policy_id": "missing", "amount": 1, "status": "open"},
        ],
        [
            QualityCheck.required("policy_required", "policy_id"),
            QualityCheck.unique("claim_unique", "claim_id"),
            QualityCheck.numeric_range("amount_positive", "amount", minimum=0),
            QualityCheck.allowed("known_status", "status", {"open", "closed"}),
            QualityCheck.referential("policy_exists", "policy_id", {"p1", "p2"}),
            QualityCheck.custom("claim_shape", ["claim_id"], lambda row: row["claim_id"].startswith("c")),
        ],
        evaluated_at=NOW,
    )

    assert result.passed is False
    assert result.failed_records == 2
    assert result.score < 1
    assert result.attributes["duplicate_rate"] == pytest.approx(1 / 3)
    assert len(result.attributes["checks"]) == 7
    assert all("score" in check for check in result.attributes["checks"])


def test_quality_engine_rejects_non_finite_numeric_values_and_bad_row_count() -> None:
    engine = DataQualityEngine()
    result = engine.evaluate(
        "dataset",
        [{"amount": float("nan")}],
        [QualityCheck.numeric_range("finite", "amount", minimum=0)],
        evaluated_at=NOW,
    )
    assert not result.passed
    with pytest.raises(ValueError, match="expected_row_count"):
        engine.evaluate("dataset", [], evaluated_at=NOW, expected_row_count=-1)


def test_freshness_engine_reports_healthy_degraded_and_critical_states() -> None:
    engine = FreshnessEngine()
    updated = NOW - timedelta(seconds=50)
    assert engine.evaluate("d", updated, 60, NOW).state == HealthState.HEALTHY
    assert engine.evaluate("d", NOW - timedelta(seconds=75), 60, NOW).state == HealthState.DEGRADED
    critical = engine.evaluate("d", NOW - timedelta(seconds=100), 60, NOW)
    assert critical.state == HealthState.CRITICAL
    assert critical.age_seconds == 100
    assert "threshold exceeded" in critical.message


def test_volume_monitor_uses_absolute_and_rolling_baselines() -> None:
    monitor = VolumeMonitor(history_size=5, minimum_history=3)
    for count in (100, 102, 98):
        result = monitor.evaluate("silver.claims", count, NOW)
        assert not result.anomalous
    result = monitor.evaluate("silver.claims", 40, NOW, max_deviation_percent=30)
    assert result.anomalous
    assert result.expected_count == 100
    assert result.deviation_percent == 60
    absolute = monitor.evaluate("telemetry", 0, NOW, minimum_rows=1)
    assert absolute.anomalous
    assert "absolute minimum" in absolute.reason


def test_schema_detector_detects_field_type_and_nullability_changes() -> None:
    detector = SchemaDriftDetector()
    detector.detect(
        "bronze.claims",
        {
            "version": "1",
            "fields": {
                "claim_id": "string",
                "legacy_id": "string",
                "policy_id": {"type": "string", "nullable": False},
            },
        },
    )
    result = detector.detect(
        "bronze.claims",
        {
            "version": "2",
            "fields": {
                "claim_id": "integer",
                "amount": "number",
                "policy_id": {"type": "string", "nullable": True},
            },
        },
    )
    assert result.detected
    assert {change.change_type for change in result.changes} == {
        "added",
        "removed",
        "type_changed",
        "nullability_changed",
    }
    assert result.signature == SchemaDriftDetector.signature(
        {"claim_id": "integer", "amount": "number", "policy_id": {"type": "string", "nullable": True}}
    )


def test_anomaly_detector_recognizes_canonical_fixture_event_families() -> None:
    detector = AnomalyDetector()
    expected_categories = {
        "quality_failure": "data_quality",
        "schema_drift": "schema_drift",
        "volume_anomaly": "volume",
        "freshness_violation": "freshness",
        "pipeline_failure": "pipeline_failure",
    }
    for event_type, category in expected_categories.items():
        findings = detector.detect(EVENT_FIXTURES_BY_TYPE[event_type])
        assert [finding.category for finding in findings] == [category]


def test_incidents_correlate_compatible_shared_signals_but_separate_unrelated_ones() -> None:
    base = EVENT_FIXTURES_BY_TYPE["quality_failure"]
    quality = base.model_copy(
        update={"event_id": uuid4(), "correlation_id": "same-correlation", "pipeline_id": "claims-pipeline"}
    )
    schema = EVENT_FIXTURES_BY_TYPE["schema_drift"].model_copy(
        update={
            "event_id": uuid4(),
            "correlation_id": "same-correlation",
            "pipeline_id": "claims-pipeline",
            "occurred_at": NOW + timedelta(seconds=30),
        }
    )
    unrelated = EVENT_FIXTURES_BY_TYPE["volume_anomaly"].model_copy(
        update={
            "event_id": uuid4(),
            "correlation_id": "unrelated",
            "pipeline_id": "other-pipeline",
        }
    )
    incidents = IncidentCorrelationEngine().correlate([quality, schema, unrelated])

    assert sorted(len(item.incident.evidence) for item in incidents) == [1, 2]
    correlated = next(item for item in incidents if len(item.incident.evidence) == 2)
    assert correlated.correlation_reasons
    assert "correlation_id" in correlated.correlation_reasons[0]
    assert len(correlated.incident.timeline) >= 3


def test_confidence_engine_is_deterministic_and_uses_documented_weights() -> None:
    events = [
        EVENT_FIXTURES_BY_TYPE["quality_failure"],
        EVENT_FIXTURES_BY_TYPE["schema_drift"].model_copy(
            update={"occurred_at": NOW + timedelta(seconds=15)}
        ),
    ]
    engine = ConfidenceEngine()
    first = engine.assess(events)
    second = engine.assess(events)
    assert first == second
    assert sum(engine.WEIGHTS.values()) == pytest.approx(1)
    assert {factor.name for factor in first[1]} == set(engine.WEIGHTS)
    assert 0 <= first[0] <= 1


def test_dataset_health_evaluation_and_remediation_verification() -> None:
    freshness = FreshnessEngine().evaluate("d", NOW - timedelta(seconds=100), 60, NOW)
    quality = DataQualityEngine().evaluate(
        "d",
        [{"id": None}],
        [QualityCheck.required("id_required", "id")],
        evaluated_at=NOW,
    )
    evaluation = DatasetHealthEvaluator().evaluate(
        "d", NOW, quality=quality, freshness=freshness, row_count=1
    )
    assert evaluation.health.state == HealthState.CRITICAL
    assert len(evaluation.reasons) == 2

    before = DatasetHealth(dataset_id="d", state=HealthState.DEGRADED, observed_at=NOW)
    verified = VerificationEngine().verify(
        "plan",
        before,
        DatasetHealth(
            dataset_id="d",
            state=HealthState.HEALTHY,
            quality_score=0.99,
            freshness_seconds=10,
            observed_at=NOW,
        ),
        required_quality_score=0.95,
        required_max_freshness_seconds=30,
        verified_at=NOW,
    )
    assert verified.verified


def test_local_provider_stores_events_and_exposes_findings_incidents_and_confidence() -> None:
    provider = LocalObservabilityProvider()
    event = EVENT_FIXTURES_BY_TYPE["quality_failure"]
    provider.publish_event(event)

    assert provider.status == ProviderStatus.READY
    assert provider.events == [event]
    assert provider.findings[0].category == "data_quality"
    assert provider.incidents
    assert provider.confidence_results
    assert provider.last_processing_result.incidents == provider.incidents


def test_external_provider_configuration_and_failures_are_explicit_and_nonfatal() -> None:
    event = EVENT_FIXTURES_BY_TYPE["quality_failure"]
    dynatrace = DynatraceObservabilityProvider(environ={})
    delivery = dynatrace.try_publish_event(event)
    assert not delivery.delivered
    assert delivery.status == "not_configured"
    assert dynatrace.status == ProviderStatus.NOT_CONFIGURED

    failed_provider = DynatraceObservabilityProvider(
        environ={"DYNATRACE_URL": "https://example.invalid", "DYNATRACE_API_TOKEN": "test"},
        transport=lambda request: 503,
    )
    failed_provider.publish_event(event)
    failed = failed_provider.last_delivery
    assert not failed.delivered
    assert failed.status == "unavailable"
    assert "503" in failed.detail
    assert failed_provider.local_fallback.events == [event]
    assert failed_provider.local_fallback.findings[0].category == "data_quality"


def test_dynatrace_adapter_sends_sanitized_allowlisted_metadata_only() -> None:
    event = EVENT_FIXTURES_BY_TYPE["quality_failure"].model_copy(
        update={
            "message": "Synthetic record detail that must not be exported",
            "attributes": {"customer_name": "synthetic-sensitive-value"},
        }
    )
    sent = []

    def accept_request(request):
        sent.append(request)
        return 202

    provider = DynatraceObservabilityProvider(
        environ={"DYNATRACE_URL": "https://example.invalid", "DYNATRACE_API_TOKEN": "test"},
        transport=accept_request,
    )
    delivery = provider.try_publish_event(event)
    body = json.loads(sent[0].data)

    assert delivery.delivered
    assert provider.status == ProviderStatus.READY
    assert "message" not in body and "attributes" not in body
    assert "synthetic-sensitive-value" not in sent[0].data.decode()
    assert "insuraobserve.metric.dataset.quality_score" in body["properties"]


def test_opentelemetry_and_opensource_adapters_require_real_exporter() -> None:
    event = EVENT_FIXTURES_BY_TYPE["quality_failure"].model_copy(
        update={"message": "do not export", "attributes": {"raw": "private synthetic field"}}
    )
    absent = OpenSourceObservabilityProvider(environ={})
    absent.publish_event(event)
    assert absent.last_delivery.status == "not_configured"
    assert absent.local_fallback.events == [event]

    exported = []
    provider = OpenTelemetryObservabilityProvider(
        environ={"OTEL_EXPORTER_OTLP_ENDPOINT": "https://collector.example.invalid"},
        exporter=exported.append,
    )
    provider.publish_event(event)
    assert provider.status == ProviderStatus.READY
    assert exported
    assert "message" not in exported[0] and "attributes" not in exported[0]
    assert "private synthetic field" not in str(exported[0])


def test_provider_factory_uses_settings_not_unrelated_process_environment() -> None:
    provider = build_observability_provider(
        Settings(observability_provider="dynatrace", dynatrace_url="https://example.invalid")
    )
    assert provider.status == ProviderStatus.NOT_CONFIGURED
    assert provider.try_publish_event(EVENT_FIXTURES_BY_TYPE["quality_failure"]).status == "not_configured"


def test_processor_returns_typed_events_and_deterministic_incidents() -> None:
    events = [
        EVENT_FIXTURES_BY_TYPE["quality_failure"],
        EVENT_FIXTURES_BY_TYPE["pipeline_failure"].model_copy(
            update={
                "event_id": uuid4(),
                "correlation_id": EVENT_FIXTURES_BY_TYPE["quality_failure"].correlation_id,
                "pipeline_id": "policy-ingestion",
            }
        ),
    ]
    result = DataObservabilityEngine().process_events(events, generated_at=NOW)
    assert result.findings
    assert result.incidents
    assert result.confidence_results
    assert all(item.generated_at == NOW for item in result.confidence_results)
