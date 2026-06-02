"""One-shot CLI: ingest the bundled Coupang CSV into phase1_reviews.

Usage:
    PYTHONPATH=. python3 scripts/ingest_coupang_phase1.py [path/to/csv]

Defaults to /coupang/coupang_reviews.csv at the repo root. Override the database
location via the PHASE1_DB_PATH env var (default: voc_data.db at repo root).

Prints the resulting phase1_runs row's quality_status, insert count, and the
connector's run summary as JSON.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
from pathlib import Path

from src.voc.app.phase1_pipeline import Phase1Pipeline
from src.voc.connectors.base import CollectParams
from src.voc.connectors.coupang_csv import COUPANG_PROMOTED_KEYS, CoupangCSVConnector
from src.voc.persistence.migrations import init_db
from src.voc.persistence.phase1_review_repository import Phase1ReviewRepository
from src.voc.persistence.phase1_run_repository import Phase1RunRepository
from src.voc.schemas.channel_meta import CoupangMeta

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CSV = REPO_ROOT / "coupang" / "coupang_reviews.csv"
DEFAULT_DB = os.environ.get("PHASE1_DB_PATH", str(REPO_ROOT / "voc_data.db"))


async def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )
    csv_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_CSV
    if not csv_path.is_file():
        print(f"ERROR: CSV not found at {csv_path}", file=sys.stderr)
        return 1

    db = init_db(DEFAULT_DB)
    review_repo = Phase1ReviewRepository(db)
    run_repo = Phase1RunRepository(db)
    connector = CoupangCSVConnector(csv_path=csv_path)
    pipeline = Phase1Pipeline(review_repo=review_repo, run_repo=run_repo)

    # CollectParams default max_results=100 is a safety cap for ad-hoc connectors;
    # the bait-report ingest wants the whole file, so override generously.
    result = await pipeline.run(
        connector=connector,
        target=str(csv_path),
        channel_meta_class=CoupangMeta,
        promoted_keys=COUPANG_PROMOTED_KEYS,
        source_method="csv_upload",
        params=CollectParams(max_results=10**9),
    )

    run_row = run_repo.get(result.run_id)
    print(json.dumps(
        {
            "run_id": result.run_id,
            "quality_status": result.quality_status,
            "rows_inserted": result.rows_inserted,
            "rows_skipped_by_normalize": result.rows_skipped,
            "summary": run_row["summary"] if run_row else None,
            "phase1_reviews_count_by_channel": review_repo.count_by_channel(),
            "db_path": DEFAULT_DB,
        },
        ensure_ascii=False,
        indent=2,
    ))
    db.close()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
