"""Attach precomputed detail-guidance gaps to a report result dict (S2x.5b-1).

Pure, offline wiring helper: given an existing report result dict and an
optional snapshot directory, load ``product_guidance_review.json`` (fail-soft),
run the S2x.4b list adapter over ``result["issue_items"]``, and return a copy of
the result with ``detail_guidance_gaps`` (+ a small ``detail_guidance_source``
provenance dict) attached. The Notion export (S2x.5a) renders these when
present; nothing calls this module from the app yet.

Discipline: NO network, NO OpenAI, NO multimodal, NO ProductKnowledge, NO
Notion / Streamlit / store / review-analysis integration, NO artifact writing.
The input ``result`` is never mutated; every no-gap path (missing snapshot_dir,
missing/invalid review, empty issue list) returns an unchanged copy so the
Notion export falls back to its review-only section.
"""

from __future__ import annotations

from pathlib import Path

from src.voc.review_ops.industrial.detail_snapshot.guidance_gap import BASIS
from src.voc.review_ops.industrial.detail_snapshot.guidance_gap_apply import (
    REVIEW_FILENAME,
    analyze_issue_list_guidance_gaps,
    load_guidance_review,
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
