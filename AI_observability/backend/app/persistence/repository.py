from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.persistence.models import RECORD_MODELS, Base


def resolve_database_url(database_url: str | None) -> str:
    if database_url:
        return database_url
    path = Path(".local") / "metadata.sqlite3"
    path.parent.mkdir(parents=True, exist_ok=True)
    return f"sqlite:///{path.resolve().as_posix()}"


def create_database_engine(database_url: str) -> Engine:
    options: dict[str, Any] = {}
    if database_url.startswith("sqlite:"):
        options["connect_args"] = {"check_same_thread": False}
        if database_url.endswith(":memory:"):
            options["poolclass"] = StaticPool
    return create_engine(database_url, future=True, **options)


def run_migrations(database_url: str) -> None:
    config_path = Path(__file__).resolve().parents[3] / "alembic.ini"
    config = Config(str(config_path))
    config.set_main_option("sqlalchemy.url", database_url.replace("%", "%%"))
    config.attributes["database_url"] = database_url
    command.upgrade(config, "head")


class MetadataRepository:
    """Typed-entity repository; business rows remain in the data-platform provider."""

    def __init__(self, engine: Engine):
        self.engine = engine
        self.sessions = sessionmaker(bind=engine, expire_on_commit=False, class_=Session)

    def upsert(self, kind: str, record_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        model = self._model(kind)
        with self.sessions.begin() as session:
            record = session.get(model, record_id)
            if record is None:
                record = model(record_id=record_id, payload=payload, updated_at=datetime.now(UTC))
                session.add(record)
            else:
                record.payload = payload
                record.updated_at = datetime.now(UTC)
        return payload

    def get(self, kind: str, record_id: str) -> dict[str, Any] | None:
        model = self._model(kind)
        with self.sessions() as session:
            record = session.get(model, record_id)
            return dict(record.payload) if record else None

    def list(self, kind: str, *, limit: int = 100, offset: int = 0) -> list[dict[str, Any]]:
        model = self._model(kind)
        with self.sessions() as session:
            records = session.scalars(
                select(model).order_by(model.record_id).offset(offset).limit(limit)
            )
            return [dict(record.payload) for record in records]

    def delete(self, kind: str, record_id: str) -> bool:
        model = self._model(kind)
        with self.sessions.begin() as session:
            record = session.get(model, record_id)
            if record is None:
                return False
            session.delete(record)
            return True

    @staticmethod
    def _model(kind: str):
        try:
            return RECORD_MODELS[kind]
        except KeyError as error:
            raise ValueError(f"Unsupported metadata record type: {kind}") from error


def initialize_schema(engine: Engine, database_url: str) -> MetadataRepository:
    run_migrations(database_url)
    return MetadataRepository(engine)
