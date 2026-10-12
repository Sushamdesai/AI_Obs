from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime
from pathlib import Path
from typing import Any


class LocalDatasetStore:
    """Small SQLite-backed bronze/silver/gold record store for local development."""

    def __init__(self, database_path: str = ":memory:") -> None:
        if database_path != ":memory:":
            expanded_path = Path(database_path).expanduser()
            expanded_path.parent.mkdir(parents=True, exist_ok=True)
            database_path = str(expanded_path)
        self.connection = sqlite3.connect(database_path, check_same_thread=False)
        self.connection.row_factory = sqlite3.Row
        self._lock = threading.RLock()
        with self.connection:
            self.connection.execute(
                """
                CREATE TABLE IF NOT EXISTS dataset_records (
                    dataset_id TEXT NOT NULL,
                    batch_id TEXT NOT NULL,
                    record_id TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    stored_at TEXT NOT NULL,
                    PRIMARY KEY (dataset_id, batch_id, record_id)
                )
                """
            )
            self.connection.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_dataset_records_latest
                ON dataset_records(dataset_id, stored_at)
                """
            )

    def append_records(
        self,
        dataset_id: str,
        records: list[dict[str, Any]],
        batch_id: str,
        stored_at: datetime,
    ) -> None:
        rows = [
            (
                dataset_id,
                batch_id,
                str(record.get("_record_id") or record.get("product_record_id") or record.get("feature_record_id")),
                json.dumps(record, sort_keys=True, separators=(",", ":")),
                stored_at.isoformat(),
            )
            for record in records
        ]
        if any(row[2] == "None" for row in rows):
            raise ValueError("Every stored record must have a stable synthetic record ID.")
        with self._lock, self.connection:
            self.connection.executemany(
                """
                INSERT OR REPLACE INTO dataset_records
                    (dataset_id, batch_id, record_id, payload_json, stored_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                rows,
            )

    def get_records(
        self,
        dataset_id: str,
        *,
        limit: int = 1000,
        latest_batch_only: bool = False,
    ) -> list[dict[str, Any]]:
        if limit < 1:
            raise ValueError("limit must be at least 1.")
        with self._lock:
            if latest_batch_only:
                rows = self.connection.execute(
                    """
                    SELECT payload_json FROM dataset_records
                    WHERE dataset_id = ?
                      AND batch_id = (
                          SELECT batch_id FROM dataset_records
                          WHERE dataset_id = ?
                          ORDER BY stored_at DESC, batch_id DESC LIMIT 1
                      )
                    ORDER BY record_id
                    LIMIT ?
                    """,
                    (dataset_id, dataset_id, limit),
                ).fetchall()
            else:
                rows = self.connection.execute(
                    """
                    SELECT payload_json FROM dataset_records
                    WHERE dataset_id = ?
                    ORDER BY stored_at DESC, batch_id DESC, record_id
                    LIMIT ?
                    """,
                    (dataset_id, limit),
                ).fetchall()
        return [json.loads(row["payload_json"]) for row in rows]

    def count_records(self, dataset_id: str, *, latest_batch_only: bool = False) -> int:
        if latest_batch_only:
            result = self.connection.execute(
                """
                SELECT COUNT(*) AS count FROM dataset_records
                WHERE dataset_id = ?
                  AND batch_id = (
                      SELECT batch_id FROM dataset_records
                      WHERE dataset_id = ?
                      ORDER BY stored_at DESC, batch_id DESC LIMIT 1
                  )
                """,
                (dataset_id, dataset_id),
            ).fetchone()
        else:
            result = self.connection.execute(
                "SELECT COUNT(*) AS count FROM dataset_records WHERE dataset_id = ?",
                (dataset_id,),
            ).fetchone()
        return int(result["count"])

    def close(self) -> None:
        with self._lock:
            self.connection.close()
