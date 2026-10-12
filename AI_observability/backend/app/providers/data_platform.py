import re
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from backend.app.providers.base import DataPlatformProvider
from backend.app.providers.fixtures import DATASETS, MOTOR_LINEAGE
from backend.app.providers.local_storage import LocalDatasetStore
from shared.contracts import Dataset, LineageGraph, ProviderStatus


class LocalDataPlatformProvider(DataPlatformProvider):
    def __init__(self, database_path: str = ":memory:") -> None:
        self.store = LocalDatasetStore(database_path)

    @property
    def status(self) -> ProviderStatus:
        return ProviderStatus.READY

    def list_datasets(self) -> list[Dataset]:
        return [dataset.model_copy(deep=True) for dataset in DATASETS]

    def get_lineage_graph(self) -> LineageGraph:
        return MOTOR_LINEAGE.model_copy(deep=True)

    def append_records(
        self, dataset_id: str, records: list[dict[str, Any]], batch_id: str, stored_at: Any
    ) -> None:
        if dataset_id not in {dataset.dataset_id for dataset in DATASETS}:
            raise ValueError(f"Unknown local dataset: {dataset_id}")
        self.store.append_records(dataset_id, records, batch_id, stored_at)

    def get_records(
        self, dataset_id: str, *, limit: int = 1000, latest_batch_only: bool = False
    ) -> list[dict[str, Any]]:
        if dataset_id not in {dataset.dataset_id for dataset in DATASETS}:
            raise ValueError(f"Unknown local dataset: {dataset_id}")
        return self.store.get_records(dataset_id, limit=limit, latest_batch_only=latest_batch_only)

    def count_records(self, dataset_id: str, *, latest_batch_only: bool = True) -> int:
        if dataset_id not in {dataset.dataset_id for dataset in DATASETS}:
            raise ValueError(f"Unknown local dataset: {dataset_id}")
        return self.store.count_records(dataset_id, latest_batch_only=latest_batch_only)

    def close(self) -> None:
        self.store.close()


class DatabricksDataPlatformProvider(DataPlatformProvider):
    def __init__(
        self,
        host: str | None = None,
        http_path: str | None = None,
        token: str | None = None,
        catalog: str = "insurance_observability",
        local_fallback: LocalDataPlatformProvider | None = None,
    ) -> None:
        self.host = host
        self.http_path = http_path
        self.token = token
        self.catalog = catalog
        self.local_fallback = local_fallback or LocalDataPlatformProvider()
        self.configuration_errors = self.validate_configuration()

    def validate_configuration(self) -> tuple[str, ...]:
        errors: list[str] = []
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", self.catalog):
            errors.append("DATABRICKS_CATALOG must be a simple SQL identifier.")
        configured = (self.host is not None, self.http_path is not None, self.token is not None)
        if any(configured) and not all(configured):
            errors.append("DATABRICKS_HOST, DATABRICKS_HTTP_PATH, and DATABRICKS_TOKEN must be set together.")
        if self.host:
            parsed = urlparse(self.host)
            if parsed.scheme != "https" or not parsed.netloc:
                errors.append("DATABRICKS_HOST must be an https URL.")
        if self.http_path and not self.http_path.startswith("/"):
            errors.append("DATABRICKS_HTTP_PATH must start with '/'.")
        return tuple(errors)

    @property
    def status(self) -> ProviderStatus:
        return ProviderStatus.NOT_CONFIGURED

    @property
    def is_configured(self) -> bool:
        return not self.configuration_errors and bool(self.host and self.http_path and self.token)

    def list_datasets(self) -> list[Dataset]:
        return self.local_fallback.list_datasets()

    def get_lineage_graph(self) -> LineageGraph:
        return self.local_fallback.get_lineage_graph()

    def append_records(
        self, dataset_id: str, records: list[dict[str, Any]], batch_id: str, stored_at: Any
    ) -> None:
        self.local_fallback.append_records(dataset_id, records, batch_id, stored_at)

    def get_records(
        self, dataset_id: str, *, limit: int = 1000, latest_batch_only: bool = False
    ) -> list[dict[str, Any]]:
        return self.local_fallback.get_records(dataset_id, limit=limit, latest_batch_only=latest_batch_only)

    def count_records(self, dataset_id: str, *, latest_batch_only: bool = True) -> int:
        return self.local_fallback.count_records(dataset_id, latest_batch_only=latest_batch_only)

    def setup_sql(self) -> str:
        if any("DATABRICKS_CATALOG" in error for error in self.configuration_errors):
            raise ValueError("; ".join(self.configuration_errors))
        script = Path(__file__).resolve().parents[3].joinpath("databricks", "setup.sql").read_text(encoding="utf-8")
        return script.replace("insurance_observability", self.catalog)

    def close(self) -> None:
        self.local_fallback.close()
