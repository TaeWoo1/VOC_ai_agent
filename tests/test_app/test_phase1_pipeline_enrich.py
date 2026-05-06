"""Tests for the optional enrich step + pipeline-level rejection observability (PR4)."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

import pytest

from src.voc.app.connector_run_summary import ConnectorRunSummary
from src.voc.app.phase1_pipeline import Phase1Pipeline
from src.voc.persistence.migrations import init_db
from src.voc.persistence.phase1_review_repository import Phase1ReviewRepository
from src.voc.persistence.phase1_run_repository import Phase1RunRepository
from src.voc.processing.segment_normalizer import DictionarySegmentNormalizer
from src.voc.schemas.channel_meta import (
    DerivedAttributes,
    OliveYoungMeta,
)
from src.voc.schemas.raw import RawReview


OY_PROMOTED_KEYS = {"skin_type", "age_group", "product_option_raw"}


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


@pytest.fixture
def dictionary_file(tmp_path) -> Path:
    p = tmp_path / "oy.json"
    p.write_text(json.dumps({
        "products": {
            "oy_lipstick_aaa_001": {
                "options": {"베어그레이프": {"color_family": "purple", "shade": "berry-gray"}},
            },
        },
    }, ensure_ascii=False), encoding="utf-8")
    return p


@pytest.fixture
def segment_normalizer(dictionary_file):
    return DictionarySegmentNormalizer(dictionary_file)


def make_oy_enrich(normalizer):
    def _enrich(channel_meta, product_external_id):
        if not isinstance(channel_meta, OliveYoungMeta):
            return None
        return DerivedAttributes(
            normalized_skin_type=normalizer.normalize_skin_type(channel_meta.skin_type),
            normalized_age_group=normalizer.normalize_age_group(channel_meta.age_group),
            normalized_product_option=normalizer.normalize_product_option(
                "oliveyoung", channel_meta.product_option_raw, product_external_id,
            ),
        )
    return _enrich


def _oy_raw(text="건성 피부에 잘 맞아요 보습력 좋고", **ovr) -> RawReview:
    raw_metadata = {
        "skin_type": ovr.pop("skin_type", "건성"),
        "age_group": ovr.pop("age_group", "20대 후반"),
        "product_option_raw": ovr.pop("product_option_raw", "베어그레이프"),
        "product_external_id": ovr.pop("product_external_id", "oy_lipstick_aaa_001"),
        "product_url": "https://www.oliveyoung.co.kr/x",
    }
    return RawReview(
        source_channel=ovr.pop("source_channel", "oliveyoung"),
        source_id=ovr.pop("source_id", "OY9876"),
        source_url="https://www.oliveyoung.co.kr/x",
        raw_text=text,
        raw_rating=ovr.pop("raw_rating", 4),
        raw_date="2026-01-15",
        raw_language="ko",
        raw_metadata=raw_metadata,
        collected_at=datetime(2026, 1, 1),
        keyword_used="lipstick",
    )


def _summary(**ovr) -> ConnectorRunSummary:
    base = {
        "run_id": "ignored",
        "channel": "oliveyoung",
        "requested_target": "fixture",
        "started_at": datetime(2026, 1, 1),
        "raw_records_seen": 1,
        "records_parsed": 1,
    }
    base.update(ovr)
    return ConnectorRunSummary(**base)


class FakeConnector:
    def __init__(self, raws, summary, channel_name="oliveyoung"):
        self._raws = raws
        self.last_run_summary = summary
        self._channel_name = channel_name

    @property
    def channel_name(self):
        return self._channel_name

    async def collect(self, target, params=None):
        return self._raws


# ---------- enrich populates derived ----------

@pytest.mark.asyncio
async def test_enrich_populates_all_three_derived_dimensions(
    pipeline, review_repo, segment_normalizer
):
    connector = FakeConnector([_oy_raw()], _summary())
    result = await pipeline.run(
        connector=connector, target="fixture",
        channel_meta_class=OliveYoungMeta,
        promoted_keys=OY_PROMOTED_KEYS,
        enrich_fn=make_oy_enrich(segment_normalizer),
    )
    row = review_repo.query(run_id=result.run_id)[0]
    derived = row["derived"]
    assert derived["normalized_skin_type"]["bucket"] == "dry"
    assert derived["normalized_age_group"]["bucket"] == "20s"
    assert derived["normalized_product_option"]["color_family"] == "purple"
    assert derived["normalized_product_option"]["shade"] == "berry-gray"


@pytest.mark.asyncio
async def test_enrich_unknown_skin_type_yields_unknown_bucket(
    pipeline, review_repo, segment_normalizer
):
    raws = [_oy_raw(skin_type="외계인", source_id="r1")]
    connector = FakeConnector(raws, _summary())
    result = await pipeline.run(
        connector=connector, target="fixture",
        channel_meta_class=OliveYoungMeta,
        promoted_keys=OY_PROMOTED_KEYS,
        enrich_fn=make_oy_enrich(segment_normalizer),
    )
    row = review_repo.query(run_id=result.run_id)[0]
    assert row["derived"]["normalized_skin_type"]["bucket"] == "unknown"


@pytest.mark.asyncio
async def test_enrich_mixed_skin_type_uses_first_token(
    pipeline, review_repo, segment_normalizer
):
    raws = [_oy_raw(skin_type="건성·지성", source_id="r1")]
    connector = FakeConnector(raws, _summary())
    result = await pipeline.run(
        connector=connector, target="fixture",
        channel_meta_class=OliveYoungMeta,
        promoted_keys=OY_PROMOTED_KEYS,
        enrich_fn=make_oy_enrich(segment_normalizer),
    )
    row = review_repo.query(run_id=result.run_id)[0]
    assert row["derived"]["normalized_skin_type"]["bucket"] == "dry"


@pytest.mark.asyncio
async def test_enrich_unknown_product_option_returns_none(
    pipeline, review_repo, segment_normalizer
):
    raws = [_oy_raw(product_external_id="no_such_product")]
    connector = FakeConnector(raws, _summary())
    result = await pipeline.run(
        connector=connector, target="fixture",
        channel_meta_class=OliveYoungMeta,
        promoted_keys=OY_PROMOTED_KEYS,
        enrich_fn=make_oy_enrich(segment_normalizer),
    )
    row = review_repo.query(run_id=result.run_id)[0]
    assert row["derived"]["normalized_product_option"] is None
    # other dimensions still populated
    assert row["derived"]["normalized_skin_type"]["bucket"] == "dry"


# ---------- no enrich_fn ----------

@pytest.mark.asyncio
async def test_no_enrich_fn_keeps_derived_null(pipeline, review_repo):
    connector = FakeConnector([_oy_raw()], _summary())
    result = await pipeline.run(
        connector=connector, target="fixture",
        channel_meta_class=OliveYoungMeta,
        promoted_keys=OY_PROMOTED_KEYS,
        enrich_fn=None,
    )
    row = review_repo.query(run_id=result.run_id)[0]
    assert row["derived"] is None


# ---------- pipeline_normalize_rejections observability ----------

@pytest.mark.asyncio
async def test_pipeline_normalize_rejections_recorded_on_summary(pipeline, run_repo):
    raws = [
        _oy_raw(text="건성 피부에 잘 맞아요 보습력 좋고", source_id="r1"),
        _oy_raw(text="굿", source_id="r2"),  # text floor reject by normalize()
    ]
    summary = _summary(raw_records_seen=2, records_parsed=2)
    connector = FakeConnector(raws, summary)
    result = await pipeline.run(
        connector=connector, target="fixture",
        channel_meta_class=OliveYoungMeta,
        promoted_keys=OY_PROMOTED_KEYS,
        enrich_fn=None,
    )
    assert result.rows_skipped == 1
    persisted = run_repo.get(result.run_id)["summary"]
    # PR4: pipeline-level rejection visible on persisted summary
    assert persisted["pipeline_normalize_rejections"] == 1
    # Connector-level drops are unchanged (the connector accepted both rows)
    assert persisted["records_dropped_short_text"] == 0


@pytest.mark.asyncio
async def test_pipeline_normalize_rejections_zero_when_no_rejections(pipeline, run_repo):
    connector = FakeConnector([_oy_raw()], _summary())
    result = await pipeline.run(
        connector=connector, target="fixture",
        channel_meta_class=OliveYoungMeta,
        promoted_keys=OY_PROMOTED_KEYS,
        enrich_fn=None,
    )
    persisted = run_repo.get(result.run_id)["summary"]
    assert persisted["pipeline_normalize_rejections"] == 0


@pytest.mark.asyncio
async def test_invalid_run_does_not_set_pipeline_rejections(pipeline, run_repo):
    # When the gate fails, no rows are processed → pipeline_normalize_rejections stays 0
    summary = _summary(blocked=True)
    connector = FakeConnector([_oy_raw(text="굿", source_id="r1")], summary)
    result = await pipeline.run(
        connector=connector, target="fixture",
        channel_meta_class=OliveYoungMeta,
        promoted_keys=OY_PROMOTED_KEYS,
        enrich_fn=None,
    )
    persisted = run_repo.get(result.run_id)["summary"]
    assert result.quality_status == "invalid"
    assert persisted["pipeline_normalize_rejections"] == 0
