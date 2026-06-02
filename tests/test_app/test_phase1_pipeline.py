"""Tests for Phase1Pipeline — collect → normalize → strip-and-promote → persist."""

from __future__ import annotations

from datetime import datetime

import pytest

from src.voc.app.connector_run_summary import ConnectorRunSummary
from src.voc.app.phase1_pipeline import Phase1Pipeline
from src.voc.persistence.migrations import init_db
from src.voc.persistence.phase1_review_repository import Phase1ReviewRepository
from src.voc.persistence.phase1_run_repository import Phase1RunRepository
from src.voc.schemas.channel_meta import CoupangMeta
from src.voc.schemas.raw import RawReview


COUPANG_PROMOTED_KEYS = {
    "verified_purchase", "photo_attached", "helpful_count", "review_title",
}


@pytest.fixture
def db():
    return init_db(":memory:")


@pytest.fixture
def review_repo(db):
    return Phase1ReviewRepository(db)


@pytest.fixture
def run_repo(db):
    return Phase1RunRepository(db)


@pytest.fixture
def pipeline(review_repo, run_repo):
    return Phase1Pipeline(review_repo=review_repo, run_repo=run_repo)


def _raw(text="좋은 제품이에요 정말로 만족", title="좋아요", **overrides):
    raw_metadata = {
        "review_title": title,
        "product_external_id": overrides.pop("product_external_id", "12345"),
        "product_url": "https://www.coupang.com/vp/products/12345",
        "product_title": "조은몰드 사각 전선몰딩",
    }
    raw_metadata.update(overrides.pop("extra_raw", {}))
    return RawReview(
        source_channel=overrides.pop("source_channel", "coupang"),
        source_id=overrides.pop("source_id", "12345::7"),
        source_url="https://www.coupang.com/vp/products/12345",
        raw_text=text,
        raw_rating=overrides.pop("raw_rating", 5),
        raw_author="임*숙",
        raw_date=overrides.pop("raw_date", "2024-03-19"),
        raw_language="ko",
        raw_metadata=raw_metadata,
        collected_at=datetime(2026, 1, 1),
        keyword_used="에어팟",
    )


def _summary(**overrides) -> ConnectorRunSummary:
    base = {
        "run_id": "ignored_by_pipeline",
        "channel": "coupang",
        "requested_target": "fixture",
        "started_at": datetime(2026, 1, 1),
        "raw_records_seen": 1,
        "records_parsed": 1,
    }
    base.update(overrides)
    return ConnectorRunSummary(**base)


class FakeConnector:
    def __init__(self, raws, summary=None, channel_name="coupang"):
        self._raws = raws
        self.last_run_summary = summary
        self._channel_name = channel_name

    @property
    def channel_name(self):
        return self._channel_name

    async def collect(self, target, params=None):
        return self._raws


# ---------- happy path ----------

@pytest.mark.asyncio
async def test_ok_run_persists_rows_and_saves_summary(pipeline, review_repo, run_repo):
    connector = FakeConnector([_raw()], _summary())
    result = await pipeline.run(
        connector=connector, target="fixture",
        channel_meta_class=CoupangMeta,
        promoted_keys=COUPANG_PROMOTED_KEYS,
    )
    assert result.quality_status == "ok"
    assert result.rows_inserted == 1
    assert result.rows_skipped == 0
    assert review_repo.count_by_channel() == {"coupang": 1}
    run_row = run_repo.get(result.run_id)
    assert run_row is not None
    assert run_row["quality_status"] == "ok"


@pytest.mark.asyncio
async def test_run_id_stamped_on_persisted_rows(pipeline, review_repo):
    connector = FakeConnector([_raw()], _summary())
    result = await pipeline.run(
        connector=connector, target="fixture",
        channel_meta_class=CoupangMeta,
        promoted_keys=COUPANG_PROMOTED_KEYS,
    )
    rows = review_repo.query(run_id=result.run_id)
    assert len(rows) == 1
    assert rows[0]["run_id"] == result.run_id


# ---------- promotion / strip ----------

