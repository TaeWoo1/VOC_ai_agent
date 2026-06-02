"""Product image fetcher — collection-side cache to run-local assets dir.

The cardnews skill renders covers using a *local* product image when
one is available. Live HTTP fetches at render time are forbidden by
the v2.4 image policy (the operator-side smoke render must work
offline; CDN URLs decay; live fetches add render-time latency and
make screenshots non-reproducible).

This module provides the collection-stage pre-fetch:

    fetch_and_cache_product_image(
        url=https_url,
        run_dir=Path("outputs/content_packages/<run>"),
        slug="mediheal-pad",
        source="oliveyoung",
    )
    → {"url": ..., "local_path": "assets/product_image.jpg",
       "source": "oliveyoung", "content_type": "image/jpeg"}
    or None on any failure.

Filesystem contract
-------------------
* All output goes under `<run_dir>/assets/`. The function refuses to
  write outside that directory — it resolves the requested path with
  `Path.resolve()` and asserts the parent equals the resolved
  `<run_dir>/assets/`.
* Filenames are sanitized from the slug. Non-alphanumeric characters
  collapse to `_`; the slug is truncated to 48 chars. The extension
  is inferred from `Content-Type` (JPEG/PNG/WebP/GIF). Unknown content
  types fall back to `.bin` and are flagged in the meta sidecar.

Failure semantics
-----------------
* Network error / non-200 / wrong content type → returns `None`.
* The function NEVER raises out — collection-side image fetch
  failures must not abort an analysis run. The caller decides whether
  to surface the missing-image warning to the operator.

Sidecar meta
------------
A sibling JSON `<slug>_meta.json` is written so a future re-render
can audit the image choice without re-querying the source. Shape:

    {
        "url": "<original https url>",
        "local_path": "assets/<slug>.jpg",
        "source": "oliveyoung" | "coupang" | "manual" | "og_image" | "json_ld",
        "content_type": "image/jpeg",
        "fetched_at": "2026-05-03T10:30:00Z",
        "byte_size": 12345
    }
"""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional


_LOG = logging.getLogger("voc.content.product_image_fetcher")


# Allowed content types and their canonical extensions. Anything else
# falls back to `.bin` + a flag so operators see the content_type drift.
_CONTENT_TYPE_TO_EXT: dict[str, str] = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}

# Max image size — refuse oversized fetches so a misbehaving CDN can't
# fill the operator's disk. 8 MiB is generous for product hero images.
_MAX_IMAGE_BYTES = 8 * 1024 * 1024

# Network timeout in seconds. Short on purpose — collection-side image
# fetch is best-effort, not a blocking dependency.
_FETCH_TIMEOUT_SEC = 6


_SLUG_SAFE_RE = re.compile(r"[^A-Za-z0-9가-힣\-_]+")


def sanitize_slug(slug: str) -> str:
    """Filesystem-safe slug for the cached image filename.

    Collapses runs of unsafe characters into `_` and truncates to 48
    chars so we don't hit OS path length limits on long product names."""
    if not slug:
        return "product"
    cleaned = _SLUG_SAFE_RE.sub("_", slug.strip()).strip("_")
    cleaned = cleaned[:48] or "product"
    return cleaned


def _ensure_under_assets_dir(target: Path, assets_dir: Path) -> None:
    """Refuse to write a path outside the run's assets dir.

    Defense-in-depth: even with a sanitized slug, a future bug or a
    crafted upstream string must not let us write to the parent run
    dir or anywhere outside it. Compares resolved paths so symlinks
    and `..` traversal don't smuggle a write through."""
    try:
        target_r = target.resolve()
        assets_r = assets_dir.resolve()
    except OSError as e:
        raise RuntimeError(
            f"product_image_fetcher: cannot resolve target paths: {e}"
        )
    # Python 3.9+: PurePath.is_relative_to. Walk parent chain manually
    # to keep this version-agnostic and explicit.
    if assets_r != target_r and assets_r not in target_r.parents:
        raise RuntimeError(
            f"product_image_fetcher: refusing to write outside run assets "
            f"dir (target={target_r}, assets_dir={assets_r})"
        )


