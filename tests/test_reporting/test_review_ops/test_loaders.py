from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Optional

from src.voc.persistence.migrations import init_db
from src.voc.reporting.review_ops.loaders import load_review_ops_inputs

PRODUCT_URL = "https://example.test/p/abc"


def _make_run_dir(
    tmp_path: Path,
    *,
    manifest_run_id: Optional[str] = None,
    source_url: str = PRODUCT_URL,
    profile_id: str = "skincare_pad",
) -> Path:
    run_dir = tmp_path / "2026-05-04_product-test_run-001"
    (run_dir / "shared").mkdir(parents=True)

    manifest = {
        "schema_version": "manifest.v1",
        "run_dir": run_dir.name,
        "product": {"slug": "product-test", "source_url": source_url},
    }
    if manifest_run_id is not None:
        manifest["run_id"] = manifest_run_id
    (run_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False), encoding="utf-8"
    )

    (run_dir / "shared" / "analysis_report.json").write_text(
        json.dumps(
            {
                "schema_version": "analysis_report.v1",
                "generated_at": "2026-05-04T00:00:00Z",
                "product": {
                    "slug": "product-test",
                    "display_product_name": "테스트 제품",
                    "source_url": source_url,
                    "selected_profile_id": profile_id,
                },
                "corpus": {"observation_window": {"start": None, "end": None}},
                "attributes": [],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    return run_dir


def _seed_db(db_path: Path, rows: list[dict]) -> None:
    init_db(str(db_path)).close()
    conn = sqlite3.connect(str(db_path))
    try:
        for row in rows:
            conn.execute(
                """
                INSERT INTO phase1_reviews (
                    review_id, source_channel, source_method, text,
                    rating_raw, review_date, content_fingerprint, is_duplicate,
                    product_keyword, channel_meta_json, raw_metadata_json, run_id,
                    collected_at, ingested_at
                ) VALUES (?, ?, 'api', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    row["review_id"],
                    row.get("source_channel", "oliveyoung"),
                    row["text"],
                    row.get("rating_raw"),
                    row.get("review_date"),
                    row.get("content_fingerprint", row["review_id"] + "_fp"),
                    row.get("is_duplicate", 0),
                    row.get("product_keyword", PRODUCT_URL),
                    row.get("channel_meta_json", "{}"),
                    row.get("raw_metadata_json", "{}"),
                    row.get("run_id"),
                    row.get("collected_at", "2026-05-04T00:00:00Z"),
                    row.get("ingested_at", "2026-05-04T00:00:00Z"),
                ),
            )
        conn.commit()
    finally:
        conn.close()


# ── happy path ────────────────────────────────────────────────────────


def test_loads_manifest_analysis_report_and_reviews(tmp_path):
    run_dir = _make_run_dir(tmp_path)
    db = tmp_path / "voc.db"
    _seed_db(db, [{"review_id": "abc", "text": "리뷰 본문"}])

    inputs = load_review_ops_inputs(run_dir, db_path=db)

    assert inputs.manifest["product"]["source_url"] == PRODUCT_URL
    assert inputs.analysis_report["product"]["selected_profile_id"] == "skincare_pad"
    assert inputs.selected_profile_id == "skincare_pad"
    assert inputs.db_status == "ok"
    assert len(inputs.reviews) == 1
    assert inputs.reviews[0].review_id == "abc"


# ── run_id selection / fallback ───────────────────────────────────────


def test_manifest_run_id_when_present_filters_db_by_run_id(tmp_path):
    run_dir = _make_run_dir(tmp_path, manifest_run_id="run_xyz")
    db = tmp_path / "voc.db"
    _seed_db(
        db,
        [
            {"review_id": "match", "text": "...", "run_id": "run_xyz"},
            {"review_id": "other", "text": "...", "run_id": "run_other"},
        ],
    )

    inputs = load_review_ops_inputs(run_dir, db_path=db)
    assert inputs.run_id == "run_xyz"
    assert {r.review_id for r in inputs.reviews} == {"match"}


def test_missing_manifest_run_id_falls_back_to_product_keyword(tmp_path):
    run_dir = _make_run_dir(tmp_path, manifest_run_id=None)
    db = tmp_path / "voc.db"
    _seed_db(
        db,
        [
            {"review_id": "in", "text": "...", "product_keyword": PRODUCT_URL},
            {"review_id": "out", "text": "...", "product_keyword": "https://other"},
        ],
    )

    inputs = load_review_ops_inputs(run_dir, db_path=db)
    assert inputs.run_id is None
    assert {r.review_id for r in inputs.reviews} == {"in"}


# ── degraded paths ────────────────────────────────────────────────────


def test_db_missing_degrades_to_status_missing_without_crashing(tmp_path):
    run_dir = _make_run_dir(tmp_path)
    inputs = load_review_ops_inputs(run_dir, db_path=tmp_path / "does_not_exist.db")
    assert inputs.db_status == "missing"
    assert inputs.reviews == []


def test_db_path_override_works(tmp_path):
    run_dir = _make_run_dir(tmp_path)
    db1 = tmp_path / "v1.db"
    db2 = tmp_path / "v2.db"
    _seed_db(db1, [{"review_id": "in_v1", "text": "..."}])
    _seed_db(db2, [{"review_id": "in_v2", "text": "..."}])

    inputs1 = load_review_ops_inputs(run_dir, db_path=db1)
    inputs2 = load_review_ops_inputs(run_dir, db_path=db2)
    assert {r.review_id for r in inputs1.reviews} == {"in_v1"}
    assert {r.review_id for r in inputs2.reviews} == {"in_v2"}


# ── per-row resilience ────────────────────────────────────────────────


def test_malformed_channel_and_raw_meta_do_not_crash(tmp_path):
    run_dir = _make_run_dir(tmp_path)
    db = tmp_path / "voc.db"
    _seed_db(
        db,
        [
            {
                "review_id": "abc",
                "text": "...",
                "channel_meta_json": "{this is not json",
                "raw_metadata_json": "garbage",
            }
        ],
    )

    inputs = load_review_ops_inputs(run_dir, db_path=db)
    assert len(inputs.reviews) == 1
    row = inputs.reviews[0]
    assert row.product_option is None
    assert row.has_brand_reply is False


def test_is_duplicate_rows_are_excluded(tmp_path):
    run_dir = _make_run_dir(tmp_path)
    db = tmp_path / "voc.db"
    _seed_db(
        db,
        [
            {"review_id": "keep", "text": "1", "is_duplicate": 0},
            {"review_id": "drop", "text": "2", "is_duplicate": 1},
        ],
    )

    inputs = load_review_ops_inputs(run_dir, db_path=db)
    assert {r.review_id for r in inputs.reviews} == {"keep"}


def test_unparseable_review_date_becomes_none(tmp_path):
    run_dir = _make_run_dir(tmp_path)
    db = tmp_path / "voc.db"
    _seed_db(
        db,
        [{"review_id": "abc", "text": "...", "review_date": "not-a-date"}],
    )

    inputs = load_review_ops_inputs(run_dir, db_path=db)
    assert inputs.reviews[0].review_date is None


def test_brand_reply_flag_picked_up_from_channel_meta(tmp_path):
    """If a future channel persists has_brand_reply, the loader surfaces it."""
    run_dir = _make_run_dir(tmp_path)
    db = tmp_path / "voc.db"
    _seed_db(
        db,
        [
            {
                "review_id": "with_reply",
                "text": "...",
                "channel_meta_json": json.dumps(
                    {"has_brand_reply": True, "product_option_raw": "21호"}
                ),
            },
            {
                "review_id": "without_reply",
                "text": "...",
                "channel_meta_json": json.dumps({"product_option_raw": "23호"}),
            },
        ],
    )

    inputs = load_review_ops_inputs(run_dir, db_path=db)
    by_id = {r.review_id: r for r in inputs.reviews}
    assert by_id["with_reply"].has_brand_reply is True
    assert by_id["with_reply"].product_option == "21호"
    assert by_id["without_reply"].has_brand_reply is False
    assert by_id["without_reply"].product_option == "23호"
