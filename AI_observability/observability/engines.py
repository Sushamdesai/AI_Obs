from __future__ import annotations

import statistics
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from math import isfinite
from typing import Any, Iterable, Mapping, Sequence
from uuid import NAMESPACE_URL, uuid5

from shared.contracts import (
    ConfidenceFactor,
    DataMetric,
    DatasetHealth,
    EventStatus,
    HealthState,
    Incident,
    IncidentStatus,
    IncidentTimelineEvent,
    LineageGraph,
    ObservabilityEvent,
    QualityResult,
    RCAResult,
    SchemaVersion,
    Severity,
    VerificationResult,
)


class QualityCheckType(StrEnum):
    REQUIRED = "required"
    UNIQUE = "unique"
    NUMERIC_RANGE = "numeric_range"
    ALLOWED_VALUES = "allowed_values"
    REFERENTIAL = "referential"
    CUSTOM = "custom"


@dataclass(frozen=True)
class QualityCheck:
    check_id: str
    check_type: QualityCheckType
    fields: tuple[str, ...]
    minimum: float | None = None
    maximum: float | None = None
    allowed_values: frozenset[Any] = frozenset()
    reference_values: frozenset[Any] = frozenset()
    custom_predicate: Any | None = None
    description: str = ""

    @classmethod
    def required(cls, check_id: str, *fields: str, description: str = "") -> QualityCheck:
        return cls(check_id, QualityCheckType.REQUIRED, tuple(fields), description=description)

    @classmethod
    def unique(cls, check_id: str, *fields: str, description: str = "") -> QualityCheck:
        return cls(check_id, QualityCheckType.UNIQUE, tuple(fields), description=description)

    @classmethod
    def numeric_range(
        cls,
        check_id: str,
        field: str,
        *,
        minimum: float | None = None,
        maximum: float | None = None,
        description: str = "",
    ) -> QualityCheck:
        if (
            minimum is not None
            and not isfinite(minimum)
            or maximum is not None
            and not isfinite(maximum)
        ):
            raise ValueError("numeric range bounds must be finite.")
        if minimum is not None and maximum is not None and minimum > maximum:
            raise ValueError("minimum cannot be greater than maximum.")
        return cls(
            check_id,
            QualityCheckType.NUMERIC_RANGE,
            (field,),
            minimum=minimum,
            maximum=maximum,
            description=description,
        )

    @classmethod
    def allowed(
        cls, check_id: str, field: str, values: Iterable[Any], *, description: str = ""
    ) -> QualityCheck:
        allowed_values = frozenset(values)
        if not allowed_values:
            raise ValueError("allowed values must not be empty.")
        return cls(
            check_id,
            QualityCheckType.ALLOWED_VALUES,
            (field,),
            allowed_values=allowed_values,
            description=description,
        )

    @classmethod
    def referential(
        cls,
        check_id: str,
        field: str,
        reference_values: Iterable[Any],
        *,
        description: str = "",
    ) -> QualityCheck:
        return cls(
            check_id,
            QualityCheckType.REFERENTIAL,
            (field,),
            reference_values=frozenset(reference_values),
            description=description,
        )

    @classmethod
    def custom(
        cls,
        check_id: str,
        fields: Sequence[str],
        predicate: Any,
        *,
        description: str = "",
    ) -> QualityCheck:
        if not callable(predicate):
            raise ValueError("custom predicate must be callable.")
        return cls(
            check_id,
            QualityCheckType.CUSTOM,
            tuple(fields),
            custom_predicate=predicate,
            description=description,
        )


@dataclass(frozen=True)
class FreshnessResult:
    dataset_id: str
    age_seconds: float
    expected_interval_seconds: float
    threshold_seconds: float
    state: HealthState
    last_successful_update: datetime
    evaluated_at: datetime
    message: str


@dataclass(frozen=True)
class VolumeResult:
    dataset_id: str
    row_count: int
    anomalous: bool
    expected_count: float | None
    deviation_percent: float | None
    reason: str
    evaluated_at: datetime
    history_size: int


@dataclass(frozen=True)
class SchemaChange:
    field_name: str
    change_type: str
    previous: Any = None
    current: Any = None


@dataclass(frozen=True)
class SchemaDriftResult:
    dataset_id: str
    previous_version: str | None
    current_version: str | None
    changes: tuple[SchemaChange, ...]
    detected: bool
    signature: str


@dataclass(frozen=True)
class CorrelatedIncident:
    incident: Incident
    correlation_reasons: tuple[str, ...]


@dataclass(frozen=True)
class HealthEvaluation:
    health: DatasetHealth
    reasons: tuple[str, ...]


