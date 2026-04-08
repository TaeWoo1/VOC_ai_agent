"""Indexer — upserts chunks into ChromaDB with metadata.

HYBRID: ChromaDB setup scaffolded. Metadata schema design for
upsert is SELF.
"""

from __future__ import annotations

import chromadb

from src.voc.config import get_settings


class ChunkIndexer:
    """Manages a ChromaDB collection for VOC evidence chunks."""

    def __init__(
        self,
        collection_name: str = "voc_chunks",
        persist_dir: str | None = None,
    ):
        settings = get_settings()
        persist = persist_dir or settings.chroma_persist_dir
        self.client = chromadb.PersistentClient(path=persist)
        self.collection = self.client.get_or_create_collection(
            name=collection_name,
            metadata={"hnsw:space": "cosine"},
        )

    def upsert_chunks(
        self,
        ids: list[str],
        embeddings: list[list[float]],
        documents: list[str],
        metadatas: list[dict],
    ) -> None:
        """Upsert chunks into ChromaDB.

        Args:
            ids: Chunk IDs.
            embeddings: Pre-computed embedding vectors.
            documents: Chunk text content.
            metadatas: Per-chunk metadata dicts.

        TODO: Finalize metadata schema — which fields to include for filtering
              (tenant_id, source_channel, product_keyword, language,
               rating_normalized, review_date)
        TODO: Decide on batch size for large upserts
        """
        self.collection.upsert(
            ids=ids,
            embeddings=embeddings,
            documents=documents,
            metadatas=metadatas,
        )

    def query(
        self,
        query_embedding: list[float],
        n_results: int = 10,
        where: dict | None = None,
    ) -> dict:
        """Query the collection by embedding similarity.

        Args:
            query_embedding: Query vector.
            n_results: Number of results to return.
            where: Optional ChromaDB metadata filter.

        Returns:
            ChromaDB query result dict.
        """
        return self.collection.query(
            query_embeddings=[query_embedding],
            n_results=n_results,
            where=where,
            include=["documents", "metadatas", "distances"],
        )
