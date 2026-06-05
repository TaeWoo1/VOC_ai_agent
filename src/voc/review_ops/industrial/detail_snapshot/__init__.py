"""Coupang detail-page snapshot feasibility spike (S2x.1, capture-only).

A read-only, single-URL feasibility spike: given exactly one operator-provided
Coupang product detail URL, capture a local snapshot artifact (page text, image
manifest, screenshot) so we can judge whether product guidance is extractable
*before* committing to a ProductKnowledge schema.

This is intentionally NOT a scraper: no bulk/category/search crawling, no login
or anti-bot bypass, no retries-to-evade, no scheduling, no OCR/multimodal, and
no integration with the review report, Notion export, store, or Streamlit. The
network/browser work is isolated in :mod:`capture` behind a lazy Playwright
import; :mod:`parse` is pure and offline-testable.
"""

from __future__ import annotations

from src.voc.review_ops.industrial.detail_snapshot.ingest_local import (
    ingest_local_images,
)
from src.voc.review_ops.industrial.detail_snapshot.multimodal_extract import (
    extract_guidance,
)
from src.voc.review_ops.industrial.detail_snapshot.parse import (
    extract_from_html,
    is_valid_coupang_product_url,
    validate_coupang_product_url,
)
from src.voc.review_ops.industrial.detail_snapshot.tiling import (
    compute_tile_bounds,
    make_tiles,
)

__all__ = [
    "compute_tile_bounds",
    "extract_from_html",
    "extract_guidance",
    "ingest_local_images",
    "is_valid_coupang_product_url",
    "make_tiles",
    "validate_coupang_product_url",
]
