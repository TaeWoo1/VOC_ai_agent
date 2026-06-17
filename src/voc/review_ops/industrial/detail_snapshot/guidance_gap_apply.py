"""Apply the issue × detail-guidance gap helper over a list of issues (S2x.4b).

Pure, offline adapter: normalizes repeated-issue items into the shape
:func:`analyze_issue_guidance_gap` expects, runs the gap analysis per issue, and
returns one cautious result dict per issue (order preserved, passthrough metadata
attached). Plus a fail-soft loader for ``product_guidance_review.json``.

Discipline: NO network, NO OpenAI, NO OCR, NO ProductKnowledge, NO Notion /
Streamlit / store / review-analysis integration, NO artifact writing. Inputs are
never mutated; a missing/empty guidance review yields ``no_guidance_review`` for
every issue (the cautious framing of :mod:`guidance_gap` is preserved verbatim).
"""

from __future__ import annotations

import json
from pathlib import Path

from src.voc.review_ops.industrial.detail_snapshot.guidance_gap import (
    analyze_issue_guidance_gap,
)

REVIEW_FILENAME = "product_guidance_review.json"

# issue-item fields carried through onto each gap result when present.
_PASSTHROUGH_KEYS: tuple[str, ...] = ("review_count", "severity", "recommended_action")


def _normalize_issue(item: dict) -> dict:
    """Map a repeated-issue item onto the gap helper's expected issue shape.

    Accepts either ``title`` or ``issue_title`` as the display title; builds a
    fresh dict so the caller's input is never mutated.
    """
    item = item or {}
    return {
        "title": item.get("title") or item.get("issue_title") or "",
        "canonical_label": item.get("canonical_label") or "",
        "summary": item.get("summary") or "",
        "recommended_action": item.get("recommended_action") or "",
    }


def analyze_issue_list_guidance_gaps(
    issue_items: list[dict] | None, guidance_review: dict | None
) -> list[dict]:
    """Run :func:`analyze_issue_guidance_gap` over each issue, preserving order.

    Returns ``[]`` for an empty/missing issue list. A missing/empty
    ``guidance_review`` yields a ``no_guidance_review`` result per issue. Each
    result carries through ``review_count`` / ``severity`` / ``recommended_action``
    from its source item when present. Inputs are not mutated.
    """
    if not issue_items:
        return []

    results: list[dict] = []
    for item in issue_items:
        item = item or {}
        result = analyze_issue_guidance_gap(_normalize_issue(item), guidance_review)
        for key in _PASSTHROUGH_KEYS:
            value = item.get(key)
            if value is not None:
                result[key] = value
        results.append(result)
    return results


def load_guidance_review(snapshot_dir: str | Path) -> dict | None:
    """Load ``product_guidance_review.json`` from ``snapshot_dir``.

    Fail-soft: returns ``None`` when the directory or file is missing or the JSON
    is invalid. Reads only — never writes an artifact.
    """
    d = Path(snapshot_dir)
    review_path = d / REVIEW_FILENAME
    if not review_path.exists():
        return None
    try:
        data = json.loads(review_path.read_text(encoding="utf-8"))
    except Exception:
        return None
    return data if isinstance(data, dict) else None
