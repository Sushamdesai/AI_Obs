from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import UTC
from typing import Callable, Mapping, Sequence
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

from backend.app.providers.base import ObservabilityProvider
from observability.engines import CorrelatedIncident, EventFinding
from observability.processor import DataObservabilityEngine, EventProcessingResult
from shared.contracts import LineageGraph, ObservabilityEvent, ProviderStatus, RCAResult, Severity


@dataclass(frozen=True)
class ProviderDelivery:
    delivered: bool
    status: str
    detail: str


class LocalObservabilityProvider(ObservabilityProvider):
    """Guaranteed local event store and deterministic event processing path."""

    def __init__(self, engine: DataObservabilityEngine | None = None) -> None:
        self.events: list[ObservabilityEvent] = []
        self.engine = engine or DataObservabilityEngine()
        self.findings: list[EventFinding] = []
        self.incidents: list[CorrelatedIncident] = []
        self.confidence_results: list[RCAResult] = []
        self.last_processing_result = EventProcessingResult()

    @property
    def status(self) -> ProviderStatus:
        return ProviderStatus.READY

    def publish_event(self, event: ObservabilityEvent) -> None:
        self.process_events([event])

    def process_events(
        self,
        events: Sequence[ObservabilityEvent],
        *,
        lineage_graph: LineageGraph | None = None,
        volume_anomalies: Mapping[str, bool] | None = None,
        schema_drifts: Mapping[str, bool] | None = None,
    ) -> EventProcessingResult:
        copies = [event.model_copy(deep=True) for event in events]
        self.events.extend(copies)
        result = self.engine.process_events(
            copies,
            lineage_graph=lineage_graph,
            volume_anomalies=volume_anomalies,
            schema_drifts=schema_drifts,
        )
        self.findings.extend(result.findings)
        self.incidents.extend(result.incidents)
        self.confidence_results.extend(result.confidence_results)
        self.last_processing_result = result
        return result


class DynatraceObservabilityProvider(ObservabilityProvider):
    """Optional Dynatrace Events API adapter; only publishes sanitized signal metadata."""

    def __init__(
        self,
        environ: Mapping[str, str] | None = None,
        *,
        transport: Callable[[Request], int] | None = None,
        timeout_seconds: float = 5.0,
    ) -> None:
        self.local_fallback = LocalObservabilityProvider()
        self.environ = os.environ if environ is None else environ
        self.base_url = self.environ.get("DYNATRACE_URL", "").strip().rstrip("/")
        self.api_token = self.environ.get("DYNATRACE_API_TOKEN", "").strip()
        self.transport = transport or self._send_request
        if timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be greater than zero.")
        self.timeout_seconds = timeout_seconds
        self._configured = bool(self.base_url and self.api_token)
        self.availability = "not_configured" if not self._configured else "configured_unverified"
        self.last_delivery = ProviderDelivery(False, self.availability, "No event has been delivered.")

    @property
    def status(self) -> ProviderStatus:
        return ProviderStatus.READY if self.availability == "available" else ProviderStatus.NOT_CONFIGURED

    def publish_event(self, event: ObservabilityEvent) -> None:
        self.local_fallback.publish_event(event)
        self.try_publish_event(event)

    def try_publish_event(self, event: ObservabilityEvent) -> ProviderDelivery:
        if not self._configured:
            self.availability = "not_configured"
            self.last_delivery = ProviderDelivery(
                False,
                "not_configured",
                "Set DYNATRACE_URL and DYNATRACE_API_TOKEN to enable export.",
            )
            return self.last_delivery
        parsed_url = urlsplit(self.base_url)
        if parsed_url.scheme != "https" or not parsed_url.netloc:
            self.availability = "unavailable"
            self.last_delivery = ProviderDelivery(False, "unavailable", "DYNATRACE_URL must use HTTPS.")
            return self.last_delivery
        payload = self._safe_payload(event)
        request = Request(
            f"{self.base_url}/api/v2/events/ingest",
            data=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
            headers={
                "Authorization": f"Api-Token {self.api_token}",
                "Content-Type": "application/json; charset=utf-8",
            },
            method="POST",
        )
        try:
            status_code = self.transport(request)
        except (HTTPError, URLError, TimeoutError, OSError) as error:
            self.availability = "unavailable"
            self.last_delivery = ProviderDelivery(
                False,
                "unavailable",
                f"Dynatrace export failed ({type(error).__name__}); local event processing continues.",
            )
            return self.last_delivery
        if status_code < 200 or status_code >= 300:
            self.availability = "unavailable"
            self.last_delivery = ProviderDelivery(
                False,
                "unavailable",
                f"Dynatrace returned HTTP {status_code}; local event processing continues.",
            )
            return self.last_delivery
        self.availability = "available"
        self.last_delivery = ProviderDelivery(True, "available", "Sanitized event metadata was accepted.")
        return self.last_delivery

    @staticmethod
    def _safe_payload(event: ObservabilityEvent) -> dict:
        severity = Severity(event.severity)
        if severity in {Severity.CRITICAL, Severity.ERROR}:
            event_type = "ERROR_EVENT"
        elif severity == Severity.WARNING:
            event_type = "CUSTOM_ALERT"
        else:
            event_type = "CUSTOM_INFO"
        properties = {
            "insuraobserve.event_id": str(event.event_id),
            "insuraobserve.event_type": event.event_type[:128],
            "insuraobserve.correlation_id": event.correlation_id[:128],
            "insuraobserve.line_of_business": event.line_of_business[:64],
            "insuraobserve.severity": severity.value,
        }
        for key, value in (
            ("source_id", event.source_id),
            ("pipeline_id", event.pipeline_id),
            ("dataset_id", event.dataset_id),
            ("run_id", event.run_id),
        ):
            if value:
                properties[f"insuraobserve.{key}"] = value[:256]
        for metric in event.metrics:
            if metric.name in _SAFE_METRIC_NAMES and isinstance(metric.value, (int, float, bool)):
                properties[f"insuraobserve.metric.{metric.name}"] = str(metric.value)[:128]
        occurred_at_ms = int(event.occurred_at.astimezone(UTC).timestamp() * 1000)
        return {
            "eventType": event_type,
            "title": f"InsuraObserve data event: {event.event_type[:96]}",
            "startTime": occurred_at_ms,
            "properties": properties,
        }

    def _send_request(self, request: Request) -> int:
        with urlopen(request, timeout=self.timeout_seconds) as response:
            return response.status


