"""One-shot CLI: generate a Phase 1 mini-report (JSON + markdown) on rows
already in ``phase1_reviews``. No ingestion happens here — the CLI reads
from whichever DB ``PHASE1_DB_PATH`` points at.

Usage:
    PYTHONPATH=. python3 scripts/generate_phase1_report.py \\
        [--channel oliveyoung] [--channel coupang] \\
        [--product-id A000000238828] [--product-id ...] \\
        [--start 2026-03-01] [--end 2026-04-30] \\
        [--output-dir reports]

Flags:
    --channel      Repeatable. Filters by source_channel. Omit for all channels.
    --product-id   Repeatable. Filters by phase1_reviews.product_external_id.
    --start/--end  ISO-formatted review_date bounds (inclusive). Either or both.
    --output-dir   Where to write the JSON + .md (default: ./reports).
    --stdout       Print the markdown report to stdout INSTEAD of writing .md
                   (JSON is still written). Useful for preview.

Environment:
    PHASE1_DB_PATH            sqlite db path (default: voc_data.db at repo root)
    PHASE1_LEXICON_POSITIVE   positive lexicon override
    PHASE1_LEXICON_CAUTIONARY cautionary lexicon override
    PHASE1_PRODUCT_LABELS     product display-label mapping override

This is the template-only renderer (PR5C). PR5D adds optional LLM narrative
behind a separate flag; it does not change the CLI signature.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from datetime import date
from pathlib import Path

from src.voc.persistence.migrations import init_db
from src.voc.persistence.phase1_review_repository import Phase1ReviewRepository
from src.voc.reporting.phase1.narrative import render_markdown
from src.voc.reporting.phase1.pipeline import (
    build_report,
    load_product_categories,
    load_product_labels,
)
from src.voc.reporting.phase1.schema import ReportQuery
from src.voc.reporting.phase1.signals import load_lexicons

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = os.environ.get("PHASE1_DB_PATH", str(REPO_ROOT / "voc_data.db"))
DEFAULT_OUTPUT_DIR = REPO_ROOT / "reports"
DEFAULT_LEXICON_POSITIVE = os.environ.get(
    "PHASE1_LEXICON_POSITIVE",
    str(REPO_ROOT / "data" / "phase1_lexicons" / "positive.json"),
)
DEFAULT_LEXICON_CAUTIONARY = os.environ.get(
    "PHASE1_LEXICON_CAUTIONARY",
    str(REPO_ROOT / "data" / "phase1_lexicons" / "cautionary.json"),
)
DEFAULT_PRODUCT_LABELS = os.environ.get(
    "PHASE1_PRODUCT_LABELS",
    str(REPO_ROOT / "data" / "phase1_product_labels.json"),
)


def _parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Generate a Phase 1 mini-report from phase1_reviews.",
    )
    p.add_argument("--channel", action="append", default=[],
                   help="Filter by source_channel. Repeatable.")
    p.add_argument("--product-id", dest="product_ids", action="append", default=[],
                   help="Filter by product_external_id. Repeatable.")
    p.add_argument("--start", type=date.fromisoformat, default=None,
                   help="Inclusive lower bound on review_date (YYYY-MM-DD).")
    p.add_argument("--end", type=date.fromisoformat, default=None,
                   help="Inclusive upper bound on review_date (YYYY-MM-DD).")
    p.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR,
                   help=f"Where to write outputs (default: {DEFAULT_OUTPUT_DIR}).")
    p.add_argument("--stdout", action="store_true",
                   help="Print markdown to stdout instead of writing a .md file "
                        "(JSON is still written).")
    p.add_argument("--include-charts", action="store_true",
                   help="Render static PNG charts alongside the .md/.json "
                        "output and embed image references. Requires "
                        "matplotlib (install via '.[charts]' extra). "
                        "v1: rating-distribution bar only.")
    return p.parse_args(argv)


def _fetch_rows(
    repo: Phase1ReviewRepository,
    *,
    channels: list[str],
    product_ids: list[str],
    start: date | None,
    end: date | None,
) -> list[dict]:
    """Fetch and filter rows. The repo supports channel-level filtering; we
    handle product_ids and date window in Python because the repo does not
    yet support those (Phase 1 volume is small, this is fine)."""
    raw: list[dict] = []
    if channels:
        for ch in channels:
            raw.extend(repo.query(source_channel=ch))
    else:
        raw.extend(repo.query())

    product_filter = set(product_ids) if product_ids else None

    out: list[dict] = []
    for r in raw:
        if product_filter is not None and r.get("product_external_id") not in product_filter:
            continue
        rd = r.get("review_date")
        if rd:
            try:
                d = date.fromisoformat(rd)
            except ValueError:
                d = None
        else:
            d = None
        if start is not None and (d is None or d < start):
            continue
        if end is not None and (d is None or d > end):
            continue
        out.append(r)
    return out


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )
    args = _parse_args(argv if argv is not None else sys.argv[1:])

    db = init_db(DEFAULT_DB)
    try:
        repo = Phase1ReviewRepository(db)
        rows = _fetch_rows(
            repo,
            channels=args.channel,
            product_ids=args.product_ids,
            start=args.start,
            end=args.end,
        )
    finally:
        db.close()

    query = ReportQuery(
        channel_filter=args.channel or None,
        product_ids=args.product_ids or None,
        window_start=args.start,
        window_end=args.end,
    )
    lexicons = load_lexicons(DEFAULT_LEXICON_POSITIVE, DEFAULT_LEXICON_CAUTIONARY)
    product_labels = load_product_labels(DEFAULT_PRODUCT_LABELS)
    product_categories = load_product_categories(DEFAULT_PRODUCT_LABELS)
    report = build_report(
        rows,
        query,
        lexicons=lexicons,
        product_labels=product_labels,
        product_categories=product_categories,
    )

    output_dir: Path = args.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)
    json_path = output_dir / f"{report.report_id}.json"
    json_path.write_text(
        json.dumps(report.model_dump(mode="json"), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    # Optional chart rendering. When --include-charts is set, produce the
    # PNG charts next to the .md/.json and pass their filenames to the
    # markdown renderer for embedding.
    chart_paths: dict[str, str] = {}
    if args.include_charts:
        from src.voc.reporting.phase1.charts import (
            render_coverage_composition_bar,
            render_rating_distribution_bar,
            render_segment_signal_heatmap,
        )
        # Rating distribution — always producible.
        rating_png = output_dir / f"{report.report_id}_rating_dist.png"
        render_rating_distribution_bar(
            report.deterministic_metrics, rating_png,
        )
        chart_paths["rating_distribution"] = rating_png.name

        # Coverage composition — only when the report has rows.
        if report.coverage and report.coverage.total_reviews > 0:
            coverage_png = output_dir / f"{report.report_id}_coverage.png"
            render_coverage_composition_bar(report.coverage, coverage_png)
            chart_paths["coverage_composition"] = coverage_png.name

        # Segment × signal heatmap — needs row-level membership, so
        # re-run detection here (cheap). Don't redeclare load_lexicons
        # locally — it's already imported at module top; a local import
        # makes it a function-local name for the entire main() scope,
        # which breaks the earlier unconditional use at line ~150.
        from src.voc.reporting.phase1.signals import (
            detect_signals_with_membership,
        )
        _, _membership = detect_signals_with_membership(
            rows, lexicons, product_categories=product_categories,
        )
        heatmap_png = output_dir / f"{report.report_id}_segment_heatmap.png"
        try:
            render_segment_signal_heatmap(
                rows, report.signals, _membership, heatmap_png,
            )
            chart_paths["segment_signal_heatmap"] = heatmap_png.name
        except ValueError as e:
            logging.info("segment_signal_heatmap skipped: %s", e)

    md = render_markdown(report, chart_paths=chart_paths or None)
    if args.stdout:
        sys.stdout.write(md)
    else:
        md_path = output_dir / f"{report.report_id}.md"
        md_path.write_text(md, encoding="utf-8")

    # Print a small JSON handoff so scripts/operators can locate artifacts.
    sys.stderr.write(json.dumps(
        {
            "report_id": report.report_id,
            "json_path": str(json_path),
            "md_path": None if args.stdout else str(output_dir / f"{report.report_id}.md"),
            "rows_in_scope": report.scope.total_reviews,
            "db_path": DEFAULT_DB,
        },
        ensure_ascii=False,
        indent=2,
    ) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
