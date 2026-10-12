from __future__ import annotations

import json
import os
from math import isfinite
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from backend.app.providers.base import LLMProvider, ProviderNotConfiguredError
from shared.contracts import ProviderStatus


class GeminiProviderError(ProviderNotConfiguredError):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


class GeminiLLMProvider(LLMProvider):
    """Evidence-only Gemini adapter. It deliberately has no data-set access."""

    provider_name = "gemini"
    _EVENT_FIELDS = {
        "event_id",
        "event_type",
        "dataset_id",
        "pipeline_id",
        "source_id",
        "severity",
        "status",
        "occurred_at",
    }

    def __init__(
        self,
        api_key: str | None = None,
        *,
        model: str | None = None,
        timeout_seconds: float = 8.0,
        transport: Callable[[Request, float], bytes] | None = None,
    ) -> None:
        self.api_key = (api_key if api_key is not None else os.environ.get("GEMINI_API_KEY", "")).strip()
        self.model = (model or os.environ.get("GEMINI_MODEL") or "gemini-1.5-pro").strip()
        if not self.model or any(char not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-" for char in self.model):
            raise ValueError("GEMINI_MODEL contains unsupported characters.")
        if not isfinite(timeout_seconds) or timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be greater than zero.")
        self.timeout_seconds = timeout_seconds
        self.transport = transport or self._send
        self.availability = "not_configured" if not self.api_key else "configured_unverified"

    @property
    def status(self) -> ProviderStatus:
        return ProviderStatus.READY if self.availability == "available" else ProviderStatus.NOT_CONFIGURED

    def generate_finding(self, evidence: list[dict[str, Any]]) -> str:
        if not self.api_key:
            self.availability = "not_configured"
            raise GeminiProviderError("not_configured")
        safe_evidence, task = self._prepare_evidence(evidence)
        if not safe_evidence:
            raise GeminiProviderError("insufficient_evidence")
        prompt = (
            "You are assisting a deterministic data-observability RCA workflow. "
            "Use only the supplied synthetic observability evidence. Do not invent evidence, "
            "lineage, identifiers, insurance outcomes, legal conclusions, confidence scores, "
            "or remediation actions. Return only a JSON object with exactly these string fields: "
            "root_cause_summary and explanation. Keep both concise and explicitly uncertain "
            "when the evidence is inconclusive.\n"
            f"Task: {task}\n"
            f"Evidence: {json.dumps(safe_evidence, separators=(',', ':'), ensure_ascii=True)}"
        )
        url = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{quote(self.model, safe='')}:generateContent"
        )
        request = Request(
            url,
            data=json.dumps(
                {
                    "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                    "generationConfig": {
                        "temperature": 0.1,
                        "maxOutputTokens": 512,
                        "responseMimeType": "application/json",
                    },
                },
                separators=(",", ":"),
            ).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "x-goog-api-key": self.api_key,
            },
            method="POST",
        )
        try:
            response = self.transport(request, self.timeout_seconds)
        except GeminiProviderError:
            self.availability = "unavailable"
            raise
        except HTTPError as error:
            self.availability = "unavailable"
            if error.code == 429:
                raise GeminiProviderError("quota_exceeded") from None
            if error.code in {401, 403}:
                raise GeminiProviderError("authentication_failed") from None
            raise GeminiProviderError("http_error") from None
        except (TimeoutError, URLError, OSError):
            self.availability = "unavailable"
            raise GeminiProviderError("network_or_timeout") from None
        if len(response) > 65_536:
            self.availability = "unavailable"
            raise GeminiProviderError("response_too_large")
        try:
            body = json.loads(response)
            text = body["candidates"][0]["content"]["parts"][0]["text"]
            if not isinstance(text, str) or not text.strip() or len(text) > 8_192:
                raise ValueError
        except (json.JSONDecodeError, KeyError, IndexError, TypeError, ValueError):
            self.availability = "unavailable"
            raise GeminiProviderError("invalid_response") from None
        self.availability = "available"
        return text.strip()

    @staticmethod
    def _send(request: Request, timeout_seconds: float) -> bytes:
        with urlopen(request, timeout=timeout_seconds) as response:
            if response.status < 200 or response.status >= 300:
                raise GeminiProviderError("http_error")
            return response.read(65_537)

    @classmethod
    def _prepare_evidence(
        cls, evidence: list[dict[str, Any]]
    ) -> tuple[list[dict[str, Any]], str]:
        task = "Summarize the likely technical cause."
        entries: list[dict[str, Any]] = []
        raw_entries: list[dict[str, Any]] = []
        for item in evidence[:20]:
            if "task" in item and isinstance(item["task"], str):
                task = item["task"][:300]
                nested = item.get("evidence")
                if isinstance(nested, list):
                    raw_entries.extend(entry for entry in nested[:20] if isinstance(entry, dict))
                continue
            raw_entries.append(item)
        for item in raw_entries[:20]:
            safe = {
                key: value[:256] if isinstance(value, str) else value
                for key, value in item.items()
                if key in cls._EVENT_FIELDS
                and isinstance(value, (str, int, float, bool, type(None)))
            }
            metrics = item.get("metrics")
            if isinstance(metrics, list):
                safe["metrics"] = [
                    {
                        "name": metric["name"][:128],
                        "value": metric["value"][:128]
                        if isinstance(metric["value"], str)
                        else metric["value"],
                    }
                    for metric in metrics[:12]
                    if isinstance(metric, dict)
                    and isinstance(metric.get("name"), str)
                    and isinstance(metric.get("value"), (str, int, float, bool))
                ]
            if safe:
                entries.append(safe)
        return entries, task


__all__ = ["GeminiLLMProvider", "GeminiProviderError"]