class OpenTelemetryObservabilityProvider(ObservabilityProvider):
    """Optional adapter boundary around a caller-supplied OpenTelemetry exporter."""

    def __init__(
        self,
        environ: Mapping[str, str] | None = None,
        *,
        exporter: Callable[[Mapping[str, str | int | float | bool]], None] | None = None,
    ) -> None:
        self.local_fallback = LocalObservabilityProvider()
        self.environ = os.environ if environ is None else environ
        self.endpoint = self.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT", "").strip()
        self.exporter = exporter
        self.availability = (
            "not_configured"
            if not self.endpoint
            else ("configured_unverified" if exporter is not None else "unavailable")
        )
        self.last_delivery = ProviderDelivery(False, self.availability, "No telemetry has been exported.")

    @property
    def status(self) -> ProviderStatus:
        return ProviderStatus.READY if self.availability == "available" else ProviderStatus.NOT_CONFIGURED

    def publish_event(self, event: ObservabilityEvent) -> None:
        self.local_fallback.publish_event(event)
        if not self.endpoint:
            self.last_delivery = ProviderDelivery(
                False,
                "not_configured",
                "Set OTEL_EXPORTER_OTLP_ENDPOINT and supply an exporter to enable telemetry export.",
            )
            return
        if self.exporter is None:
            self.availability = "unavailable"
            self.last_delivery = ProviderDelivery(
                False, "unavailable", "No OpenTelemetry exporter is installed or configured."
            )
            return
        try:
            self.exporter(self._safe_telemetry(event))
        except (TimeoutError, OSError, RuntimeError) as error:
            self.availability = "unavailable"
            self.last_delivery = ProviderDelivery(
                False,
                "unavailable",
                f"OpenTelemetry export failed ({type(error).__name__}); local event processing continues.",
            )
            return
        self.availability = "available"
        self.last_delivery = ProviderDelivery(True, "available", "Telemetry exporter accepted the event.")

    @staticmethod
    def _safe_telemetry(event: ObservabilityEvent) -> dict[str, str | int | float | bool]:
        telemetry: dict[str, str | int | float | bool] = {
            "event_id": str(event.event_id),
            "event_type": event.event_type[:128],
            "severity": Severity(event.severity).value,
            "line_of_business": event.line_of_business[:64],
        }
        if event.dataset_id:
            telemetry["dataset_id"] = event.dataset_id[:256]
        if event.pipeline_id:
            telemetry["pipeline_id"] = event.pipeline_id[:256]
        for metric in event.metrics:
            if metric.name in _SAFE_METRIC_NAMES and isinstance(metric.value, (int, float, bool)):
                telemetry[metric.name] = metric.value
        return telemetry


class OpenSourceObservabilityProvider(OpenTelemetryObservabilityProvider):
    """Vendor-neutral optional adapter; custom local Python processing stays guaranteed."""


_SAFE_METRIC_NAMES = {
    "dataset.row_count",
    "dataset.null_rate",
    "dataset.duplicate_rate",
    "dataset.quality_score",
    "dataset.freshness_seconds",
    "pipeline.duration",
    "pipeline.records_in",
    "pipeline.records_out",
    "pipeline.records_failed",
    "pipeline.records_rejected",
}


__all__ = [
    "DynatraceObservabilityProvider",
    "LocalObservabilityProvider",
    "OpenSourceObservabilityProvider",
    "OpenTelemetryObservabilityProvider",
    "ProviderDelivery",
    "ObservabilityProvider",
]
