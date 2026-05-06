"""Final-stage automation: analysis output → Sheet → Figma plugin.

Architecture (mirrors jay.pm.ai):

    analysis_report.json            Google Sheet              Figma plugin
    + figma_cardnews_copy_ko.json   ┌─────────────────┐       ┌─────────────┐
    + manifest.json                 │ 1 row per run   │       │ master      │
            ────►  build_row  ──►   │ human-reviewed  │  ──►  │ frames ×7   │
                                    │ copy_status     │       │ cloned +    │
                                    │ design_status   │       │ filled      │
                                    └─────────────────┘       └─────────────┘
                                            ▲
                                            │ HTTP
                                       local data server
                                       (serve_figma_cardnews.py)

Modules:

- `sheet_row` — pure row builder (27 columns, deterministic).
- (`server` lives in scripts/serve_figma_cardnews.py — stdlib only.)
- (`export` lives in scripts/export_cardnews_to_sheet.py — CSV-default.)

Why this shape:

1. The Sheet is the *only* human-review surface. Anything not yet
   approved cannot reach Figma.
2. The local server is a thin read-only adapter so the Figma plugin
   never needs Google API credentials or auth flows.
3. The row builder is pure so the Sheet schema is testable without
   any external dependency.
"""

from src.voc.figma_pipeline.sheet_row import (
    SHEET_COLUMNS,
    SHEET_TEMPLATE_HEADER,
    COPY_STATUS_PENDING,
    COPY_STATUS_APPROVED,
    COPY_STATUS_NEEDS_REVISION,
    DESIGN_STATUS_PENDING,
    DESIGN_STATUS_FIGMA_GENERATED,
    DESIGN_STATUS_VISUAL_REVIEW,
    DESIGN_STATUS_PUBLISH_READY,
    DESIGN_STATUS_REJECTED,
    KNOWN_COPY_STATUSES,
    KNOWN_DESIGN_STATUSES,
    build_cardnews_row,
    extract_goods_no,
    format_card_body,
)

__all__ = [
    "SHEET_COLUMNS",
    "SHEET_TEMPLATE_HEADER",
    "COPY_STATUS_PENDING",
    "COPY_STATUS_APPROVED",
    "COPY_STATUS_NEEDS_REVISION",
    "DESIGN_STATUS_PENDING",
    "DESIGN_STATUS_FIGMA_GENERATED",
    "DESIGN_STATUS_VISUAL_REVIEW",
    "DESIGN_STATUS_PUBLISH_READY",
    "DESIGN_STATUS_REJECTED",
    "KNOWN_COPY_STATUSES",
    "KNOWN_DESIGN_STATUSES",
    "build_cardnews_row",
    "extract_goods_no",
    "format_card_body",
]
