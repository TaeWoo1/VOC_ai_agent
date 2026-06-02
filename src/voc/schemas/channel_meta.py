"""Channel-specific typed metadata and derived-attribute schemas.

`ChannelMeta` is a Pydantic v2 discriminated union keyed on `source_channel`. It
holds the SUBSET of raw source fields we promote out of the verbatim
`CanonicalReview.metadata` dict for typed segmentation, filtering, and
comparison in the bait report. Unpromoted raw fields stay on `metadata`.

`DerivedAttributes` carries downstream-computed signals (segment buckets,
sentiment, topics). It is populated by an enrichment pass separate from the
canonical normalize step and is therefore absent on freshly-normalized rows.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, Field


class CoupangMeta(BaseModel):
    source_channel: Literal["coupang"] = "coupang"
    verified_purchase: bool | None = None
    photo_attached: bool | None = None
    helpful_count: int | None = None
    review_title: str | None = None


class OliveYoungMeta(BaseModel):
    source_channel: Literal["oliveyoung"] = "oliveyoung"
    skin_type: str | None = None           # raw OY label, e.g. "건성"
    age_group: str | None = None           # raw OY label, e.g. "20대 후반"
    product_option_raw: str | None = None  # raw OY label, e.g. "베어그레이프"


ChannelMeta = Annotated[
    CoupangMeta | OliveYoungMeta,
    Field(discriminator="source_channel"),
]


class NormalizedSkinType(BaseModel):
    bucket: Literal["dry", "normal", "combination", "oily", "sensitive", "unknown"]


class NormalizedAgeGroup(BaseModel):
    bucket: Literal["under_20", "20s", "30s", "40_plus", "unknown"]


class NormalizedProductOption(BaseModel):
    color_family: str | None = None
    shade: str | None = None
    size: str | None = None
    capacity: str | None = None


class DerivedAttributes(BaseModel):
    normalized_skin_type: NormalizedSkinType | None = None
    normalized_age_group: NormalizedAgeGroup | None = None
    normalized_product_option: NormalizedProductOption | None = None
