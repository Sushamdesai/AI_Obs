from __future__ import annotations

import logging
import os
import re
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from backend.app.api.v1.agents import router as agents_router
from backend.app.api.v1.datasets import router as datasets_router
from backend.app.api.v1.development import router as development_router
from backend.app.api.v1.events import router as events_router
from backend.app.api.v1.health import router as health_router
from backend.app.api.v1.incidents import router as incidents_router
from backend.app.api.v1.lineage import router as lineage_router
from backend.app.api.v1.pipelines import router as pipelines_router
from backend.app.api.v1.quality import router as quality_router
from backend.app.api.v1.remediation import router as remediation_router
from backend.app.api.v1.simulator import router as simulator_router
from backend.app.api.v1.sla import router as sla_router
from backend.app.api.v1.sources import router as sources_router
from backend.app.config import Settings, settings as default_settings
from backend.app.logging_config import configure_logging
from backend.app.persistence.repository import (
    create_database_engine,
    initialize_schema,
    resolve_database_url,
)
from backend.app.providers.factory import (
    build_data_platform_provider,
    build_llm_provider,
    build_observability_provider,
)
from backend.app.services.catalog import seed_catalog
from backend.app.services.lineage import LineageService
from shared.contracts import APIError, LineageEdge, LineageGraph, LineageNode

logger = logging.getLogger(__name__)


def create_app(config: Settings = default_settings) -> FastAPI:
    configure_logging(config.log_level)

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        database_url = resolve_database_url(config.database_url)
        engine = create_database_engine(database_url)
        repository = initialize_schema(engine, database_url)
        seed_catalog(repository)
        application.state.database_url = database_url
        application.state.engine = engine
        application.state.repository = repository
        graph = LineageGraph(
            nodes=[LineageNode.model_validate(item) for item in repository.list("lineage_node")],
            edges=[LineageEdge.model_validate(item) for item in repository.list("lineage_edge")],
            generated_at=datetime.now(UTC),
        )
        application.state.lineage_service = LineageService(graph)
        application.state.last_simulation_summaries = []
        try:
            yield
        finally:
            for provider in application.state.providers.values():
                close = getattr(provider, "close", None)
                if callable(close):
                    close()
            engine.dispose()

    application = FastAPI(
        title=config.app_name,
        version="0.1.0",
        description="Local-first APIs for synthetic insurance data observability.",
        lifespan=lifespan,
    )
    application.state.settings = config
    application.state.providers = {
        "data_platform": build_data_platform_provider(config),
        "observability": build_observability_provider(config),
        "llm": build_llm_provider(config),
    }
    origins = [
        origin.strip()
        for origin in os.environ.get(
            "FRONTEND_ORIGINS", "http://localhost:3000,http://localhost:5173"
        ).split(",")
        if origin.strip()
    ]
    application.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Correlation-ID"],
    )

    @application.middleware("http")
    async def correlation_id_middleware(request: Request, call_next):
        requested_id = request.headers.get("x-correlation-id", "").strip()
        correlation_id = (
            requested_id
            if len(requested_id) <= 128 and re.fullmatch(r"[A-Za-z0-9._:-]+", requested_id)
            else str(uuid4())
        )
        request.state.correlation_id = correlation_id
        response = await call_next(request)
        response.headers["X-Correlation-ID"] = correlation_id
        return response

    @application.exception_handler(StarletteHTTPException)
    async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        body = APIError(
            code=f"http_{exc.status_code}",
            message=str(exc.detail),
            correlation_id=getattr(request.state, "correlation_id", None),
        )
        return JSONResponse(status_code=exc.status_code, content=jsonable_encoder(body))

    @application.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
        body = APIError(
            code="validation_error",
            message="Request validation failed.",
            details=[
                {
                    key: value
                    for key, value in error.items()
                    if key not in {"input", "ctx"}
                }
                for error in exc.errors()
            ],
            correlation_id=getattr(request.state, "correlation_id", None),
        )
        return JSONResponse(status_code=422, content=jsonable_encoder(body))

    @application.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        correlation_id = getattr(request.state, "correlation_id", None)
        logger.exception("Unhandled request exception", extra={"correlation_id": correlation_id})
        body = APIError(
            code="internal_error",
            message="An unexpected error occurred.",
            correlation_id=correlation_id,
        )
        return JSONResponse(status_code=500, content=jsonable_encoder(body))

    @application.get("/")
    def read_root() -> dict[str, str]:
        return {"service": config.app_name, "status": "booted"}

    for route in (
        health_router,
        development_router,
        sources_router,
        datasets_router,
        pipelines_router,
        lineage_router,
        quality_router,
        events_router,
        incidents_router,
        agents_router,
        sla_router,
        remediation_router,
        simulator_router,
    ):
        application.include_router(route, prefix="/api/v1")
    return application


app = create_app()
