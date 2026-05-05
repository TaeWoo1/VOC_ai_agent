"""Build a review_ops pilot package index over existing run_dirs.

Read-only by design — never runs collection or analysis. Walks each given
run_dir, gathers per-run artifact paths, and writes a single index.html
into --package-dir with relative links to:
  - shared/analysis_report.json (base)
  - seller_report/seller_report_ko.pdf (base, optional)
  - buyer_content/ko/buyer_journey_cardnews.json (base, optional)
  - shared/review_ops_analysis.json (review_ops, optional)
  - review_ops/review_ops_report.html (review_ops, optional)

Usage:
    PYTHONPATH=. python3 scripts/build_review_ops_package_index.py \\
        --package-dir outputs/review_ops_brand20_20260505 \\
        --run-dir outputs/<run_a> --run-dir outputs/<run_b> ...

  or:

    PYTHONPATH=. python3 scripts/build_review_ops_package_index.py \\
        --package-dir outputs/review_ops_brand20_20260505 \\
        --runs-file configs/brand20_run_dirs.txt
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional

DEFAULT_CONTENT_PACKAGES_ROOT = Path("outputs/content_packages")

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


# ── data extraction ──────────────────────────────────────────────────


@dataclass
class RunSummary:
    run_dir: Path
    brand: Optional[str] = None
    product_name: Optional[str] = None
    profile_id: Optional[str] = None
    total_reviews: Optional[int] = None
    average_rating: Optional[float] = None
    period_start: Optional[str] = None
    period_end: Optional[str] = None
    analysis_report: Optional[Path] = None
    seller_pdf: Optional[Path] = None
    cardnews_json: Optional[Path] = None
    review_ops_html: Optional[Path] = None
    review_ops_json: Optional[Path] = None
    cardnews_png_dir: Optional[Path] = None  # rendered cardnews dir (parent of pages/)
    cardnews_png_count: int = 0
    cardnews_cover_png: Optional[Path] = None
    qa_status: str = "missing"  # "ready" | "partial" | "missing"
    note: str = ""
    errors: list[str] = field(default_factory=list)


def _read_json(path: Path) -> Optional[dict]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _sha256_file(path: Path) -> Optional[str]:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except OSError:
        return None


def _sha256_analysis_report(path: Path) -> Optional[str]:
    """Mirror src/voc/content/cardnews_long_layout._analysis_report_sha256.

    The cardnews renderer writes `analysis_report_sha256` in its manifest as
    sha256 of `json.dumps(report, ensure_ascii=False, sort_keys=True)`, NOT
    the raw bytes on disk. Match that canonicalization here so sha-based
    lookup actually finds rendered packages.
    """
    try:
        report = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    blob = json.dumps(report, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


@dataclass
class CardnewsPackagesIndex:
    """Lookup table for rendered cardnews packages under outputs/content_packages/."""
    by_sha: dict[str, Path] = field(default_factory=dict)  # analysis_report_sha256 → cardnews dir
    by_basename: dict[str, Path] = field(default_factory=dict)  # package slug → cardnews dir


def scan_cardnews_packages(
    content_packages_root: Optional[Path] = None,
) -> CardnewsPackagesIndex:
    """Walk outputs/content_packages/<slug>/cardnews/<lang>/manifest.json and
    build sha256 + basename indexes pointing at each cardnews dir (the parent
    of pages/). Skips directories without a parsable manifest."""
    root = content_packages_root or DEFAULT_CONTENT_PACKAGES_ROOT
    idx = CardnewsPackagesIndex()
    if not root.is_dir():
        return idx
    for manifest_path in root.glob("*/cardnews/*/manifest.json"):
        cn_dir = manifest_path.parent  # outputs/content_packages/<slug>/cardnews/<lang>/
        try:
            data = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        # Slug is two parents up from cardnews/<lang>/
        slug = cn_dir.parent.parent.name
        idx.by_basename[slug] = cn_dir
        sha = data.get("analysis_report_sha256")
        if isinstance(sha, str) and sha:
            idx.by_sha[sha] = cn_dir
    return idx


def _find_cardnews_dir(
    run_dir: Path,
    packages_index: CardnewsPackagesIndex,
) -> Optional[Path]:
    """Match a run_dir to its rendered cardnews dir.

    Preferred: analysis_report.json sha256 lookup (handles cases where the
    cardnews package slug differs from the run_dir basename, e.g. the hince
    smoke render lives at content_packages/hince_raw_glow_gel_tint/ while
    the source run_dir is batch_oy_top8_real_..._hince_raw_glow_gel_tint).
    Fallback: basename match.
    """
    ar = run_dir / "shared" / "analysis_report.json"
    if ar.exists():
        sha = _sha256_analysis_report(ar)
        if sha and sha in packages_index.by_sha:
            return packages_index.by_sha[sha]
    return packages_index.by_basename.get(run_dir.name)


def _resolve_artifacts(
    run_dir: Path,
    packages_index: Optional[CardnewsPackagesIndex] = None,
) -> RunSummary:
    summary = RunSummary(run_dir=run_dir)

    ar_path = run_dir / "shared" / "analysis_report.json"
    if not ar_path.exists():
        summary.qa_status = "missing"
        summary.errors.append("missing shared/analysis_report.json")
        return summary
    summary.analysis_report = ar_path

    # Optional artifacts.
    pdf = run_dir / "seller_report" / "seller_report_ko.pdf"
    if pdf.exists():
        summary.seller_pdf = pdf

    cn = run_dir / "buyer_content" / "ko" / "buyer_journey_cardnews.json"
    if cn.exists():
        summary.cardnews_json = cn

    ro_html = run_dir / "review_ops" / "review_ops_report.html"
    if ro_html.exists():
        summary.review_ops_html = ro_html

    ro_json = run_dir / "shared" / "review_ops_analysis.json"
    if ro_json.exists():
        summary.review_ops_json = ro_json

    # Rendered cardnews PNGs (consumer-facing assets). Sha256-then-basename match.
    if packages_index is not None:
        cn_dir = _find_cardnews_dir(run_dir, packages_index)
        if cn_dir is not None:
            pages_dir = cn_dir / "pages"
            if pages_dir.is_dir():
                pngs = sorted(pages_dir.glob("*.png"))
                if pngs:
                    summary.cardnews_png_dir = pages_dir
                    summary.cardnews_png_count = len(pngs)
                    cover = pages_dir / "01_cover.png"
                    if cover.exists():
                        summary.cardnews_cover_png = cover
                    else:
                        summary.cardnews_cover_png = pngs[0]

    # Prefer review_ops_analysis.json for product/metrics; fall back to
    # analysis_report.json when missing.
    ro_payload = _read_json(ro_json) if ro_json.exists() else None
    ar_payload = _read_json(ar_path)

    product_block: dict = {}
    metrics_block: dict = {}
    if ro_payload:
        product_block = ro_payload.get("product") or {}
        metrics_block = ro_payload.get("metrics") or {}
    if not product_block and ar_payload:
        product_block = ar_payload.get("product") or {}
    if not metrics_block and ar_payload:
        corpus = ar_payload.get("corpus") or {}
        metrics_block = {
            "total_reviews": corpus.get("n_reviews_total")
            or corpus.get("n_reviews_analyzed"),
        }

    summary.brand = product_block.get("brand_name")
    # Prefer the review_ops-cleaned header_title for the index display when
    # present (no leading "[promo]" / trailing "(offer)" noise).
    summary.product_name = (
        product_block.get("header_title")
        or product_block.get("display_product_name")
        or product_block.get("name_ko")
        or product_block.get("raw_product_name")
    )
    summary.profile_id = product_block.get("selected_profile_id")
    summary.total_reviews = metrics_block.get("total_reviews")
    summary.average_rating = metrics_block.get("average_rating")

    # analysis_period: prefer review_ops_analysis if populated.
    if ro_payload:
        period = (ro_payload.get("product") or {}).get("analysis_period") or {}
        summary.period_start = period.get("start")
        summary.period_end = period.get("end")
    if not summary.period_start and ar_payload:
        window = (ar_payload.get("corpus") or {}).get("observation_window") or {}
        summary.period_start = window.get("start")
        summary.period_end = window.get("end")

    # QA status: ready iff every artifact slot is populated.
    has_all = all(
        x is not None
        for x in (
            summary.analysis_report,
            summary.seller_pdf,
            summary.cardnews_json,
            summary.review_ops_html,
            summary.review_ops_json,
        )
    )
    summary.qa_status = "ready" if has_all else "partial"
    return summary


# ── input resolution ─────────────────────────────────────────────────


def _read_runs_file(path: Path) -> list[Path]:
    out: list[Path] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        # Allow CSV-ish first column.
        first = line.split(",")[0].strip()
        if first:
            out.append(Path(first))
    return out


# ── HTML rendering ───────────────────────────────────────────────────


def _rel_or_dash(target: Optional[Path], base: Path) -> str:
    if target is None:
        return ""
    return os.path.relpath(target, base)


def _link_or_missing(target: Optional[Path], base: Path, label: str) -> str:
    if target is None:
        return '<span class="missing">not found</span>'
    rel = _rel_or_dash(target, base)
    return f'<a href="{rel}">{label}</a>'


def _ro_html_or_missing(summary: RunSummary, base: Path) -> str:
    if summary.review_ops_html is None:
        return '<span class="missing">not generated</span>'
    return _link_or_missing(summary.review_ops_html, base, "HTML")


def _ro_json_or_missing(summary: RunSummary, base: Path) -> str:
    if summary.review_ops_json is None:
        return '<span class="missing">not generated</span>'
    return _link_or_missing(summary.review_ops_json, base, "JSON")


def _cardnews_png_cell(summary: RunSummary, base: Path) -> str:
    """Cardnews PNG cell: 'N pages' + cover link, or 'cardnews images not found'."""
    if summary.cardnews_png_count <= 0 or summary.cardnews_png_dir is None:
        return '<span class="missing">cardnews images not found</span>'
    cover_html = ""
    if summary.cardnews_cover_png is not None:
        rel_cover = _rel_or_dash(summary.cardnews_cover_png, base)
        cover_html = f' · <a href="{rel_cover}">01_cover.png</a>'
    rel_dir = _rel_or_dash(summary.cardnews_png_dir, base)
    return (
        f'<a href="{rel_dir}">{summary.cardnews_png_count} pages</a>'
        f"{cover_html}"
    )


def _row_html(idx: int, summary: RunSummary, base: Path) -> str:
    metric = "—"
    if summary.total_reviews is not None:
        avg = (
            f" / ★{summary.average_rating:.2f}"
            if isinstance(summary.average_rating, (int, float)) and summary.average_rating
            else ""
        )
        metric = f"{summary.total_reviews:,}{avg}"
    period = "—"
    if summary.period_start or summary.period_end:
        period = f"{summary.period_start or '?'} ~ {summary.period_end or '?'}"
    qa_class = {
        "ready": "qa-ready",
        "partial": "qa-partial",
        "missing": "qa-missing",
    }.get(summary.qa_status, "")

    return f"""
      <tr>
        <td class="order">{idx}</td>
        <td>{summary.brand or "—"}</td>
        <td class="product">{summary.product_name or "—"}</td>
        <td>{metric}</td>
        <td>{period}</td>
        <td>{summary.profile_id or "—"}</td>
        <td>{_link_or_missing(summary.analysis_report, base, "analysis_report.json")}</td>
        <td>{_link_or_missing(summary.seller_pdf, base, "seller_report_ko.pdf")}</td>
        <td>{_link_or_missing(summary.cardnews_json, base, "buyer_journey_cardnews.json")}</td>
        <td>{_cardnews_png_cell(summary, base)}</td>
        <td>{_ro_html_or_missing(summary, base)}</td>
        <td>{_ro_json_or_missing(summary, base)}</td>
        <td class="{qa_class}">{summary.qa_status}</td>
        <td class="note">{summary.note or (' · '.join(summary.errors) if summary.errors else '')}</td>
      </tr>"""


_INDEX_CSS = """
  body {
    margin: 28px 24px;
    font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo",
      "Pretendard", "Noto Sans KR", sans-serif;
    color: #1f2937;
    line-height: 1.5;
  }
  h1 { font-size: 22px; margin: 0 0 6px 0; color: #0f766e; }
  p.sub { color: #6b7280; font-size: 13px; margin: 0 0 16px 0; }
  .framing {
    margin: 0 0 18px 0;
    padding: 12px 14px;
    background: #f9fafb;
    border: 1px dashed #d1d5db;
    border-radius: 6px;
    color: #4b5563;
    font-size: 12px;
    line-height: 1.6;
  }
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  thead th {
    background: #f9fafb;
    border-bottom: 2px solid #0f766e;
    text-align: left;
    padding: 8px 8px;
    font-weight: 600;
    vertical-align: bottom;
  }
  tbody td {
    border-bottom: 1px solid #e5e7eb;
    padding: 8px 8px;
    vertical-align: top;
  }
  .order { text-align: center; font-weight: 600; color: #0f766e; }
  .product { font-weight: 600; }
  .missing { color: #9ca3af; font-style: italic; font-size: 11px; }
  .qa-ready { color: #0f766e; font-weight: 600; }
  .qa-partial { color: #b45309; font-weight: 600; }
  .qa-missing { color: #b91c1c; font-weight: 600; }
  .note { color: #4b5563; font-size: 11px; }
  a { color: #0f766e; text-decoration: none; }
  a:hover { text-decoration: underline; }
  footer {
    margin-top: 22px;
    color: #6b7280;
    font-size: 11px;
    border-top: 1px solid #e5e7eb;
    padding-top: 12px;
  }
"""


def _render_index_html(summaries: list[RunSummary], package_dir: Path) -> str:
    rows = "".join(
        _row_html(i + 1, s, package_dir) for i, s in enumerate(summaries)
    )
    generated = datetime.now().strftime("%Y-%m-%d %H:%M")
    return f"""<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <title>Review Ops Pilot Package — {generated}</title>
  <style>{_INDEX_CSS}</style>
</head>
<body>
  <h1>Review Ops Pilot Package Index</h1>
  <p class="sub">Generated {generated} · {len(summaries)} run_dirs</p>
  <p class="framing">
    이 인덱스는 base VOC 산출물(<code>analysis_report.json</code> · seller PDF · cardnews JSON)과
    review_ops 보조 산출물(<code>review_ops_analysis.json</code> · review_ops_report.html)을
    한 페이지에서 함께 열어볼 수 있도록 모은 것입니다. review_ops는 base 분석에 운영 액션 관점의
    재가공을 더한 <b>companion report</b>입니다. QA status는 산출물 완전성 기준 (ready / partial / missing).
  </p>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Brand</th>
        <th>Product</th>
        <th>Reviews / ★</th>
        <th>Period</th>
        <th>Profile</th>
        <th>Base · analysis_report</th>
        <th>Base · seller PDF</th>
        <th>Base · cardnews JSON source</th>
        <th>Consumer · cardnews PNG</th>
        <th>Review Ops · HTML</th>
        <th>Review Ops · JSON</th>
        <th>QA</th>
        <th>Note</th>
      </tr>
    </thead>
    <tbody>{rows}
    </tbody>
  </table>
  <footer>
    Read-only index; no run_dirs are modified. Build script:
    scripts/build_review_ops_package_index.py
  </footer>
</body>
</html>
"""


# ── CLI ──────────────────────────────────────────────────────────────


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--package-dir", required=True, type=Path,
        help="Output directory for index.html (created if missing).",
    )
    p.add_argument(
        "--run-dir", action="append", type=Path, default=None,
        help="Run directory to index. Repeatable.",
    )
    p.add_argument(
        "--runs-file", type=Path, default=None,
        help="Text/CSV file listing run_dirs (one path per line, # comments allowed).",
    )
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)

    runs: list[Path] = list(args.run_dir or [])
    if args.runs_file:
        runs.extend(_read_runs_file(args.runs_file))
    if not runs:
        print(
            "[package-index] no run_dirs supplied (use --run-dir or --runs-file)",
            file=sys.stderr,
        )
        return 1

    args.package_dir.mkdir(parents=True, exist_ok=True)

    packages_index = scan_cardnews_packages()
    summaries = [_resolve_artifacts(rd, packages_index) for rd in runs]

    out_path = args.package_dir / "index.html"
    out_path.write_text(
        _render_index_html(summaries, args.package_dir), encoding="utf-8"
    )

    ready = sum(1 for s in summaries if s.qa_status == "ready")
    partial = sum(1 for s in summaries if s.qa_status == "partial")
    missing = sum(1 for s in summaries if s.qa_status == "missing")
    print(
        f"[package-index] indexed {len(summaries)} run_dirs "
        f"(ready={ready} partial={partial} missing={missing})"
    )
    print(f"[package-index] wrote {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