@dataclass(frozen=True)
class EventFinding:
    finding_id: str
    event: ObservabilityEvent
    category: str
    evidence: tuple[str, ...]
    severity: Severity


def _utc(value: datetime, name: str) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{name} must be timezone-aware.")
    return value.astimezone(UTC)


def _normalized(value: Any) -> Any:
    if isinstance(value, StrEnum):
        return value.value
    return value


class DataQualityEngine:
    """Deterministic row-level checks with an auditable arithmetic score."""

    def evaluate(
        self,
        dataset_id: str,
        records: Sequence[Mapping[str, Any]],
        checks: Sequence[QualityCheck] = (),
        *,
        evaluated_at: datetime | None = None,
        row_id_fields: Sequence[str] = ("_record_id", "id", "claim_id", "policy_id"),
        expected_row_count: int | None = None,
    ) -> QualityResult:
        now = _utc(evaluated_at or datetime.now(UTC), "evaluated_at")
        rows = [dict(record) for record in records]
        if expected_row_count is not None and expected_row_count < 0:
            raise ValueError("expected_row_count must be non-negative.")
        effective_checks = list(checks)
        check_results: list[dict[str, Any]] = []
        failed_indexes: set[int] = set()
        for check in effective_checks:
            violations = self._violations(rows, check)
            failed_indexes.update(violations)
            check_results.append(
                {
                    "check_id": check.check_id,
                    "check_type": check.check_type.value,
                    "fields": list(check.fields),
                    "description": check.description,
                    "failed_records": len(violations),
                    "evaluated_records": len(rows),
                    "score": self._pass_rate(len(rows), len(violations)),
                }
            )
        duplicate_indexes, duplicate_rate = self._duplicates(rows, row_id_fields)
        failed_indexes.update(duplicate_indexes)
        check_results.append(
            {
                "check_id": "duplicate_rate",
                "check_type": "duplicate_rate",
                "fields": [],
                "description": "Duplicate rows based on available record identifiers or full-row signature.",
                "failed_records": len(duplicate_indexes),
                "evaluated_records": len(rows),
                "score": self._pass_rate(len(rows), len(duplicate_indexes)),
            }
        )
        row_count_passed = expected_row_count is None or len(rows) == expected_row_count
        if expected_row_count is not None:
            check_results.append(
                {
                    "check_id": "row_count",
                    "check_type": "row_count",
                    "fields": [],
                    "description": f"Expected exactly {expected_row_count} rows.",
                    "failed_records": 0 if row_count_passed else abs(len(rows) - expected_row_count),
                    "evaluated_records": max(len(rows), expected_row_count, 1),
                    "score": 1.0 if row_count_passed else self._pass_rate(
                        max(len(rows), expected_row_count), abs(len(rows) - expected_row_count)
                    ),
                }
            )
        check_scores = [float(result["score"]) for result in check_results]
        score = round(sum(check_scores) / len(check_scores), 6) if check_scores else 1.0
        all_passed = not failed_indexes and row_count_passed
        return QualityResult(
            check_id=f"{dataset_id}:quality",
            dataset_id=dataset_id,
            passed=all_passed,
            score=score,
            evaluated_at=now,
            failed_records=len(failed_indexes),
            message=(
                "All configured checks passed."
                if all_passed
                else f"{len(failed_indexes)} record(s) failed one or more checks."
            ),
            attributes={
                "checks": check_results,
                "scoring": "unweighted arithmetic mean of per-check pass rates, including duplicate rate",
                "duplicate_rate": duplicate_rate,
                "row_count": len(rows),
                "expected_row_count": expected_row_count,
            },
        )

    @staticmethod
    def _pass_rate(total: int, failures: int) -> float:
        return round(max(0, total - failures) / total, 6) if total else (1.0 if failures == 0 else 0.0)

    @staticmethod
    def _duplicates(
        rows: Sequence[Mapping[str, Any]], row_id_fields: Sequence[str]
    ) -> tuple[set[int], float]:
        if not rows:
            return set(), 0.0
        key = next((field for field in row_id_fields if all(field in row for row in rows)), None)
        seen: set[Any] = set()
        duplicates: set[int] = set()
        for index, row in enumerate(rows):
            if key is None:
                value = tuple(sorted((str(k), repr(v)) for k, v in row.items()))
            else:
                value = repr(row.get(key))
            if value in seen:
                duplicates.add(index)
            else:
                seen.add(value)
        return duplicates, round(len(duplicates) / len(rows), 6)

    @staticmethod
    def _violations(rows: Sequence[Mapping[str, Any]], check: QualityCheck) -> set[int]:
        if check.check_type == QualityCheckType.UNIQUE:
            seen: set[tuple[Any, ...]] = set()
            failed: set[int] = set()
            for index, row in enumerate(rows):
                key = tuple(repr(row.get(field)) for field in check.fields)
                if key in seen:
                    failed.add(index)
                else:
                    seen.add(key)
            return failed

        failures: set[int] = set()
        for index, row in enumerate(rows):
            if check.check_type == QualityCheckType.REQUIRED:
                invalid = any(field not in row or row[field] is None or row[field] == "" for field in check.fields)
            elif check.check_type == QualityCheckType.NUMERIC_RANGE:
                value = row.get(check.fields[0])
                try:
                    numeric = float(value)
                    invalid = (
                        not isfinite(numeric)
                        or (check.minimum is not None and numeric < check.minimum)
                        or (check.maximum is not None and numeric > check.maximum)
                    )
                except (TypeError, ValueError):
                    invalid = True
            elif check.check_type == QualityCheckType.ALLOWED_VALUES:
                invalid = row.get(check.fields[0]) not in check.allowed_values
            elif check.check_type == QualityCheckType.REFERENTIAL:
                invalid = row.get(check.fields[0]) not in check.reference_values
            elif check.check_type == QualityCheckType.CUSTOM:
                invalid = not bool(check.custom_predicate(row))
            else:
                raise ValueError(f"Unsupported quality check type: {check.check_type}")
            if invalid:
                failures.add(index)
        return failures


