"""Tests for CoupangCSVConnector — title merge, date normalization, run summary."""

from __future__ import annotations

import csv
import tempfile
from pathlib import Path

import pytest

from src.voc.connectors.base import CollectParams
from src.voc.connectors.coupang_csv import (
    COUPANG_PROMOTED_KEYS,
    CoupangCSVConnector,
    _merge_title_content,
    _normalize_coupang_date,
)


@pytest.fixture
def csv_file():
    def _make(rows: list[dict]) -> Path:
        tmpdir = Path(tempfile.mkdtemp())
        path = tmpdir / "coupang.csv"
        fieldnames = [
            "product_index", "product_url", "product_title", "product_price",
            "product_rating_summary", "product_reviewcount_summary",
            "review_index", "review_author", "review_date",
            "review_stars", "review_title", "review_content",
        ]
        with open(path, "w", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            for r in rows:
                full = {fn: "" for fn in fieldnames}
                full.update(r)
                writer.writerow(full)
        return path
    return _make


def _row(**overrides) -> dict:
    base = {
        "product_index": "12345",
        "product_url": "https://www.coupang.com/vp/products/12345",
        "product_title": "조은몰드 사각 전선몰딩",
        "product_price": "12,900원",
        "review_index": "1",
        "review_author": "임*숙",
        "review_date": "2024.03.19",
        "review_stars": "5",
        "review_title": "좋아요",
        "review_content": "이사오면서 새로 설치한 가전들이 많아 지면서 전선정리용으로 구매했어요",
    }
    base.update(overrides)
    return base


# ---------- pure helpers ----------

def test_merge_prepends_when_title_not_substring():
    assert _merge_title_content("제목", "본문") == "[제목] 본문"


def test_merge_skips_when_title_already_in_content():
    assert _merge_title_content("좋아요", "좋아요 정말 만족") == "좋아요 정말 만족"


def test_merge_returns_content_when_title_none_or_empty():
    assert _merge_title_content(None, "본문") == "본문"
    assert _merge_title_content("", "본문") == "본문"


def test_normalize_date_dot_format():
    assert _normalize_coupang_date("2024.03.19") == "2024-03-19"


def test_normalize_date_zero_pads_month_and_day():
    assert _normalize_coupang_date("2024.3.9") == "2024-03-09"


def test_normalize_date_rejects_dash_format():
    # The connector handles only Coupang's dotted format; dashed dates pass through unchanged
    # at the normalizer layer, but this helper specifically expects dots.
    assert _normalize_coupang_date("2024-03-19") is None


def test_normalize_date_rejects_invalid_month_and_day():
    assert _normalize_coupang_date("2024.13.01") is None
    assert _normalize_coupang_date("2024.03.32") is None


def test_normalize_date_rejects_non_numeric():
    assert _normalize_coupang_date("abc.de.fg") is None
    assert _normalize_coupang_date(None) is None
    assert _normalize_coupang_date("") is None


def test_promoted_keys_exact_set():
    assert COUPANG_PROMOTED_KEYS == {
        "verified_purchase",
        "photo_attached",
        "helpful_count",
        "review_title",
    }


# ---------- connector behavior ----------

def test_channel_name():
    assert CoupangCSVConnector(csv_path=Path("/dev/null")).channel_name == "coupang"


@pytest.mark.asyncio
async def test_basic_parse(csv_file):
    path = csv_file([_row()])
    raws = await CoupangCSVConnector(csv_path=path).collect(keyword="에어팟")
    assert len(raws) == 1
    raw = raws[0]
    assert raw.source_channel == "coupang"
    assert raw.raw_rating == 5
    assert raw.raw_author == "임*숙"
    assert raw.raw_date == "2024-03-19"
    assert raw.raw_language == "ko"
    assert raw.keyword_used == "에어팟"


@pytest.mark.asyncio
async def test_title_prepended_when_not_substring(csv_file):
    path = csv_file([_row(review_title="좋아요", review_content="가성비 만족합니다")])
    raws = await CoupangCSVConnector(csv_path=path).collect(keyword="x")
    assert raws[0].raw_text == "[좋아요] 가성비 만족합니다"


@pytest.mark.asyncio
async def test_title_not_prepended_when_already_substring(csv_file):
    path = csv_file([_row(review_title="좋아요", review_content="좋아요 정말 만족합니다")])
    raws = await CoupangCSVConnector(csv_path=path).collect(keyword="x")
    assert raws[0].raw_text == "좋아요 정말 만족합니다"


@pytest.mark.asyncio
async def test_no_title_no_prepend(csv_file):
    path = csv_file([_row(review_title="", review_content="만족합니다 좋은 제품")])
    raws = await CoupangCSVConnector(csv_path=path).collect(keyword="x")
    assert raws[0].raw_text == "만족합니다 좋은 제품"


@pytest.mark.asyncio
async def test_empty_content_dropped_and_counted(csv_file):
    path = csv_file([_row(review_content=""), _row(review_index="2")])
    connector = CoupangCSVConnector(csv_path=path)
    raws = await connector.collect(keyword="x")
    assert len(raws) == 1
    s = connector.last_run_summary
    assert s.raw_records_seen == 2
    assert s.records_parsed == 1
    assert s.records_dropped_short_text == 1


@pytest.mark.asyncio
async def test_missing_required_column_raises(tmp_path):
    p = tmp_path / "bad.csv"
    p.write_text("product_index,review_index\n1,1\n", encoding="utf-8")
    with pytest.raises(ValueError, match="missing required columns"):
        await CoupangCSVConnector(csv_path=p).collect(keyword="x")


@pytest.mark.asyncio
async def test_raw_metadata_carries_promoted_review_title(csv_file):
    path = csv_file([_row(review_title="좋아요")])
    raws = await CoupangCSVConnector(csv_path=path).collect(keyword="x")
    assert raws[0].raw_metadata["review_title"] == "좋아요"


@pytest.mark.asyncio
async def test_raw_metadata_carries_product_external_id(csv_file):
    path = csv_file([_row(product_index="98765")])
    raws = await CoupangCSVConnector(csv_path=path).collect(keyword="x")
    assert raws[0].raw_metadata["product_external_id"] == "98765"


@pytest.mark.asyncio
async def test_raw_metadata_omits_unexposed_promoted_keys(csv_file):
    # Coupang CSV does not expose verified_purchase / photo_attached / helpful_count
    path = csv_file([_row()])
    raws = await CoupangCSVConnector(csv_path=path).collect(keyword="x")
    raw_md = raws[0].raw_metadata
    assert "verified_purchase" not in raw_md
    assert "photo_attached" not in raw_md
    assert "helpful_count" not in raw_md


@pytest.mark.asyncio
async def test_source_id_combines_product_and_review_index(csv_file):
    path = csv_file([_row(product_index="98765", review_index="42")])
    raws = await CoupangCSVConnector(csv_path=path).collect(keyword="x")
    assert raws[0].source_id == "98765::42"


@pytest.mark.asyncio
async def test_source_id_none_when_indexes_missing(csv_file):
    path = csv_file([_row(product_index="", review_index="")])
    raws = await CoupangCSVConnector(csv_path=path).collect(keyword="x")
    assert raws[0].source_id is None


@pytest.mark.asyncio
async def test_run_summary_populated(csv_file):
    rows = [_row(review_index=str(i)) for i in range(5)]
    path = csv_file(rows)
    connector = CoupangCSVConnector(csv_path=path)
    await connector.collect(keyword="x")
    s = connector.last_run_summary
    assert s.raw_records_seen == 5
    assert s.records_parsed == 5
    assert s.channel == "coupang"
    assert s.blocked is False
    assert s.auth_error is False


@pytest.mark.asyncio
async def test_max_results_caps_output(csv_file):
    rows = [_row(review_index=str(i)) for i in range(20)]
    path = csv_file(rows)
    connector = CoupangCSVConnector(csv_path=path)
    raws = await connector.collect(keyword="x", params=CollectParams(max_results=7))
    assert len(raws) == 7


@pytest.mark.asyncio
async def test_collectparams_language_filter_overrides_csv_path(csv_file, tmp_path):
    explicit = csv_file([_row(review_index="explicit")])
    bogus = tmp_path / "missing.csv"  # not a file
    connector = CoupangCSVConnector(csv_path=bogus)
    raws = await connector.collect(
        keyword="x", params=CollectParams(language_filter=str(explicit))
    )
    assert len(raws) == 1


@pytest.mark.asyncio
async def test_no_csv_returns_empty_with_summary(tmp_path):
    nonexistent = tmp_path / "missing.csv"
    connector = CoupangCSVConnector(csv_path=nonexistent)
    raws = await connector.collect(keyword="x")
    assert raws == []
    assert connector.last_run_summary is not None
    assert connector.last_run_summary.raw_records_seen == 0


@pytest.mark.asyncio
async def test_unparseable_date_emits_row_with_warning(csv_file):
    path = csv_file([
        _row(review_date="invalid-date"),
        _row(review_index="2"),  # well-formed
    ])
    connector = CoupangCSVConnector(csv_path=path)
    raws = await connector.collect(keyword="x")
    assert len(raws) == 2  # both rows kept
    assert raws[0].raw_date is None  # unparseable date → None
    assert raws[1].raw_date == "2024-03-19"
    assert connector.last_run_summary.parse_warnings == 1
