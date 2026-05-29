#!/usr/bin/env python3
"""Generate the industrial review-ops sample HTML report from the sample CSV.

Run from the repo root:
    PYTHONPATH=. python3 scripts/review_ops/industrial/generate_sample_report.py

Writes a standalone HTML file to /tmp and prints its path. CSV → HTML only;
no Excel, no PDF, no LLM, no network.
"""

from __future__ import annotations

from pathlib import Path

from src.voc.review_ops.industrial.dedup import dedup
from src.voc.review_ops.industrial.ingest import load_csv
from src.voc.review_ops.industrial.normalize import normalize_rows
from src.voc.review_ops.industrial.render_html import render_report_html
from src.voc.review_ops.industrial.report_model import SAMPLE_DENSITY_NOTE, build_report

REPO_ROOT = Path(__file__).resolve().parents[3]
SAMPLE_CSV = REPO_ROOT / "samples" / "review_ops_industrial" / "input" / "sample_reviews.csv"
OUTPUT_HTML = Path("/tmp/industrial_review_ops_sample.html")


def main() -> None:
    rows = load_csv(SAMPLE_CSV)
    reviews = dedup(normalize_rows(rows))
    report = build_report(reviews, density_note=SAMPLE_DENSITY_NOTE)
    OUTPUT_HTML.write_text(render_report_html(report), encoding="utf-8")

    active = [r for r in reviews if not r.is_duplicate]
    dupes = len(reviews) - len(active)
    today = sum(1 for r in report.worklist if r.tier == "today")
    week = len(report.worklist) - today
    print(f"Input rows        : {len(rows)}")
    print(f"Reviews (active)  : {len(active)}  (duplicates flagged: {dupes})")
    print(f"Worklist items    : {len(report.worklist)}")
    print(f"  오늘 먼저 볼 리뷰 : {today}")
    print(f"  이번 주 안에 볼 리뷰: {week}")
    print(f"date_unknown_count : {report.header.date_unknown_count}")
    print(f"rating_unknown_count: {report.header.rating_unknown_count}")
    print(f"HTML written to   : {OUTPUT_HTML}")


if __name__ == "__main__":
    main()
