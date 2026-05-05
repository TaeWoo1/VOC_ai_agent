"""Generate a review_ops_analysis.json + review_ops_report.html for an existing run_dir.

- Reads outputs/<run_dir>/shared/analysis_report.json (untouched)
- Reads phase1_reviews from voc_data.db (read-only)
- Writes shared/review_ops_analysis.json and review_ops/review_ops_report.html

Usage:
    PYTHONPATH=. python scripts/generate_review_ops_report.py \\
        --run-dir outputs/<run_dir> [--db-path voc_data.db]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Make `src.voc.*` imports work when invoked as `python scripts/...`.
REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from src.voc.reporting.review_ops.pipeline import process_run_dir  # noqa: E402


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--run-dir",
        required=True,
        type=Path,
        help="Path to outputs/<run_dir> (must contain shared/analysis_report.json).",
    )
    parser.add_argument(
        "--db-path",
        type=Path,
        default=None,
        help="Path to voc_data.db (default: <repo>/voc_data.db). Read-only.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    result = process_run_dir(args.run_dir, db_path=args.db_path)

    if result.status == "skipped":
        print(
            f"[review_ops] skipped: {result.error_message}",
            file=sys.stderr,
        )
        return 1

    if result.status == "failed":
        if result.safety_violations:
            print(
                f"[review_ops] safety validation failed for run_dir={args.run_dir}",
                file=sys.stderr,
            )
            for line in result.safety_violations:
                print(f"  - {line}", file=sys.stderr)
            return 2
        print(
            f"[review_ops] failed: {result.error_message}",
            file=sys.stderr,
        )
        return 1

    print(
        f"[review_ops] db_status={result.db_status} "
        f"reviews_loaded={result.reviews_loaded}"
    )
    print(f"[review_ops] wrote {result.json_path}")
    print(f"[review_ops] wrote {result.html_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
