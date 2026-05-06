"""Pipeline-start product metadata collection.

The product image is part of the **product identity** — captured at run
start alongside the product name and URL, NOT at render time. This
module is the source-dispatched entry point that:

  1. Detects the source (oliveyoung / coupang / unknown) from the URL.
  2. Extracts the source-specific identifier (OY: goodsNo, Coupang:
     productId or vendor item id).
  3. Collects a representative product image URL via a per-source
     adapter (OY: detail-page og:image / JSON-LD; Coupang: CSV
     column mapping when caller supplies the rows).
  4. Caches the image to `<run>/assets/` via `fetch_and_cache_product_image`.
  5. Writes a `<run>/shared/product_metadata.json` sidecar so downstream
     steps (and re-runs) can read what was captured without re-deriving.

Every step is fail-soft. Image collection NEVER blocks review scraping
or report generation. When extraction or fetch fails, the metadata is
emitted with `product_image_url=None` / `product_image_local_path=None`
and the rest of the pipeline runs unchanged.

Anti-bot rule (OliveYoung)
--------------------------
By default this module uses the standalone HTTP extractor
(`extract_oy_product_image_url`) which performs a single GET against
the detail page. Operators who already have an active Playwright
session (e.g. mid-collection) can pass it via `playwright_page` to
prefer the existing session over a fresh HTTP fetch — that avoids
running afoul of OY's per-IP rate limits when the orchestrator already
has a warm cookie jar. The standalone fetch stays as a fallback.

`product_metadata.json` shape
-----------------------------
```
{
  "product_url": "https://www.oliveyoung.co.kr/.../?goodsNo=A000000XXXXXX",
  "source": "oliveyoung" | "coupang" | "unknown",
  "source_id": "A000000XXXXXX" | "<coupang_id>" | null,
  "product_name_raw": "<merch headline if known, else null>",
  "product_image_url": "<absolute URL or null>",
  "product_image_local_path": "assets/<sanitized_slug>.jpg",
  "product_image_source": "oliveyoung" | "coupang" | "manual" |
                          "og_image" | "json_ld" | null,
  "collected_at": "<ISO 8601 UTC>"
}
```
"""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional


_LOG = logging.getLogger("voc.app.product_metadata")


# Source detection patterns. The lookbehind accepts `.` (subdomain
# separator: `www.oliveyoung…`), `/` (URL after `//`: `https://oliveyoung…`),
# or start-of-string (bare hostname: `oliveyoung.co.kr/...`).
_OY_HOST_PATTERN = re.compile(
    r"(?:^|[./])oliveyoung\.co\.kr(?:\b|/)", re.IGNORECASE,
)
_COUPANG_HOST_PATTERN = re.compile(
    r"(?:^|[./])coupang\.com(?:\b|/)", re.IGNORECASE,
)

# Identifier extraction patterns (per source).
_OY_GOODS_NO_RE = re.compile(r"[?&]goodsNo=([A-Za-z0-9]+)", re.IGNORECASE)
# Coupang URLs vary: /vp/products/<productId>?vendorItemId=<id>
_COUPANG_PRODUCT_ID_RE = re.compile(r"/vp/products/(\d+)", re.IGNORECASE)
_COUPANG_VENDOR_ITEM_ID_RE = re.compile(
    r"[?&]vendorItemId=(\d+)", re.IGNORECASE,
)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def detect_source(product_url: Optional[str]) -> str:
    """Classify a product URL into one of: oliveyoung | coupang | unknown.

    Pure (no I/O); idempotent. Returns "unknown" for empty input or
    unrecognized hosts so callers can branch on equality."""
    if not product_url or not isinstance(product_url, str):
        return "unknown"
    if _OY_HOST_PATTERN.search(product_url):
        return "oliveyoung"
    if _COUPANG_HOST_PATTERN.search(product_url):
        return "coupang"
    return "unknown"


def extract_source_identifier(
    product_url: Optional[str], source: Optional[str] = None,
) -> Optional[str]:
    """Pull the source-specific identifier from a product URL.

    Defaults to running `detect_source` when no `source` is passed.
    Returns None when no identifier can be extracted (e.g. unknown
    source, or URL without the expected query param)."""
    if not product_url:
        return None
    source = source or detect_source(product_url)
    if source == "oliveyoung":
        m = _OY_GOODS_NO_RE.search(product_url)
        if m:
            return m.group(1)
        return None
    if source == "coupang":
        m = _COUPANG_VENDOR_ITEM_ID_RE.search(product_url)
        if m:
            return m.group(1)
        m = _COUPANG_PRODUCT_ID_RE.search(product_url)
        if m:
            return m.group(1)
        return None
    return None


