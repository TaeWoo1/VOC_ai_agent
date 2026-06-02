"""Tests for channel-specific typed metadata and discriminated union."""

from __future__ import annotations

from datetime import datetime

import pytest
from pydantic import ValidationError

from src.voc.schemas.canonical import CanonicalReview
from src.voc.schemas.channel_meta import (
    CoupangMeta,
    DerivedAttributes,
    NormalizedAgeGroup,
    NormalizedProductOption,
    NormalizedSkinType,
    OliveYoungMeta,
)


def _base_canonical_kwargs(channel: str = "coupang", domain: str = "coupang.com") -> dict:
    return {
        "review_id": "abc123def4567890",
        "source_channel": channel,
        "source_domain": domain,
        "text": "좋은 제품이에요 만족합니다",
        "language": "ko",
        "content_fingerprint": "f" * 64,
        "product_keyword": "test",
        "collected_at": datetime(2026, 1, 1, 0, 0, 0),
        "ingested_at": datetime(2026, 1, 1, 0, 0, 1),
    }


def test_coupang_meta_defaults_discriminator():
    meta = CoupangMeta()
    assert meta.source_channel == "coupang"
    assert meta.verified_purchase is None
    assert meta.review_title is None


def test_oliveyoung_meta_defaults_discriminator():
    meta = OliveYoungMeta()
    assert meta.source_channel == "oliveyoung"
    assert meta.skin_type is None


def test_coupang_meta_round_trip():
    meta = CoupangMeta(
        verified_purchase=True,
        photo_attached=False,
        helpful_count=12,
        review_title="좋아요",
    )
    loaded = CoupangMeta.model_validate_json(meta.model_dump_json())
    assert loaded == meta


def test_oliveyoung_meta_round_trip():
    meta = OliveYoungMeta(
        skin_type="건성",
        age_group="20대 후반",
        product_option_raw="베어그레이프",
    )
    loaded = OliveYoungMeta.model_validate_json(meta.model_dump_json())
    assert loaded == meta


def test_canonical_review_with_coupang_meta_round_trip():
    cr = CanonicalReview(
        **_base_canonical_kwargs(),
        channel_meta=CoupangMeta(verified_purchase=True, helpful_count=3),
    )
    loaded = CanonicalReview.model_validate_json(cr.model_dump_json())
    assert isinstance(loaded.channel_meta, CoupangMeta)
    assert loaded.channel_meta.verified_purchase is True
    assert loaded.channel_meta.helpful_count == 3


def test_canonical_review_with_oliveyoung_meta_round_trip():
    cr = CanonicalReview(
        **_base_canonical_kwargs(channel="oliveyoung", domain="oliveyoung.co.kr"),
        channel_meta=OliveYoungMeta(skin_type="건성", age_group="20대 후반"),
    )
    loaded = CanonicalReview.model_validate_json(cr.model_dump_json())
    assert isinstance(loaded.channel_meta, OliveYoungMeta)
    assert loaded.channel_meta.skin_type == "건성"
    assert loaded.channel_meta.age_group == "20대 후반"


def test_canonical_review_defaults_for_new_fields():
    cr = CanonicalReview(**_base_canonical_kwargs())
    assert cr.channel_meta is None
    assert cr.derived is None
    assert cr.source_method == "csv_upload"


def test_canonical_review_source_method_rejects_unknown_value():
    with pytest.raises(ValidationError):
        CanonicalReview(**_base_canonical_kwargs(), source_method="ftp")  # type: ignore[arg-type]


def test_channel_meta_discriminator_picks_coupang_from_dict():
    cr = CanonicalReview(
        **_base_canonical_kwargs(),
        channel_meta={"source_channel": "coupang", "verified_purchase": True},
    )
    assert isinstance(cr.channel_meta, CoupangMeta)
    assert cr.channel_meta.verified_purchase is True


def test_channel_meta_discriminator_picks_oliveyoung_from_dict():
    cr = CanonicalReview(
        **_base_canonical_kwargs(channel="oliveyoung", domain="oliveyoung.co.kr"),
        channel_meta={"source_channel": "oliveyoung", "skin_type": "지성"},
    )
    assert isinstance(cr.channel_meta, OliveYoungMeta)
    assert cr.channel_meta.skin_type == "지성"


def test_channel_meta_discriminator_rejects_unknown_channel():
    with pytest.raises(ValidationError):
        CanonicalReview(
            **_base_canonical_kwargs(),
            channel_meta={"source_channel": "bogus_channel"},
        )


def test_normalized_skin_type_rejects_invalid_bucket():
    NormalizedSkinType(bucket="dry")  # ok
    with pytest.raises(ValidationError):
        NormalizedSkinType(bucket="very_dry")  # type: ignore[arg-type]


def test_normalized_age_group_rejects_invalid_bucket():
    NormalizedAgeGroup(bucket="20s")  # ok
    with pytest.raises(ValidationError):
        NormalizedAgeGroup(bucket="millennial")  # type: ignore[arg-type]


def test_normalized_product_option_all_optional():
    assert NormalizedProductOption().color_family is None
    opt = NormalizedProductOption(color_family="purple", shade="berry-gray")
    assert opt.color_family == "purple"
    assert opt.shade == "berry-gray"


def test_derived_attributes_round_trip():
    d = DerivedAttributes(
        normalized_skin_type=NormalizedSkinType(bucket="dry"),
        normalized_age_group=NormalizedAgeGroup(bucket="20s"),
        normalized_product_option=NormalizedProductOption(color_family="purple"),
    )
    loaded = DerivedAttributes.model_validate_json(d.model_dump_json())
    assert loaded.normalized_skin_type.bucket == "dry"
    assert loaded.normalized_age_group.bucket == "20s"
    assert loaded.normalized_product_option.color_family == "purple"


def test_canonical_review_with_derived_round_trip():
    cr = CanonicalReview(
        **_base_canonical_kwargs(),
        derived=DerivedAttributes(normalized_skin_type=NormalizedSkinType(bucket="dry")),
    )
    loaded = CanonicalReview.model_validate_json(cr.model_dump_json())
    assert loaded.derived is not None
    assert loaded.derived.normalized_skin_type.bucket == "dry"
