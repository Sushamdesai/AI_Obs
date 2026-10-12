from fastapi import APIRouter, HTTPException, Request

from backend.app.api.v1.schemas import SimulatorCycleRequest, SimulatorCycleResponse
from backend.app.services.catalog import model_payload
from backend.app.services.event_ingestion import EventIngestionService
from simulator import FailureScenario, SimulationOrchestrator

router = APIRouter(prefix="/simulator", tags=["simulator"])


@router.get("")
def get_simulator_status(request: Request) -> dict:
    return {
        "enabled": request.app.state.settings.demo_mode,
        "last_cycles": request.app.state.last_simulation_summaries,
    }


@router.post("/cycles", response_model=SimulatorCycleResponse)
def run_simulation_cycles(body: SimulatorCycleRequest, request: Request) -> SimulatorCycleResponse:
    if not request.app.state.settings.demo_mode:
        raise HTTPException(status_code=409, detail="Simulator controls are available only in demo mode.")
    if len(set(body.failure_scenarios)) != len(body.failure_scenarios):
        raise HTTPException(status_code=422, detail="failure_scenarios must not contain duplicates.")
    try:
        scenarios = [FailureScenario(value) for value in body.failure_scenarios]
    except ValueError as error:
        raise HTTPException(status_code=422, detail=f"Unknown failure scenario: {error}") from error

    provider = request.app.state.providers["data_platform"]
    batch_size = body.batch_size or request.app.state.settings.simulator_batch_size
    orchestrator = SimulationOrchestrator(
        seed=body.seed,
        batch_size=batch_size,
        interval_seconds=request.app.state.settings.simulator_interval_seconds,
        provider=provider,
        pipeline_delay_seconds=0,
    )
    for scenario in scenarios:
        orchestrator.inject_failure(scenario, cycles=body.cycles)

    service = EventIngestionService(
        request.app.state.repository,
        provider,
        request.app.state.providers["observability"],
    )
    summaries = []
    event_count = 0
    for _ in range(body.cycles):
        cycle = orchestrator.run_cycle()
        for run in cycle.pipeline_runs:
            payload = model_payload(run)
            request.app.state.repository.upsert("pipeline_run", run.run_id, payload)
        service.ingest(cycle.events)
        summaries.append(cycle.summary())
        event_count += len(cycle.events)
    request.app.state.last_simulation_summaries = summaries
    return SimulatorCycleResponse(cycles=summaries, event_count=event_count)
