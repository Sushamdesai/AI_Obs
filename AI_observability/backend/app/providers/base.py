from abc import ABC, abstractmethod
from datetime import datetime
from typing import Any

from shared.contracts import Dataset, LineageGraph, ObservabilityEvent, ProviderStatus


class ProviderNotConfiguredError(RuntimeError):
    """Raised when an optional provider has no implemented/configured connection."""


class DataPlatformProvider(ABC):
    @property
    @abstractmethod
    def status(self) -> ProviderStatus:
        raise NotImplementedError

    @abstractmethod
    def list_datasets(self) -> list[Dataset]:
        raise NotImplementedError

    @abstractmethod
    def get_lineage_graph(self) -> LineageGraph:
        raise NotImplementedError

    @abstractmethod
    def get_records(
        self, dataset_id: str, *, limit: int = 100, latest_batch_only: bool = True
    ) -> list[dict[str, Any]]:
        raise NotImplementedError

    @abstractmethod
    def count_records(self, dataset_id: str, *, latest_batch_only: bool = True) -> int:
        raise NotImplementedError

    @abstractmethod
    def append_records(
        self,
        dataset_id: str,
        records: list[dict[str, Any]],
        batch_id: str,
        stored_at: datetime,
    ) -> None:
        raise NotImplementedError


class ObservabilityProvider(ABC):
    @property
    @abstractmethod
    def status(self) -> ProviderStatus:
        raise NotImplementedError

    @abstractmethod
    def publish_event(self, event: ObservabilityEvent) -> None:
        raise NotImplementedError


class LLMProvider(ABC):
    @property
    @abstractmethod
    def status(self) -> ProviderStatus:
        raise NotImplementedError

    @abstractmethod
    def generate_finding(self, evidence: list[dict[str, Any]]) -> str:
        raise NotImplementedError
