from typing import Any

from agents.gemini import GeminiLLMProvider
from backend.app.providers.base import LLMProvider
from shared.contracts import ProviderStatus


class DeterministicLLMProvider(LLMProvider):
    provider_name = "deterministic"

    @property
    def status(self) -> ProviderStatus:
        return ProviderStatus.READY

    def generate_finding(self, evidence: list[dict[str, Any]]) -> str:
        if not evidence:
            return "No evidence supplied; no finding can be made."
        signals = sorted({str(item.get("event_type", "unknown")) for item in evidence})
        return "Evidence contains these observed event types: " + ", ".join(signals) + "."
