"""Retriever — query ChromaDB with configurable strategy.

Embeds the query internally. Converts ChromaDB distances to similarity
scores (higher = better) at this boundary. Returns results best-first.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from src.voc.processing.embedder import Embedder
from src.voc.processing.indexer import ChunkIndexer


@dataclass
class RetrievedChunk:
    """Lightweight retrieval result. Adds score and rank to chunk data."""

    chunk_id: str
    review_id: str
    text: str
    evidence_ids: list[str]
    score: float  # Similarity: 1.0 = identical, 0.0 = opposite
    rank: int  # 1-based, best-first
    language: str
    source_channel: str
    product_keyword: str
    rating_normalized: float | None
    review_date: date | None


def retrieve(
    query: str,
    embedder: Embedder,
    indexer: ChunkIndexer,
    top_k: int = 10,
    strategy: str = "naive",
    filters: dict | None = None,
) -> list[RetrievedChunk]:
    """Retrieve relevant chunks for a query.

    Returns list of RetrievedChunk sorted best-first, empty list if no results.
    Raises ValueError for unknown strategy.
    """
    if strategy == "naive":
        return _naive_retrieve(query, embedder, indexer, top_k, filters)
    elif strategy == "filtered_reranked":
        # TODO: implement for Experiment 1
        raise NotImplementedError("filtered_reranked strategy not yet implemented")
    else:
        raise ValueError(f"Unknown retrieval strategy: {strategy}")


def _naive_retrieve(
    query: str,
    embedder: Embedder,
    indexer: ChunkIndexer,
    top_k: int,
    filters: dict | None,
) -> list[RetrievedChunk]:
    """Embed query, search ChromaDB top-K, return ranked results."""
    query_vector = embedder.embed_single(query)

    raw = indexer.query(
        query_embedding=query_vector,
        n_results=top_k,
        where=filters if filters else None,
    )

    # ChromaDB returns lists nested under a single query
    ids = raw.get("ids", [[]])[0]
    documents = raw.get("documents", [[]])[0]
    metadatas = raw.get("metadatas", [[]])[0]
    distances = raw.get("distances", [[]])[0]

    results = []
    for i, (chunk_id, text, meta, dist) in enumerate(
        zip(ids, documents, metadatas, distances)
    ):
        results.append(RetrievedChunk(
            chunk_id=chunk_id,
            review_id=meta.get("review_id", ""),
            text=text,
            evidence_ids=meta.get("evidence_ids", "").split(",") if meta.get("evidence_ids") else [],
            score=_distance_to_similarity(dist),
            rank=i + 1,
            language=meta.get("language", "unknown"),
            source_channel=meta.get("source_channel", ""),
            product_keyword=meta.get("product_keyword", ""),
            rating_normalized=meta.get("rating_normalized"),
            review_date=None,  # ChromaDB stores strings; skip date parsing for now
        ))

    return results


def _distance_to_similarity(distance: float) -> float:
    """ChromaDB cosine distance → similarity. Higher = better."""
    return 1.0 - distance / 2.0
