"""Base connector protocol for all VOC data sources."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, runtime_checkable

from src.voc.schemas.raw import RawReview


@dataclass
class CollectParams:
    """Parameters for a collection request."""

    max_results: int = 100
    language_filter: str | None = None  # "ko", "en", or None for all


@runtime_checkable
class ChannelConnector(Protocol):
    """Protocol that all VOC channel connectors must implement."""

    @property
    def channel_name(self) -> str:
        """Unique identifier for this channel (e.g., 'mock', 'naver', 'csv')."""
        ...

    async def collect(
        self, keyword: str, params: CollectParams | None = None
    ) -> list[RawReview]:
        """Collect reviews matching the keyword from this channel.

        Args:
            keyword: Product/brand keyword (Korean or English).
            params: Optional collection parameters.

        Returns:
            List of raw, unprocessed reviews.
        """
        ...