# ---------------------------------------------------------------------------
# Per-source image URL extraction
# ---------------------------------------------------------------------------


def _extract_oy_image_url(
    *,
    goods_no: str,
    playwright_page: Any | None = None,
    user_agent: Optional[str] = None,
) -> tuple[Optional[str], Optional[str]]:
    """Try to get an OY product image URL.

    Returns `(image_url, image_source_label)` or `(None, None)` on
    failure. Tries the Playwright page first (if supplied) to leverage
    an already-warm session, then falls back to the standalone HTTP
    extractor.

    Source labels (v2.4.3 — explicit per-channel):
      * `oliveyoung_detail_page_playwright` — Playwright path matched
      * `oliveyoung_detail_page_http`       — standalone HTTP fallback matched
    """
    if playwright_page is not None:
        try:
            from src.voc.connectors.product_image_extractor import (
                extract_image_url_from_html,
            )
            # The orchestrator manages session lifecycle; we just read
            # the rendered HTML once. NO clicks, NO scrolls — we don't
            # want to perturb a mid-collection session.
            url = (
                "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do"
                f"?goodsNo={goods_no}"
            )
            playwright_page.goto(url, wait_until="domcontentloaded", timeout=10_000)
            html = playwright_page.content()
            extracted = extract_image_url_from_html(html)
            if extracted:
                return extracted, "oliveyoung_detail_page_playwright"
        except Exception as e:  # noqa: BLE001 — fail-soft is intentional
            _LOG.warning(
                "OY playwright-based image extraction raised: %r "
                "(goods_no=%s) — falling back to HTTP extractor",
                e, goods_no,
            )
    # Fallback: standalone HTTP fetch + parse.
    from src.voc.connectors.product_image_extractor import (
        extract_oy_product_image_url,
    )
    url = extract_oy_product_image_url(goods_no, user_agent=user_agent)
    if url:
        return url, "oliveyoung_detail_page_http"
    return None, None


