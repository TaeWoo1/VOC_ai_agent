"""App-facing wiring seam for the detail-snapshot package (S2x.5b-1 / S2x.6b).

This is the ONE module the Streamlit app is authorized to import from the
detail_snapshot package (enforced by the isolation contracts in
``tests/test_review_ops/test_industrial_detail_snapshot.py``). It exposes two
offline wiring helpers:

- ``attach_detail_guidance_gaps`` (S2x.5b-1): given an existing report result
  dict and an optional snapshot directory, load
  ``product_guidance_review.json`` (fail-soft), run the S2x.4b list adapter
  over ``result["issue_items"]``, and return a copy of the result with
  ``detail_guidance_gaps`` (+ a small ``detail_guidance_source`` provenance
  dict) attached. The Notion export (S2x.5a) renders these when present.
- ``ingest_uploaded_images`` (S2x.6b): persist operator-uploaded detail-page
  image bytes into the same gitignored local snapshot artifact shape via the
  S2x.2-local ingest. Ingest only — NO tiling, NO OCR, NO multimodal, NO
  guidance draft/review creation.
- ``make_snapshot_tiles`` (S2x.6c): cut the ingested snapshot images into
  vertical tiles via the S2x.3a tiling module (``tiles/`` +
  ``tiles_manifest.json``, deterministic overwrite). Tiles only — NO
  extraction, NO multimodal, NO guidance draft/review creation.
- ``extract_snapshot_guidance_draft`` (S2x.6d): explicit, opt-in multimodal
  guidance extraction from generated tiles via the S2x.3b extractor —
  writes ``product_guidance_draft.json`` on success. The ONLY helper here
  that can reach OpenAI, and only when the caller passes
  ``enable_multimodal=True`` (a key gate and per-tile fail-soft live in the
  extractor). NO postprocess, NO review-file creation, NO gap attach.
- ``review_snapshot_guidance_draft`` (S2x.6e): deterministic, local-only
  postprocess of the extraction draft via the S2x.3c module — writes
  ``product_guidance_review.json`` (the file the attach helper and the
  Notion gap surfaces consume). NO OpenAI, NO gap attach, NO draft
  mutation.

Discipline: NO ProductKnowledge, NO Notion / store / review-analysis
integration. NO network and NO OpenAI anywhere EXCEPT inside
``extract_snapshot_guidance_draft`` when explicitly called with
``enable_multimodal=True`` (it returns ``skipped`` otherwise and
``skipped_no_key`` without a resolvable key — never a silent live call). The
only file writes are the gitignored snapshot artifacts produced by
``ingest_uploaded_images`` / ``make_snapshot_tiles`` /
``extract_snapshot_guidance_draft`` / ``review_snapshot_guidance_draft``
(the attach helper writes nothing). The input ``result`` is never mutated; every
no-gap path (missing snapshot_dir, missing/invalid review, empty issue list)
returns an unchanged copy so the Notion export falls back to its review-only
section.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from src.voc.review_ops.industrial.detail_snapshot.guidance_gap import BASIS
from src.voc.review_ops.industrial.detail_snapshot.guidance_gap_apply import (
    REVIEW_FILENAME,
    analyze_issue_list_guidance_gaps,
    load_guidance_review,
)
from src.voc.review_ops.industrial.detail_snapshot.guidance_postprocess import (
    review_guidance_draft,
)
from src.voc.review_ops.industrial.detail_snapshot.ingest_local import (
    DEFAULT_ARTIFACT_ROOT,
    ingest_local_images,
)
from src.voc.review_ops.industrial.detail_snapshot.multimodal_extract import (
    extract_guidance,
)
from src.voc.review_ops.industrial.detail_snapshot.tiling import (
    DEFAULT_OVERLAP_PX,
    DEFAULT_TILE_HEIGHT,
    make_tiles,
)


def attach_detail_guidance_gaps(result: dict, snapshot_dir: str | Path | None) -> dict:
    """Return a copy of ``result`` with detail-guidance gaps attached when possible.

    Attaches ``detail_guidance_gaps`` (one cautious gap result per issue item,
    order preserved) and ``detail_guidance_source`` (provenance) ONLY when all
    of: ``snapshot_dir`` is provided, ``product_guidance_review.json`` loads,
    and ``result["issue_items"]`` is non-empty. Otherwise the copy is returned
    unchanged — no diagnostic fields, so downstream consumers see exactly the
    pre-S2x.5b result shape. The input dict is not mutated.
    """
    out = dict(result or {})
    if not snapshot_dir:
        return out
    guidance_review = load_guidance_review(snapshot_dir)
    if not guidance_review:
        return out
    issue_items = out.get("issue_items") or []
    if not issue_items:
        return out
    gaps = analyze_issue_list_guidance_gaps(issue_items, guidance_review)
    if not gaps:
        return out
    out["detail_guidance_gaps"] = gaps
    out["detail_guidance_source"] = {
        "snapshot_dir": str(snapshot_dir),
        "source": REVIEW_FILENAME,
        "basis": BASIS,
        "needs_operator_review": True,
    }
    return out


def ingest_uploaded_images(
    image_files: list[tuple[str, bytes]] | None,
    *,
    product_name: str = "",
    out_root: str | Path = DEFAULT_ARTIFACT_ROOT,
) -> dict:
    """Persist uploaded detail-page images into a local snapshot artifact (S2x.6b).

    ``image_files`` is a list of ``(filename, bytes)`` pairs (the thin Streamlit
    wrapper converts its UploadedFile objects to this shape, so the helper stays
    UI-free and testable). The bytes are staged under
    ``<out_root>/_uploads/upload-<digest>/`` with order-preserving names
    (``upload_000.png`` …), then handed to the S2x.2-local
    ``ingest_local_images`` — so the resulting artifact (snapshot_metadata.json
    / image_manifest.json / extracted_text.txt placeholder / images/) is
    byte-shape-identical to a manually prepared local-image snapshot.

    The staging digest is content-addressed over (product_name, filenames,
    bytes), so re-uploading the same images is idempotent: same staging dir,
    same snapshot_dir. Upload order is the page order and is preserved.

    Ingest ONLY: no tiling, no OCR, no multimodal, no OpenAI, no network, no
    guidance draft/review files. Fail-soft: an empty/blank upload list returns
    ``{"status": "error", "snapshot_dir": ""}`` without writing anything;
    unreadable image bytes degrade to the ingest's partial/error status.
    """
    files = [
        (str(name), data)
        for name, data in (image_files or [])
        if name and isinstance(data, (bytes, bytearray)) and data
    ]
    if not files:
        return {
            "status": "error",
            "snapshot_dir": "",
            "metadata": {},
            "paths": {},
            "notes": "업로드된 이미지가 없습니다.",
        }

    digest = hashlib.sha1()
    digest.update((product_name or "").encode("utf-8"))
    for name, data in files:
        digest.update(b"\x00")
        digest.update(name.encode("utf-8"))
        digest.update(b"\x00")
        digest.update(bytes(data))
    staging = Path(out_root) / "_uploads" / f"upload-{digest.hexdigest()[:10]}"
    staging.mkdir(parents=True, exist_ok=True)
    for i, (name, data) in enumerate(files):
        suffix = Path(name).suffix.lower() or ".png"
        (staging / f"upload_{i:03d}{suffix}").write_bytes(bytes(data))

    return ingest_local_images(staging, product_name=product_name, out_root=out_root)


def make_snapshot_tiles(
    snapshot_dir: str | Path | None,
    *,
    tile_height: int = DEFAULT_TILE_HEIGHT,
    overlap_px: int = DEFAULT_OVERLAP_PX,
) -> dict:
    """Cut a snapshot's ingested images into vertical tiles (S2x.6c).

    Thin app-facing wrapper over the S2x.3a tiling module: writes
    ``<snapshot_dir>/tiles/`` + ``<snapshot_dir>/tiles_manifest.json`` and
    returns its ``{status, snapshot_dir, manifest_path, tile_count, tiles_dir}``
    result. Re-running is a deterministic overwrite (the tiling module replaces
    any prior ``tiles/``), so tiles are never duplicated.

    Tiles ONLY: no OCR, no multimodal, no OpenAI, no network, no guidance
    draft/review files. Fail-soft: an empty/blank ``snapshot_dir`` returns
    ``status="error"`` without touching the filesystem; a missing folder /
    manifest / images degrades inside the tiling module (error recorded in
    ``tiles_manifest.json`` where possible).
    """
    cleaned = str(snapshot_dir or "").strip()
    if not cleaned:
        return {
            "status": "error",
            "reason": "스냅샷 경로가 없습니다.",
            "snapshot_dir": "",
            "manifest_path": None,
            "tile_count": 0,
            "tiles_dir": None,
        }
    return make_tiles(cleaned, tile_height=tile_height, overlap_px=overlap_px)


def extract_snapshot_guidance_draft(
    snapshot_dir: str | Path | None,
    *,
    enable_multimodal: bool = False,
    api_key: str | None = None,
    model: str | None = None,
    tile_extractor=None,
) -> dict:
    """Extract a guidance draft from a snapshot's generated tiles (S2x.6d).

    Thin app-facing wrapper over the S2x.3b extractor: reads
    ``tiles_manifest.json`` + ``tiles/`` and writes
    ``product_guidance_draft.json`` when at least one tile extracts. Returns
    the extractor's result (``status`` / ``reason`` / ``draft_path``, plus
    ``tile_count`` / ``success_count`` / ``confidence`` on success).

    Explicit opt-in chain, never silent: ``enable_multimodal=False`` (the
    default) → ``status="skipped"`` with no extractor call and no file write;
    no resolvable API key → ``status="skipped_no_key"`` with no draft; missing
    tiles → ``status="error"`` asking the operator to create tiles first.
    ``tile_extractor`` is a test seam — an injected extractor bypasses the key
    gate so tests never call OpenAI. Draft ONLY: no postprocess, no
    ``product_guidance_review.json``, no gap attach.
    """
    cleaned = str(snapshot_dir or "").strip()
    if not cleaned:
        return {
            "status": "error",
            "reason": "스냅샷 경로가 없습니다.",
            "snapshot_dir": "",
            "draft_path": None,
        }
    return extract_guidance(
        cleaned,
        enable_multimodal=enable_multimodal,
        api_key=api_key,
        model=model,
        tile_extractor=tile_extractor,
    )


def review_snapshot_guidance_draft(snapshot_dir: str | Path | None) -> dict:
    """Postprocess a snapshot's extraction draft into the review file (S2x.6e).

    Thin app-facing wrapper over the S2x.3c deterministic postprocess: reads
    ``product_guidance_draft.json`` and writes ``product_guidance_review.json``
    — the exact file the attach helper / gap preview / Notion export already
    consume, so those surfaces work naturally once this succeeds. Local-only:
    NO OpenAI, NO multimodal, NO network; the draft is read, never modified.
    Re-running is a deterministic overwrite of the review file.

    Returns the postprocess result (``status`` / ``reason`` / ``review_path``
    plus ``not_found_count`` / ``gap_signal_count`` / ``quality_flag_count``),
    extended with ``confirmed_count`` (total confirmed-guidance items across
    buckets) on success. Fail-soft: empty/blank path or a missing/unparseable
    draft returns ``status="error"`` with no file writes.
    """
    cleaned = str(snapshot_dir or "").strip()
    if not cleaned:
        return {
            "status": "error",
            "reason": "스냅샷 경로가 없습니다.",
            "snapshot_dir": "",
            "review_path": None,
        }
    out = review_guidance_draft(cleaned)
    if out.get("status") == "ok" and out.get("review_path"):
        try:
            review = json.loads(Path(out["review_path"]).read_text(encoding="utf-8"))
            buckets = review.get("confirmed_guidance") or {}
            out["confirmed_count"] = sum(len(v or []) for v in buckets.values())
        except Exception:  # fail-soft: count is advisory display data
            out["confirmed_count"] = None
    return out