class FreshnessEngine:
    def evaluate(
        self,
        dataset_id: str,
        last_successful_update: datetime,
        expected_interval_seconds: float,
        now: datetime,
        *,
        grace_multiplier: float = 1.5,
    ) -> FreshnessResult:
        updated = _utc(last_successful_update, "last_successful_update")
        evaluated = _utc(now, "now")
        if not isfinite(expected_interval_seconds) or expected_interval_seconds <= 0:
            raise ValueError("expected_interval_seconds must be greater than zero.")
        if not isfinite(grace_multiplier) or grace_multiplier < 1:
            raise ValueError("grace_multiplier must be at least 1.")
        age = max(0.0, (evaluated - updated).total_seconds())
        threshold = expected_interval_seconds * grace_multiplier
        if age <= expected_interval_seconds:
            state = HealthState.HEALTHY
            message = "Dataset updated within its expected refresh interval."
        elif age <= threshold:
            state = HealthState.DEGRADED
            message = "Dataset is late but remains within the configured grace period."
        else:
            state = HealthState.CRITICAL
            message = "Dataset freshness threshold exceeded."
        return FreshnessResult(
            dataset_id=dataset_id,
            age_seconds=round(age, 3),
            expected_interval_seconds=expected_interval_seconds,
            threshold_seconds=threshold,
            state=state,
            last_successful_update=updated,
            evaluated_at=evaluated,
            message=message,
        )


class VolumeMonitor:
    def __init__(self, history_size: int = 20, minimum_history: int = 3) -> None:
        if history_size < 1 or minimum_history < 1 or minimum_history > history_size:
            raise ValueError("Require 1 <= minimum_history <= history_size.")
        self.history_size = history_size
        self.minimum_history = minimum_history
        self._history: dict[str, list[int]] = {}

    def evaluate(
        self,
        dataset_id: str,
        row_count: int,
        now: datetime,
        *,
        minimum_rows: int | None = None,
        maximum_rows: int | None = None,
        expected_rows: float | None = None,
        max_deviation_percent: float = 50.0,
    ) -> VolumeResult:
        evaluated = _utc(now, "now")
        if row_count < 0:
            raise ValueError("row_count must be non-negative.")
        if minimum_rows is not None and minimum_rows < 0:
            raise ValueError("minimum_rows must be non-negative.")
        if maximum_rows is not None and maximum_rows < 0:
            raise ValueError("maximum_rows must be non-negative.")
        if minimum_rows is not None and maximum_rows is not None and minimum_rows > maximum_rows:
            raise ValueError("minimum_rows cannot exceed maximum_rows.")
        if not isfinite(max_deviation_percent) or max_deviation_percent < 0:
            raise ValueError("max_deviation_percent must be non-negative.")
        if expected_rows is not None and (not isfinite(expected_rows) or expected_rows < 0):
            raise ValueError("expected_rows must be non-negative.")
        history = self._history.setdefault(dataset_id, [])
        baseline = expected_rows
        if baseline is None and len(history) >= self.minimum_history:
            baseline = float(statistics.median(history[-self.history_size :]))
        deviations: list[str] = []
        if minimum_rows is not None and row_count < minimum_rows:
            deviations.append(f"row_count {row_count} below absolute minimum {minimum_rows}")
        if maximum_rows is not None and row_count > maximum_rows:
            deviations.append(f"row_count {row_count} above absolute maximum {maximum_rows}")
        deviation_percent = None
        if baseline is not None:
            deviation_percent = round(abs(row_count - baseline) / max(abs(baseline), 1.0) * 100, 3)
            if deviation_percent > max_deviation_percent:
                deviations.append(
                    f"row_count deviates {deviation_percent}% from baseline {baseline:g} "
                    f"(limit {max_deviation_percent}%)"
                )
        history.append(row_count)
        del history[:-self.history_size]
        return VolumeResult(
            dataset_id=dataset_id,
            row_count=row_count,
            anomalous=bool(deviations),
            expected_count=baseline,
            deviation_percent=deviation_percent,
            reason="; ".join(deviations) if deviations else "Row count is within configured volume bounds.",
            evaluated_at=evaluated,
            history_size=len(history),
        )