@pytest.mark.asyncio
async def test_promoted_keys_stripped_from_raw_metadata(pipeline, review_repo):
    connector = FakeConnector([_raw(title="좋아요")], _summary())
    result = await pipeline.run(
        connector=connector, target="fixture",
        channel_meta_class=CoupangMeta,
        promoted_keys=COUPANG_PROMOTED_KEYS,
    )
    row = review_repo.query(run_id=result.run_id)[0]
    # channel_meta carries the promoted title
    assert row["channel_meta"]["review_title"] == "좋아요"
    # raw_metadata does NOT carry it
    assert "review_title" not in row["raw_metadata"]
    # raw_metadata also does NOT carry product_external_id (extracted to row column)
    assert "product_external_id" not in row["raw_metadata"]
    # non-promoted keys remain
    assert row["raw_metadata"]["product_url"] == "https://www.coupang.com/vp/products/12345"
    assert row["raw_metadata"]["product_title"] == "조은몰드 사각 전선몰딩"


@pytest.mark.asyncio
async def test_product_external_id_extracted_to_row_column(pipeline, review_repo):
    connector = FakeConnector([_raw(product_external_id="98765")], _summary())
    result = await pipeline.run(
        connector=connector, target="fixture",
        channel_meta_class=CoupangMeta,
        promoted_keys=COUPANG_PROMOTED_KEYS,
    )
    row = review_repo.query(run_id=result.run_id)[0]
    assert row["product_external_id"] == "98765"


@pytest.mark.asyncio
async def test_unexposed_promoted_keys_default_to_none_on_channel_meta(pipeline, review_repo):
    # Coupang CSV doesn't expose verified_purchase etc.; CoupangMeta defaults them
    connector = FakeConnector([_raw()], _summary())
    result = await pipeline.run(
        connector=connector, target="fixture",
        channel_meta_class=CoupangMeta,
        promoted_keys=COUPANG_PROMOTED_KEYS,
    )
    cm = review_repo.query(run_id=result.run_id)[0]["channel_meta"]
    assert cm["verified_purchase"] is None
    assert cm["photo_attached"] is None
    assert cm["helpful_count"] is None
    assert cm["source_channel"] == "coupang"


# ---------- normalize rejection ----------

@pytest.mark.asyncio
async def test_normalize_rejected_rows_counted_as_skipped(pipeline, review_repo):
    raws = [
        _raw(text="좋은 제품 정말로 만족", source_id="row_1"),  # 12 chars OK
        _raw(text="굿", source_id="row_2"),                    # 1 char → text floor
        _raw(text="두번째 좋은 제품 정말로", source_id="row_3"),  # OK
    ]
    summary = _summary(raw_records_seen=3, records_parsed=3)
    connector = FakeConnector(raws, summary)
    result = await pipeline.run(
        connector=connector, target="fixture",
        channel_meta_class=CoupangMeta,
        promoted_keys=COUPANG_PROMOTED_KEYS,
    )
    assert result.quality_status == "ok"
    assert result.rows_inserted == 2
    assert result.rows_skipped == 1


# ---------- quality gate ----------

@pytest.mark.asyncio
async def test_invalid_run_skips_persistence_but_saves_summary(pipeline, review_repo, run_repo):
    summary = _summary(blocked=True)
    connector = FakeConnector([_raw()], summary)
    result = await pipeline.run(
        connector=connector, target="fixture",
        channel_meta_class=CoupangMeta,
        promoted_keys=COUPANG_PROMOTED_KEYS,
    )
    assert result.quality_status == "invalid"
    assert result.rows_inserted == 0
    assert review_repo.count_by_channel() == {}
    assert run_repo.get(result.run_id)["quality_status"] == "invalid"


@pytest.mark.asyncio
async def test_auth_error_blocks_persistence(pipeline, review_repo, run_repo):
    summary = _summary(auth_error=True)
    connector = FakeConnector([_raw()], summary)
    result = await pipeline.run(
        connector=connector, target="fixture",
        channel_meta_class=CoupangMeta,
        promoted_keys=COUPANG_PROMOTED_KEYS,
    )
    assert result.quality_status == "invalid"
    assert review_repo.count_by_channel() == {}


