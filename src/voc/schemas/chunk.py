"""Chunk schema — embedding-ready unit for vector indexing.

HYBRID: Structure scaffolded. Chunking parameters and language-aware
token targets are SELF.
"""

from __future__ import annotations

from datetime import date

from pydantic import BaseModel


class Chunk(BaseModel):
    """Embedding-ready chunk. May combine adjacent evidence units if short.

    TODO: Define language-aware token target params (Korean text is denser)
    TODO: Decide chunk_id generation strategy (hash of evidence_ids)
    TODO: Define to_chroma_metadata() for ChromaDB upsert
    """

    chunk_id: str  # sha256(sorted(evidence_ids))[:16]
    review_id: str  # Parent review — all evidence units in a chunk share the same parent
    evidence_ids: list[str]  # Ordered by unit_index
    text: str  # Evidence unit texts joined with single space
    language: str  # Primary language of chunk content ("ko" or "en")
    tenant_id: str
    source_channel: str
    product_keyword: str
    rating_normalized: float | None = None
    review_date: date | None = None