class SchemaDriftDetector:
    def __init__(self) -> None:
        self._baseline: dict[str, tuple[str | None, dict[str, Any]]] = {}

    def detect(
        self,
        dataset_id: str,
        current: SchemaVersion | Mapping[str, Any],
        *,
        baseline: SchemaVersion | Mapping[str, Any] | None = None,
    ) -> SchemaDriftResult:
        current_version, current_fields = self._schema_parts(current)
        previous_source = baseline
        if previous_source is None:
            previous_source = self._baseline.get(dataset_id, (None, {}))[1]
            previous_version = self._baseline.get(dataset_id, (None, {}))[0]
        else:
            previous_version, _ = self._schema_parts(previous_source)
        _, previous_fields = self._schema_parts(previous_source) if previous_source else (None, {})
        changes: list[SchemaChange] = []
        for field_name in sorted(current_fields.keys() - previous_fields.keys()):
            changes.append(SchemaChange(field_name, "added", current=current_fields[field_name]))
        for field_name in sorted(previous_fields.keys() - current_fields.keys()):
            changes.append(SchemaChange(field_name, "removed", previous=previous_fields[field_name]))
        for field_name in sorted(current_fields.keys() & previous_fields.keys()):
            old = previous_fields[field_name]
            new = current_fields[field_name]
            old_type, old_nullable = self._field_parts(old)
            new_type, new_nullable = self._field_parts(new)
            if old_type != new_type:
                changes.append(SchemaChange(field_name, "type_changed", previous=old_type, current=new_type))
            if old_nullable != new_nullable:
                changes.append(
                    SchemaChange(field_name, "nullability_changed", previous=old_nullable, current=new_nullable)
                )
        signature = self.signature(current_fields)
        self._baseline[dataset_id] = (current_version, dict(current_fields))
        return SchemaDriftResult(
            dataset_id=dataset_id,
            previous_version=previous_version,
            current_version=current_version,
            changes=tuple(changes),
            detected=bool(changes),
            signature=signature,
        )

    @staticmethod
    def _schema_parts(
        value: SchemaVersion | Mapping[str, Any],
    ) -> tuple[str | None, dict[str, Any]]:
        if isinstance(value, SchemaVersion):
            return value.version, dict(value.fields)
        if not isinstance(value, Mapping):
            raise TypeError("schema must be SchemaVersion or a field mapping.")
        if "fields" in value and isinstance(value["fields"], Mapping):
            fields = dict(value["fields"])
            version = value.get("version")
        else:
            fields = dict(value)
            version = None
        return str(version) if version is not None else None, fields

    @staticmethod
    def _field_parts(value: Any) -> tuple[Any, Any]:
        if isinstance(value, Mapping):
            return value.get("type"), value.get("nullable", value.get("required"))
        if isinstance(value, str):
            return value, None
        return value, None

    @staticmethod
    def signature(fields: Mapping[str, Any]) -> str:
        canonical = "|".join(f"{field}:{fields[field]!r}" for field in sorted(fields))
        return f"{uuid5(NAMESPACE_URL, canonical)}"


