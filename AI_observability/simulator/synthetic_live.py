from __future__ import annotations

import random
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Any, Callable, Iterable
from uuid import NAMESPACE_URL, uuid5

from backend.app.providers.data_platform import LocalDataPlatformProvider
from shared.contracts import (
    DataMetric,
    EventStatus,
    ObservabilityEvent,
    PipelineRun,
    PipelineRunStatus,
    Severity,
)

SOURCE_NAMES = ("claims", "policies", "customers", "payments", "bureau", "telematics")
SCHEDULE_INTERVAL_SECONDS = 5
DEFAULT_BATCH_SIZE = 12
BASE_TIME = datetime(2026, 1, 1, tzinfo=UTC)


class FailureScenario(StrEnum):
    CLAIMS_QUALITY_FAILURE = "CLAIMS_QUALITY_FAILURE"
    SCHEMA_DRIFT = "SCHEMA_DRIFT"
    TELEMATICS_VOLUME_DROP = "TELEMATICS_VOLUME_DROP"
    FRESHNESS_VIOLATION = "FRESHNESS_VIOLATION"
    PII_PROCESSING_FAILURE = "PII_PROCESSING_FAILURE"
    PIPELINE_DELAY = "PIPELINE_DELAY"


DEFAULT_FAILURE_SOURCES = {
    FailureScenario.CLAIMS_QUALITY_FAILURE: "claims",
    FailureScenario.SCHEMA_DRIFT: "claims",
    FailureScenario.TELEMATICS_VOLUME_DROP: "telematics",
    FailureScenario.FRESHNESS_VIOLATION: "payments",
}


@dataclass
class FailureInjection:
    scenario: FailureScenario
    source_id: str | None = None
    remaining_cycles: int | None = None
    delay_seconds: float | None = None


@dataclass
class SimulationCycle:
    cycle_number: int
    run_id: str
    correlation_id: str
    occurred_at: datetime
    source_batches: dict[str, list[dict[str, Any]]]
    silver_batches: dict[str, list[dict[str, Any]]]
    gold_batches: dict[str, list[dict[str, Any]]]
    pipeline_runs: list[PipelineRun]
    events: list[ObservabilityEvent]
    source_counts: dict[str, int]
    rejected_counts: dict[str, int]

    def summary(self) -> dict[str, Any]:
        return {
            "cycle_number": self.cycle_number,
            "run_id": self.run_id,
            "source_counts": self.source_counts.copy(),
            "silver_counts": {name: len(records) for name, records in self.silver_batches.items()},
            "gold_counts": {name: len(records) for name, records in self.gold_batches.items()},
            "rejected_counts": self.rejected_counts.copy(),
            "event_count": len(self.events),
        }


