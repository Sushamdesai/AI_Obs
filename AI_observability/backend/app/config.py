from __future__ import annotations

import os
from dataclasses import dataclass, replace
from typing import Mapping


@dataclass(frozen=True)
class Settings:
    app_name: str = "InsuraObserve AI"
    app_env: str = "demo"
    log_level: str = "INFO"
    demo_mode: bool = True
    simulator_batch_size: int = 12
    simulator_interval_seconds: float = 5.0
    data_platform_provider: str = "local"
    observability_provider: str = "local"
    llm_provider: str = "deterministic"
    database_url: str | None = None
    local_data_path: str = ":memory:"
    databricks_host: str | None = None
    databricks_http_path: str | None = None
    databricks_token: str | None = None
    databricks_catalog: str = "insurance_observability"
    dynatrace_url: str | None = None
    dynatrace_api_token: str | None = None
    otel_exporter_otlp_endpoint: str | None = None
    gemini_api_key: str | None = None


def _optional(environ: Mapping[str, str], key: str) -> str | None:
    value = environ.get(key, "").strip()
    return value or None


def load_settings(environ: Mapping[str, str] | None = None) -> Settings:
    values = os.environ if environ is None else environ
    demo_mode = values.get("DEMO_MODE", "true").strip().lower()
    if demo_mode not in {"true", "false"}:
        raise ValueError("DEMO_MODE must be 'true' or 'false'.")

    settings = Settings(
        app_name=values.get("APP_NAME", "InsuraObserve AI"),
        app_env=values.get("APP_ENV", "demo"),
        log_level=values.get("LOG_LEVEL", "INFO").upper(),
        demo_mode=demo_mode == "true",
        data_platform_provider=values.get("DATA_PLATFORM_PROVIDER", "local").lower(),
        observability_provider=values.get("OBSERVABILITY_PROVIDER", "local").lower(),
        llm_provider=values.get("LLM_PROVIDER", "deterministic").lower(),
        database_url=_optional(values, "DATABASE_URL"),
        local_data_path=values.get("LOCAL_DATA_PATH", ":memory:").strip() or ":memory:",
        databricks_host=_optional(values, "DATABRICKS_HOST"),
        databricks_http_path=_optional(values, "DATABRICKS_HTTP_PATH"),
        databricks_token=_optional(values, "DATABRICKS_TOKEN"),
        databricks_catalog=values.get("DATABRICKS_CATALOG", "insurance_observability").strip(),
        dynatrace_url=_optional(values, "DYNATRACE_URL"),
        dynatrace_api_token=_optional(values, "DYNATRACE_API_TOKEN"),
        otel_exporter_otlp_endpoint=_optional(values, "OTEL_EXPORTER_OTLP_ENDPOINT"),
        gemini_api_key=_optional(values, "GEMINI_API_KEY"),
    )
    allowed = {
        "data_platform_provider": {"local", "databricks"},
        "observability_provider": {"local", "dynatrace", "opensource"},
        "llm_provider": {"deterministic", "gemini"},
    }
    for field, choices in allowed.items():
        if getattr(settings, field) not in choices:
            raise ValueError(f"{field.upper()} must be one of: {', '.join(sorted(choices))}.")
    if settings.log_level not in {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}:
        raise ValueError("LOG_LEVEL must be a valid Python logging level.")
    try:
        batch_size = int(values.get("SIMULATOR_BATCH_SIZE", "12"))
        interval = float(values.get("SIMULATOR_INTERVAL_SECONDS", "5"))
    except ValueError as error:
        raise ValueError("Simulator batch size and interval must be numeric.") from error
    if batch_size < 1:
        raise ValueError("SIMULATOR_BATCH_SIZE must be at least 1.")
    if interval <= 0:
        raise ValueError("SIMULATOR_INTERVAL_SECONDS must be greater than zero.")
    settings = replace(
        settings,
        simulator_batch_size=batch_size,
        simulator_interval_seconds=interval,
    )
    return settings


settings = load_settings()