class AnomalyDetector:
    def __init__(self, *, quality_floor: float = 0.8, freshness_limit_seconds: float | None = None) -> None:
        if not isfinite(quality_floor) or not 0 <= quality_floor <= 1:
            raise ValueError("quality_floor must be between 0 and 1.")
        if freshness_limit_seconds is not None and (
            not isfinite(freshness_limit_seconds) or freshness_limit_seconds <= 0
        ):
            raise ValueError("freshness_limit_seconds must be greater than zero.")
        self.quality_floor = quality_floor
        self.freshness_limit_seconds = freshness_limit_seconds

    def detect(
        self,
        event: ObservabilityEvent,
        *,
        volume_anomalous: bool = False,
        schema_drifted: bool = False,
    ) -> list[EventFinding]:
        metric_map = {metric.name: metric.value for metric in event.metrics}
        findings: list[EventFinding] = []
        event_categories = {
            "quality_failure": "data_quality",
            "data_quality_changed": "data_quality",
            "freshness_violation": "freshness",
            "volume_anomaly": "volume",
            "volume_drop": "volume",
            "schema_drift": "schema_drift",
            "schema_drift_detected": "schema_drift",
            "pipeline_failure": "pipeline_failure",
            "pipeline_failed": "pipeline_failure",
        }
        event_category = event_categories.get(event.event_type)
        if event_category is not None:
            findings.append(
                self._finding(event, event_category, f"canonical event type is {event.event_type}")
            )
        quality = metric_map.get("dataset.quality_score")
        quality_value = self._metric_float(quality)
        if quality is not None and event_category is None and (
            quality_value is None or quality_value < self.quality_floor
        ):
            findings.append(self._finding(event, "data_quality", f"quality score {quality} below {self.quality_floor}"))
        freshness = metric_map.get("dataset.freshness_seconds")
        freshness_value = self._metric_float(freshness)
        if (
            freshness is not None
            and self.freshness_limit_seconds is not None
            and (freshness_value is None or freshness_value > self.freshness_limit_seconds)
            and event_category != "freshness"
        ):
            findings.append(self._finding(event, "freshness", f"freshness age {freshness}s exceeds configured limit"))
        if volume_anomalous and event_category != "volume":
            findings.append(self._finding(event, "volume", "observed row count violated configured volume baseline"))
        if schema_drifted and event_category != "schema_drift":
            findings.append(self._finding(event, "schema_drift", "observed schema differs from the accepted signature"))
        pipeline_status = metric_map.get("pipeline.status")
        if pipeline_status == "failed" and event_category != "pipeline_failure":
            findings.append(self._finding(event, "pipeline_failure", "pipeline status is failed"))
        return findings

    @staticmethod
    def _metric_float(value: Any) -> float | None:
        try:
            parsed = float(value)
        except (TypeError, ValueError):
            return None
        return parsed if isfinite(parsed) else None

    @staticmethod
    def _finding(event: ObservabilityEvent, category: str, evidence: str) -> EventFinding:
        return EventFinding(
            finding_id=f"{event.event_id}:{category}",
            event=event,
            category=category,
            evidence=(evidence,),
            severity=event.severity,
        )


class DatasetHealthEvaluator:
    def evaluate(
        self,
        dataset_id: str,
        evaluated_at: datetime,
        *,
        quality: QualityResult | None = None,
        freshness: FreshnessResult | None = None,
        row_count: int | None = None,
        pipeline_status: str | None = None,
    ) -> HealthEvaluation:
        now = _utc(evaluated_at, "evaluated_at")
        reasons: list[str] = []
        states: list[HealthState] = []
        if quality is not None:
            states.append(HealthState.HEALTHY if quality.passed else HealthState.DEGRADED)
            if not quality.passed:
                reasons.append(f"quality score {quality.score}: {quality.message}")
        if freshness is not None:
            states.append(freshness.state)
            if freshness.state != HealthState.HEALTHY:
                reasons.append(freshness.message)
        if pipeline_status is not None:
            normalized_status = pipeline_status.lower()
            if normalized_status in {"failed", "error"}:
                states.append(HealthState.CRITICAL)
                reasons.append(f"pipeline status is {normalized_status}")
            elif normalized_status in {"running", "queued", "waiting"}:
                states.append(HealthState.WAITING)
            elif normalized_status not in {"succeeded", "success", "completed"}:
                states.append(HealthState.UNKNOWN)
        state = self._worst(states)
        return HealthEvaluation(
            health=DatasetHealth(
                dataset_id=dataset_id,
                state=state,
                quality_score=quality.score if quality is not None else None,
                freshness_seconds=freshness.age_seconds if freshness is not None else None,
                row_count=row_count,
                observed_at=now,
            ),
            reasons=tuple(reasons),
        )

    @staticmethod
    def _worst(states: Sequence[HealthState]) -> HealthState:
        priority = {
            HealthState.CRITICAL: 5,
            HealthState.DEGRADED: 4,
            HealthState.WAITING: 3,
            HealthState.UNKNOWN: 2,
            HealthState.HEALTHY: 1,
        }
        return max(states, key=priority.__getitem__) if states else HealthState.UNKNOWN