@pytest.mark.asyncio
async def test_cursor_429_invalid_partial_persists_valid_rows(
    pipeline, review_repo, run_repo,
):
    summary = _summary(
        raw_records_seen=2,
        records_parsed=2,
        blocked=True,
        http_429_seen=True,
        cursor_api_rate_limited=True,
    )
    raws = [
        _raw(source_channel="oliveyoung", source_id="oy::1"),
        _raw(source_channel="oliveyoung", source_id="oy::2"),
    ]
    connector = FakeConnector(raws, summary, channel_name="oliveyoung")

    result = await pipeline.run(
        connector=connector,
        target="fixture",
        channel_meta_class=CoupangMeta,
        promoted_keys=COUPANG_PROMOTED_KEYS,
    )

    assert result.quality_status == "invalid"
    assert result.rows_inserted == 2
    assert review_repo.count_by_channel() == {"oliveyoung": 2}
    run_row = run_repo.get(result.run_id)
    assert run_row["quality_status"] == "invalid"
    assert run_row["summary"]["cursor_api_rate_limited"] is True


@pytest.mark.asyncio
async def test_cursor_partial_insert_is_idempotent(pipeline, review_repo):
    summary = _summary(
        raw_records_seen=1,
        records_parsed=1,
        blocked=True,
        http_429_seen=True,
        cursor_api_rate_limited=True,
    )
    raws = [_raw(source_channel="oliveyoung", source_id="oy::same")]

    result1 = await pipeline.run(
        connector=FakeConnector(raws, summary, channel_name="oliveyoung"),
        target="fixture",
        channel_meta_class=CoupangMeta,
        promoted_keys=COUPANG_PROMOTED_KEYS,
    )
    result2 = await pipeline.run(
        connector=FakeConnector(raws, summary, channel_name="oliveyoung"),
        target="fixture",
        channel_meta_class=CoupangMeta,
        promoted_keys=COUPANG_PROMOTED_KEYS,
    )

    assert result1.rows_inserted == 1
    assert result2.rows_inserted == 0
    assert review_repo.count_by_channel() == {"oliveyoung": 1}


@pytest.mark.asyncio
async def test_human_check_invalid_partial_does_not_persist(
    pipeline, review_repo,
):
    summary = _summary(
        raw_records_seen=1,
        records_parsed=1,
        blocked=True,
        http_429_seen=True,
        cursor_api_rate_limited=True,
        human_check_detected=True,
        human_check_recovered=False,
    )
    connector = FakeConnector(
        [_raw(source_channel="oliveyoung", source_id="oy::captcha")],
        summary,
        channel_name="oliveyoung",
    )

    result = await pipeline.run(
        connector=connector,
        target="fixture",
        channel_meta_class=CoupangMeta,
        promoted_keys=COUPANG_PROMOTED_KEYS,
    )

    assert result.quality_status == "invalid"
    assert result.rows_inserted == 0
    assert review_repo.count_by_channel() == {}


@pytest.mark.asyncio
async def test_degraded_run_still_persists(pipeline, review_repo, run_repo):
    # 11 warnings / 100 parsed = 0.11 > 0.1 → degraded but rows persist
    summary = _summary(raw_records_seen=100, records_parsed=100, parse_warnings=11)
    raws = [_raw() for _ in range(1)]  # supply one raw to be persisted
    connector = FakeConnector(raws, summary)
    result = await pipeline.run(
        connector=connector, target="fixture",
        channel_meta_class=CoupangMeta,
        promoted_keys=COUPANG_PROMOTED_KEYS,
    )
    assert result.quality_status == "degraded"
    assert result.rows_inserted == 1
    assert run_repo.get(result.run_id)["quality_status"] == "degraded"


# ---------- connector exception ----------

