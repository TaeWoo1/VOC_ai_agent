"""Layer A parser tests for OliveYoung browser-driven API connector.

Exercises `parse_response_body` and helpers against the two saved fixtures
captured by PR4B Step 2:

  tests/fixtures/oliveyoung_api/goods_review_list_page1.json
  tests/fixtures/oliveyoung_api/goods_review_list_page2.json

The browser runtime (Playwright session + response interception + cursor
pagination) is not exercised here — Layer A is a pure (dict → list[RawReview])
function and this suite is the contract it must satisfy.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path

import pytest

from src.voc.connectors.oliveyoung_browser_api import (
    OLIVEYOUNG_PROMOTED_KEYS,
    PROFILE_DIMENSIONS,
    ProfileCodeMapper,
    _extract_total_count_from_dom_text,
    _extract_total_count_from_response_body,
    _normalize_oy_date,
    _parse_review_record,
    parse_response_body,
)

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "oliveyoung_api"
PAGE1_PATH = FIXTURE_DIR / "goods_review_list_page1.json"
PAGE2_PATH = FIXTURE_DIR / "goods_review_list_page2.json"
SEED_DICT_PATH = (
    Path(__file__).resolve().parents[2]
    / "data" / "option_dictionary" / "oliveyoung_profile_codes.json"
)


@pytest.fixture
def page1_body() -> dict:
    return json.loads(PAGE1_PATH.read_text(encoding="utf-8"))


@pytest.fixture
def page2_body() -> dict:
    return json.loads(PAGE2_PATH.read_text(encoding="utf-8"))


@pytest.fixture
def seed_mapper() -> ProfileCodeMapper:
    return ProfileCodeMapper(SEED_DICT_PATH)


@pytest.fixture
def empty_mapper() -> ProfileCodeMapper:
    return ProfileCodeMapper()


@pytest.fixture
def collected_at() -> datetime:
    return datetime(2026, 4, 21, 8, 47, 43)


# ----------------------------- constants -----------------------------

def test_promoted_keys_constant():
    assert OLIVEYOUNG_PROMOTED_KEYS == {"skin_type", "age_group", "product_option_raw"}


def test_profile_dimensions_constant():
    assert PROFILE_DIMENSIONS == ("skin_type", "skin_tone", "skin_trouble")


# ----------------------------- _normalize_oy_date -----------------------------

def test_normalize_oy_date_happy():
    assert _normalize_oy_date("2026.04.16") == "2026-04-16"
    assert _normalize_oy_date("2026.1.5") == "2026-01-05"


def test_normalize_oy_date_rejects_iso_shape():
    # Dot-separated is OY; the ISO form is CSV's territory — don't confuse the two.
    assert _normalize_oy_date("2026-04-16") is None


def test_normalize_oy_date_invalid():
    assert _normalize_oy_date(None) is None
    assert _normalize_oy_date("") is None
    assert _normalize_oy_date("2026.13.01") is None
    assert _normalize_oy_date("2026.01.32") is None
    assert _normalize_oy_date("abc") is None


# ----------------------------- ProfileCodeMapper -----------------------------

def test_mapper_none_code_is_silent(empty_mapper, caplog):
    with caplog.at_level(logging.WARNING):
        assert empty_mapper.to_label(None, "skin_type") is None
    # legitimate "user didn't fill it in" — must not spam warnings
    assert not any("Unmapped" in r.message for r in caplog.records)


def test_mapper_unknown_dimension_warns(empty_mapper, caplog):
    with caplog.at_level(logging.WARNING):
        assert empty_mapper.to_label("A01", "not_a_real_dimension") is None
    assert any("Unmapped" in r.message for r in caplog.records)


def test_mapper_missing_file_logs_and_degrades(tmp_path, caplog):
    missing = tmp_path / "nope.json"
    with caplog.at_level(logging.WARNING):
        m = ProfileCodeMapper(missing)
    # Still usable — just always returns None.
    assert m.to_label("A01", "skin_type") is None


def test_mapper_loads_curated_labels(tmp_path):
    dictionary = {
        "skin_type": {"A01": "건성", "A02": None},
        "skin_tone": {"B01": "봄웜톤"},
        "skin_trouble": {"C01": "잡티"},
    }
    path = tmp_path / "dict.json"
    path.write_text(json.dumps(dictionary), encoding="utf-8")
    m = ProfileCodeMapper(path)
    assert m.to_label("A01", "skin_type") == "건성"
    assert m.to_label("A02", "skin_type") is None  # curated-as-null
    assert m.to_label("B01", "skin_tone") == "봄웜톤"
    assert m.to_labels(["C01", "C99"], "skin_trouble") == ["잡티"]
    assert m.to_labels(None, "skin_trouble") == []
    assert m.to_labels([], "skin_trouble") == []


def test_mapper_ignores_non_dim_top_level_keys(tmp_path):
    # Dictionary files carry a `_comment` and `_observed_codes_pending_curation`
    # — loader must tolerate (and ignore) them without raising.
    dictionary = {
        "_comment": "anything",
        "_observed_codes_pending_curation": True,
        "skin_type": {"A01": "건성"},
    }
    path = tmp_path / "dict.json"
    path.write_text(json.dumps(dictionary), encoding="utf-8")
    m = ProfileCodeMapper(path)
    assert m.to_label("A01", "skin_type") == "건성"


def test_mapper_warns_once_per_code(empty_mapper, caplog):
    with caplog.at_level(logging.WARNING):
        empty_mapper.to_label("A01", "skin_type")
        empty_mapper.to_label("A01", "skin_type")
        empty_mapper.to_label("A01", "skin_type")
    warnings = [r for r in caplog.records if "Unmapped" in r.message]
    assert len(warnings) == 1


def test_seed_dictionary_covers_every_fixture_code(page1_body, page2_body, seed_mapper):
    """Regression on the committed seed at data/option_dictionary/oliveyoung_profile_codes.json.

    If a new code appears in either fixture that isn't in the seed, the seed
    is stale — extend it (label may stay null until a curator resolves it).
    """
    observed: dict[str, set[str]] = {
        "skin_type": set(), "skin_tone": set(), "skin_trouble": set(),
    }
    for body in (page1_body, page2_body):
        for rec in body["data"]["goodsReviewList"]:
            p = rec["profileDto"]
            if p.get("skinType"):
                observed["skin_type"].add(p["skinType"])
            if p.get("skinTone"):
                observed["skin_tone"].add(p["skinTone"])
            for c in p.get("skinTrouble") or []:
                observed["skin_trouble"].add(c)
    for dim, codes in observed.items():
        missing = codes - set(seed_mapper._dict.get(dim, {}).keys())
        assert not missing, f"{dim} codes missing from seed: {sorted(missing)}"


# ----------------------------- parse_response_body: fixtures -----------------------------

def test_parse_page1_yields_10_records(page1_body, seed_mapper, collected_at):
    raws = parse_response_body(
        page1_body, code_mapper=seed_mapper, keyword="블러셔",
        collected_at=collected_at,
    )
    assert len(raws) == 10


def test_parse_page2_yields_10_records(page2_body, seed_mapper, collected_at):
    raws = parse_response_body(
        page2_body, code_mapper=seed_mapper, keyword="블러셔",
        collected_at=collected_at,
    )
    assert len(raws) == 10


def test_first_page1_record_fully_mapped(page1_body, seed_mapper, collected_at):
    raws = parse_response_body(
        page1_body, code_mapper=seed_mapper, keyword="블러셔",
        collected_at=collected_at,
    )
    raw = raws[0]
    assert raw.source_channel == "oliveyoung"
    assert raw.source_id == "58434650"
    assert raw.source_url is None
    assert raw.raw_text.startswith("촉촉해서 꿀광가능입니다")
    assert raw.raw_rating == 5
    assert raw.raw_date == "2026-04-16"
    assert raw.raw_author == "말랑볼"
    assert raw.raw_language == "ko"
    assert raw.keyword_used == "블러셔"
    assert raw.collected_at == collected_at

    md = raw.raw_metadata
    # promoted-to-channel_meta
    assert md["skin_type"] == "건성"  # seed maps A02 → 건성
    assert md["age_group"] is None  # OY API does not expose
    assert md["product_option_raw"] == "[피크닉백 증정] 베어리"
    # promoted-to-row
    assert md["product_external_id"] == "A000000238828"
    # audit / non-promoted
    assert md["oy_review_id"] == 58434650
    assert md["oy_skin_type_code"] == "A02"
    assert md["oy_skin_tone_code"] == "B01"
    assert md["oy_skin_trouble_codes"] == ["C09"]
    assert md["oy_review_type"] == "OFFLINE"
    assert md["oy_useful_point"] == 3672.0
    assert md["oy_recommend_count"] == 5
    assert md["oy_has_photo"] is False
    assert md["oy_is_repurchase"] is False
    assert md["oy_is_top_reviewer"] is True
    assert md["oy_is_shutterbrity"] is False
    assert md["oy_member_nickname"] == "말랑볼"
    assert md["oy_goods_name"].startswith("[NEW컬러")
    assert md["oy_item_number"] == "001"


def test_record_with_null_profile_fields_parses(page1_body, seed_mapper, collected_at):
    """Record index 3 (제뜨) has skinType=null / skinTone=null and photos."""
    raws = parse_response_body(
        page1_body, code_mapper=seed_mapper, keyword="x",
        collected_at=collected_at,
    )
    raw = raws[3]
    assert raw.source_id == "57869071"
    assert raw.raw_author == "제뜨"
    md = raw.raw_metadata
    assert md["oy_skin_type_code"] is None
    assert md["oy_skin_tone_code"] is None
    assert md["oy_skin_trouble_codes"] == []
    assert md["oy_has_photo"] is True
    assert md["skin_type"] is None  # null code → None label (no warning)


def test_record_with_null_profile_image_url_parses(page2_body, seed_mapper, collected_at):
    """Record index 3 of page2 (Amigothecat) has profileImageUrl=null."""
    raws = parse_response_body(
        page2_body, code_mapper=seed_mapper, keyword="x",
        collected_at=collected_at,
    )
    raw = raws[3]
    assert raw.source_id == "58026948"
    assert raw.raw_author == "Amigothecat"


def test_all_dates_on_both_pages_are_iso(page1_body, page2_body, seed_mapper, collected_at):
    for body in (page1_body, page2_body):
        raws = parse_response_body(
            body, code_mapper=seed_mapper, keyword="x",
            collected_at=collected_at,
        )
        for raw in raws:
            assert raw.raw_date is not None
            assert len(raw.raw_date) == 10
            assert raw.raw_date[4] == "-" and raw.raw_date[7] == "-"


def test_source_ids_are_stringified(page1_body, seed_mapper, collected_at):
    raws = parse_response_body(
        page1_body, code_mapper=seed_mapper, keyword="x",
        collected_at=collected_at,
    )
    for raw in raws:
        assert isinstance(raw.source_id, str)
        assert raw.source_id.isdigit()


def test_source_ids_unique_across_both_pages(
    page1_body, page2_body, seed_mapper, collected_at
):
    r1 = parse_response_body(
        page1_body, code_mapper=seed_mapper, keyword="x",
        collected_at=collected_at,
    )
    r2 = parse_response_body(
        page2_body, code_mapper=seed_mapper, keyword="x",
        collected_at=collected_at,
    )
    ids = [r.source_id for r in r1] + [r.source_id for r in r2]
    assert len(set(ids)) == len(ids)


def test_unknown_code_does_not_break_parse_and_warns_once(
    page1_body, empty_mapper, collected_at, caplog
):
    """Empty mapper = every code is unknown. Parser must still produce all 10
    records; mapper logs one warning per (dim, code)."""
    with caplog.at_level(logging.WARNING):
        raws = parse_response_body(
            page1_body, code_mapper=empty_mapper, keyword="x",
            collected_at=collected_at,
        )
    assert len(raws) == 10
    for raw in raws:
        assert raw.raw_metadata["skin_type"] is None


# ----------------------------- parse_response_body: defensive paths -----------------------------

def test_empty_body_returns_empty_list(seed_mapper, collected_at):
    assert parse_response_body(
        {}, code_mapper=seed_mapper, keyword="x", collected_at=collected_at,
    ) == []


def test_non_dict_body_returns_empty_list(seed_mapper, collected_at):
    assert parse_response_body(
        "not-a-dict", code_mapper=seed_mapper, keyword="x",
        collected_at=collected_at,
    ) == []


def test_missing_data_object_returns_empty(seed_mapper, collected_at, caplog):
    with caplog.at_level(logging.WARNING):
        out = parse_response_body(
            {"status": "FAIL"}, code_mapper=seed_mapper, keyword="x",
            collected_at=collected_at,
        )
    assert out == []


def test_goods_review_list_not_a_list_returns_empty(seed_mapper, collected_at, caplog):
    with caplog.at_level(logging.WARNING):
        out = parse_response_body(
            {"data": {"goodsReviewList": "not-a-list"}},
            code_mapper=seed_mapper, keyword="x", collected_at=collected_at,
        )
    assert out == []


def test_malformed_records_in_list_are_skipped_without_breaking_batch(
    seed_mapper, collected_at,
):
    body = {
        "data": {
            "goodsReviewList": [
                None,
                "not-a-dict",
                {   # valid
                    "reviewId": 1, "content": "ok",
                    "goodsDto": {"goodsNumber": "A1"},
                    "profileDto": {"memberNickname": "x"},
                    "createdDateTime": "2026.04.01", "reviewScore": 5,
                },
                {"reviewId": 2, "content": ""},  # empty content
                {"content": "no review id"},     # missing reviewId
                {   # valid
                    "reviewId": 3, "content": "ok3",
                    "goodsDto": {}, "profileDto": {},
                    "createdDateTime": "2026.04.02",
                },
            ]
        }
    }
    raws = parse_response_body(
        body, code_mapper=seed_mapper, keyword="x", collected_at=collected_at,
    )
    assert [r.source_id for r in raws] == ["1", "3"]


# ----------------------------- _parse_review_record direct -----------------------------

def test_parse_review_record_returns_none_for_non_dict(seed_mapper, collected_at):
    assert _parse_review_record(
        None, code_mapper=seed_mapper, keyword="x", collected_at=collected_at,
    ) is None
    assert _parse_review_record(
        "not-a-dict", code_mapper=seed_mapper, keyword="x",
        collected_at=collected_at,
    ) is None


def test_parse_review_record_malformed_date_yields_none_raw_date(
    seed_mapper, collected_at,
):
    record = {
        "reviewId": 99, "content": "hi",
        "goodsDto": {"goodsNumber": "A1"}, "profileDto": {},
        "createdDateTime": "not-a-date", "reviewScore": 3,
    }
    raw = _parse_review_record(
        record, code_mapper=seed_mapper, keyword="x",
        collected_at=collected_at,
    )
    assert raw is not None
    assert raw.raw_date is None
    assert raw.source_id == "99"


# ---------------------------------------------------------------------------
# Total review count extraction (Phase 2E coverage_ratio support)
# ---------------------------------------------------------------------------


# _extract_total_count_from_response_body ----------------------------------


def test_response_body_total_count_returns_none_for_none_input():
    assert _extract_total_count_from_response_body(None) is None


def test_response_body_total_count_returns_none_for_empty_dict():
    assert _extract_total_count_from_response_body({}) is None


def test_response_body_total_count_at_root_path():
    assert _extract_total_count_from_response_body(
        {"totalCnt": 1234, "data": {}}
    ) == 1234


def test_response_body_total_count_at_data_path():
    """Some OY endpoint variants nest totalCnt under data."""
    assert _extract_total_count_from_response_body(
        {"data": {"totalCnt": 5678}}
    ) == 5678


def test_response_body_total_count_root_wins_over_nested():
    """When both paths have a value, prefer the root field — it's the
    canonical location per the module docstring."""
    assert _extract_total_count_from_response_body(
        {"totalCnt": 100, "data": {"totalCnt": 200}}
    ) == 100


def test_response_body_total_count_returns_none_for_null_values():
    assert _extract_total_count_from_response_body(
        {"totalCnt": None, "data": {"totalCnt": None}}
    ) is None


def test_response_body_total_count_excludes_zero_and_negative():
    """0 means 'no reviews' OR 'sentinel' — we treat as unknown
    rather than a real coverage denominator."""
    assert _extract_total_count_from_response_body(
        {"totalCnt": 0}
    ) is None
    assert _extract_total_count_from_response_body(
        {"totalCnt": -1}
    ) is None


def test_response_body_total_count_excludes_booleans():
    """bool is a subclass of int — make sure True/False don't get
    coerced into 1/0."""
    assert _extract_total_count_from_response_body(
        {"totalCnt": True}
    ) is None
    assert _extract_total_count_from_response_body(
        {"totalCnt": False}
    ) is None


def test_response_body_total_count_accepts_string_with_commas():
    """Some endpoints stringify the count: '"1,234"' → 1234."""
    assert _extract_total_count_from_response_body(
        {"totalCnt": "1,234"}
    ) == 1234


def test_response_body_total_count_rejects_non_numeric_string():
    assert _extract_total_count_from_response_body(
        {"totalCnt": "not a number"}
    ) is None


# _extract_total_count_from_dom_text ---------------------------------------


@pytest.mark.parametrize(
    "text, expected",
    [
        ("리뷰 (1,234)", 1234),
        ("리뷰 (12345)", 12345),
        ("1,234건", 1234),
        ("리뷰 1234", 1234),
        ("총 1,234건", 1234),
        ("(987)", 987),
        ("리뷰 1", 1),
    ],
)
def test_dom_text_total_count_parses_known_shapes(text, expected):
    assert _extract_total_count_from_dom_text(text) == expected


@pytest.mark.parametrize(
    "text",
    [
        None,
        "",
        "리뷰",
        "abc",
    ],
)
def test_dom_text_total_count_returns_none_for_unparseable(text):
    assert _extract_total_count_from_dom_text(text) is None


def test_dom_text_total_count_excludes_zero():
    """0건 means '리뷰 없음' — no real denominator. Treat as unknown."""
    assert _extract_total_count_from_dom_text("0건") is None


def test_dom_text_total_count_takes_first_match():
    """When multiple integers appear, the first is the count
    (e.g. '리뷰 1,234 / 평점 4.7' — we want 1234, not 4)."""
    assert _extract_total_count_from_dom_text(
        "리뷰 1,234 평점 4"
    ) == 1234


# ConnectorRunSummary serialization round-trip ------------------------------


def test_run_summary_round_trips_total_review_count_available():
    from src.voc.app.connector_run_summary import ConnectorRunSummary
    summary = ConnectorRunSummary(
        run_id="r1",
        channel="oliveyoung",
        requested_target="https://example/goodsNo=A0001",
        started_at=datetime(2026, 4, 28, 15, 30),
        total_review_count_available=1842,
    )
    assert summary.total_review_count_available == 1842
    payload = summary.model_dump_json()
    revived = ConnectorRunSummary.model_validate_json(payload)
    assert revived.total_review_count_available == 1842


def test_run_summary_default_total_count_is_none():
    """Backward-compat: pre-existing summaries without the field
    deserialize cleanly with total_review_count_available=None."""
    from src.voc.app.connector_run_summary import ConnectorRunSummary
    summary = ConnectorRunSummary(
        run_id="r1",
        channel="oliveyoung",
        requested_target="https://example/goodsNo=A0001",
        started_at=datetime(2026, 4, 28, 15, 30),
    )
    assert summary.total_review_count_available is None


# ProductResult preservation ------------------------------------------------


def test_product_result_carries_total_review_count_available():
    from src.voc.app.collection_batch import ProductResult
    pr = ProductResult(
        name="Test Product",
        oy_goods_no="A0001",
        started_at="2026-04-28T15:30:00",
        total_review_count_available=1842,
    )
    assert pr.total_review_count_available == 1842


def test_product_result_default_total_count_is_none():
    from src.voc.app.collection_batch import ProductResult
    pr = ProductResult(
        name="Test Product",
        oy_goods_no="A0001",
        started_at="2026-04-28T15:30:00",
    )
    assert pr.total_review_count_available is None


# Snapshot integration: coverage warning fires correctly --------------------


def test_coverage_warning_fires_when_total_capture_yields_low_ratio():
    """End-to-end: connector captured total=1842, scrape collected 845.
    coverage_ratio = 0.459 < 0.80 → warning fires with the locked
    Korean phrase."""
    from src.voc.reporting.phase2e.snapshots import (
        COVERAGE_WARNING_KO,
        AttributeSnapshot,
        CorpusProvenance,
        Snapshot,
        SNAPSHOT_SCHEMA_VERSION,
        compare_snapshots,
        compute_coverage_ratio,
    )
    total = 1842
    collected = 845
    ratio = compute_coverage_ratio(collected, total)
    assert ratio is not None and ratio < 0.80
    prov = CorpusProvenance(
        corpus_type="observed_scrape",
        sampling_strategy="latest_plus_signal",
        primary_sort_type="DATETIME_DESC",
        cap_policy="all",
        collected_primary_review_count=collected,
        total_review_count_available=total,
        coverage_ratio=ratio,
        is_full_corpus=False,
    )
    snap = Snapshot(
        schema_version=SNAPSHOT_SCHEMA_VERSION,
        goods_no="A0001",
        product_name="Test",
        collected_at="2026-04-28T15:30:00Z",
        n_reviews=collected,
        n_records=collected,
        attributes={
            "x": AttributeSnapshot(
                n_positive=400, n_negative=100,
                negative_share=100 / 500,
                avg_intensity_neg=2.0, priority_score=20.0,
            ),
        },
        provenance=prov,
    )
    cmp = compare_snapshots(snap, previous=None)
    assert cmp.coverage_warning == COVERAGE_WARNING_KO


def test_coverage_warning_silent_when_total_capture_yields_high_ratio():
    from src.voc.reporting.phase2e.snapshots import (
        AttributeSnapshot,
        CorpusProvenance,
        Snapshot,
        SNAPSHOT_SCHEMA_VERSION,
        compare_snapshots,
        compute_coverage_ratio,
    )
    total = 1000
    collected = 900
    ratio = compute_coverage_ratio(collected, total)
    assert ratio is not None and ratio >= 0.80
    prov = CorpusProvenance(
        corpus_type="observed_scrape",
        sampling_strategy="latest_only",
        primary_sort_type="DATETIME_DESC",
        cap_policy="all",
        collected_primary_review_count=collected,
        total_review_count_available=total,
        coverage_ratio=ratio,
        is_full_corpus=False,
    )
    snap = Snapshot(
        schema_version=SNAPSHOT_SCHEMA_VERSION,
        goods_no="A0001",
        product_name="Test",
        collected_at="2026-04-28T15:30:00Z",
        n_reviews=collected,
        n_records=collected,
        attributes={
            "x": AttributeSnapshot(
                n_positive=700, n_negative=200,
                negative_share=200 / 900,
                avg_intensity_neg=2.0, priority_score=15.0,
            ),
        },
        provenance=prov,
    )
    cmp = compare_snapshots(snap, previous=None)
    assert cmp.coverage_warning is None


def test_coverage_warning_silent_when_total_unknown():
    """When the connector failed to capture the total (None
    propagates), no coverage warning fires — we don't fake a ratio
    from an unknown denominator."""
    from src.voc.reporting.phase2e.snapshots import (
        AttributeSnapshot,
        CorpusProvenance,
        Snapshot,
        SNAPSHOT_SCHEMA_VERSION,
        compare_snapshots,
    )
    prov = CorpusProvenance(
        corpus_type="observed_scrape",
        sampling_strategy="latest_only",
        primary_sort_type="DATETIME_DESC",
        cap_policy="all",
        collected_primary_review_count=500,
        total_review_count_available=None,
        coverage_ratio=None,
        is_full_corpus=False,
    )
    snap = Snapshot(
        schema_version=SNAPSHOT_SCHEMA_VERSION,
        goods_no="A0001",
        product_name="Test",
        collected_at="2026-04-28T15:30:00Z",
        n_reviews=500,
        n_records=500,
        attributes={
            "x": AttributeSnapshot(
                n_positive=400, n_negative=100,
                negative_share=100 / 500,
                avg_intensity_neg=2.0, priority_score=15.0,
            ),
        },
        provenance=prov,
    )
    cmp = compare_snapshots(snap, previous=None)
    assert cmp.coverage_warning is None


# ---------------------------------------------------------------------------
# Mixed-goods filter (added 2026-05-01 — 기획 set products return reviews
# from multiple sub-product goodsNumbers in a single cursor response).
# ---------------------------------------------------------------------------


from src.voc.connectors.oliveyoung_browser_api import (
    parse_response_body_with_telemetry,
)


def _captured_cursor_body(*goods_numbers: str) -> dict:
    """Synthesize a cursor response that mixes multiple sub-product
    goodsNumbers in a single `data.goodsReviewList` — mirrors the
    shape captured for OY 기획 set products."""
    return {
        "status": "SUCCESS",
        "code": 200,
        "data": {
            "goodsReviewList": [
                {
                    "reviewId": 58660118 + i,
                    "content": (
                        f"얇아서 아침에 메이크업 준비하면서 붙여놓으면 "
                        f"금방 흡수되네요~ ({goods})"
                    ),
                    "goodsDto": {
                        "goodsNumber": goods,
                        "itemNumber": "015",
                        "goodsName": "메디힐 더마 패드 200매",
                        "optionName": " PDRN 모공 탄력 패드 200매",
                    },
                    "reviewScore": 5,
                    "createdDateTime": "2026.04.22",
                    "usefulPoint": 16254.0 + i,
                    "photoReviewList": [],
                    "profileDto": {
                        "memberNickname": f"reviewer_{i}",
                        "skinType": "A01",
                        "skinTone": "B02",
                        "skinTrouble": [],
                    },
                }
                for i, goods in enumerate(goods_numbers)
            ],
        },
    }


def test_parses_captured_cursor_shape(seed_mapper, collected_at):
    """The 2026-05-01 captured cursor response must parse into 2+
    RawReview rows, with reviewId / content / rating / option /
    item_number / nickname all populated. Regression gate against
    a parser regression breaking the documented shape."""
    body = _captured_cursor_body("A000000171427", "A000000171427")
    raws = parse_response_body(
        body, code_mapper=seed_mapper, keyword="패드",
        collected_at=collected_at,
    )
    assert len(raws) == 2
    r = raws[0]
    assert r.source_id == "58660118"
    assert r.raw_text.startswith("얇아서 아침에")
    assert r.raw_rating == 5
    assert r.raw_date == "2026-04-22"
    md = r.raw_metadata
    assert md["product_external_id"] == "A000000171427"
    assert md["oy_item_number"] == "015"
    assert md["product_option_raw"] == " PDRN 모공 탄력 패드 200매"
    assert md["oy_useful_point"] == 16254.0
    assert md["oy_member_nickname"] == "reviewer_0"


def test_target_goods_no_filters_sibling_subproduct_rows(
    seed_mapper, collected_at,
):
    """When `target_goods_no` is set, records whose goodsNumber differs
    are dropped. Critical for 기획 set products (A000000171426 +
    A000000171427 in the same payload)."""
    body = _captured_cursor_body(
        "A000000171426",  # sibling — should be filtered
        "A000000171427",  # target — should be kept
        "A000000171427",  # target — should be kept
        "A000000171426",  # sibling — should be filtered
    )
    raws = parse_response_body(
        body, code_mapper=seed_mapper, keyword="패드",
        collected_at=collected_at,
        target_goods_no="A000000171427",
    )
    assert len(raws) == 2
    for r in raws:
        assert r.raw_metadata["product_external_id"] == "A000000171427"


def test_target_goods_no_none_keeps_everything(
    seed_mapper, collected_at,
):
    """Backward-compat: callers that don't set `target_goods_no` get
    the legacy behavior (no filtering)."""
    body = _captured_cursor_body("A000000171426", "A000000171427")
    raws = parse_response_body(
        body, code_mapper=seed_mapper, keyword="패드",
        collected_at=collected_at,
    )
    assert len(raws) == 2


def test_telemetry_reports_filter_counts(
    seed_mapper, collected_at,
):
    """`parse_response_body_with_telemetry` must surface kept /
    filtered / total / dropped counts. Sum invariant verified."""
    body = _captured_cursor_body(
        "A000000171426", "A000000171427",
        "A000000171427", "A000000171426", "A000000171427",
    )
    raws, telem = parse_response_body_with_telemetry(
        body, code_mapper=seed_mapper, keyword="패드",
        collected_at=collected_at,
        target_goods_no="A000000171427",
    )
    assert telem["total_before_filter"] == 5
    assert telem["filtered_by_goods_no"] == 2
    assert telem["kept_after_goods_no_filter"] == 3
    # Sum invariant.
    assert (
        telem["total_before_filter"]
        == telem["kept_after_goods_no_filter"]
        + telem["filtered_by_goods_no"]
        + telem["dropped_unparseable"]
    )
    assert len(raws) == 3


def test_telemetry_zero_filter_when_target_none(
    seed_mapper, collected_at,
):
    body = _captured_cursor_body("A000000171426", "A000000171427")
    raws, telem = parse_response_body_with_telemetry(
        body, code_mapper=seed_mapper, keyword="패드",
        collected_at=collected_at,
    )
    assert telem["filtered_by_goods_no"] == 0
    assert telem["kept_after_goods_no_filter"] == 2


def test_record_missing_goods_dto_kept_defensively(
    seed_mapper, collected_at,
):
    """A record without `goodsDto.goodsNumber` does not get filtered.
    The defensive default avoids losing rows whose payload doesn't
    carry the discriminator."""
    body = {
        "data": {
            "goodsReviewList": [
                {
                    "reviewId": 99,
                    "content": "good",
                    # no goodsDto key
                    "reviewScore": 4,
                    "createdDateTime": "2026.01.01",
                    "profileDto": {},
                },
            ],
        },
    }
    raws = parse_response_body(
        body, code_mapper=seed_mapper, keyword="x",
        collected_at=collected_at,
        target_goods_no="A000000171427",
    )
    assert len(raws) == 1
