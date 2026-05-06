"""One-shot CLI: render a 1-page bait PPTX from an existing Phase 1 report JSON.

Usage:
    PYTHONPATH=. python3 scripts/generate_phase1_bait.py <report.json>
        [--output some_name.pptx] [--db voc_data.db]

Inputs:
    report.json  — a Phase 1 report JSON produced by
                   scripts/generate_phase1_report.py.

Optional:
    --output     — destination PPTX path. Default: sibling to the JSON,
                   suffix ``_bait.pptx``.
    --db         — SQLite DB to look up review text for quoted excerpts.
                   Default: PHASE1_DB_PATH env var, else voc_data.db at repo
                   root. Pass an empty string to skip DB lookups (quotes
                   omitted; signal names + counts still render).

Outputs:
    A single-slide PPTX written to --output (or inferred).

Framing: this is a strict post-stage. The upstream JSON/Markdown artifacts
remain the evidence layer; this CLI only produces the outbound 1-pager.

Dependency: python-pptx (installed via ``pip install -e '.[bait]'``).
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sqlite3
import sys
from pathlib import Path

from src.voc.reporting.phase1.bait import render_bait_pptx
from src.voc.reporting.phase1.schema import Phase1Report

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = os.environ.get("PHASE1_DB_PATH", str(REPO_ROOT / "voc_data.db"))


def _parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Render a 1-page bait PPTX from a Phase 1 report JSON.",
    )
    p.add_argument(
        "report_json",
        type=Path,
        help="Path to a Phase 1 report JSON (produced by "
             "scripts/generate_phase1_report.py).",
    )
    p.add_argument(
        "--output", type=Path, default=None,
        help="Destination PPTX path. Default: sibling to the JSON, "
             "suffix _bait.pptx.",
    )
    p.add_argument(
        "--db", type=str, default=DEFAULT_DB,
        help=f"SQLite DB used to look up review text for quotes. Default: "
             f"{DEFAULT_DB}. Pass '' to skip DB lookups.",
    )
    return p.parse_args(argv)


def _collect_quote_ids(report: Phase1Report) -> set[str]:
    """Gather the review_ids the bait renderer will need.

    We look up every sample_review_id from the top-3 cautionary signals +
    every gap signal (the operational-selection logic chooses one at render
    time, but we don't know which here, so fetch all). Over-fetching a few
    is cheaper than doing conditional DB lookups.
    """
    ids: set[str] = set()
    for s in list(report.signals.cautionary) + list(report.signals.gaps):
        for rid in s.sample_review_ids:
            ids.add(str(rid))
    return ids


def _load_quote_texts(db_path: str, review_ids: set[str]) -> dict[str, str]:
    """Pull {review_id: text} for the given ids from phase1_reviews.

    Returns empty dict when db_path is falsy, DB missing, or ids is empty —
    the bait renderer handles missing quote text silently.
    """
    if not db_path or not review_ids:
        return {}
    p = Path(db_path)
    if not p.is_file():
        logging.warning("bait: DB not found at %s; quotes will be omitted", p)
        return {}
    placeholders = ",".join("?" * len(review_ids))
    with sqlite3.connect(str(p)) as conn:
        cur = conn.cursor()
        rows = cur.execute(
            f"SELECT review_id, text FROM phase1_reviews "
            f"WHERE review_id IN ({placeholders})",
            tuple(review_ids),
        ).fetchall()
    return {str(rid): text for rid, text in rows if text}


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )
    args = _parse_args(argv if argv is not None else sys.argv[1:])

    json_path: Path = args.report_json
    if not json_path.is_file():
        print(f"ERROR: report JSON not found at {json_path}", file=sys.stderr)
        return 1

    payload = json.loads(json_path.read_text(encoding="utf-8"))
    report = Phase1Report.model_validate(payload)

    output_path: Path = (
        args.output
        if args.output is not None
        else json_path.with_name(json_path.stem + "_bait.pptx")
    )

    quote_ids = _collect_quote_ids(report)
    review_text_by_id = _load_quote_texts(args.db, quote_ids)

    render_bait_pptx(
        report, output_path,
        review_text_by_id=review_text_by_id,
    )

    print(json.dumps(
        {
            "report_id": report.report_id,
            "report_json": str(json_path),
            "bait_pptx": str(output_path),
            "quote_ids_found": len(review_text_by_id),
            "quote_ids_needed": len(quote_ids),
            "db_path": args.db,
        },
        ensure_ascii=False,
        indent=2,
    ))
    return 0


if __name__ == "__main__":
    sys.exit(main())
