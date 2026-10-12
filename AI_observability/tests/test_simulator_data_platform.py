from datetime import UTC, datetime
from threading import Event, Thread

import pytest

from backend.app.providers.base import ProviderNotConfiguredError
from backend.app.providers.data_platform import (
    DatabricksDataPlatformProvider,
    LocalDataPlatformProvider,
)
from simulator.synthetic_live import (
    FailureScenario,
    SimulationOrchestrator,
    SyntheticSourceSimulator,
)
from shared.contracts import ProviderStatus


FIXED_NOW = datetime(2026, 10, 9, 8, 30, tzinfo=UTC)


def make_simulator(
    *, seed: int = 17, batch_size: int = 12, provider: LocalDataPlatformProvider | None = None
) -> SimulationOrchestrator:
    return SimulationOrchestrator(
        seed=seed,
        batch_size=batch_size,
        interval_seconds=0.01,
        provider=provider,
        clock=lambda: FIXED_NOW,
        pipeline_delay_seconds=0,
    )


def test_seeded_generators_are_reproducible_and_relationships_are_valid() -> None:
    first = make_simulator().run_cycle()
    second = make_simulator().run_cycle()
    assert first.source_batches == second.source_batches

    policy_ids = {row["policy_id"] for row in first.source_batches["policies"]}
    customer_ids = {row["customer_id"] for row in first.source_batches["customers"]}
    vehicle_by_policy = {
        row["policy_id"]: row["vehicle_id"] for row in first.source_batches["policies"]
    }
    assert all(row["policy_id"] in policy_ids for row in first.source_batches["claims"])
    assert all(row["customer_id"] in customer_ids for row in first.source_batches["policies"])
    assert all(row["policy_id"] in policy_ids for row in first.source_batches["payments"])
    assert all(row["policy_id"] in policy_ids for row in first.source_batches["telematics"])
    assert all(
        row["vehicle_id"] == vehicle_by_policy[row["policy_id"]]
        for row in first.source_batches["telematics"]
    )


def test_source_simulator_is_seeded_and_rejects_invalid_batch_sizes() -> None:
    generator = SyntheticSourceSimulator("claims", seed=123)
    assert generator.emit_batch(4, cycle_number=8) == SyntheticSourceSimulator(
        "claims", seed=123
    ).emit_batch(4, cycle_number=8)
    with pytest.raises(ValueError):
        generator.emit_batch(-1)


def test_continuous_cycles_advance_batches_and_emit_typed_events() -> None:
    observed = []
    provider = LocalDataPlatformProvider()
    simulator = make_simulator(provider=provider)
    simulator.event_publisher = provider_event_collector(observed)
    first = simulator.run_cycle()
    second = simulator.run_cycle()

    assert first.run_id != second.run_id
    assert first.source_batches["claims"] != second.source_batches["claims"]
    assert first.source_batches["policies"][0]["policy_id"] == second.source_batches["policies"][0]["policy_id"]
    assert len(first.events) == len(observed) // 2
    assert all(event.correlation_id == first.correlation_id for event in first.events)
    assert {event.event_type for event in first.events} >= {
        "pipeline_started",
        "pipeline_completed",
        "dataset_updated",
        "schema_version",
        "quality_measurement",
        "freshness_update",
    }
    assert len(first.pipeline_runs) == 7
    provider.close()


def provider_event_collector(observed: list) -> object:
    def collect(event) -> None:
        observed.append(event)

    return collect


def test_local_pipeline_persists_bronze_silver_and_gold_outputs() -> None:
    provider = LocalDataPlatformProvider()
    result = make_simulator(provider=provider).run_cycle()

    for source_id in ("claims", "policies", "customers", "payments", "bureau", "telematics"):
        assert len(provider.get_records(f"bronze.{source_id}", latest_batch_only=True)) == 12
        assert len(provider.get_records(f"silver.{source_id}", latest_batch_only=True)) == 12
    assert len(result.gold_batches["gold.claims_analytics"]) == 12
    assert len(result.gold_batches["gold.customer_360"]) == 12
    assert len(result.gold_batches["gold.feature_store"]) == 12
    assert len(result.gold_batches["gold.fraud_features"]) == 12
    assert len(result.gold_batches["gold.risk_scoring"]) == 12
    assert len(result.gold_batches["feature.risk_features"]) == 12
    assert len(result.gold_batches["feature.driving_features"]) == 12
    assert provider.get_records("gold.customer_360", latest_batch_only=True)[0]["line_of_business"] == "motor"
    assert provider.store.count_records("bronze.claims") == 12
    provider.close()


