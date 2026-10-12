from backend.app.config import Settings
from backend.app.providers.base import DataPlatformProvider, LLMProvider, ObservabilityProvider
from backend.app.providers.data_platform import DatabricksDataPlatformProvider, LocalDataPlatformProvider
from backend.app.providers.llm import DeterministicLLMProvider, GeminiLLMProvider
from observability.providers import (
    DynatraceObservabilityProvider,
    LocalObservabilityProvider,
    OpenSourceObservabilityProvider,
)


def build_data_platform_provider(settings: Settings) -> DataPlatformProvider:
    if settings.data_platform_provider == "local":
        return LocalDataPlatformProvider(settings.local_data_path)
    if settings.data_platform_provider == "databricks":
        return DatabricksDataPlatformProvider(
            settings.databricks_host,
            settings.databricks_http_path,
            settings.databricks_token,
            catalog=settings.databricks_catalog,
            local_fallback=LocalDataPlatformProvider(settings.local_data_path),
        )
    raise ValueError(f"Unsupported data platform provider: {settings.data_platform_provider}")


def build_observability_provider(settings: Settings) -> ObservabilityProvider:
    if settings.observability_provider == "local":
        return LocalObservabilityProvider()
    if settings.observability_provider == "dynatrace":
        return DynatraceObservabilityProvider(
            {
                "DYNATRACE_URL": settings.dynatrace_url or "",
                "DYNATRACE_API_TOKEN": settings.dynatrace_api_token or "",
            }
        )
    if settings.observability_provider == "opensource":
        return OpenSourceObservabilityProvider(
            {"OTEL_EXPORTER_OTLP_ENDPOINT": settings.otel_exporter_otlp_endpoint or ""}
        )
    raise ValueError(f"Unsupported observability provider: {settings.observability_provider}")


def build_llm_provider(settings: Settings) -> LLMProvider:
    if settings.llm_provider == "deterministic":
        return DeterministicLLMProvider()
    if settings.llm_provider == "gemini":
        return GeminiLLMProvider(api_key=settings.gemini_api_key)
    raise ValueError(f"Unsupported LLM provider: {settings.llm_provider}")
