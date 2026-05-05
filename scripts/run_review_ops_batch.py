"""Run the review_ops pipeline across many existing run_dirs.

Reuses scripts/generate_review_ops_report.py's per-run logic via
src.voc.reporting.review_ops.pipeline.process_run_dir, so behavior
stays identical to the single-run CLI. No new analysis logic.

Discovery:
  - --run-dir <path> (repeatable): explicit list, used as-is.
  - Otherwise scan --outputs-dir for direct subdirs that contain
    shared/analysis_report.json. Sorted ascending by name for
    deterministic ordering. --limit caps the count.

Output:
  - One log line per run to stderr: status, reviews loaded, cluster count.
  - A single batch summary JSON to stdout at the end.

Exit code:
  - 0 if at least one run succeeded.
  - 1 otherwise (including when no candidates are discovered).

Usage:
    PYTHONPATH=. python scripts/run_review_ops_batch.py --outputs-dir outputs
    PYTHONPATH=. python scripts/run_review_ops_batch.py \\
        --run-dir outputs/run_a --run-dir outputs/run_b --db-path voc_data.db
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Optional

_PRODUCT_HASH_RE = re.compile(r"product-([0-9a-f]+)")

# Make `src.voc.*` imports work when invoked as `python scripts/...`.
REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from src.voc.reporting.review_ops.pipeline import (  # noqa: E402
    ProcessResult,
    process_run_dir,
)


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--outputs-dir",
        type=Path,
        default=Path("outputs"),
        help="Directory to scan for run_dirs (default: outputs).",
    )
    parser.add_argument(
        "--run-dir",
        type=Path,
        action="append",
        default=None,
        help="Explicit run_dir to process. Repeatable. Overrides --outputs-dir scan.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Cap the number of run_dirs processed when scanning --outputs-dir.",
    )
    parser.add_argument(
        "--db-path",
        type=Path,
        default=None,
        help="Path to voc_data.db (default: <repo>/voc_data.db). Read-only.",
    )
    parser.add_argument(
        "--newest-per-product",
        action="store_true",
        help=(
            "Collapse run_dirs to one-per-product (newest by run_dir name). "
            "Identity is resolved from analysis_report.product.{slug,product_id}, "
            "then manifest.product.{slug,source_url}, then a 'product-XXXX' hash "
            "parsed from the run_dir name. Applied before --limit."
        ),
    )
    return parser.parse_args(argv)


def _read_json_safe(path: Path) -> Optional[dict]:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _product_identity(run_dir: Path) -> str:
    """Resolve a stable product identity for grouping.

    Priority (per spec):
      1) analysis_report.product.slug
      2) analysis_report.product.product_id
      3) manifest.product.slug
      4) manifest.product.source_url
      5) 'product-XXXXXXXX' hash parsed from the run_dir name
      6) fallback: the run_dir name itself (so unknown items never collapse)
    Source-prefixed strings keep keys disjoint across origins.
    """
    ar = _read_json_safe(run_dir / "shared" / "analysis_report.json") or {}
    ar_prod = (ar.get("product") or {}) if isinstance(ar, dict) else {}
    for key in ("slug", "product_id"):
        v = ar_prod.get(key)
        if isinstance(v, str) and v:
            return f"ar:{key}:{v}"

    mf = _read_json_safe(run_dir / "manifest.json") or {}
    mf_prod = (mf.get("product") or {}) if isinstance(mf, dict) else {}
    for key in ("slug", "source_url"):
        v = mf_prod.get(key)
        if isinstance(v, str) and v:
            return f"mf:{key}:{v}"

    match = _PRODUCT_HASH_RE.search(run_dir.name)
    if match:
        return f"name:product-{match.group(1)}"
    return f"path:{run_dir.name}"


def _dedup_newest_per_product(candidates: list[Path]) -> list[Path]:
    """Keep one run_dir per product identity — the lexicographically newest
    name (run_dir names are ISO-date prefixed, so lex max == newest)."""
    by_product: dict[str, Path] = {}
    for run_dir in candidates:
        identity = _product_identity(run_dir)
        existing = by_product.get(identity)
        if existing is None or run_dir.name > existing.name:
            by_product[identity] = run_dir
    return sorted(by_product.values(), key=lambda p: p.name)


def _discover_candidates(outputs_dir: Path) -> list[Path]:
    if not outputs_dir.is_dir():
        return []
    candidates: list[Path] = []
    for child in sorted(outputs_dir.iterdir(), key=lambda p: p.name):
        if not child.is_dir():
            continue
        if not (child / "shared" / "analysis_report.json").exists():
            continue
        candidates.append(child)
    return candidates


def _summarize(results: list[ProcessResult]) -> dict:
    succeeded = sum(1 for r in results if r.status == "success")
    failed = sum(1 for r in results if r.status == "failed")
    skipped = sum(1 for r in results if r.status == "skipped")
    return {
        "total_candidates": len(results),
        "succeeded": succeeded,
        "failed": failed,
        "skipped": skipped,
        "results": [
            {
                "run_dir": str(r.run_dir),
                "status": r.status,
                "reviews_loaded": r.reviews_loaded,
                "total_reviews": r.total_reviews,
                "asset_counts": dict(r.asset_counts),
                "emergent_cluster_count": r.emergent_cluster_count,
                "html_path": str(r.html_path) if r.html_path else None,
                "json_path": str(r.json_path) if r.json_path else None,
                "error_message": r.error_message,
            }
            for r in results
        ],
    }


def _log_run(result: ProcessResult) -> None:
    extra = ""
    if result.status == "success":
        extra = (
            f" reviews={result.reviews_loaded} clusters={result.emergent_cluster_count}"
        )
    elif result.error_message:
        extra = f" — {result.error_message}"
    print(
        f"[review_ops][batch] {result.run_dir}: {result.status}{extra}",
        file=sys.stderr,
    )


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)

    if args.run_dir:
        candidates: list[Path] = list(args.run_dir)
    else:
        candidates = _discover_candidates(args.outputs_dir)

    if args.newest_per_product:
        candidates = _dedup_newest_per_product(candidates)

    if args.limit is not None and args.limit >= 0:
        candidates = candidates[: args.limit]

    results: list[ProcessResult] = []
    for run_dir in candidates:
        # process_run_dir never raises — failures are recorded on the result.
        result = process_run_dir(run_dir, db_path=args.db_path)
        results.append(result)
        _log_run(result)

    summary = _summarize(results)
    print(json.dumps(summary, ensure_ascii=False, indent=2))

    return 0 if summary["succeeded"] >= 1 else 1


if __name__ == "__main__":
    raise SystemExit(main())