def _ext_for_content_type(content_type: str) -> tuple[str, bool]:
    """Return `(extension, is_known)`. Unknown types get `.bin`."""
    ct = (content_type or "").split(";")[0].strip().lower()
    if ct in _CONTENT_TYPE_TO_EXT:
        return _CONTENT_TYPE_TO_EXT[ct], True
    return ".bin", False


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def fetch_and_cache_product_image(
    *,
    url: Optional[str],
    run_dir: Path,
    slug: str,
    source: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> Optional[dict]:
    """Fetch `url` once and cache it under `run_dir/assets/`.

    Returns the meta dict on success (also written as a sidecar JSON
    next to the image), or `None` on any failure. NEVER raises.

    `source` is recorded verbatim in the meta sidecar. Conventional
    values: `oliveyoung`, `coupang`, `manual`, `og_image`, `json_ld`.

    On success, the local image lives at
    `run_dir/assets/<sanitized_slug>{.ext}`.
    """
    if not url or not isinstance(url, str):
        return None
    if not url.lower().startswith(("http://", "https://")):
        _LOG.warning("non-http(s) image url skipped: %r", url)
        return None

    try:
        import requests  # type: ignore
    except ImportError:
        _LOG.warning("requests not installed; cannot fetch product image")
        return None

    safe_slug = sanitize_slug(slug)
    assets_dir = Path(run_dir).resolve() / "assets"
    try:
        assets_dir.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        _LOG.warning("could not create assets dir %s: %s", assets_dir, e)
        return None

    headers = {}
    if user_agent:
        headers["User-Agent"] = user_agent

    try:
        resp = requests.get(
            url,
            timeout=_FETCH_TIMEOUT_SEC,
            stream=True,
            headers=headers or None,
        )
    except Exception as e:  # noqa: BLE001 — fail-soft is intentional
        _LOG.warning("product image fetch raised: %r url=%s", e, url)
        return None

    if resp.status_code != 200:
        _LOG.warning(
            "product image fetch non-200: status=%d url=%s",
            resp.status_code, url,
        )
        return None

    content_type = resp.headers.get("Content-Type", "")
    ext, is_known = _ext_for_content_type(content_type)
    if not is_known:
        _LOG.warning(
            "product image content-type %r is not a known image format; "
            "saving with .bin extension and flagging in sidecar",
            content_type,
        )

    target = assets_dir / f"{safe_slug}{ext}"
    try:
        _ensure_under_assets_dir(target, assets_dir)
    except RuntimeError as e:
        _LOG.warning(str(e))
        return None

    bytes_written = 0
    try:
        with open(target, "wb") as fh:
            for chunk in resp.iter_content(chunk_size=64 * 1024):
                if not chunk:
                    continue
                bytes_written += len(chunk)
                if bytes_written > _MAX_IMAGE_BYTES:
                    fh.close()
                    target.unlink(missing_ok=True)
                    _LOG.warning(
                        "product image exceeds max size %d bytes; "
                        "discarding url=%s",
                        _MAX_IMAGE_BYTES, url,
                    )
                    return None
                fh.write(chunk)
    except Exception as e:  # noqa: BLE001
        _LOG.warning("product image write failed: %r", e)
        target.unlink(missing_ok=True)
        return None

    if bytes_written == 0:
        target.unlink(missing_ok=True)
        _LOG.warning("product image empty body; discarding url=%s", url)
        return None

    # Local path is recorded relative to run_dir so the manifest /
    # analysis_report stays portable across machines.
    rel_local_path = target.relative_to(Path(run_dir).resolve()).as_posix()

    meta = {
        "url": url,
        "local_path": rel_local_path,
        "source": source,
        "content_type": content_type,
        "is_known_image_type": is_known,
        "fetched_at": _utc_now_iso(),
        "byte_size": bytes_written,
    }

    sidecar = assets_dir / f"{safe_slug}_meta.json"
    try:
        _ensure_under_assets_dir(sidecar, assets_dir)
        sidecar.write_text(
            json.dumps(meta, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except Exception as e:  # noqa: BLE001
        # Image is fine even if the sidecar write fails; just log.
        _LOG.warning("product image meta sidecar write failed: %r", e)

    return meta
