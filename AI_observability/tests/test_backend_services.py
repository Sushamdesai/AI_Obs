from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import text

from backend.app.config import Settings
from backend.app.main import create_app
from backend.app.services.lineage import LineageService
from backend.app.providers.fixtures import MOTOR_LINEAGE
from backend.app.providers.fixtures import EVENT_FIXTURES_BY_TYPE
from shared.contracts import LineageEdge, LineageGraph, LineageNode


def make_client(tmp_path: Path) -> TestClient:
    config = Settings(
        database_url=f"sqlite:///{(tmp_path / 'metadata.sqlite3').as_posix()}",
        local_data_path=":memory:",
    )
    return TestClient(create_app(config))


def test_lineage_graph_traversal_paths_and_blast_radius() -> None:
    service = LineageService(MOTOR_LINEAGE)

    upstream = service.get_upstream("ai.fraud_risk_scoring")
    assert {node.node_id for node in upstream} >= {
        "gold.feature_store",
        "silver.claims",
        "silver.policies",
        "feature.risk_features",
        "feature.driving_features",
    }
    downstream = service.calculate_blast_radius("silver.claims")
    assert {node.node_id for node in downstream} >= {
        "gold.claims_analytics",
        "gold.customer_360",
        "gold.feature_store",
        "ai.fraud_risk_scoring",
    }
    paths = service.get_paths("silver.claims", "ai.fraud_risk_scoring")
    assert paths
    assert all(path[0] == "silver.claims" and path[-1] == "ai.fraud_risk_scoring" for path in paths)
    anchor_graph = service.get_lineage_graph("gold.customer_360")
    assert "silver.customers" in {node.node_id for node in anchor_graph.nodes}


def test_lineage_operations_handle_cycles_and_reject_dangling_edges() -> None:
    graph = LineageGraph(
        nodes=[
            LineageNode(node_id=node_id, node_type="dataset", label=node_id)
            for node_id in ("a", "b", "c")
        ],
        edges=[
            LineageEdge(source_node_id="a", target_node_id="b", relationship="depends"),
            LineageEdge(source_node_id="b", target_node_id="c", relationship="depends"),
            LineageEdge(source_node_id="c", target_node_id="a", relationship="cycle"),
        ],
        generated_at=datetime.now(UTC),
    )
    service = LineageService(graph)
    assert {node.node_id for node in service.get_downstream("a")} == {"b", "c"}
    assert service.get_paths("a", "c") == [["a", "b", "c"]]
    assert service.calculate_blast_radius("a")

    invalid = graph.model_copy(
        update={
            "edges": [
                LineageEdge(source_node_id="a", target_node_id="missing", relationship="bad")
            ]
        }
    )
    try:
        LineageService(invalid)
    except ValueError as error:
        assert "missing endpoint" in str(error)
    else:
        raise AssertionError("Expected malformed graph to be rejected.")


def test_api_starts_migrations_seeds_contracts_and_exposes_lineage_and_explorer(tmp_path: Path) -> None:
    with make_client(tmp_path) as client:
        health = client.get("/api/v1/health")
        assert health.status_code == 200
        assert client.get("/api/v1/sources").json()[0]["source_id"] == "bureau"
        assert client.get("/api/v1/datasets").status_code == 200

        detail = client.get("/api/v1/datasets/silver.claims")
        assert detail.status_code == 200
        assert detail.json()["dataset"]["layer"] == "silver"
        assert detail.json()["platform"] == "ready"

        anchor = client.get("/api/v1/lineage", params={"anchor": "gold.customer_360"})
        assert anchor.status_code == 200
        assert "silver.customers" in {node["node_id"] for node in anchor.json()["nodes"]}

        upstream = client.get("/api/v1/lineage/upstream/ai.fraud_risk_scoring")
        assert upstream.status_code == 200
        assert "gold.feature_store" in {node["node_id"] for node in upstream.json()}

        paths = client.get(
            "/api/v1/lineage/paths",
            params={"source": "silver.claims", "target": "ai.fraud_risk_scoring"},
        )
        assert paths.status_code == 200 and paths.json()
        assert client.get("/api/v1/lineage/downstream/not-real").status_code == 404
        assert client.get("/api/v1/lineage/paths", params={"source": "bad", "target": "also-bad"}).status_code == 404

        engine = client.app.state.engine
        with engine.connect() as connection:
            assert connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == "0001_initial_metadata"


def test_simulator_cycle_persists_runs_events_and_safe_preview(tmp_path: Path) -> None:
    with make_client(tmp_path) as client:
        result = client.post(
            "/api/v1/simulator/cycles",
            json={"cycles": 1, "batch_size": 4, "seed": 21},
        )
        assert result.status_code == 200
        assert result.json()["event_count"] > 0
        assert client.get("/api/v1/pipelines/runs").json()
        events = client.get("/api/v1/events", params={"limit": 100})
        assert events.status_code == 200

        preview = client.get("/api/v1/datasets/bronze.claims/preview", params={"limit": 3})
        assert preview.status_code == 200
        assert preview.json()["returned_count"] == 3
        assert preview.json()["row_count"] == 4
        assert preview.json()["truncated"] is True
        assert all("customer_name" not in record for record in preview.json()["records"])
        assert client.get("/api/v1/datasets/not-a-dataset").status_code == 404
        assert client.get("/api/v1/datasets/bronze.claims/preview", params={"limit": 101}).status_code == 422


