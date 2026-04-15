"""Source connection management endpoints."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException

from src.voc.api.dependencies import get_entity_repo, get_source_repo
from src.voc.api.schemas import SourceConnectionCreate, SourceConnectionResponse
from src.voc.persistence.repository import EntityRepository, SourceConnectionRepository

router = APIRouter(prefix="/v1/entities", tags=["sources"])
logger = logging.getLogger(__name__)


@router.post(
    "/{entity_id}/sources",
    response_model=SourceConnectionResponse,
    status_code=201,
)
async def create_source_connection(
    entity_id: str,
    request: SourceConnectionCreate,
    entity_repo: EntityRepository = Depends(get_entity_repo),
    source_repo: SourceConnectionRepository = Depends(get_source_repo),
):
    """Add a source connection to an entity."""
    if entity_repo.get(entity_id) is None:
        raise HTTPException(status_code=404, detail=f"Entity '{entity_id}' not found")

    connection_id = uuid4().hex[:12]
    record = {
        "connection_id": connection_id,
        "entity_id": entity_id,
        "connector_type": request.connector_type,
        "source_type": request.source_type,
        "display_name": request.display_name,
        "status": "active",
        "config": request.config,
        "capabilities": request.capabilities,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    source_repo.save(record)
    logger.info("Source connection created", extra={
        "entity_id": entity_id, "connection_id": connection_id,
        "connector_type": request.connector_type,
    })
    return source_repo.get(connection_id)


@router.get(
    "/{entity_id}/sources",
    response_model=list[SourceConnectionResponse],
)
async def list_source_connections(
    entity_id: str,
    status: str | None = None,
    entity_repo: EntityRepository = Depends(get_entity_repo),
    source_repo: SourceConnectionRepository = Depends(get_source_repo),
):
    """List source connections for an entity."""
    if entity_repo.get(entity_id) is None:
        raise HTTPException(status_code=404, detail=f"Entity '{entity_id}' not found")
    return source_repo.list_by_entity(entity_id, status=status)


@router.get(
    "/{entity_id}/sources/{connection_id}",
    response_model=SourceConnectionResponse,
)
async def get_source_connection(
    entity_id: str,
    connection_id: str,
    source_repo: SourceConnectionRepository = Depends(get_source_repo),
):
    """Get a specific source connection."""
    conn = source_repo.get(connection_id)
    if conn is None or conn["entity_id"] != entity_id:
        raise HTTPException(status_code=404, detail=f"Source connection '{connection_id}' not found")
    return conn


@router.delete("/{entity_id}/sources/{connection_id}", status_code=204)
async def delete_source_connection(
    entity_id: str,
    connection_id: str,
    source_repo: SourceConnectionRepository = Depends(get_source_repo),
):
    """Remove a source connection."""
    conn = source_repo.get(connection_id)
    if conn is None or conn["entity_id"] != entity_id:
        raise HTTPException(status_code=404, detail=f"Source connection '{connection_id}' not found")
    source_repo.delete(connection_id)