class SyntheticSourceSimulator:
    """Seeded, relationship-aware batch generator for one synthetic source."""

    def __init__(self, source_name: str, seed: int = 17, line_of_business: str = "motor") -> None:
        if source_name not in SOURCE_NAMES:
            raise ValueError(f"Unknown synthetic source: {source_name}")
        self.source_name = source_name
        self.seed = seed
        self.line_of_business = line_of_business

    def emit_batch(
        self,
        batch_size: int = DEFAULT_BATCH_SIZE,
        cycle_number: int = 0,
        context: dict[str, list[dict[str, Any]]] | None = None,
        failures: Iterable[FailureScenario] = (),
    ) -> list[dict[str, Any]]:
        if batch_size < 0:
            raise ValueError("batch_size must be non-negative.")
        context = context or {}
        active = set(failures)
        rng = random.Random(self.seed + cycle_number * 1_000_003 + SOURCE_NAMES.index(self.source_name) * 9_973)
        policies = context.get("policies", [])
        customers = context.get("customers", [])
        policy_by_index = [record["policy_id"] for record in policies]
        customer_by_index = [record["customer_id"] for record in customers]

        def policy_id_at(index: int) -> str:
            if not policy_by_index:
                return f"policy-{self.seed:04d}-{index:06d}"
            return policy_by_index[index % len(policy_by_index)]

        def customer_id_at(index: int) -> str:
            if not customer_by_index:
                return f"customer-{self.seed:04d}-{index:06d}"
            return customer_by_index[index % len(customer_by_index)]

        if FailureScenario.TELEMATICS_VOLUME_DROP in active and self.source_name == "telematics":
            batch_size //= 4

        records: list[dict[str, Any]] = []
        for index in range(batch_size):
            record_id = f"{self.source_name}-{self.seed:04d}-{cycle_number:06d}-{index:04d}"
            policy_id = policy_id_at(index)
            customer_id = customer_id_at(index)
            if self.source_name == "claims":
                record: dict[str, Any] = {
                    "claim_id": record_id,
                    "policy_id": policy_id,
                    "customer_id": customer_id,
                    "claim_status": ("reported", "under_review", "settled")[index % 3],
                    "loss_date": (BASE_TIME + timedelta(days=cycle_number + index)).date().isoformat(),
                    "claim_amount": round(250 + rng.random() * 4_750, 2),
                    "line_of_business": self.line_of_business,
                }
                if FailureScenario.CLAIMS_QUALITY_FAILURE in active and index % 2 == 0:
                    record["policy_id"] = None if index % 4 == 0 else "invalid-policy-reference"
                if FailureScenario.SCHEMA_DRIFT in active:
                    record["policy_reference"] = record.pop("policy_id")
            elif self.source_name == "policies":
                record = {
                    "policy_id": f"policy-{self.seed:04d}-{index:06d}",
                    "customer_id": customer_id,
                    "vehicle_id": f"vehicle-{self.seed:04d}-{index:06d}",
                    "policy_status": ("active", "active", "renewal_pending")[index % 3],
                    "effective_date": (BASE_TIME + timedelta(days=index)).date().isoformat(),
                    "line_of_business": self.line_of_business,
                }
            elif self.source_name == "customers":
                record = {
                    "customer_id": f"customer-{self.seed:04d}-{index:06d}",
                    "customer_segment": ("standard", "preferred", "commercial")[index % 3],
                    "region_code": f"R{index % 8:02d}",
                    "line_of_business": self.line_of_business,
                }
            elif self.source_name == "payments":
                record = {
                    "payment_id": record_id,
                    "policy_id": policy_id,
                    "payment_status": ("posted", "pending")[index % 2],
                    "amount": round(50 + rng.random() * 950, 2),
                    "currency": "USD",
                    "line_of_business": self.line_of_business,
                }
            elif self.source_name == "bureau":
                record = {
                    "bureau_record_id": record_id,
                    "policy_id": policy_id,
                    "synthetic_risk_band": 1 + index % 5,
                    "line_of_business": self.line_of_business,
                }
            else:
                record = {
                    "telematics_record_id": record_id,
                    "policy_id": policy_id,
                    "vehicle_id": f"vehicle-{self.seed:04d}-{index:06d}",
                    "distance_km": round(1 + rng.random() * 200, 2),
                    "harsh_braking_count": index % 4,
                    "line_of_business": self.line_of_business,
                }
            record["_record_id"] = record_id
            record["_source_id"] = self.source_name
            records.append(record)
        return records


