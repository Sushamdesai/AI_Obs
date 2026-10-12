from backend.app.main import app

from fastapi.testclient import TestClient


def test_health_endpoint_reports_api_and_local_providers() -> None:
    with TestClient(app) as client:
        response = client.get("/api/v1/health", headers={"X-Correlation-ID": "test-run-7"})
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "healthy"
    assert body["demo_mode"] is True
    assert body["providers"] == {
        "data_platform": "ready",
        "observability": "ready",
        "llm": "ready",
    }
    assert body["correlation_id"] == "test-run-7"
    assert response.headers["X-Correlation-ID"] == "test-run-7"


def test_fixture_endpoints_serve_shared_contracts() -> None:
    with TestClient(app) as client:
        datasets = client.get("/api/v1/dev/datasets")
        lineage = client.get("/api/v1/dev/lineage")
        events = client.get("/api/v1/dev/events")
    assert datasets.status_code == lineage.status_code == events.status_code == 200
    assert datasets.json()[0]["dataset_id"] == "bronze.claims"
    assert lineage.json()["line_of_business"] == "motor"
    assert len(lineage.json()["nodes"]) > 0
    assert len(events.json()) == 6


def test_unknown_fixture_event_has_standard_error_envelope() -> None:
    with TestClient(app) as client:
        response = client.get("/api/v1/dev/events/not_a_fixture")
    assert response.status_code == 404
    assert response.json()["code"] == "http_404"
    assert response.json()["correlation_id"] == response.headers["X-Correlation-ID"]
