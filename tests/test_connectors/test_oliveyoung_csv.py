"""Tests for OliveYoungCSVConnector — CSV-replay path for Phase 1.

Live scrape (blocked/auth_error/captcha) tests are deferred until Decision 3
locks the transport choice. The pipeline-side blocked/auth_error gating is
already covered in tests/test_app/test_phase1_pipeline.py via FakeConnector.
"""

from __future__ import annotations

import csv
import tempfile
from pathlib import Path

import pytest

from src.voc.connectors.base import CollectParams
from src.voc.connectors.oliveyoung_csv import (
    OLIVEYOUNG_PROMOTED_KEYS,
    OliveYoungCSVConnector,
    _parse_int,
    _parse_iso_date,
)


@pytest.fixture
def oy_csv_file():
    def _make(rows: list[dict]) -> Path:
        tmpdir = Path(tempfile.mkdtemp())
        path = tmpdir / "oy.csv"
        fieldnames = [
            "product_id", "product_name", "product_url",
            "review_id", "review_url", "review_author",
            "review_date", "review_rating", "review_content",
            "skin_type", "age_group", "product_option_raw",
        ]
        with open(path, "w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=fieldnames)
            w.writeheader()
            for r in rows:
                full = {fn: "" for fn in fieldnames}
                full.update(r)
                w.writerow(full)
        return path
    return _make


def _row(**ovr) -> dict:
    base = {
        "product_id": "oy_lipstick_aaa_001",
        "product_name": "Sample Lipstick A",
        "product_url": "https://www.oliveyoung.co.kr/store/goods/aaa-001",
        "review_id": "OY9876",
        "review_url": "https://www.oliveyoung.co.kr/.../review/9876",
        "review_author": "user_kor",
        "review_date": "2026-01-15",
        "review_rating": "4",
        "review_content": "건성 피부에 잘 맞아요 보습력 좋고 자극 없어요",
        "skin_type": "건성",
        "age_group": "20대 후반",
        "product_option_raw": "베어그레이프",
    }
    base.update(ovr)
    return base


# ---------- pure helpers ----------

def test_promoted_keys_constant():
    assert OLIVEYOUNG_PROMOTED_KEYS == {"skin_type", "age_group", "product_option_raw"}


def test_parse_int_handles_valid_and_invalid():
    assert _parse_int("4") == 4
    assert _parse_int(" 5 ") == 5
    assert _parse_int("abc") is None
    assert _parse_int("") is None
    assert _parse_int(None) is None


def test_parse_iso_date_accepts_valid_iso():
    assert _parse_iso_date("2026-01-15") == "2026-01-15"
    assert _parse_iso_date("2026-1-5") == "2026-01-05"  # zero-padded


def test_parse_iso_date_rejects_dot_format():
    assert _parse_iso_date("2026.01.15") is None


def test_parse_iso_date_rejects_invalid():
    assert _parse_iso_date("2026-13-01") is None
    assert _parse_iso_date("2026-01-32") is None
    assert _parse_iso_date("not-a-date") is None
    assert _parse_iso_date(None) is None
    assert _parse_iso_date("") is None


# ---------- connector behavior ----------

def test_channel_name():
    assert OliveYoungCSVConnector(csv_path=Path("/dev/null")).channel_name == "oliveyoung"


@pytest.mark.asyncio
async def test_basic_parse(oy_csv_file):
    path = oy_csv_file([_row()])
    raws = await OliveYoungCSVConnector(csv_path=path).collect(keyword="lipstick")
    assert len(raws) == 1
    raw = raws[0]
    assert raw.source_channel == "oliveyoung"
    assert raw.raw_rating == 4
    assert raw.raw_date == "2026-01-15"
    assert raw.raw_language == "ko"
    assert raw.keyword_used == "lipstick"


@pytest.mark.asyncio
async def test_raw_metadata_carries_promoted_segment_fields(oy_csv_file):
    path = oy_csv_file([_row()])
    raws = await OliveYoungCSVConnector(csv_path=path).collect(keyword="x")
    md = raws[0].raw_metadata
    assert md["skin_type"] == "건성"
    assert md["age_group"] == "20대 후반"
    assert md["product_option_raw"] == "베어그레이프"


@pytest.mark.asyncio
async def test_raw_metadata_carries_product_external_id_from_product_id(oy_csv_file):
    path = oy_csv_file([_row(product_id="oy_serum_bbb_002")])
    raws = await OliveYoungCSVConnector(csv_path=path).collect(keyword="x")
    assert raws[0].raw_metadata["product_external_id"] == "oy_serum_bbb_002"


@pytest.mark.asyncio
async def test_raw_metadata_carries_non_promoted_helpers(oy_csv_file):
    path = oy_csv_file([_row(product_name="Sample A", review_url="https://r/1")])
    raws = await OliveYoungCSVConnector(csv_path=path).collect(keyword="x")
    md = raws[0].raw_metadata
    assert md["product_name"] == "Sample A"
    assert md["review_url"] == "https://r/1"


@pytest.mark.asyncio
async def test_source_id_uses_review_id(oy_csv_file):
    path = oy_csv_file([_row(review_id="OY42")])
    raws = await OliveYoungCSVConnector(csv_path=path).collect(keyword="x")
    assert raws[0].source_id == "OY42"


@pytest.mark.asyncio
async def test_empty_content_dropped_and_counted(oy_csv_file):
    path = oy_csv_file([_row(review_content=""), _row(review_id="OY2")])
    connector = OliveYoungCSVConnector(csv_path=path)
    raws = await connector.collect(keyword="x")
    assert len(raws) == 1
    s = connector.last_run_summary
    assert s.raw_records_seen == 2
    assert s.records_parsed == 1
    assert s.records_dropped_short_text == 1


@pytest.mark.asyncio
async def test_missing_product_id_dropped(oy_csv_file):
    path = oy_csv_file([_row(product_id=""), _row(review_id="OY2")])
    connector = OliveYoungCSVConnector(csv_path=path)
    raws = await connector.collect(keyword="x")
    assert len(raws) == 1
    assert connector.last_run_summary.records_dropped_short_text == 1


@pytest.mark.asyncio
async def test_missing_review_id_dropped(oy_csv_file):
    path = oy_csv_file([_row(review_id=""), _row(review_id="OY2")])
    connector = OliveYoungCSVConnector(csv_path=path)
    raws = await connector.collect(keyword="x")
    assert len(raws) == 1
    assert connector.last_run_summary.records_dropped_short_text == 1


@pytest.mark.asyncio
async def test_missing_required_column_raises(tmp_path):
    p = tmp_path / "bad.csv"
    p.write_text("product_id,review_id\n1,1\n", encoding="utf-8")
    with pytest.raises(ValueError, match="missing required columns"):
        await OliveYoungCSVConnector(csv_path=p).collect(keyword="x")


@pytest.mark.asyncio
async def test_unparseable_date_emits_row_with_warning(oy_csv_file):
    path = oy_csv_file([
        _row(review_date="not-a-date"),
        _row(review_id="OY2"),  # ok
    ])
    connector = OliveYoungCSVConnector(csv_path=path)
    raws = await connector.collect(keyword="x")
    assert len(raws) == 2
    assert raws[0].raw_date is None
    assert raws[1].raw_date == "2026-01-15"
    assert connector.last_run_summary.parse_warnings == 1


@pytest.mark.asyncio
async def test_unparseable_rating_emits_row_with_warning(oy_csv_file):
    path = oy_csv_file([_row(review_rating="not-a-number")])
    connector = OliveYoungCSVConnector(csv_path=path)
    raws = await connector.collect(keyword="x")
    assert len(raws) == 1
    assert raws[0].raw_rating is None
    assert connector.last_run_summary.parse_warnings == 1


@pytest.mark.asyncio
async def test_run_summary_populated(oy_csv_file):
    rows = [_row(review_id=f"OY{i}") for i in range(5)]
    path = oy_csv_file(rows)
    connector = OliveYoungCSVConnector(csv_path=path)
    await connector.collect(keyword="x")
    s = connector.last_run_summary
    assert s.channel == "oliveyoung"
    assert s.raw_records_seen == 5
    assert s.records_parsed == 5
    assert s.blocked is False
    assert s.auth_error is False
    assert s.pipeline_normalize_rejections == 0  # connector does not set this


@pytest.mark.asyncio
async def test_no_csv_returns_empty_with_summary(tmp_path):
    nonexistent = tmp_path / "missing.csv"
    connector = OliveYoungCSVConnector(csv_path=nonexistent)
    raws = await connector.collect(keyword="x")
    assert raws == []
    assert connector.last_run_summary is not None
    assert connector.last_run_summary.raw_records_seen == 0


@pytest.mark.asyncio
async def test_max_results_caps_output(oy_csv_file):
    rows = [_row(review_id=str(i)) for i in range(20)]
    path = oy_csv_file(rows)
    connector = OliveYoungCSVConnector(csv_path=path)
    raws = await connector.collect(keyword="x", params=CollectParams(max_results=3))
    assert len(raws) == 3


@pytest.mark.asyncio
async def test_optional_segment_fields_become_none(oy_csv_file):
    path = oy_csv_file([_row(skin_type="", age_group="", product_option_raw="")])
    raws = await OliveYoungCSVConnector(csv_path=path).collect(keyword="x")
    md = raws[0].raw_metadata
    assert md["skin_type"] is None
    assert md["age_group"] is None
    assert md["product_option_raw"] is None


@pytest.mark.asyncio
async def test_korean_segment_labels_round_trip_intact(oy_csv_file):
    path = oy_csv_file([_row(skin_type="민감성", age_group="30대 초반",
                              product_option_raw="로지피치")])
    raws = await OliveYoungCSVConnector(csv_path=path).collect(keyword="x")
    md = raws[0].raw_metadata
    assert md["skin_type"] == "민감성"
    assert md["age_group"] == "30대 초반"
    assert md["product_option_raw"] == "로지피치"