class VerificationEngine:
    def verify(
        self,
        plan_id: str,
        before: DatasetHealth,
        after: DatasetHealth,
        *,
        required_state: HealthState = HealthState.HEALTHY,
        required_quality_score: float | None = None,
        required_max_freshness_seconds: float | None = None,
        verified_at: datetime | None = None,
    ) -> VerificationResult:
        checks: list[str] = []
        passed = True
        if after.state == required_state:
            checks.append(f"dataset_state:{required_state.value}:passed")
        else:
            checks.append(f"dataset_state:{required_state.value}:failed:{after.state.value}")
            passed = False
        if required_quality_score is not None:
            quality_ok = after.quality_score is not None and after.quality_score >= required_quality_score
            checks.append(f"quality_score>={required_quality_score}:{'passed' if quality_ok else 'failed'}")
            passed = passed and quality_ok
        if required_max_freshness_seconds is not None:
            freshness_ok = (
                after.freshness_seconds is not None
                and after.freshness_seconds <= required_max_freshness_seconds
            )
            checks.append(
                f"freshness<={required_max_freshness_seconds}:{'passed' if freshness_ok else 'failed'}"
            )
            passed = passed and freshness_ok
        if before.dataset_id != after.dataset_id:
            checks.append("dataset_identity:failed")
            passed = False
        return VerificationResult(
            plan_id=plan_id,
            verified=passed,
            verified_at=_utc(verified_at or datetime.now(UTC), "verified_at"),
            checks=checks,
            message="Post-remediation health checks passed." if passed else "Post-remediation health checks did not pass.",
        )


class ConfidenceEngine:
    """Deterministic confidence; weights: temporal .20, lineage .25, anomaly .20, signature .20, consistency .15."""

    WEIGHTS = {
        "temporal_correlation": 0.20,
        "lineage_proximity": 0.25,
        "anomaly_strength": 0.20,
        "signature_match": 0.20,
        "evidence_consistency": 0.15,
    }

    def assess(
        self,
        events: Sequence[ObservabilityEvent],
        *,
        lineage_graph: LineageGraph | None = None,
        anomaly_strength: float | None = None,
        signature_match: float | None = None,
        temporal_window_seconds: float = 300,
    ) -> tuple[float, list[ConfidenceFactor]]:
        if not events:
            raise ValueError("At least one event is required for confidence assessment.")
        if not isfinite(temporal_window_seconds) or temporal_window_seconds <= 0:
            raise ValueError("temporal_window_seconds must be greater than zero.")
        times = [_utc(event.occurred_at, "event.occurred_at") for event in events]
        span = (max(times) - min(times)).total_seconds()
        temporal = max(0.0, 1.0 - span / temporal_window_seconds)
        lineage = self._lineage_score(events, lineage_graph)
        severity_strength = {
            Severity.INFO: 0.25,
            Severity.WARNING: 0.5,
            Severity.ERROR: 0.75,
            Severity.CRITICAL: 1.0,
        }
        observed_strength = max(severity_strength[Severity(_normalized(event.severity))] for event in events)
        anomaly = observed_strength if anomaly_strength is None else self._clamp(anomaly_strength)
        signature = self._compatibility_score(events) if signature_match is None else self._clamp(signature_match)
        consistency = self._consistency_score(events)
        raw = {
            "temporal_correlation": temporal,
            "lineage_proximity": lineage,
            "anomaly_strength": anomaly,
            "signature_match": signature,
            "evidence_consistency": consistency,
        }
        factors = [
            ConfidenceFactor(
                name=name,
                score=round(score, 4),
                explanation=f"weight={self.WEIGHTS[name]:.2f}; observed factor score={score:.4f}",
            )
            for name, score in raw.items()
        ]
        weighted = sum(self.WEIGHTS[name] * score for name, score in raw.items())
        return round(weighted, 4), factors

    def to_rca_result(
        self,
        incident: Incident,
        *,
        lineage_graph: LineageGraph | None = None,
        generated_at: datetime | None = None,
    ) -> RCAResult:
        score, factors = self.assess(incident.evidence, lineage_graph=lineage_graph)
        return RCAResult(
            incident_id=incident.incident_id,
            suspected_root_cause="Deterministic evidence confidence assessment; root-cause reasoning is not included.",
            confidence_score=score,
            confidence_factors=factors,
            evidence_event_ids=[event.event_id for event in incident.evidence],
            generated_at=_utc(generated_at or datetime.now(UTC), "generated_at"),
        )

    @staticmethod
    def _clamp(value: float) -> float:
        if not isfinite(value) or not 0 <= value <= 1:
            raise ValueError("confidence factor values must be between 0 and 1.")
        return value

    @staticmethod
    def _compatibility_score(events: Sequence[ObservabilityEvent]) -> float:
        if len(events) < 2:
            return 0.5
        groups = [IncidentCorrelationEngine.event_group(event) for event in events]
        groups = [group for group in groups if group is not None]
        if len(groups) < 2:
            return 0.5
        return 1.0 if len(set(groups)) == 1 else 0.75

    @staticmethod
    def _consistency_score(events: Sequence[ObservabilityEvent]) -> float:
        fields = ("line_of_business",)
        consistency = sum(
            1 for field_name in fields if len({getattr(event, field_name) for event in events}) == 1
        )
        if len({event.correlation_id for event in events}) == 1:
            consistency += 1
        if len({event.run_id for event in events if event.run_id}) <= 1:
            consistency += 1
        return consistency / 3

    @staticmethod
    def _lineage_score(
        events: Sequence[ObservabilityEvent], graph: LineageGraph | None
    ) -> float:
        dataset_ids = {event.dataset_id for event in events if event.dataset_id}
        if len(dataset_ids) <= 1:
            return 1.0 if dataset_ids else 0.0
        if graph is None:
            return 0.25
        adjacency: dict[str, set[str]] = {}
        for edge in graph.edges:
            adjacency.setdefault(edge.source_node_id, set()).add(edge.target_node_id)
            adjacency.setdefault(edge.target_node_id, set()).add(edge.source_node_id)
        distances = []
        targets = set(dataset_ids)
        for source in targets:
            seen = {source}
            frontier = [(source, 0)]
            found = None
            while frontier:
                node, distance = frontier.pop(0)
                if node != source and node in targets:
                    found = distance
                    break
                for neighbor in adjacency.get(node, ()):
                    if neighbor not in seen:
                        seen.add(neighbor)
                        frontier.append((neighbor, distance + 1))
            if found is not None:
                distances.append(found)
        if not distances:
            return 0.0
        average_distance = sum(distances) / len(distances)
        return round(1.0 / max(1.0, average_distance), 4)