def _extract_coupang_image_url(
    *, csv_rows: Optional[list[dict]] = None,
) -> tuple[Optional[str], Optional[str]]:
    """Try to get a Coupang product image URL.

    Currently only supports the CSV-row path (the Coupang scraper isn't
    in this codebase). The orchestrator must read the CSV and pass
    `csv_rows`. Returns `(None, None)` when nothing matches.

    Source label: `coupang_csv` when matched."""
    if not csv_rows:
        return None, None
    from src.voc.connectors.product_image_extractor import (
        extract_coupang_product_image_url,
    )
    url = extract_coupang_product_image_url(csv_rows)
    if url:
        return url, "coupang_csv"
    return None, None


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def collect_product_metadata(
    *,
    product_url: str,
    run_dir: Path,
    goods_no: Optional[str] = None,
    product_name_raw: Optional[str] = None,
    csv_rows: Optional[list[dict]] = None,
    playwright_page: Any | None = None,
    user_agent: Optional[str] = None,
    write_sidecar: bool = True,
    image_url_hint: Optional[str] = None,
    image_source_hint: Optional[str] = None,
) -> dict:
    """Collect product metadata + cache the representative image.

    Always returns a dict (never None, never raises). When extraction
    or fetch fails, the relevant fields are `None` and the pipeline
    proceeds. When `write_sidecar=True`, the dict is also written to
    `<run-dir>/shared/product_metadata.json` for audit.

    Parameters
    ----------
    product_url : str
        The product URL (used for source detection + OY HTTP fallback).
    run_dir : Path
        The run package root. Image goes to `<run_dir>/assets/`; sidecar
        to `<run_dir>/shared/product_metadata.json`. Image NEVER lives
        outside `<run_dir>/assets/`.
    goods_no : str, optional
        Source identifier. If not supplied, derived via
        `extract_source_identifier(product_url)`.
    product_name_raw : str, optional
        Recorded verbatim in the sidecar — informational only.
    csv_rows : list[dict], optional
        Coupang CSV rows (when source is Coupang). Ignored otherwise.
    playwright_page : Any, optional
        Active Playwright `Page` from the OY scrape session. When
        supplied, the OY adapter prefers it over a fresh HTTP fetch
        to avoid anti-bot escalation.
    user_agent : str, optional
        UA header passed to the HTTP extractor. Optional.
    write_sidecar : bool, default True
        When True, writes `<run_dir>/shared/product_metadata.json`.
    image_url_hint : str, optional
        Pre-extracted image URL (e.g. from the OY connector's warm
        session capture during open(). When set, the extractor is
        SKIPPED entirely and we go straight to the asset cache step.
        This is the anti-bot-aware path: the URL was captured as a
        side effect of the scrape, no extra HTTP fetch needed.
    image_source_hint : str, optional
        Source label paired with `image_url_hint`. Recommended values:
        `"oliveyoung_detail_page_playwright"` (warm session capture),
        `"oliveyoung_detail_page_http"`, `"coupang_csv"`, `"manual"`.
        Recorded verbatim on the sidecar.
    """
    metadata: dict = {
        "product_url": product_url,
        "source": detect_source(product_url),
        "source_id": goods_no or extract_source_identifier(product_url),
        "product_name_raw": product_name_raw,
        "product_image_url": None,
        "product_image_local_path": None,
        "product_image_source": None,
        "collected_at": _utc_now_iso(),
    }

    image_url: Optional[str] = None
    image_source_label: Optional[str] = None

    # v2.4.3 — when the upstream layer already captured the URL during
    # the scrape (warm Playwright session), skip extraction entirely.
    # This is the preferred path for OY: no extra HTTP fetch, no
    # anti-bot escalation. `image_source_hint` is recorded verbatim so
    # the sidecar shows where the URL came from.
    if image_url_hint:
        image_url = image_url_hint
        image_source_label = image_source_hint or "manual"
    else:
        try:
            if metadata["source"] == "oliveyoung" and metadata["source_id"]:
                image_url, image_source_label = _extract_oy_image_url(
                    goods_no=metadata["source_id"],
                    playwright_page=playwright_page,
                    user_agent=user_agent,
                )
            elif metadata["source"] == "coupang":
                image_url, image_source_label = _extract_coupang_image_url(
                    csv_rows=csv_rows,
                )
        except Exception as e:  # noqa: BLE001 — never block the run
            _LOG.warning(
                "product image URL extraction raised: %r (url=%s) — "
                "metadata image fields stay None",
                e, product_url,
            )
            image_url, image_source_label = None, None

    metadata["product_image_url"] = image_url
    metadata["product_image_source"] = image_source_label or ("none" if image_url is None else None)

    # Cache the image to <run>/assets/ (when we have a URL).
    if image_url:
        try:
            from src.voc.content.product_image_fetcher import (
                fetch_and_cache_product_image,
            )
            cache_slug = (
                metadata.get("source_id") or product_name_raw or run_dir.name
            )
            meta = fetch_and_cache_product_image(
                url=image_url,
                run_dir=run_dir,
                slug=cache_slug,
                source=image_source_label,
                user_agent=user_agent,
            )
            if meta is not None:
                metadata["product_image_local_path"] = meta["local_path"]
            else:
                _LOG.warning(
                    "product image cache failed for url=%s — local_path=None",
                    image_url,
                )
        except Exception as e:  # noqa: BLE001 — never block the run
            _LOG.warning(
                "product image cache raised: %r (url=%s) — local_path=None",
                e, image_url,
            )

    if write_sidecar:
        try:
            shared = Path(run_dir).resolve() / "shared"
            shared.mkdir(parents=True, exist_ok=True)
            (shared / "product_metadata.json").write_text(
                json.dumps(metadata, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except Exception as e:  # noqa: BLE001
            _LOG.warning("product_metadata.json write failed: %r", e)

    return metadata


def read_product_metadata(run_dir: Path) -> Optional[dict]:
    """Read `<run_dir>/shared/product_metadata.json` if present.

    Returns None when missing or unreadable. Never raises."""
    p = Path(run_dir) / "shared" / "product_metadata.json"
    if not p.is_file():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        _LOG.warning("product_metadata.json read failed: %r", e)
        return None