@pytest.mark.asyncio
async def test_connector_exception_yields_invalid_run(pipeline, review_repo, run_repo):
    class BrokenConnector:
        last_run_summary = None

        @property
        def channel_name(self):
            return "coupang"

        async def collect(self, target, params=None):
            raise RuntimeError("boom!")

    result = await pipeline.run(
        connector=BrokenConnector(), target="fixture",
        channel_meta_class=CoupangMeta,
        promoted_keys=COUPANG_PROMOTED_KEYS,
    )
    assert result.quality_status == "invalid"
    assert result.rows_inserted == 0
    assert review_repo.count_by_channel() == {}
    run_row = run_repo.get(result.run_id)
    assert run_row is not None
    assert "boom!" in run_row["summary"]["sample_dropped_reasons"][0]


# 2026-05-01 — Phase1Pipeline catches connector.collect exceptions; the
# error_summary it builds must inspect the message for the canonical
# CDP-attach wall markers and set `cdp_attach_failed=True` so the
# downstream classify_status returns `cdp_attach_failed` rather than the
# legacy generic `unknown_failure`. Without this, the OY operator sees
# `status=unknown_failure` even though the verbatim
# Browser.setDownloadBehavior message is in `sample_dropped_reasons`.
@pytest.mark.asyncio
async def test_cdp_attach_marker_sets_summary_flag(pipeline, run_repo):
    class CdpWallConnector:
        last_run_summary = None

        @property
        def channel_name(self):
            return "oliveyoung"

        async def collect(self, target, params=None):
            raise RuntimeError(
                "BrowserType.connect_over_cdp: Protocol error "
                "(Browser.setDownloadBehavior): Browser context "
                "management is not supported."
            )

    result = await pipeline.run(
        connector=CdpWallConnector(), target="fixture",
        channel_meta_class=CoupangMeta,
        promoted_keys=COUPANG_PROMOTED_KEYS,
    )
    assert result.quality_status == "invalid"
    summary = run_repo.get(result.run_id)["summary"]
    assert summary["cdp_attach_failed"] is True
    assert summary["page_open_failed"] is False
    assert summary["cdp_attach_error"] is not None
    assert "setDownloadBehavior" in summary["cdp_attach_error"]
    # And the verbatim message is still in sample_dropped_reasons (truncated).
    assert "setDownloadBehavior" in summary["sample_dropped_reasons"][0]


@pytest.mark.asyncio
async def test_page_open_marker_sets_page_flag(pipeline, run_repo):
    """Distinct from the CDP path: a page.goto-flavoured error sets
    `page_open_failed=True` and leaves `cdp_attach_failed=False`."""
    class PageOpenConnector:
        last_run_summary = None

        @property
        def channel_name(self):
            return "oliveyoung"

        async def collect(self, target, params=None):
            raise RuntimeError(
                "page.goto: net::ERR_CONNECTION_REFUSED at "
                "https://www.oliveyoung.co.kr/..."
            )

    result = await pipeline.run(
        connector=PageOpenConnector(), target="fixture",
        channel_meta_class=CoupangMeta,
        promoted_keys=COUPANG_PROMOTED_KEYS,
    )
    summary = run_repo.get(result.run_id)["summary"]
    assert summary["cdp_attach_failed"] is False
    assert summary["page_open_failed"] is True
    assert "page.goto" in (summary["page_open_error"] or "")


@pytest.mark.asyncio
async def test_generic_exception_leaves_diagnostic_flags_false(pipeline, run_repo):
    """Sanity: a non-marker exception (e.g. a parser bug) does NOT
    spuriously set the diagnostic flags — they only fire on canonical
    markers, NOT on every exception."""
    class GenericConnector:
        last_run_summary = None

        @property
        def channel_name(self):
            return "oliveyoung"

        async def collect(self, target, params=None):
            raise ValueError("invalid date format in row 7")

    result = await pipeline.run(
        connector=GenericConnector(), target="fixture",
        channel_meta_class=CoupangMeta,
        promoted_keys=COUPANG_PROMOTED_KEYS,
    )
    summary = run_repo.get(result.run_id)["summary"]
    assert summary["cdp_attach_failed"] is False
    assert summary["page_open_failed"] is False
    assert summary["cdp_attach_error"] is None
    assert summary["page_open_error"] is None


