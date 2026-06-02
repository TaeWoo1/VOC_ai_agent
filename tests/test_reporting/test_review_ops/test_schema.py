from __future__ import annotations

import json
from datetime import date, datetime, timezone

from src.voc.reporting.review_ops.schema import (
    DEFAULT_DISCLAIMER_KO,
    SCHEMA_VERSION,
    AssetCounts,
    AssetItem,
    Metrics,
    ProductMeta,
    ReviewOpsAnalysis,
)


def _minimal_report(**overrides) -> ReviewOpsAnalysis:
    base = dict(
        source_run_dir="/tmp/fake",
        generated_at=datetime(2026, 5, 4, 12, tzinfo=timezone.utc),
    )
    base.update(overrides)
    return ReviewOpsAnalysis(**base)


def test_schema_version_constant_and_default_match():
    assert SCHEMA_VERSION == "review_ops_analysis.v1"
    assert _minimal_report().schema_version == SCHEMA_VERSION


def test_default_disclaimer_is_present_and_hedged():
    report = _minimal_report()
    assert report.disclaimer == DEFAULT_DISCLAIMER_KO
    # Disclaimer must explicitly disclaim defect/sales claims.
    assert "단정하지 않습니다" in report.disclaimer


def test_assets_buckets_default_to_empty_lists():
    a = _minimal_report().assets
    assert a.usable == []
    assert a.stale == []
    assert a.risk == []
    assert a.insight == []


def test_generated_actions_defaults_to_empty_lists():
    g = _minimal_report().generated_actions
    assert g.landing_page_copy == []
    assert g.reply_drafts == []
    assert g.oem_questions == []
    assert g.faq_items == []
    assert g.content_angles == []


def test_consumer_safe_signals_default_to_empty_list():
    assert _minimal_report().consumer_safe_signals == []


def test_emergent_clusters_default_to_empty_list():
    assert _minimal_report().emergent_clusters == []


def test_asset_counts_default_to_zero():
    counts = _minimal_report().asset_counts
    assert counts.usable == 0
    assert counts.stale == 0
    assert counts.risk == 0
    assert counts.insight == 0


def test_pydantic_round_trip_preserves_top_level_payload():
    original = _minimal_report(
        source_run_id="run_xyz",
        product=ProductMeta(display_product_name="테스트 제품"),
        metrics=Metrics(total_reviews=42, average_rating=4.2),
        asset_counts=AssetCounts(usable=5, risk=3),
        emergent_clusters=[
            {
                "cluster_id": "packaging_pump_leak",
                "method": "keyword_v1",
                "evidence_count": 3,
                "evidence_review_ids": ["a", "b", "c"],
                "linked_attribute": "packaging_container",
            }
        ],
        consumer_safe_signals=[
            {
                "topic_label": "packaging_container",
                "tone": "caution",
                "summary": "용기 의견이 일부 반복됐어요",
                "evidence_count": 3,
                "audit": {"evidence_review_id_truncated": ["abcdef01…"]},
            }
        ],
    )

    payload = original.model_dump(mode="json")
    rehydrated = ReviewOpsAnalysis.model_validate(payload)
    assert rehydrated.source_run_id == "run_xyz"
    assert rehydrated.metrics.total_reviews == 42
    assert rehydrated.metrics.average_rating == 4.2
    assert rehydrated.asset_counts.usable == 5
    assert rehydrated.emergent_clusters[0]["cluster_id"] == "packaging_pump_leak"
    assert rehydrated.consumer_safe_signals[0]["topic_label"] == "packaging_container"

    # Round-trip via JSON string is idempotent on the dumped payload.
    second = ReviewOpsAnalysis.model_validate_json(
        json.dumps(payload, ensure_ascii=False)
    )
    assert second.model_dump(mode="json") == payload


def test_asset_item_round_trip_preserves_fields():
    item = AssetItem(
        review_id="rid_123",
        quote="짧은 인용",
        rating=2.0,
        review_date=date(2024, 8, 12),
        product_option="기본",
        asset_classes=["risk", "stale"],
        topic_labels=["packaging_container"],
        reason="리스크 후보",
        suggested_action="CS 답글 회수 검토",
        has_brand_reply=False,
        is_stale_candidate=True,
        age_days=631,
        stale_band="actionable",
    )
    payload = item.model_dump(mode="json")
    re = AssetItem.model_validate(payload)
    assert re.review_id == "rid_123"
    assert re.review_date == date(2024, 8, 12)
    assert re.asset_classes == ["risk", "stale"]
    assert re.is_stale_candidate is True
    assert re.age_days == 631
    assert re.stale_band == "actionable"


def test_asset_item_age_days_and_stale_band_default_none():
    item = AssetItem(review_id="r", quote="q")
    assert item.age_days is None
    assert item.stale_band is None


def test_executive_summary_defaults_to_empty_string():
    assert _minimal_report().executive_summary == ""
