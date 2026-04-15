"""Entity schema — the monitoring target (product, store, or business).

SELF: Schema design and field semantics are hand-authored.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class Entity(BaseModel):
    """A monitoring target that the operator watches over time.

    product_keywords is an internal ingestion/retrieval bridge — the search
    terms used to collect and scope reviews for this entity.
    """

    entity_id: str
    entity_type: Literal["product", "store", "business"] = "product"
    tenant_id: str = "default"
    display_name: str
    description: str = ""
    product_keywords: list[str] = Field(min_length=1)
    connector: str = "mock"
    created_at: datetime
    last_refreshed_at: datetime | None = None
    refresh_count: int = 0
    metadata: dict[str, Any] = Field(default_factory=dict)
