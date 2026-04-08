"""Embedder — thin wrapper around OpenAI embeddings API.

Supports multilingual input (Korean + English) via text-embedding-3-small.
"""

from __future__ import annotations

from openai import OpenAI

from src.voc.config import get_settings


class Embedder:
    """Embeds text chunks using OpenAI's embedding API."""

    def __init__(self, client: OpenAI | None = None, model: str | None = None):
        settings = get_settings()
        self.client = client or OpenAI(api_key=settings.openai_api_key)
        self.model = model or settings.openai_embedding_model

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        """Embed a batch of texts.

        Args:
            texts: List of text strings (Korean or English).

        Returns:
            List of embedding vectors.
        """
        if not texts:
            return []

        response = self.client.embeddings.create(input=texts, model=self.model)
        return [item.embedding for item in response.data]

    def embed_single(self, text: str) -> list[float]:
        """Embed a single text string."""
        return self.embed_texts([text])[0]
