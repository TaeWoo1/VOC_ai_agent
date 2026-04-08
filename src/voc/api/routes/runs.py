"""Run tracking endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from src.voc.api.dependencies import get_run_store
from src.voc.api.store import RunStore

router = APIRouter(prefix="/v1/runs", tags=["runs"])


@router.get("/{run_id}")
async def get_run(run_id: str, store: RunStore = Depends(get_run_store)):
    """Retrieve a stored run by ID. Returns the raw stored record (ingest or query)."""
    record = store.get(run_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"Run not found: {run_id}")
    return record
