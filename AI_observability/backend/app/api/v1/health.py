from fastapi import APIRouter, Request
from sqlalchemy.exc import SQLAlchemyError

from shared.contracts import HealthCheck, HealthResponse, HealthState

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
def get_health(request: Request) -> HealthResponse:
    providers = request.app.state.providers
    checks = [
        HealthCheck(
            name=name,
            status=HealthState.HEALTHY if provider.status.value == "ready" else HealthState.WAITING,
            details=provider.status.value,
        )
        for name, provider in providers.items()
    ]
    checks.append(HealthCheck(name="api", status=HealthState.HEALTHY, details="API is ready."))
    database_status = HealthState.HEALTHY
    database_details = "Metadata database is ready."
    try:
        with request.app.state.engine.connect() as connection:
            connection.exec_driver_sql("SELECT 1")
    except SQLAlchemyError:
        database_status = HealthState.CRITICAL
        database_details = "Metadata database is unavailable."
    checks.append(
        HealthCheck(name="metadata_database", status=database_status, details=database_details)
    )
    return HealthResponse(
        status=HealthState.HEALTHY if database_status == HealthState.HEALTHY else HealthState.CRITICAL,
        service_name=request.app.title,
        version=request.app.version,
        demo_mode=request.app.state.settings.demo_mode,
        providers={name: provider.status for name, provider in providers.items()},
        checks=checks,
        correlation_id=request.state.correlation_id,
    )
