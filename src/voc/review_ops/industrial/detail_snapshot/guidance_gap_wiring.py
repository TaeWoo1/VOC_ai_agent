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

Discipline: NO network, NO OpenAI, NO multimodal, NO ProductKnowledge, NO
Notion / store / review-analysis integration. The only file writes are the
gitignored snapshot artifacts produced by ``ingest_uploaded_images`` (the
attach helper writes nothing). The input ``result`` is never mutated; every
no-gap path (missing snapshot_dir, missing/invalid review, empty issue list)
returns an unchanged copy so the Notion export falls back to its review-only
section.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

from src.voc.review_ops.industrial.detail_snapshot.guidance_gap import BASIS
from src.voc.review_ops.industrial.detail_snapshot.guidance_gap_apply import (
    REVIEW_FILENAME,
    analyze_issue_list_guidance_gaps,
    load_guidance_review,
)
from src.voc.review_ops.industrial.detail_snapshot.ingest_local import (
    DEFAULT_ARTIFACT_ROOT,
    ingest_local_images,
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
