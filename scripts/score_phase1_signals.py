"""One-shot CLI: score the Phase 1 pipeline's signals against the golden labels.

Usage:
    PYTHONPATH=. python3 scripts/score_phase1_signals.py \\
        [--product-id ID ...] [--channel CH ...] \\
        [--reviewed-only] [--emit-json] \\
        [--golden PATH] [--signal-map PATH]

Default scope is the currently-validated Phase 1 matched pair:
    - OliveYoung A000000238828 (페탈 드롭 리퀴드 블러쉬, 18 rows)
    - Coupang    7156638510    (디어달리아 페탈 드롭 리퀴드 블러쉬, 67 rows)

Flags:
    --reviewed-only    Include only labels with status=="reviewed".
                       Default: include both "draft" and "reviewed".
    --emit-json        Print EvalResult as JSON instead of markdown.
    --product-id       Override default scope. Repeatable.
    --channel          Override default scope. Repeatable.
    --golden           Path to golden labels JSON.
    --signal-map       Path to tag → signal map JSON.

Environment:
    PHASE1_DB_PATH                 sqlite path (default voc_data.db at repo root)
    PHASE1_LEXICON_POSITIVE        lexicon override
    PHASE1_LEXICON_CAUTIONARY      lexicon override
    PHASE1_SIGNALS_GOLDEN          golden path override
    PHASE1_SIGNAL_MAP              signal_map path override

Exits 0 on success; exits 2 on file-load errors or missing DB.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from src.voc.persistence.migrations import init_db
from src.voc.persistence.phase1_review_repository import Phase1ReviewRepository
from src.voc.reporting.phase1.eval import render_markdown, score
from src.voc.reporting.phase1.signals import (
    detect_signals_with_membership,
    load_lexicons,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = os.environ.get("PHASE1_DB_PATH", str(REPO_ROOT / "voc_data.db"))
DEFAULT_LEX_POSITIVE = os.environ.get(
    "PHASE1_LEXICON_POSITIVE",
    str(REPO_ROOT / "data" / "phase1_lexicons" / "positive.json"),
)
DEFAULT_LEX_CAUTIONARY = os.environ.get(
    "PHASE1_LEXICON_CAUTIONARY",
    str(REPO_ROOT / "data" / "phase1_lexicons" / "cautionary.json"),
)
DEFAULT_GOLDEN = os.environ.get(
    "PHASE1_SIGNALS_GOLDEN",
    str(REPO_ROOT / "eval_data" / "phase1" / "phase1_signals_golden.json"),
)
DEFAULT_SIGNAL_MAP = os.environ.get(
    "PHASE1_SIGNAL_MAP",
    str(REPO_ROOT / "eval_data" / "phase1" / "phase1_signal_map.json"),
)

# Default scope — the currently-validated matched pair.
DEFAULT_PRODUCT_IDS = ["A000000238828", "7156638510"]
DEFAULT_CHANNELS: list[str] = []   # empty means "don't filter by channel"


def _parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Score Phase 1 pipeline signals against golden labels.",
    )
    p.add_argument("--product-id", dest="product_ids", action="append",
                   default=None,
                   help="Product external ID to include. Repeatable. "
                        f"Default: {DEFAULT_PRODUCT_IDS}")
    p.add_argument("--channel", dest="channels", action="append", default=None,
                   help="Source channel filter. Repeatable. "
                        "Default: no channel filter.")
    p.add_argument("--reviewed-only", action="store_true",
                   help="Include only labels with status=='reviewed'. "
                        "Default: include both draft and reviewed.")
    p.add_argument("--emit-json", action="store_true",
                   help="Output EvalResult as JSON instead of markdown.")
    p.add_argument("--golden", default=DEFAULT_GOLDEN,
                   help=f"Golden labels JSON (default: {DEFAULT_GOLDEN}).")
    p.add_argument("--signal-map", default=DEFAULT_SIGNAL_MAP,
                   help=f"Signal map JSON (default: {DEFAULT_SIGNAL_MAP}).")
    return p.parse_args(argv)


def _load_json(path: str) -> dict:
    p = Path(path)
    if not p.is_file():
        sys.stderr.write(f"ERROR: file not found: {path}\n")
        sys.exit(2)
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        sys.stderr.write(f"ERROR: malformed JSON at {path}: {e}\n")
        sys.exit(2)


def _fetch_rows(
    repo: Phase1ReviewRepository,
    product_ids: list[str],
    channels: list[str],
) -> list[dict]:
    """Query the DB, then filter to the requested product set in Python."""
    if channels:
        raw: list[dict] = []
        for ch in channels:
            raw.extend(repo.query(source_channel=ch))
    else:
        raw = repo.query()
    if product_ids:
        id_set = set(product_ids)
        raw = [r for r in raw if r.get("product_external_id") in id_set]
    return raw


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv if argv is not None else sys.argv[1:])
    product_ids = args.product_ids if args.product_ids is not None else DEFAULT_PRODUCT_IDS
    channels = args.channels if args.channels is not None else DEFAULT_CHANNELS

    db_path = Path(DEFAULT_DB)
    if not db_path.is_file():
        sys.stderr.write(f"ERROR: DB not found at {db_path}\n")
        return 2

    # Load everything.
    golden = _load_json(args.golden)
    signal_map = _load_json(args.signal_map)
    lexicons = load_lexicons(DEFAULT_LEX_POSITIVE, DEFAULT_LEX_CAUTIONARY)

    db = init_db(str(db_path))
    try:
        repo = Phase1ReviewRepository(db)
        rows = _fetch_rows(repo, product_ids, channels)
    finally:
        db.close()

    if not rows:
        sys.stderr.write(
            "ERROR: 0 rows matched the scope "
            f"(product_ids={product_ids}, channels={channels or 'all'}).\n"
        )
        return 2

    _bundle, membership = detect_signals_with_membership(rows, lexicons)
    all_review_ids = [str(r["review_id"]) for r in rows if r.get("review_id")]

    include_statuses = ["reviewed"] if args.reviewed_only else None

    result = score(
        membership=membership,
        all_review_ids=all_review_ids,
        golden=golden,
        signal_map=signal_map,
        include_statuses=include_statuses,
    )

    if args.emit_json:
        sys.stdout.write(
            json.dumps(result.model_dump(mode="json"), ensure_ascii=False, indent=2)
            + "\n"
        )
    else:
        sys.stdout.write(render_markdown(result))

    # Stderr handoff (consistent with scripts/generate_phase1_report.py)
    sys.stderr.write(json.dumps({
        "labeled_reviews_included": result.summary.labeled_reviews_included,
        "labeled_reviews_total": result.summary.labeled_reviews_total,
        "reviews_in_universe": result.summary.reviews_in_universe,
        "scored_signals": result.summary.scored_signals,
        "coverage_gap_tags_used": result.summary.coverage_gap_tags_used,
        "golden_version": result.golden_version,
        "signal_map_version": result.signal_map_version,
        "included_statuses": result.included_statuses,
    }, ensure_ascii=False, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