@pytest.mark.asyncio
async def test_attribute_error_does_not_misroute_to_cdp_attach_failed(
    pipeline, run_repo,
):
    """2026-05-01 — connector-internal bugs (e.g. the `REVIEW_MORE_LOCATORS`
    AttributeError) must NOT classify as `cdp_attach_failed`. They are
    bugs in OUR code, not Playwright/Chrome compat issues. The verbatim
    message must still land in sample_dropped_reasons for diagnosis."""
    class BuggyConnector:
        last_run_summary = None

        @property
        def channel_name(self):
            return "oliveyoung"

        async def collect(self, target, params=None):
            raise AttributeError(
                "'_PlaywrightReviewSession' object has no attribute "
                "'REVIEW_MORE_LOCATORS'"
            )

    result = await pipeline.run(
        connector=BuggyConnector(), target="fixture",
        channel_meta_class=CoupangMeta,
        promoted_keys=COUPANG_PROMOTED_KEYS,
    )
    summary = run_repo.get(result.run_id)["summary"]
    # Diagnostic flags must NOT fire for an internal bug.
    assert summary["cdp_attach_failed"] is False
    assert summary["page_open_failed"] is False
    # But the verbatim message must round-trip into sample_dropped_reasons
    # (truncated to 200 chars) so the operator can diagnose without the
    # full Python traceback. The attribute name and class are enough to
    # identify the bug; Python's `str(AttributeError(...))` does not
    # include the type name itself.
    joined = " ".join(summary["sample_dropped_reasons"])
    assert "REVIEW_MORE_LOCATORS" in joined
    assert "_PlaywrightReviewSession" in joined


# ---------- minimal summary fallback ----------

@pytest.mark.asyncio
async def test_minimal_summary_built_when_connector_omits_it(pipeline, review_repo, run_repo):
    # FakeConnector with summary=None → pipeline builds a minimal one
    connector = FakeConnector([_raw()], summary=None)
    result = await pipeline.run(
        connector=connector, target="fixture",
        channel_meta_class=CoupangMeta,
        promoted_keys=COUPANG_PROMOTED_KEYS,
    )
    assert result.quality_status == "ok"
    assert result.rows_inserted == 1


# ---------- idempotency ----------

@pytest.mark.asyncio
async def test_re_run_skips_duplicate_review_ids(pipeline, review_repo):
    raws = [_raw()]  # same review_id will be derived from same source_channel + source_id
    result1 = await pipeline.run(
        connector=FakeConnector(raws, _summary()),
        target="fixture",
        channel_meta_class=CoupangMeta,
        promoted_keys=COUPANG_PROMOTED_KEYS,
    )
    assert result1.rows_inserted == 1

    result2 = await pipeline.run(
        connector=FakeConnector(raws, _summary()),
        target="fixture",
        channel_meta_class=CoupangMeta,
        promoted_keys=COUPANG_PROMOTED_KEYS,
    )
    assert result2.rows_inserted == 0  # PK collision skipped
    assert review_repo.count_by_channel() == {"coupang": 1}


# ---------- rating_raw + ISO date ----------

@pytest.mark.asyncio
async def test_rating_raw_preserved_separately_from_rating_normalized(pipeline, review_repo):
    connector = FakeConnector([_raw(raw_rating=4)], _summary())
    result = await pipeline.run(
        connector=connector, target="fixture",
        channel_meta_class=CoupangMeta,
        promoted_keys=COUPANG_PROMOTED_KEYS,
    )
    row = review_repo.query(run_id=result.run_id)[0]
    assert row["rating_raw"] == 4.0
    assert row["rating_normalized"] == 0.75


@pytest.mark.asyncio
async def test_review_date_persisted_as_iso_string(pipeline, review_repo):
    connector = FakeConnector([_raw(raw_date="2024-03-19")], _summary())
    result = await pipeline.run(
        connector=connector, target="fixture",
        channel_meta_class=CoupangMeta,
        promoted_keys=COUPANG_PROMOTED_KEYS,
    )
    row = review_repo.query(run_id=result.run_id)[0]
    assert row["review_date"] == "2024-03-19"
