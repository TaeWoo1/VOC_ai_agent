"""Capture layer for the detail-snapshot spike.

This is the ONLY place that touches the network/browser. Playwright is imported
lazily *inside* :func:`capture_snapshot` so the module imports cleanly (and the
pure helpers below are testable) without a browser installed.

Hard limits, by design:
- exactly one operator-provided URL, validated as a Coupang product page;
- a single read-only page load — no login, no captcha/anti-bot bypass, no
  retries-to-evade, no link following, no pagination;
- if a login/captcha/anti-bot wall is detected the run STOPS with
  ``status="blocked"`` (we never try to get around it);
- no OCR, no multimodal, no OpenAI call, no cloud image upload. There is no
  ``product_guidance_draft.json`` in this slice.

Artifacts are written only under a gitignored output root
(``.review_ops_data/detail_snapshots/<slug>/``) and are never committed.
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Callable

from src.voc.review_ops.industrial.detail_snapshot.parse import (
    extract_from_html,
    validate_coupang_product_url,
)

DEFAULT_ARTIFACT_ROOT = ".review_ops_data/detail_snapshots"
DEFAULT_TIMEOUT_MS = 30_000
DEFAULT_MAX_SAMPLE_IMAGES = 3

# Substrings that signal a login / captcha / anti-bot wall. Detection only — we
# stop, we never attempt to bypass any of these.
_BLOCK_MARKERS = (
    "/login",
    "login.coupang",
    "captcha",
    "robot",
    "are you a human",
    "access denied",
    "비정상적인 접근",
    "로그인이 필요",
    "자동 입력 방지",
    "보안문자",
)

_SLUG_SAFE_RE = re.compile(r"[^a-z0-9._-]+")
_PRODUCT_ID_RE = re.compile(r"/products/(\d+)")


class SnapshotDependencyError(RuntimeError):
    """Raised when the browser dependency (Playwright) is unavailable."""


# --- pure helpers (no network) ----------------------------------------------


def safe_slug(url: str) -> str:
    """A filesystem-safe folder name for a URL.

    Uses the Coupang product id when present (``product-<id>``), otherwise a
    short hash of the URL, always suffixed with a short hash for uniqueness.
    """
    digest = hashlib.sha1((url or "").encode("utf-8")).hexdigest()[:10]
    m = _PRODUCT_ID_RE.search(url or "")
    base = f"product-{m.group(1)}" if m else "snapshot"
    base = _SLUG_SAFE_RE.sub("-", base.lower()).strip("-") or "snapshot"
    return f"{base}-{digest}"


def detect_block(*, url: str, title: str, text_sample: str) -> str | None:
    """Return a block reason if a login/captcha/anti-bot wall is detected, else None."""
    haystack = " ".join((url or "", title or "", (text_sample or "")[:2000])).lower()
    for marker in _BLOCK_MARKERS:
        if marker in haystack:
            return f"차단 신호 감지: '{marker}'. 우회하지 않고 중단합니다."
    return None


def build_metadata(
    *,
    url: str,
    status: str,
    extracted: dict | None = None,
    reason: str = "",
    fetched_at: str | None = None,
    capture_method: str = "playwright_chromium",
    image_count: int = 0,
    downloaded_image_count: int = 0,
    has_screenshot: bool = False,
) -> dict:
    """Assemble the ``snapshot_metadata.json`` payload. Pure; no personal data."""
    extracted = extracted or {}
    return {
        "url": url,
        "status": status,  # ok | partial | blocked | error
        "reason": reason,
        "fetched_at": fetched_at,
        "capture_method": capture_method,
        "title": extracted.get("title", ""),
        "product_name_candidate": extracted.get("product_name_candidate", ""),
        "image_source_region": extracted.get("image_source_region", ""),
        "text_length": len(extracted.get("visible_text", "") or ""),
        "image_count": image_count,
        "downloaded_image_count": downloaded_image_count,
        "has_screenshot": has_screenshot,
        # explicit, auditable statement of what this slice did NOT do
        "ocr": False,
        "multimodal": False,
    }


def write_snapshot_artifacts(
    snapshot_dir: str | Path,
    *,
    metadata: dict,
    extracted_text: str,
    image_manifest: dict,
    screenshot_bytes: bytes | None = None,
) -> dict:
    """Write the artifact files under ``snapshot_dir`` and return their paths.

    Creates ``snapshot_metadata.json`` / ``extracted_text.txt`` /
    ``image_manifest.json`` and, when ``screenshot_bytes`` is given,
    ``screenshots/full_page.png``. Pure file I/O — no network.
    """
    d = Path(snapshot_dir)
    d.mkdir(parents=True, exist_ok=True)
    paths: dict[str, str] = {}

    meta_path = d / "snapshot_metadata.json"
    meta_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    paths["metadata"] = str(meta_path)

    text_path = d / "extracted_text.txt"
    text_path.write_text(extracted_text or "", encoding="utf-8")
    paths["text"] = str(text_path)

    manifest_path = d / "image_manifest.json"
    manifest_path.write_text(
        json.dumps(image_manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    paths["image_manifest"] = str(manifest_path)

    if screenshot_bytes:
        shots = d / "screenshots"
        shots.mkdir(parents=True, exist_ok=True)
        shot_path = shots / "full_page.png"
        shot_path.write_bytes(screenshot_bytes)
        paths["screenshot"] = str(shot_path)

    return paths


def _image_dimensions(data: bytes) -> tuple[int | None, int | None]:
    """Best-effort (width, height) from image bytes via Pillow; None on failure."""
    try:
        import io

        from PIL import Image  # lazy: Pillow is present but keep import local

        with Image.open(io.BytesIO(data)) as im:
            return int(im.width), int(im.height)
    except Exception:
        return None, None


def download_sample_images(
    image_urls: list[str],
    images_dir: str | Path,
    *,
    fetcher: Callable[[str], bytes],
    max_images: int = DEFAULT_MAX_SAMPLE_IMAGES,
) -> list[dict]:
    """Download at most ``max_images`` images using an injectable ``fetcher``.

    ``fetcher(url) -> bytes`` is the only I/O seam (the live caller passes a
    Playwright-backed fetcher; tests pass a fake). Each image is saved under
    ``images_dir`` and recorded with its local filename and dimensions. Any
    single failure is logged into the entry and skipped — never raised.
    """
    out: list[dict] = []
    d = Path(images_dir)
    for i, url in enumerate(image_urls[: max(0, max_images)]):
        entry: dict = {"url": url, "downloaded": False}
        try:
            data = fetcher(url)
            if not data:
                raise ValueError("빈 응답")
            d.mkdir(parents=True, exist_ok=True)
            ext = ".jpg"
            low = url.lower()
            for cand in (".png", ".jpeg", ".jpg", ".webp", ".gif"):
                if cand in low:
                    ext = cand
                    break
            filename = f"image_{i:02d}{ext}"
            (d / filename).write_bytes(data)
            w, h = _image_dimensions(data)
            entry.update(
                {"downloaded": True, "filename": filename, "width": w, "height": h}
            )
        except Exception as exc:  # fail-soft per image
            entry["error"] = str(exc)
        out.append(entry)
    return out


# --- live capture (lazy Playwright; the only network path) ------------------


def capture_snapshot(
    url: str,
    *,
    out_root: str | Path = DEFAULT_ARTIFACT_ROOT,
    download_sample_images_flag: bool = False,
    max_sample_images: int = DEFAULT_MAX_SAMPLE_IMAGES,
    timeout_ms: int = DEFAULT_TIMEOUT_MS,
    now: datetime | None = None,
) -> dict:
    """Capture one read-only snapshot of a Coupang product detail page.

    Validates the URL, loads it once with Playwright Chromium (lazy import),
    detects login/captcha/anti-bot walls (and stops without bypassing), then
    writes the artifact folder. Returns a result dict
    ``{status, snapshot_dir, metadata, paths}``. Raises
    :class:`SnapshotDependencyError` only when Playwright itself is unavailable
    (before any artifact is written).
    """
    ok, reason = validate_coupang_product_url(url)
    if not ok:
        raise ValueError(reason)

    try:
        from playwright.sync_api import sync_playwright  # lazy import
    except Exception as exc:  # pragma: no cover - environment dependent
        raise SnapshotDependencyError(
            "Playwright를 사용할 수 없습니다. `pip install -e \".[scraper]\"` 후 "
            "`playwright install chromium`을 실행하세요."
        ) from exc

    snapshot_dir = Path(out_root) / safe_slug(url)
    fetched_at = (now or datetime.now()).isoformat(timespec="seconds")
    html = ""
    screenshot_bytes: bytes | None = None
    status = "ok"
    block_reason = ""
    image_records: list[dict] = []
    image_fetcher: Callable[[str], bytes] | None = None

    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            try:
                context = browser.new_context()
                page = context.new_page()
                # Single, read-only navigation. No retries; no evasion.
                page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
                html = page.content()
                title_guess = page.title() or ""
                block_reason = detect_block(
                    url=page.url, title=title_guess, text_sample=html
                ) or ""
                if not block_reason:
                    try:
                        screenshot_bytes = page.screenshot(full_page=True)
                    except Exception:
                        screenshot_bytes = None

                    def _pw_fetch(u: str) -> bytes:
                        resp = context.request.get(u, timeout=timeout_ms)
                        return resp.body()

                    image_fetcher = _pw_fetch
            finally:
                browser.close()
    except SnapshotDependencyError:
        raise
    except Exception as exc:  # network/timeout/other → fail-soft
        status = "error"
        block_reason = f"로드 실패: {exc}"

    if block_reason and status != "error":
        status = "blocked"

    if status in ("blocked", "error"):
        metadata = build_metadata(
            url=url,
            status=status,
            reason=block_reason,
            fetched_at=fetched_at,
            has_screenshot=bool(screenshot_bytes),
        )
        paths = write_snapshot_artifacts(
            snapshot_dir,
            metadata=metadata,
            extracted_text="",
            image_manifest={"image_source_region": "", "image_urls": [], "sampled": []},
            screenshot_bytes=screenshot_bytes,
        )
        return {"status": status, "snapshot_dir": str(snapshot_dir),
                "metadata": metadata, "paths": paths}

    extracted = extract_from_html(html, base_url=url)
    if download_sample_images_flag and image_fetcher and extracted["image_urls"]:
        image_records = download_sample_images(
            extracted["image_urls"],
            snapshot_dir / "images",
            fetcher=image_fetcher,
            max_images=max_sample_images,
        )

    # Image-heavy page with little recovered text is a valid, informative result.
    if len(extracted["visible_text"]) < 200 and extracted["image_urls"]:
        status = "partial"

    downloaded = sum(1 for r in image_records if r.get("downloaded"))
    metadata = build_metadata(
        url=url,
        status=status,
        extracted=extracted,
        reason="",
        fetched_at=fetched_at,
        image_count=len(extracted["image_urls"]),
        downloaded_image_count=downloaded,
        has_screenshot=bool(screenshot_bytes),
    )
    image_manifest = {
        "image_source_region": extracted["image_source_region"],
        "image_urls": extracted["image_urls"],
        "sampled": image_records,
    }
    paths = write_snapshot_artifacts(
        snapshot_dir,
        metadata=metadata,
        extracted_text=extracted["visible_text"],
        image_manifest=image_manifest,
        screenshot_bytes=screenshot_bytes,
    )
    return {"status": status, "snapshot_dir": str(snapshot_dir),
            "metadata": metadata, "paths": paths}
