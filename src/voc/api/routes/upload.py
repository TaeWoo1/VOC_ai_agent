"""CSV file upload endpoint for entity-scoped source import."""

from __future__ import annotations

import csv
import io
import logging
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, UploadFile

from src.voc.api.dependencies import get_entity_repo, get_source_repo
from src.voc.persistence.repository import EntityRepository, SourceConnectionRepository

UPLOADS_DIR = Path(__file__).resolve().parents[4] / "uploads"

router = APIRouter(prefix="/v1/entities", tags=["upload"])
logger = logging.getLogger(__name__)


@router.post("/{entity_id}/upload")
async def upload_csv(
    entity_id: str,
    file: UploadFile,
    entity_repo: EntityRepository = Depends(get_entity_repo),
    source_repo: SourceConnectionRepository = Depends(get_source_repo),
):
    """Upload a CSV file of reviews for an entity.

    The CSV must have a 'text' column. Optional columns:
    rating, author, date, language, source_id.

    This endpoint saves the file and creates (or updates) a CSV source
    connection for this entity with the file path in config. During refresh,
    SyncService reads the file path from the source connection and passes
    it to the CSV connector explicitly.
    """
    entity = entity_repo.get(entity_id)
    if entity is None:
        raise HTTPException(status_code=404, detail=f"Entity '{entity_id}' not found")

    if not file.filename or not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="File must be a .csv file")

    content = await file.read()
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="File must be UTF-8 encoded")

    # Validate CSV has 'text' column
    reader = csv.DictReader(io.StringIO(text))
    fieldnames = reader.fieldnames or []
    if "text" not in fieldnames:
        raise HTTPException(status_code=400, detail="CSV must have a 'text' column")

    row_count = sum(1 for _ in reader)

    # Save file under entity_id directory
    entity_dir = UPLOADS_DIR / entity_id
    entity_dir.mkdir(parents=True, exist_ok=True)
    dest = entity_dir / file.filename
    dest.write_text(text, encoding="utf-8")

    # Create or update CSV source connection with explicit file path
    existing = source_repo.find_by_entity_and_type(entity_id, "csv")
    if existing:
        source_repo.update(existing["connection_id"], {
            "config": {"file_path": str(dest), "filename": file.filename, "row_count": row_count},
            "status": "active",
            "error_message": None,
        })
        connection_id = existing["connection_id"]
    else:
        connection_id = uuid4().hex[:12]
        source_repo.save({
            "connection_id": connection_id,
            "entity_id": entity_id,
            "connector_type": "csv",
            "source_type": "owned",
            "display_name": f"CSV 업로드 — {file.filename}",
            "status": "active",
            "config": {"file_path": str(dest), "filename": file.filename, "row_count": row_count},
            "capabilities": {
                "sync_mode": "manual",
                "data_format": "csv",
                "supports_incremental": False,
                "requires_upload": True,
                "requires_auth": False,
            },
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

    logger.info("CSV uploaded", extra={
        "entity_id": entity_id, "filename": file.filename,
        "rows": row_count, "connection_id": connection_id,
    })

    return {
        "entity_id": entity_id,
        "connection_id": connection_id,
        "filename": file.filename,
        "path": str(dest),
        "row_count": row_count,
        "columns": fieldnames,
    }
