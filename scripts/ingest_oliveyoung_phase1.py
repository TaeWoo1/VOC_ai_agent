"""One-shot CLI: ingest an OliveYoung CSV into phase1_reviews with enrichment.

Usage:
    PYTHONPATH=. python3 scripts/ingest_oliveyoung_phase1.py path/to/oy_reviews.csv

Override the database path via PHASE1_DB_PATH (default: voc_data.db at repo root).
Override the option dictionary via PHASE1_OY_DICT (default: data/option_dictionary/oliveyoung.json).

Wires the SegmentNormalizer-backed enrich step so each persisted row gets a
populated `derived` column.
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
from src.voc.connectors.oliveyoung_csv import (
    OLIVEYOUNG_PROMOTED_KEYS,
    OliveYoungCSVConnector,
)
from src.voc.persistence.migrations import init_db
from src.voc.persistence.phase1_review_repository import Phase1ReviewRepository
from src.voc.persistence.phase1_run_repository import Phase1RunRepository
from src.voc.processing.segment_normalizer import (
    DictionarySegmentNormalizer,
    SegmentNormalizer,
)
from src.voc.schemas.channel_meta import (
    DerivedAttributes,
    OliveYoungMeta,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = os.environ.get("PHASE1_DB_PATH", str(REPO_ROOT / "voc_data.db"))
DEFAULT_DICT = os.environ.get(
    "PHASE1_OY_DICT", str(REPO_ROOT / "data" / "option_dictionary" / "oliveyoung.json")
)


def make_oy_enrich(normalizer: SegmentNormalizer):
    def _enrich(channel_meta, product_external_id):
        if not isinstance(channel_meta, OliveYoungMeta):
            return None
        return DerivedAttributes(
            normalized_skin_type=normalizer.normalize_skin_type(channel_meta.skin_type),
            normalized_age_group=normalizer.normalize_age_group(channel_meta.age_group),
            normalized_product_option=normalizer.normalize_product_option(
                "oliveyoung",
                channel_meta.product_option_raw,
                product_external_id,
            ),
        )
    return _enrich


async def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )
    if len(sys.argv) < 2:
        print("Usage: ingest_oliveyoung_phase1.py <path/to/oy_reviews.csv>", file=sys.stderr)
        return 1
    csv_path = Path(sys.argv[1])
    if not csv_path.is_file():
        print(f"ERROR: CSV not found at {csv_path}", file=sys.stderr)
        return 1

    db = init_db(DEFAULT_DB)
    review_repo = Phase1ReviewRepository(db)
    run_repo = Phase1RunRepository(db)
    connector = OliveYoungCSVConnector(csv_path=csv_path)
    pipeline = Phase1Pipeline(review_repo=review_repo, run_repo=run_repo)
    normalizer = DictionarySegmentNormalizer(DEFAULT_DICT)

    result = await pipeline.run(
        connector=connector,
        target=str(csv_path),
        channel_meta_class=OliveYoungMeta,
        promoted_keys=OLIVEYOUNG_PROMOTED_KEYS,
        source_method="csv_upload",
        params=CollectParams(max_results=10**9),
        enrich_fn=make_oy_enrich(normalizer),
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
            "dictionary_path": DEFAULT_DICT,
        },
        ensure_ascii=False,
        indent=2,
    ))
    db.close()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
