import pytest

from backend.app.config import load_settings


def test_config_defaults_to_local_demo_mode() -> None:
    settings = load_settings({})
    assert settings.demo_mode is True
    assert settings.data_platform_provider == "local"
    assert settings.observability_provider == "local"
    assert settings.llm_provider == "deterministic"
    assert settings.database_url is None


def test_config_reads_provider_selection_and_secret_placeholders() -> None:
    settings = load_settings(
        {
            "DEMO_MODE": "false",
            "DATA_PLATFORM_PROVIDER": "databricks",
            "DATABRICKS_TOKEN": "test-token",
            "OBSERVABILITY_PROVIDER": "dynatrace",
            "LLM_PROVIDER": "gemini",
            "SIMULATOR_BATCH_SIZE": "24",
            "SIMULATOR_INTERVAL_SECONDS": "2.5",
        }
    )
    assert settings.demo_mode is False
    assert settings.data_platform_provider == "databricks"
    assert settings.databricks_token == "test-token"
    assert settings.observability_provider == "dynatrace"
    assert settings.llm_provider == "gemini"
    assert settings.simulator_batch_size == 24
    assert settings.simulator_interval_seconds == 2.5


@pytest.mark.parametrize(
    "environment",
    [
        {"DEMO_MODE": "sometimes"},
        {"DATA_PLATFORM_PROVIDER": "snowflake"},
        {"OBSERVABILITY_PROVIDER": "newrelic"},
        {"LLM_PROVIDER": "openai"},
        {"SIMULATOR_BATCH_SIZE": "0"},
        {"SIMULATOR_INTERVAL_SECONDS": "-1"},
    ],
)
def test_config_rejects_unknown_values(environment: dict[str, str]) -> None:
    with pytest.raises(ValueError):
        load_settings(environment)