def test_claims_quality_and_schema_drift_change_generated_data_before_silver() -> None:
    quality = make_simulator()
    quality.inject_failure(FailureScenario.CLAIMS_QUALITY_FAILURE, cycles=1)
    quality_result = quality.run_cycle()
    assert any(
        row["policy_id"] is None or row["policy_id"] == "invalid-policy-reference"
        for row in quality_result.source_batches["claims"]
    )
    assert quality_result.rejected_counts["claims"] > 0
    assert all(row["policy_id"] not in (None, "invalid-policy-reference") for row in quality_result.silver_batches["silver.claims"])
    quality_event = next(
        event for event in quality_result.events
        if event.event_type == "quality_measurement" and event.dataset_id == "silver.claims"
    )
    assert quality_event.severity == "info"
    assert quality_event.metrics[1].value > 0
    assert not quality.active_failures("claims")
    quality.provider.close()

    schema = make_simulator()
    schema.inject_failure(FailureScenario.SCHEMA_DRIFT)
    schema_result = schema.run_cycle()
    assert "policy_reference" in schema_result.source_batches["claims"][0]
    assert "policy_id" not in schema_result.source_batches["claims"][0]
    schema_event = next(event for event in schema_result.events if event.event_type == "schema_version" and event.source_id == "claims")
    assert schema_event.attributes["version"] == "2.0"
    assert schema_result.rejected_counts["claims"] > 0
    schema.provider.close()


def test_telematics_volume_drop_reduces_source_output() -> None:
    simulator = make_simulator()
    simulator.inject_failure(FailureScenario.TELEMATICS_VOLUME_DROP)
    result = simulator.run_cycle()
    assert result.source_counts["telematics"] == 3
    assert result.source_counts["claims"] == 12
    simulator.provider.close()


def test_freshness_failure_pauses_updates_without_faking_freshness_event() -> None:
    provider = LocalDataPlatformProvider()
    simulator = make_simulator(provider=provider)
    healthy = simulator.run_cycle()
    previous_count = provider.store.count_records("bronze.payments")
    simulator.inject_failure(FailureScenario.FRESHNESS_VIOLATION, cycles=1)
    delayed = simulator.run_cycle()

    assert delayed.source_batches["payments"] == []
    assert delayed.source_counts["payments"] == 0
    assert provider.store.count_records("bronze.payments") == previous_count
    assert provider.get_records("silver.payments", latest_batch_only=True) == healthy.silver_batches["silver.payments"]
    assert not any(
        event.event_type in {"dataset_updated", "freshness_update"}
        and event.dataset_id in {"bronze.payments", "silver.payments"}
        for event in delayed.events
    )
    provider.close()


def test_safe_masking_failure_rejects_synthetic_records_without_pii() -> None:
    simulator = make_simulator()
    simulator.inject_failure(FailureScenario.PII_PROCESSING_FAILURE, source_id="customers")
    result = simulator.run_cycle()
    assert result.rejected_counts["customers"] > 0
    assert all("name" not in row and "email" not in row for row in result.source_batches["customers"])
    assert all(row.get("synthetic_masking_check") != "failed" for row in result.silver_batches["silver.customers"])
    simulator.provider.close()


def test_pipeline_delay_is_injected_into_processing(monkeypatch: pytest.MonkeyPatch) -> None:
    from simulator import synthetic_live

    calls = []
    current_time = [FIXED_NOW]

    def fake_sleep(delay: float) -> None:
        calls.append(delay)
        from datetime import timedelta

        current_time[0] += timedelta(seconds=delay)

    monkeypatch.setattr(synthetic_live.time, "sleep", fake_sleep)
    simulator = SimulationOrchestrator(
        seed=17,
        batch_size=12,
        interval_seconds=0.01,
        clock=lambda: current_time[0],
        pipeline_delay_seconds=0,
    )
    simulator.inject_failure(FailureScenario.PIPELINE_DELAY, source_id="claims", delay_seconds=0.25)
    result = simulator.run_cycle()
    assert calls == [0.25]
    claims_run = next(run for run in result.pipeline_runs if run.pipeline_id == "claims-ingestion")
    assert (claims_run.completed_at - claims_run.started_at).total_seconds() == 0.25
    simulator.provider.close()


