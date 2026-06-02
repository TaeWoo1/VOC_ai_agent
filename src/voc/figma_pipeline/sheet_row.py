"""Pure row builder for the cardnews review Sheet.

Given:
  - `analysis_report` dict (from `shared/analysis_report.json`)
  - `cardnews_copy`  dict (the polished `figma_cardnews_copy_ko.json`,
                          NOT the deterministic skeleton)
  - `manifest`       dict (from `manifest.json`)
  - `run_id`         str  (the operator-facing run identifier)

returns a 27-column dict shaped exactly like the human-review Sheet.

The schema is locked here so the export script and the local server
share one source of truth. Tests assert column order, presence, and
the body-formatting rules.

NOT a pipeline change — this module is a pure projection over already-
generated artifacts. Adding/removing a column requires updating both
this module and the existing tests.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Mapping


# ---------------------------------------------------------------------------
# Schema (locked)
# ---------------------------------------------------------------------------

# Column order matches the user's specification verbatim. Index in
# this tuple is the column position in CSV / Sheet.
SHEET_COLUMNS: tuple[str, ...] = (
    "date",
    "run_id",
    "product_name",
    "goods_no",
    "category",
    "profile_id",
    "review_count",
    "confidence",
    "card01_title", "card01_body",
    "card02_title", "card02_body",
    "card03_title", "card03_body",
    "card04_title", "card04_body",
    "card05_title", "card05_body",
    "card06_title", "card06_body",
    "card07_title", "card07_body",
    "copy_status",
    "design_status",
    "figma_file_url",
    "png_folder",
    "reviewer_notes",
)

# Exactly 27 columns (per spec). If this assertion ever trips, every
# downstream consumer (export script, server, plugin) needs updating
# in lockstep.
assert len(SHEET_COLUMNS) == 27, len(SHEET_COLUMNS)

SHEET_TEMPLATE_HEADER: str = ",".join(SHEET_COLUMNS)


# ---------------------------------------------------------------------------
# Status enums
# ---------------------------------------------------------------------------

COPY_STATUS_PENDING:        str = "copy_pending"
COPY_STATUS_APPROVED:       str = "copy_approved"
COPY_STATUS_NEEDS_REVISION: str = "copy_needs_revision"

KNOWN_COPY_STATUSES: tuple[str, ...] = (
    COPY_STATUS_PENDING,
    COPY_STATUS_APPROVED,
    COPY_STATUS_NEEDS_REVISION,
)

DESIGN_STATUS_PENDING:          str = "design_pending"
DESIGN_STATUS_FIGMA_GENERATED:  str = "figma_generated"
DESIGN_STATUS_VISUAL_REVIEW:    str = "visual_review_needed"
DESIGN_STATUS_PUBLISH_READY:    str = "publish_ready"
DESIGN_STATUS_REJECTED:         str = "rejected"

KNOWN_DESIGN_STATUSES: tuple[str, ...] = (
    DESIGN_STATUS_PENDING,
    DESIGN_STATUS_FIGMA_GENERATED,
    DESIGN_STATUS_VISUAL_REVIEW,
    DESIGN_STATUS_PUBLISH_READY,
    DESIGN_STATUS_REJECTED,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_GOODS_NO_RE = re.compile(r"goodsNo=([A-Z]\d{10,})", re.IGNORECASE)


def extract_goods_no(source_url: str | None) -> str:
    """Pull `goodsNo=` out of a product URL. Returns "" when absent."""
    if not source_url:
        return ""
    m = _GOODS_NO_RE.search(source_url)
    return m.group(1).upper() if m else ""


def format_card_body(slide: Mapping) -> str:
    """Compose one card's body text from a slide dict.

    Layout (newline-separated):
      [subtitle]
      • bullet 1
      • bullet 2
      ...
      ※ footer_note   (when present)

    Subtitle and footer_note are skipped silently when absent.
    Bullets that already start with a marker (✓ — • etc.) are
    passed through verbatim so the polished copy's intent
    survives.
    """
    if not isinstance(slide, Mapping):
        return ""
    parts: list[str] = []
    sub = slide.get("subtitle")
    if isinstance(sub, str) and sub.strip():
        parts.append(sub.strip())
    bullets = slide.get("bullets") or []
    for b in bullets:
        if not isinstance(b, str) or not b.strip():
            continue
        s = b.strip()
        # Don't double-bullet rows the polished copy already marked.
        if s[:1] in ("•", "✓", "—", "-", "·", "◦", "*"):
            parts.append(s)
        else:
            parts.append(f"• {s}")
    footer = slide.get("footer_note")
    if isinstance(footer, str) and footer.strip():
        parts.append(f"※ {footer.strip()}")
    return "\n".join(parts)


def _today_utc_date() -> str:
    """YYYY-MM-DD in UTC. Stable across timezones for sheet sorting."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def build_cardnews_row(
    *,
    analysis_report: Mapping,
    cardnews_copy: Mapping,
    manifest: Mapping | None = None,
    run_id: str,
    copy_status: str = COPY_STATUS_PENDING,
    design_status: str = DESIGN_STATUS_PENDING,
    figma_file_url: str = "",
    png_folder: str = "",
    reviewer_notes: str = "",
    today_str: str | None = None,
) -> dict[str, str]:
    """Build one Sheet row from the available run artifacts.

    Returns a dict with exactly the columns in `SHEET_COLUMNS`,
    every value coerced to str (CSV / Sheet semantics).

    Validates `copy_status` and `design_status` against the
    enums above; raises `ValueError` on unknown status.
    """
    if not isinstance(analysis_report, Mapping):
        raise TypeError("analysis_report must be a Mapping")
    if not isinstance(cardnews_copy, Mapping):
        raise TypeError("cardnews_copy must be a Mapping")
    if not run_id or not isinstance(run_id, str):
        raise ValueError("run_id must be a non-empty string")
    if copy_status not in KNOWN_COPY_STATUSES:
        raise ValueError(
            f"copy_status must be one of {KNOWN_COPY_STATUSES}; "
            f"got {copy_status!r}",
        )
    if design_status not in KNOWN_DESIGN_STATUSES:
        raise ValueError(
            f"design_status must be one of {KNOWN_DESIGN_STATUSES}; "
            f"got {design_status!r}",
        )

    product = analysis_report.get("product") or {}
    corpus = analysis_report.get("corpus") or {}
    slides = list(cardnews_copy.get("slides") or [])

    # Review count: prefer `n_reviews_analyzed`; fall back to
    # `n_reviews_total`. Both come from the analysis_report's
    # locked schema.
    n = corpus.get("n_reviews_analyzed")
    if not isinstance(n, int) or n <= 0:
        n = corpus.get("n_reviews_total")

    row: dict[str, str] = {
        "date": today_str or _today_utc_date(),
        "run_id": run_id,
        "product_name": str(product.get("name_ko") or ""),
        "goods_no": extract_goods_no(str(product.get("source_url") or "")),
        "category": str(product.get("category") or ""),
        "profile_id": str(product.get("selected_profile_id") or ""),
        "review_count": str(n) if isinstance(n, int) and n > 0 else "",
        "confidence": str(corpus.get("confidence_level") or ""),
    }

    # Exactly 7 cards. Missing slides become empty strings — the
    # operator can fill them in the Sheet manually if needed, but
    # the Sheet schema must always have card01..card07.
    for i in range(7):
        slide = slides[i] if i < len(slides) else {}
        row[f"card{i + 1:02d}_title"] = (
            str((slide or {}).get("title") or "").strip()
        )
        row[f"card{i + 1:02d}_body"] = format_card_body(slide or {})

    row["copy_status"] = copy_status
    row["design_status"] = design_status
    row["figma_file_url"] = str(figma_file_url or "")
    row["png_folder"] = str(png_folder or "")
    row["reviewer_notes"] = str(reviewer_notes or "")

    # Sanity: every locked column is present.
    missing = [c for c in SHEET_COLUMNS if c not in row]
    extra = [k for k in row if k not in SHEET_COLUMNS]
    if missing or extra:
        raise RuntimeError(
            f"row schema drift — missing={missing} extra={extra}"
        )

    return row