def test_incident_lifecycle_and_agent_persistence(tmp_path: Path) -> None:
    with make_client(tmp_path) as client:
        incidents = client.get("/api/v1/incidents").json()
        assert incidents
        incident_id = incidents[0]["incident_id"]

        acknowledged = client.patch(
            f"/api/v1/incidents/{incident_id}",
            json={"status": "acknowledged", "message": "Reviewed by test operator."},
        )
        assert acknowledged.status_code == 200
        assert acknowledged.json()["status"] == "acknowledged"
        assert any(item["event_type"] == "status_acknowledged" for item in acknowledged.json()["timeline"])

        invalid_transition = client.patch(
            f"/api/v1/incidents/{incident_id}",
            json={"status": "closed"},
        )
        assert invalid_transition.status_code == 409
        assert client.get(f"/api/v1/incidents/{incident_id}/events").json()
        assert client.get(f"/api/v1/incidents/{incident_id}/rca").status_code == 200
        assert client.get("/api/v1/agents/findings").json()
        assert client.get("/api/v1/incidents/missing").status_code == 404

        finding = {
            "finding_id": f"test:{uuid4()}",
            "agent_name": "test-agent",
            "summary": "Finding backed by fixture evidence.",
            "evidence_event_ids": [],
            "created_at": datetime.now(UTC).isoformat(),
        }
        stored = client.post("/api/v1/agents/findings", json=finding)
        assert stored.status_code == 201
        assert stored.json()["finding_id"] == finding["finding_id"]
        assert client.post("/api/v1/agents/findings", json=finding).status_code == 409


def test_incident_validation_prevents_partial_evidence_persistence(tmp_path: Path) -> None:
    with make_client(tmp_path) as client:
        incident = client.get("/api/v1/incidents").json()[0]
        incident["incident_id"] = f"test:{uuid4()}"
        event = EVENT_FIXTURES_BY_TYPE["quality_failure"].model_dump(mode="json")
        event["event_id"] = str(uuid4())
        incident["evidence"] = [event]
        incident["timeline"] = [
            {
                "timeline_event_id": f"test:{uuid4()}",
                "incident_id": "different-incident",
                "occurred_at": datetime.now(UTC).isoformat(),
                "event_type": "opened",
                "message": "Invalid timeline reference.",
            }
        ]

        response = client.post("/api/v1/incidents", json=incident)

        assert response.status_code == 422
        assert client.app.state.repository.get("event", event["event_id"]) is None
        assert client.app.state.repository.get("incident", incident["incident_id"]) is None


def test_event_ingestion_validates_references_persists_metrics_and_sanitizes_validation_errors(tmp_path: Path) -> None:
    with make_client(tmp_path) as client:
        event = EVENT_FIXTURES_BY_TYPE["quality_failure"].model_dump(mode="json")
        accepted = client.post("/api/v1/events", json=event)
        assert accepted.status_code == 202
        metric_rows = client.app.state.repository.list("data_metric")
        assert any(row["event_id"] == event["event_id"] for row in metric_rows)

        unknown_dataset = {**event, "event_id": str(uuid4()), "dataset_id": "private.invalid"}
        assert client.post("/api/v1/events", json=unknown_dataset).status_code == 404

        invalid_metric = {
            **event,
            "event_id": str(uuid4()),
            "metrics": [{"name": "dataset.quality_score", "value": "not-a-number"}],
        }
        invalid_response = client.post("/api/v1/events", json=invalid_metric)
        assert invalid_response.status_code == 422
        assert "not-a-number" not in invalid_response.text


def test_quality_sla_remediation_and_input_validation(tmp_path: Path) -> None:
    with make_client(tmp_path) as client:
        assert client.get("/api/v1/quality", params={"dataset_id": "silver.claims"}).status_code == 200
        assert client.get("/api/v1/sla").status_code == 200
        assert client.get("/api/v1/remediation").status_code == 200

        incident_id = client.get("/api/v1/incidents").json()[0]["incident_id"]
        plan = {
            "plan_id": f"plan-{uuid4()}",
            "incident_id": incident_id,
            "recommendation": "Re-run the synthetic validation batch.",
            "requires_human_approval": True,
            "approved": None,
            "mode": "simulate",
            "created_at": datetime.now(UTC).isoformat(),
        }
        created = client.post("/api/v1/remediation", json=plan)
        assert created.status_code == 201
        assert created.json()["requires_human_approval"] is True
        assert client.get(f"/api/v1/remediation/{plan['plan_id']}").status_code == 200
        assert client.post("/api/v1/remediation", json=plan).status_code == 409
        verification = {
            "plan_id": plan["plan_id"],
            "verified": True,
            "verified_at": datetime.now(UTC).isoformat(),
        }
        assert client.post(
            f"/api/v1/remediation/{plan['plan_id']}/verification", json=verification
        ).status_code == 409
        approved = client.patch(
            f"/api/v1/remediation/{plan['plan_id']}/approval",
            json={"approved": True},
        )
        assert approved.status_code == 200 and approved.json()["approved"] is True
        assert client.post(
            f"/api/v1/remediation/{plan['plan_id']}/verification", json=verification
        ).status_code == 201
        assert len(client.get(f"/api/v1/remediation/{plan['plan_id']}/verification").json()) == 1

        invalid = client.post(
            "/api/v1/remediation",
            json={**plan, "plan_id": f"plan-{uuid4()}", "approved": True},
        )
        assert invalid.status_code == 422
        assert client.post("/api/v1/simulator/cycles", json={"cycles": 100}).status_code == 422
