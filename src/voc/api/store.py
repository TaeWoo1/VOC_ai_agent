"""In-memory run store. Swappable to database later."""

from __future__ import annotations

from datetime import datetime, timezone


class RunStore:
    """Stores pipeline run records in memory."""

    def __init__(self):
        self._runs: dict[str, dict] = {}

    def save(self, run_id: str, record: dict) -> None:
        record["created_at"] = datetime.now(timezone.utc).isoformat()
        self._runs[run_id] = record

    def get(self, run_id: str) -> dict | None:
        return self._runs.get(run_id)

    def list_all(self) -> list[dict]:
        return list(self._runs.values())