def test_injected_failure_can_be_cleared_and_cycle_count_must_be_positive() -> None:
    simulator = make_simulator()
    with pytest.raises(ValueError):
        simulator.inject_failure(FailureScenario.SCHEMA_DRIFT, cycles=0)
    with pytest.raises(ValueError):
        simulator.inject_failure(FailureScenario.TELEMATICS_VOLUME_DROP, source_id="claims")
    simulator.inject_failure(FailureScenario.SCHEMA_DRIFT)
    simulator.clear_failure(FailureScenario.SCHEMA_DRIFT)
    assert not simulator.active_failures("claims")
    result = simulator.run_cycle()
    assert "policy_id" in result.source_batches["claims"][0]
    simulator.provider.close()


def test_databricks_configuration_is_validated_and_always_falls_back_locally() -> None:
    missing = DatabricksDataPlatformProvider()
    assert missing.status == ProviderStatus.NOT_CONFIGURED
    assert not missing.is_configured
    assert missing.list_datasets()

    partial = DatabricksDataPlatformProvider(host="https://workspace.example", token="placeholder")
    assert partial.status == ProviderStatus.NOT_CONFIGURED
    assert not partial.is_configured
    assert any("must be set together" in error for error in partial.configuration_errors)

    configured = DatabricksDataPlatformProvider(
        host="https://workspace.example",
        http_path="/sql/1.0/warehouses/demo",
        token="placeholder",
    )
    assert configured.is_configured
    assert configured.status == ProviderStatus.NOT_CONFIGURED
    assert configured.get_lineage_graph().nodes
    assert configured.setup_sql().count("CREATE SCHEMA IF NOT EXISTS") == 3
    assert "DROP " not in configured.setup_sql().upper()
    configured.close()

    invalid = DatabricksDataPlatformProvider(catalog="unsafe.catalog")
    assert any("simple SQL identifier" in error for error in invalid.configuration_errors)
    with pytest.raises(ValueError):
        invalid.setup_sql()
    invalid.close()


def test_local_provider_setup_is_idempotent_for_batch_writes() -> None:
    provider = LocalDataPlatformProvider()
    first = make_simulator(provider=provider).run_cycle()
    count_after_first = provider.store.count_records("silver.claims")
    provider.append_records(
        "silver.claims",
        first.silver_batches["silver.claims"],
        first.run_id,
        FIXED_NOW,
    )
    assert provider.store.count_records("silver.claims") == count_after_first
    provider.close()


def test_local_sqlite_records_survive_provider_reopen(tmp_path) -> None:
    database_path = tmp_path / "local-data.sqlite3"
    provider = LocalDataPlatformProvider(str(database_path))
    result = make_simulator(provider=provider).run_cycle()
    expected = result.gold_batches["gold.customer_360"]
    provider.close()

    reopened = LocalDataPlatformProvider(str(database_path))
    assert reopened.get_records("gold.customer_360", latest_batch_only=True) == expected
    reopened.close()


def test_pipeline_exception_emits_failure_event_and_is_not_suppressed() -> None:
    provider = LocalDataPlatformProvider()

    def fail_store(dataset_id, records, batch_id, stored_at):
        raise ProviderNotConfiguredError("simulated local-store write failure")

    provider.append_records = fail_store
    simulator = make_simulator(provider=provider)
    with pytest.raises(ProviderNotConfiguredError, match="simulated local-store"):
        simulator.run_cycle()
    failure = simulator.last_events[-1]
    assert failure.event_type == "pipeline_failed"
    assert failure.pipeline_id == "customers-ingestion"
    provider.close()


def test_run_forever_stops_after_caller_sets_stop_event() -> None:
    stop_event = Event()
    simulator = make_simulator()
    simulator.event_publisher = lambda event: stop_event.set()
    thread = Thread(target=simulator.run_forever, args=(stop_event,), daemon=True)
    thread.start()
    thread.join(timeout=2)
    assert not thread.is_alive()
    assert simulator.cycle_number == 1
    simulator.provider.close()