class SimulationOrchestrator:
    """Runs independent source feeds and the local bronze/silver/gold POC flow."""

    def __init__(
        self,
        seed: int = 17,
        batch_size: int = DEFAULT_BATCH_SIZE,
        interval_seconds: float = SCHEDULE_INTERVAL_SECONDS,
        provider: LocalDataPlatformProvider | None = None,
        clock: Callable[[], datetime] | None = None,
        pipeline_delay_seconds: float = 0.1,
        event_publisher: Callable[[ObservabilityEvent], None] | None = None,
    ) -> None:
        if batch_size < 1:
            raise ValueError("batch_size must be at least 1.")
        if interval_seconds <= 0:
            raise ValueError("interval_seconds must be greater than zero.")
        if pipeline_delay_seconds < 0:
            raise ValueError("pipeline_delay_seconds must be non-negative.")
        self.seed = seed
        self.batch_size = batch_size
        self.interval_seconds = interval_seconds
        self.pipeline_delay_seconds = pipeline_delay_seconds
        self.provider = provider or LocalDataPlatformProvider()
        self.clock = clock or (lambda: datetime.now(UTC))
        self.sources = {
            source: SyntheticSourceSimulator(source, seed=seed)
            for source in SOURCE_NAMES
        }
        self.failure_injections: list[FailureInjection] = []
        self.cycle_number = 0
        self.last_events: list[ObservabilityEvent] = []
        self._current_source_id: str | None = None
        self._current_pipeline_id: str | None = None
        self.event_publisher = event_publisher

    def _now_utc(self) -> datetime:
        value = self.clock()
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("clock must return a timezone-aware datetime.")
        return value.astimezone(UTC)

    def inject_failure(
        self,
        scenario: FailureScenario | str,
        *,
        source_id: str | None = None,
        cycles: int | None = None,
        delay_seconds: float | None = None,
    ) -> FailureInjection:
        failure = FailureScenario(scenario)
        if source_id is not None and source_id not in SOURCE_NAMES:
            raise ValueError(f"Unknown source for failure injection: {source_id}")
        compatible_sources = {
            FailureScenario.CLAIMS_QUALITY_FAILURE: {"claims"},
            FailureScenario.SCHEMA_DRIFT: {"claims"},
            FailureScenario.TELEMATICS_VOLUME_DROP: {"telematics"},
        }
        if source_id is not None and source_id not in compatible_sources.get(failure, SOURCE_NAMES):
            raise ValueError(f"{failure.value} cannot target source {source_id}.")
        if cycles is not None and cycles < 1:
            raise ValueError("cycles must be at least 1 when specified.")
        if delay_seconds is not None and delay_seconds < 0:
            raise ValueError("delay_seconds must be non-negative.")
        injection = FailureInjection(failure, source_id, cycles, delay_seconds)
        self.failure_injections = [
            item for item in self.failure_injections
            if (item.scenario, item.source_id) != (failure, source_id)
        ]
        self.failure_injections.append(injection)
        return injection

    def clear_failure(
        self, scenario: FailureScenario | str, *, source_id: str | None = None
    ) -> None:
        failure = FailureScenario(scenario)
        self.failure_injections = [
            item for item in self.failure_injections
            if (item.scenario, item.source_id) != (failure, source_id)
        ]

    def active_failures(self, source_id: str | None = None) -> set[FailureScenario]:
        return {
            injection.scenario
            for injection in self.failure_injections
            if (
                (injection.source_id == source_id)
                if injection.source_id is not None
                else (
                    source_id is None
                    or DEFAULT_FAILURE_SOURCES.get(injection.scenario) in (None, source_id)
                )
            )
        }

    def _run_identifier(self, cycle: int) -> tuple[str, str]:
        run_id = f"motor-{self.seed:04d}-{cycle:08d}"
        return run_id, f"correlation-{run_id}"

    def _event(
        self,
        *,
        event_type: str,
        occurred_at: datetime,
        run_id: str,
        correlation_id: str,
        source_id: str | None = None,
        pipeline_id: str | None = None,
        dataset_id: str | None = None,
        severity: Severity = Severity.INFO,
        status: EventStatus = EventStatus.DETECTED,
        metrics: list[DataMetric] | None = None,
        attributes: dict[str, Any] | None = None,
        message: str,
    ) -> ObservabilityEvent:
        identity = f"{run_id}:{event_type}:{source_id}:{pipeline_id}:{dataset_id}"
        return ObservabilityEvent(
            event_id=uuid5(NAMESPACE_URL, identity),
            event_type=event_type,
            occurred_at=occurred_at,
            correlation_id=correlation_id,
            run_id=run_id,
            source_id=source_id,
            pipeline_id=pipeline_id,
            dataset_id=dataset_id,
            line_of_business="motor",
            severity=severity,
            status=status,
            metrics=metrics or [],
            attributes=attributes or {},
            message=message,
        )

    def run_cycle(self) -> SimulationCycle:
        self.last_events = []
        try:
            return self._run_cycle()
        except Exception:
            run_id, correlation_id = self._run_identifier(max(0, self.cycle_number - 1))
            failure_event = self._event(
                event_type="pipeline_failed",
                occurred_at=self._now_utc(),
                run_id=run_id,
                correlation_id=correlation_id,
                source_id=self._current_source_id,
                pipeline_id=self._current_pipeline_id,
                severity=Severity.ERROR,
                metrics=[DataMetric(name="pipeline.status", value="failed", observed_at=self._now_utc())],
                attributes={"error_type": "pipeline_processing_error"},
                message="Pipeline stage raised an exception; details remain in service logs.",
            )
            self._record_event(self.last_events, failure_event)
            raise

    def _run_cycle(self) -> SimulationCycle:
        cycle = self.cycle_number
        self.cycle_number += 1
        run_id, correlation_id = self._run_identifier(cycle)
        occurred_at = self._now_utc()

        source_batches: dict[str, list[dict[str, Any]]] = {}
        policies_context: list[dict[str, Any]] = []
        customers_context: list[dict[str, Any]] = []
        for source_id in ("customers", "policies", "claims", "payments", "bureau", "telematics"):
            source = self.sources[source_id]
            failures = self.active_failures(source_id)
            # The source generators run independently; context is only for valid synthetic foreign keys.
            batch = source.emit_batch(
                batch_size=self.batch_size,
                cycle_number=cycle,
                context={"policies": policies_context, "customers": customers_context},
                failures=failures,
            )
            if source_id == "customers":
                customers_context = batch
            elif source_id == "policies":
                policies_context = batch
            source_batches[source_id] = batch

        events: list[ObservabilityEvent] = []
        self.last_events = events
        pipeline_runs: list[PipelineRun] = []
        silver_batches: dict[str, list[dict[str, Any]]] = {}
        rejected_counts: dict[str, int] = {}
        for source_id in ("customers", "policies", "claims", "payments", "bureau", "telematics"):
            self._current_source_id = source_id
            pipeline_id = f"{source_id}-ingestion"
            self._current_pipeline_id = pipeline_id
            bronze_id = f"bronze.{source_id}"
            silver_id = f"silver.{source_id}"
            failures = self.active_failures(source_id)
            injected_delay = max(
                (
                    injection.delay_seconds
                    if injection.delay_seconds is not None
                    else self.pipeline_delay_seconds
                    for injection in self.failure_injections
                    if injection.scenario == FailureScenario.PIPELINE_DELAY
                    and (injection.source_id is None or injection.source_id == source_id)
                ),
                default=0.0,
            )
            paused = (
                FailureScenario.FRESHNESS_VIOLATION in failures
                and source_id is not None
            )
            if paused:
                source_batches[source_id] = []
            raw_batch = source_batches[source_id]
            start_time = self._now_utc()
            self._record_event(
                events,
                self._event(
                    event_type="pipeline_started",
                    occurred_at=start_time,
                    run_id=run_id,
                    correlation_id=correlation_id,
                    source_id=source_id,
                    pipeline_id=pipeline_id,
                    severity=Severity.INFO,
                    status=EventStatus.RESOLVED,
                    metrics=[DataMetric(name="pipeline.status", value="running", observed_at=start_time)],
                    attributes={"failure_injections": sorted(failure.value for failure in failures)},
                    message="Pipeline cycle started." if not paused else "Source updates paused by freshness scenario.",
                ),
            )
            if injected_delay:
                time.sleep(injected_delay)
            if not paused:
                self.provider.append_records(bronze_id, raw_batch, run_id, occurred_at)
            if not paused:
                self._record_event(
                    events,
                    self._event(
                        event_type="dataset_updated",
                        occurred_at=occurred_at,
                        run_id=run_id,
                        correlation_id=correlation_id,
                        source_id=source_id,
                        pipeline_id=pipeline_id,
                        dataset_id=bronze_id,
                        metrics=[DataMetric(name="pipeline.records_in", value=len(raw_batch), observed_at=occurred_at)],
                        message="Bronze dataset batch stored.",
                        status=EventStatus.RESOLVED,
                    ),
                )

            silver_rows, rejected, null_policy_count = self._transform_silver(
                source_id,
                raw_batch,
                source_batches,
                failures,
                silver_batches,
            )
            if paused:
                silver_rows = self.provider.get_records(silver_id, latest_batch_only=True)
            silver_batches[silver_id] = silver_rows
            rejected_counts[source_id] = rejected
            if not paused:
                self.provider.append_records(silver_id, silver_rows, run_id, occurred_at)
            schema_version = "2.0" if FailureScenario.SCHEMA_DRIFT in failures and source_id == "claims" else "1.0"
            metrics = [
                DataMetric(name="dataset.row_count", value=len(raw_batch), observed_at=occurred_at),
                DataMetric(name="pipeline.records_rejected", value=rejected, observed_at=occurred_at),
                DataMetric(name="dataset.duplicate_rate", value=0.0, observed_at=occurred_at),
                DataMetric(
                    name="dataset.null_rate",
                    value=round(null_policy_count / max(1, len(raw_batch)), 4),
                    observed_at=occurred_at,
                ),
                DataMetric(
                    name="dataset.quality_score",
                    value=round((len(silver_rows) / max(1, len(raw_batch))), 4),
                    observed_at=occurred_at,
                ),
            ]
            generated_events = [
                    self._event(
                        event_type="schema_version",
                        occurred_at=occurred_at,
                        run_id=run_id,
                        correlation_id=correlation_id,
                        source_id=source_id,
                        pipeline_id=pipeline_id,
                        dataset_id=bronze_id,
                        attributes={"version": schema_version},
                        message=f"Observed source schema version {schema_version}.",
                    ),
                    self._event(
                        event_type="quality_measurement",
                        occurred_at=occurred_at,
                        run_id=run_id,
                        correlation_id=correlation_id,
                        source_id=source_id,
                        pipeline_id=pipeline_id,
                        dataset_id=silver_id,
                        severity=Severity.INFO,
                        status=EventStatus.RESOLVED,
                        metrics=metrics,
                        attributes={"rejected_records": rejected},
                        message="Deterministic silver validation measurements emitted.",
                    ),
                    self._event(
                        event_type="dataset_updated",
                        occurred_at=occurred_at,
                        run_id=run_id,
                        correlation_id=correlation_id,
                        source_id=source_id,
                        pipeline_id=pipeline_id,
                        dataset_id=silver_id,
                        metrics=[DataMetric(name="pipeline.records_out", value=len(silver_rows), observed_at=occurred_at)],
                        message="Validated silver dataset batch stored.",
                        status=EventStatus.RESOLVED,
                    ),
                    self._event(
                        event_type="freshness_update",
                        occurred_at=occurred_at,
                        run_id=run_id,
                        correlation_id=correlation_id,
                        source_id=source_id,
                        pipeline_id=pipeline_id,
                        dataset_id=silver_id,
                        metrics=[DataMetric(name="dataset.freshness_seconds", value=0, unit="seconds", observed_at=occurred_at)],
                        severity=Severity.INFO,
                        message="Freshness observation recorded; detection is owned by observability.",
                    ),
                ]
            for generated_event in generated_events:
                if not paused:
                    self._record_event(events, generated_event)
            completed_at = self._now_utc()
            run = PipelineRun(
                run_id=f"{run_id}:{pipeline_id}",
                pipeline_id=pipeline_id,
                status=PipelineRunStatus.SUCCEEDED,
                started_at=start_time,
                completed_at=completed_at,
                records_in=len(raw_batch),
                records_out=0 if paused else len(silver_rows),
                records_failed=0,
                correlation_id=correlation_id,
            )
            pipeline_runs.append(run)
            self._record_event(
                events,
                self._event(
                    event_type="pipeline_completed",
                    occurred_at=completed_at,
                    run_id=run_id,
                    correlation_id=correlation_id,
                    source_id=source_id,
                    pipeline_id=pipeline_id,
                    severity=Severity.INFO,
                    status=EventStatus.RESOLVED,
                    metrics=[
                        DataMetric(name="pipeline.status", value="succeeded", observed_at=completed_at),
                        DataMetric(name="pipeline.records_in", value=len(raw_batch), observed_at=occurred_at),
                        DataMetric(
                            name="pipeline.records_out",
                            value=0 if paused else len(silver_rows),
                            observed_at=occurred_at,
                        ),
                        DataMetric(name="pipeline.records_rejected", value=rejected, observed_at=occurred_at),
                        DataMetric(
                            name="pipeline.duration",
                            value=max(0.0, (completed_at - start_time).total_seconds()),
                            unit="seconds",
                            observed_at=completed_at,
                        ),
                    ],
                    message="Pipeline cycle completed.",
                ),
            )

        self._current_source_id = None
        self._current_pipeline_id = "gold-curation"
        gold_started_at = self._now_utc()
        self._record_event(
            events,
            self._event(
                event_type="pipeline_started",
                occurred_at=gold_started_at,
                run_id=run_id,
                correlation_id=correlation_id,
                pipeline_id="gold-curation",
                metrics=[DataMetric(name="pipeline.status", value="running", observed_at=gold_started_at)],
                message="Gold data product curation started.",
            ),
        )
        gold_batches = self._build_gold(silver_batches, source_batches)
        records_in = sum(len(records) for records in silver_batches.values())
        records_out = sum(len(records) for records in gold_batches.values())
        for dataset_id, records in gold_batches.items():
            self.provider.append_records(dataset_id, records, run_id, occurred_at)
            self._record_event(
                events,
                self._event(
                    event_type="dataset_updated",
                    occurred_at=occurred_at,
                    run_id=run_id,
                    correlation_id=correlation_id,
                    pipeline_id="gold-curation",
                    dataset_id=dataset_id,
                    metrics=[DataMetric(name="pipeline.records_out", value=len(records), observed_at=occurred_at)],
                    message="Gold data product batch stored.",
                    status=EventStatus.RESOLVED,
                ),
            )
        gold_completed_at = self._now_utc()
        pipeline_runs.append(
            PipelineRun(
                run_id=f"{run_id}:gold-curation",
                pipeline_id="gold-curation",
                status=PipelineRunStatus.SUCCEEDED,
                started_at=occurred_at,
                completed_at=gold_completed_at,
                records_in=records_in,
                records_out=records_out,
                correlation_id=correlation_id,
            )
        )
        self._record_event(
            events,
            self._event(
                event_type="pipeline_completed",
                occurred_at=gold_completed_at,
                run_id=run_id,
                correlation_id=correlation_id,
                pipeline_id="gold-curation",
                status=EventStatus.RESOLVED,
                metrics=[
                    DataMetric(name="pipeline.status", value="succeeded", observed_at=gold_completed_at),
                    DataMetric(name="pipeline.records_in", value=records_in, observed_at=occurred_at),
                    DataMetric(name="pipeline.records_out", value=records_out, observed_at=occurred_at),
                    DataMetric(name="pipeline.records_rejected", value=0, observed_at=occurred_at),
                    DataMetric(
                        name="pipeline.duration",
                        value=max(0.0, (gold_completed_at - gold_started_at).total_seconds()),
                        unit="seconds",
                        observed_at=gold_completed_at,
                    ),
                ],
                message="Gold data product curation completed.",
            ),
        )

        self._age_failure_injections()
        self._current_source_id = None
        self._current_pipeline_id = None
        return SimulationCycle(
            cycle_number=cycle,
            run_id=run_id,
            correlation_id=correlation_id,
            occurred_at=occurred_at,
            source_batches=source_batches,
            silver_batches=silver_batches,
            gold_batches=gold_batches,
            pipeline_runs=pipeline_runs,
            events=events,
            source_counts={name: len(records) for name, records in source_batches.items()},
            rejected_counts=rejected_counts,
        )

    def _record_event(
        self, events: list[ObservabilityEvent], event: ObservabilityEvent
    ) -> None:
        events.append(event)
        if self.event_publisher is not None:
            self.event_publisher(event)

    def _transform_silver(
        self,
        source_id: str,
        records: list[dict[str, Any]],
        source_batches: dict[str, list[dict[str, Any]]],
        failures: set[FailureScenario],
        silver_batches: dict[str, list[dict[str, Any]]],
    ) -> tuple[list[dict[str, Any]], int, int]:
        policy_records = (
            silver_batches["silver.policies"]
            if "silver.policies" in silver_batches
            else self.provider.get_records("silver.policies", latest_batch_only=True)
        )
        customer_records = (
            silver_batches["silver.customers"]
            if "silver.customers" in silver_batches
            else self.provider.get_records("silver.customers", latest_batch_only=True)
        )
        policies = {row["policy_id"] for row in policy_records if "policy_id" in row}
        customers = {row["customer_id"] for row in customer_records if "customer_id" in row}
        required = {
            "claims": ("claim_id", "policy_id", "claim_status"),
            "policies": ("policy_id", "customer_id", "vehicle_id", "policy_status"),
            "customers": ("customer_id", "customer_segment"),
            "payments": ("payment_id", "policy_id", "amount"),
            "bureau": ("bureau_record_id", "policy_id", "synthetic_risk_band"),
            "telematics": ("telematics_record_id", "policy_id", "vehicle_id", "distance_km"),
        }[source_id]
        seen: set[str] = set()
        valid: list[dict[str, Any]] = []
        rejected = 0
        null_policy_count = 0
        for record in records:
            row = dict(record)
            record_id = str(row.get("_record_id", ""))
            if record_id in seen:
                rejected += 1
                continue
            seen.add(record_id)
            if FailureScenario.PII_PROCESSING_FAILURE in failures and int(record_id[-4:]) % 7 == 0:
                row["synthetic_masking_check"] = "failed"
                rejected += 1
                continue
            if any(field not in row or row[field] in (None, "") for field in required):
                if source_id in {"claims", "payments"} and row.get("policy_id") in (None, ""):
                    null_policy_count += 1
                rejected += 1
                continue
            policy_ref = row.get("policy_id")
            if source_id in {"claims", "payments", "bureau", "telematics"} and policy_ref not in policies:
                rejected += 1
                continue
            if source_id == "policies" and row.get("customer_id") not in customers:
                rejected += 1
                continue
            if source_id == "telematics":
                linked_policy = next(
                    (
                        item
                        for item in policy_records
                        if item["policy_id"] == policy_ref
                    ),
                    None,
                )
                if linked_policy is None:
                    rejected += 1
                    continue
                if row.get("vehicle_id") != linked_policy.get("vehicle_id"):
                    rejected += 1
                    continue
            if source_id in {"claims", "payments"} and row.get("policy_id") in (None, ""):
                null_policy_count += 1
                rejected += 1
                continue
            for key in ("claim_amount", "amount", "distance_km"):
                if key in row:
                    row[key] = float(row[key])
            row["line_of_business"] = "motor"
            row["schema_version"] = "1.0"
            valid.append(row)
        return valid, rejected, null_policy_count

    @staticmethod
    def _build_gold(
        silver_batches: dict[str, list[dict[str, Any]]],
        source_batches: dict[str, list[dict[str, Any]]],
    ) -> dict[str, list[dict[str, Any]]]:
        policies = {row["policy_id"]: row for row in silver_batches["silver.policies"]}
        customers = {row["customer_id"]: row for row in silver_batches["silver.customers"]}
        payment_by_policy: dict[str, list[dict[str, Any]]] = {}
        for payment in silver_batches["silver.payments"]:
            payment_by_policy.setdefault(payment["policy_id"], []).append(payment)

        claims_analytics = [
            {
                "product_record_id": f"claims-analytics-{claim['_record_id']}",
                "claim_id": claim["claim_id"],
                "policy_id": claim["policy_id"],
                "policy_status": policies[claim["policy_id"]]["policy_status"],
                "claim_status": claim["claim_status"],
                "claim_amount": claim["claim_amount"],
                "line_of_business": "motor",
            }
            for claim in silver_batches["silver.claims"]
            if claim["policy_id"] in policies
        ]
        customer_360 = [
            {
                "product_record_id": f"customer-360-{policy['policy_id']}",
                "customer_id": policy["customer_id"],
                "policy_id": policy["policy_id"],
                "customer_segment": customers[policy["customer_id"]]["customer_segment"],
                "payment_count": len(payment_by_policy.get(policy["policy_id"], [])),
                "payment_total": round(sum(p["amount"] for p in payment_by_policy.get(policy["policy_id"], [])), 2),
                "line_of_business": "motor",
            }
            for policy in policies.values()
            if policy["customer_id"] in customers
        ]
        risk_features = [
            {
                "feature_record_id": f"risk-feature-{item['_record_id']}",
                "policy_id": item["policy_id"],
                "synthetic_risk_band": item["synthetic_risk_band"],
                "feature_source": "synthetic_bureau",
                "line_of_business": "motor",
            }
            for item in silver_batches["silver.bureau"]
        ]
        driving_features = [
            {
                "feature_record_id": f"driving-feature-{item['_record_id']}",
                "policy_id": item["policy_id"],
                "distance_km": item["distance_km"],
                "harsh_braking_count": item["harsh_braking_count"],
                "feature_source": "synthetic_telematics",
                "line_of_business": "motor",
            }
            for item in silver_batches["silver.telematics"]
        ]
        risk_by_policy = {item["policy_id"]: item for item in risk_features}
        driving_by_policy = {item["policy_id"]: item for item in driving_features}
        fraud_features = [
            {
                "product_record_id": f"fraud-feature-{policy['policy_id']}",
                "policy_id": policy["policy_id"],
                "claim_count": sum(1 for claim in silver_batches["silver.claims"] if claim["policy_id"] == policy["policy_id"]),
                "bureau_feature_present": policy["policy_id"] in risk_by_policy,
                "telematics_feature_present": policy["policy_id"] in driving_by_policy,
                "purpose": "synthetic feature preparation only; not a fraud decision",
                "line_of_business": "motor",
            }
            for policy in policies.values()
        ]
        feature_store = [
            {
                "product_record_id": f"feature-store-{policy['policy_id']}",
                "policy_id": policy["policy_id"],
                "risk_feature": risk_by_policy.get(policy["policy_id"], {}).get("synthetic_risk_band"),
                "distance_km": driving_by_policy.get(policy["policy_id"], {}).get("distance_km"),
                "harsh_braking_count": driving_by_policy.get(policy["policy_id"], {}).get(
                    "harsh_braking_count"
                ),
                "line_of_business": "motor",
            }
            for policy in policies.values()
        ]
        risk_scoring = [
            {
                "product_record_id": f"risk-input-{policy['policy_id']}",
                "policy_id": policy["policy_id"],
                "risk_band_input": risk_by_policy.get(policy["policy_id"], {}).get("synthetic_risk_band"),
                "telematics_input_present": policy["policy_id"] in driving_by_policy,
                "purpose": "synthetic model input representation; not an underwriting decision",
                "line_of_business": "motor",
            }
            for policy in policies.values()
        ]
        return {
            "gold.claims_analytics": claims_analytics,
            "gold.customer_360": customer_360,
            "feature.risk_features": risk_features,
            "feature.driving_features": driving_features,
            "gold.feature_store": feature_store,
            "gold.fraud_features": fraud_features,
            "gold.risk_scoring": risk_scoring,
        }

    def _age_failure_injections(self) -> None:
        remaining: list[FailureInjection] = []
        for injection in self.failure_injections:
            if injection.remaining_cycles is None:
                remaining.append(injection)
            elif injection.remaining_cycles > 1:
                injection.remaining_cycles -= 1
                remaining.append(injection)
        self.failure_injections = remaining

    def run_forever(self, stop_event: Any) -> None:
        """Run cycles until a caller-controlled threading.Event is set."""
        next_cycle_at = time.monotonic()
        while not stop_event.is_set():
            self.run_cycle()
            next_cycle_at += self.interval_seconds
            stop_event.wait(max(0.0, next_cycle_at - time.monotonic()))


@dataclass
class FailureScenarioController:
    orchestrator: SimulationOrchestrator

    def enable(self, scenario: FailureScenario | str, **kwargs: Any) -> FailureInjection:
        return self.orchestrator.inject_failure(scenario, **kwargs)

    def disable(self, scenario: FailureScenario | str, *, source_id: str | None = None) -> None:
        self.orchestrator.clear_failure(scenario, source_id=source_id)
