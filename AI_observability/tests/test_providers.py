import pytest

from backend.app.config import Settings
from backend.app.providers.base import ProviderNotConfiguredError
from backend.app.providers.factory import (
    build_data_platform_provider,
    build_llm_provider,
    build_observability_provider,
)
from backend.app.providers.fixtures import EVENT_FIXTURES
from shared.contracts import ProviderStatus


def test_local_provider_selection_and_fallback_work() -> None:
    settings = Settings()
    data = build_data_platform_provider(settings)
    observability = build_observability_provider(settings)
    llm = build_llm_provider(settings)

    assert data.status == ProviderStatus.READY
    assert len(data.list_datasets()) > 0
    assert data.get_lineage_graph().nodes
    assert observability.status == ProviderStatus.READY
    observability.publish_event(EVENT_FIXTURES[0])
    assert len(observability.events) == 1
    assert llm.status == ProviderStatus.READY
    assert "healthy_dataset" in llm.generate_finding([EVENT_FIXTURES[0].model_dump(mode="json")])


def test_external_provider_boundaries_never_claim_connected() -> None:
    settings = Settings(
        data_platform_provider="databricks",
        observability_provider="dynatrace",
        llm_provider="gemini",
        databricks_host="https://example.invalid",
        databricks_http_path="/sql/path",
        databricks_token="placeholder",
    )
    data = build_data_platform_provider(settings)
    observability = build_observability_provider(settings)
    llm = build_llm_provider(settings)
    assert data.status == ProviderStatus.NOT_CONFIGURED
    assert observability.status == ProviderStatus.NOT_CONFIGURED
    assert llm.status == ProviderStatus.NOT_CONFIGURED
    assert data.list_datasets()
    assert data.get_lineage_graph().nodes
    delivery = observability.try_publish_event(EVENT_FIXTURES[0])
    assert delivery.status == "not_configured"
    with pytest.raises(ProviderNotConfiguredError):
        llm.generate_finding([])


def test_local_fallback_providers_are_selectable_independently() -> None:
    settings = Settings(observability_provider="opensource")
    provider = build_observability_provider(settings)
    assert provider.status == ProviderStatus.NOT_CONFIGURED