class IncidentCorrelationEngine:
    """Clusters only compatible data events with shared evidence or direct lineage proximity."""

    EVENT_GROUPS = {
        "data_quality_changed": "quality",
        "quality_failure": "quality",
        "quality_measurement": "quality",
        "data_quality_detected": "quality",
        "freshness_violation": "freshness",
        "freshness_update": "freshness",
        "volume_anomaly": "volume",
        "volume_drop": "volume",
        "schema_drift": "schema",
        "schema_drift_detected": "schema",
        "pipeline_failed": "pipeline",
        "pipeline_failure": "pipeline",
        "pipeline_completed": "pipeline",
        "pipeline_started": "pipeline",
        "dataset_updated": "dataset",
    }
    INFORMATIVE_EVENTS = {"pipeline_started", "pipeline_completed", "dataset_updated", "freshness_update"}
    COMPATIBLE_GROUPS = {
        frozenset(("quality", "schema")),
        frozenset(("quality", "pipeline")),
        frozenset(("freshness", "pipeline")),
        frozenset(("volume", "pipeline")),
        frozenset(("schema", "pipeline")),
        frozenset(("quality", "freshness")),
        frozenset(("quality", "volume")),
        frozenset(("schema", "freshness")),
    }

    def __init__(self, time_window_seconds: float = 300, lineage_hops: int = 2) -> None:
        if time_window_seconds <= 0:
            raise ValueError("time_window_seconds must be greater than zero.")
        if lineage_hops < 1:
            raise ValueError("lineage_hops must be at least 1.")
        self.time_window_seconds = time_window_seconds
        self.lineage_hops = lineage_hops

    @classmethod
    def event_group(cls, event: ObservabilityEvent) -> str | None:
        if event.event_type in cls.INFORMATIVE_EVENTS:
            return None
        return cls.EVENT_GROUPS.get(event.event_type)

    def correlate(
        self,
        events: Sequence[ObservabilityEvent],
        *,
        lineage_graph: LineageGraph | None = None,
    ) -> list[CorrelatedIncident]:
        eligible = [
            event for event in events
            if self.event_group(event) is not None
            and event.status != EventStatus.RESOLVED
        ]
        eligible.sort(key=lambda event: (event.occurred_at, str(event.event_id)))
        adjacency: list[set[int]] = [set() for _ in eligible]
        pair_reasons: dict[tuple[int, int], str] = {}
        for left in range(len(eligible)):
            for right in range(left + 1, len(eligible)):
                reason = self._correlation_reason(eligible[left], eligible[right], lineage_graph)
                if reason:
                    adjacency[left].add(right)
                    adjacency[right].add(left)
                    pair_reasons[left, right] = reason
        groups: list[list[int]] = []
        visited: set[int] = set()
        for index in range(len(eligible)):
            if index in visited:
                continue
            frontier = [index]
            visited.add(index)
            component: list[int] = []
            while frontier:
                current = frontier.pop()
                component.append(current)
                for neighbor in adjacency[current]:
                    if neighbor not in visited:
                        visited.add(neighbor)
                        frontier.append(neighbor)
            groups.append(sorted(component))
        incidents = []
        for group in groups:
            related_events = [eligible[index] for index in group]
            reasons = sorted(
                {
                    reason
                    for (left, right), reason in pair_reasons.items()
                    if left in group and right in group
                }
            )
            incidents.append(self._make_incident(related_events, reasons))
        return incidents

    def _correlation_reason(
        self,
        left: ObservabilityEvent,
        right: ObservabilityEvent,
        graph: LineageGraph | None,
    ) -> str | None:
        if left.line_of_business != right.line_of_business:
            return None
        if abs((_utc(left.occurred_at, "event.occurred_at") - _utc(right.occurred_at, "event.occurred_at")).total_seconds()) > self.time_window_seconds:
            return None
        left_group = self.event_group(left)
        right_group = self.event_group(right)
        if left_group is None or right_group is None:
            return None
        shared_identifiers = []
        if left.run_id and left.run_id == right.run_id:
            shared_identifiers.append("run_id")
        if left.correlation_id == right.correlation_id:
            shared_identifiers.append("correlation_id")
        if left.pipeline_id and left.pipeline_id == right.pipeline_id:
            shared_identifiers.append("pipeline_id")
        if left.dataset_id and left.dataset_id == right.dataset_id:
            shared_identifiers.append("dataset_id")
        if left_group == right_group and shared_identifiers:
            return f"compatible {left_group} signals share {', '.join(shared_identifiers)}"
        if frozenset((left_group, right_group)) not in self.COMPATIBLE_GROUPS:
            return None
        shared_source_or_pipeline = bool(
            (left.source_id and left.source_id == right.source_id)
            or (left.pipeline_id and left.pipeline_id == right.pipeline_id)
        )
        if shared_identifiers and shared_source_or_pipeline:
            return f"compatible {left_group}/{right_group} signals share {', '.join(shared_identifiers)} and source/pipeline"
        distance = self._lineage_distance(left.dataset_id, right.dataset_id, graph)
        if distance is not None and distance <= self.lineage_hops:
            return f"compatible {left_group}/{right_group} signals affect datasets {distance} lineage hop(s) apart"
        return None

    @staticmethod
    def _lineage_distance(left: str | None, right: str | None, graph: LineageGraph | None) -> int | None:
        if not left or not right or graph is None:
            return None
        if left == right:
            return 0
        adjacency: dict[str, set[str]] = {}
        for edge in graph.edges:
            adjacency.setdefault(edge.source_node_id, set()).add(edge.target_node_id)
            adjacency.setdefault(edge.target_node_id, set()).add(edge.source_node_id)
        seen = {left}
        frontier = [(left, 0)]
        while frontier:
            node, distance = frontier.pop(0)
            if node == right:
                return distance
            for neighbor in adjacency.get(node, ()):
                if neighbor not in seen:
                    seen.add(neighbor)
                    frontier.append((neighbor, distance + 1))
        return None

    @staticmethod
    def _make_incident(
        events: Sequence[ObservabilityEvent], reasons: Sequence[str]
    ) -> CorrelatedIncident:
        ordered = sorted(events, key=lambda event: event.occurred_at)
        identity = ":".join(sorted(str(event.event_id) for event in ordered))
        incident_id = f"incident-{uuid5(NAMESPACE_URL, identity)}"
        severity_order = (Severity.INFO, Severity.WARNING, Severity.ERROR, Severity.CRITICAL)
        severity = max((Severity(_normalized(event.severity)) for event in ordered), key=severity_order.index)
        timeline = [
            IncidentTimelineEvent(
                timeline_event_id=f"{incident_id}:event:{event.event_id}",
                incident_id=incident_id,
                occurred_at=event.occurred_at,
                event_type=event.event_type,
                message=event.message,
                correlation_id=event.correlation_id,
            )
            for event in ordered
        ]
        timeline.extend(
            IncidentTimelineEvent(
                timeline_event_id=f"{incident_id}:correlation:{index}",
                incident_id=incident_id,
                occurred_at=ordered[0].occurred_at,
                event_type="correlation_reason",
                message=reason,
                correlation_id=ordered[0].correlation_id,
            )
            for index, reason in enumerate(reasons)
        )
        incident = Incident(
            incident_id=incident_id,
            title=f"Correlated data incident ({len(ordered)} signal(s))",
            status=IncidentStatus.OPEN,
            severity=severity,
            line_of_business=ordered[0].line_of_business,
            started_at=ordered[0].occurred_at,
            evidence=list(ordered),
            timeline=timeline,
            correlated_node_ids=sorted(
                {
                    value
                    for event in ordered
                    for value in (event.dataset_id, event.pipeline_id)
                    if value is not None
                }
            ),
        )
        return CorrelatedIncident(incident=incident, correlation_reasons=tuple(reasons))
