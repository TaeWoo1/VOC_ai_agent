from __future__ import annotations

from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

SCHEMA_VERSION = "review_ops_analysis.v1"
DEFAULT_DISCLAIMER_KO = (
    "본 리포트는 공개 리뷰 데이터를 기반으로 한 운영 진단 자료이며, "
    "매출 영향이나 제품 결함을 단정하지 않습니다. "
    "실제 영향은 브랜드 내부 판매·전환·생산 데이터와 함께 검토해야 합니다."
)


class Generator(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["rule_based", "llm_assisted"] = "rule_based"
    rules_version: str = "v1.0"


class AnalysisPeriod(BaseModel):
    model_config = ConfigDict(extra="forbid")
    start: Optional[date] = None
    end: Optional[date] = None


class ProductMeta(BaseModel):
    model_config = ConfigDict(extra="forbid")
    brand_name: Optional[str] = None
    display_product_name: Optional[str] = None
    header_title: Optional[str] = None  # cleaned title used in HTML h1
    raw_product_name: Optional[str] = None
    source_channel: Optional[str] = None
    source_url: Optional[str] = None
    selected_profile_id: Optional[str] = None
    analysis_period: AnalysisPeriod = Field(default_factory=AnalysisPeriod)


class Metrics(BaseModel):
    model_config = ConfigDict(extra="forbid")
    total_reviews: int = 0
    average_rating: float = 0.0
    recent_review_ratio: float = 0.0
    negative_mixed_ratio: float = 0.0
    unreplied_negative_count: int = 0
    stale_negative_count: int = 0


class AssetCounts(BaseModel):
    model_config = ConfigDict(extra="forbid")
    usable: int = 0
    stale: int = 0
    risk: int = 0
    insight: int = 0


# Placeholder collections — filled in later phases.
class AssetItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    review_id: str
    quote: str
    rating: Optional[float] = None
    review_date: Optional[date] = None
    product_option: Optional[str] = None
    asset_classes: list[str] = Field(default_factory=list)
    topic_labels: list[str] = Field(default_factory=list)
    reason: str = ""
    suggested_action: str = ""
    has_brand_reply: bool = False
    is_stale_candidate: bool = False
    age_days: Optional[int] = None
    stale_band: Optional[str] = None  # "actionable" | "cold" | None


class AssetBuckets(BaseModel):
    model_config = ConfigDict(extra="forbid")
    usable: list[AssetItem] = Field(default_factory=list)
    stale: list[AssetItem] = Field(default_factory=list)
    risk: list[AssetItem] = Field(default_factory=list)
    insight: list[AssetItem] = Field(default_factory=list)


class RiskGroup(BaseModel):
    model_config = ConfigDict(extra="forbid")
    cluster_id: str
    label: str
    evidence_count: int = 0
    items: list[AssetItem] = Field(default_factory=list)


class GeneratedActions(BaseModel):
    model_config = ConfigDict(extra="forbid")
    landing_page_copy: list[dict] = Field(default_factory=list)
    reply_drafts: list[dict] = Field(default_factory=list)
    oem_questions: list[dict] = Field(default_factory=list)
    faq_items: list[dict] = Field(default_factory=list)
    content_angles: list[dict] = Field(default_factory=list)


class ReviewOpsAnalysis(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: str = SCHEMA_VERSION
    source_run_dir: str
    source_run_id: Optional[str] = None
    source_analysis_report_sha256: Optional[str] = None
    generated_at: datetime
    generator: Generator = Field(default_factory=Generator)
    product: ProductMeta = Field(default_factory=ProductMeta)
    metrics: Metrics = Field(default_factory=Metrics)
    asset_counts: AssetCounts = Field(default_factory=AssetCounts)
    assets: AssetBuckets = Field(default_factory=AssetBuckets)
    risk_groups: list[RiskGroup] = Field(default_factory=list)
    generated_actions: GeneratedActions = Field(default_factory=GeneratedActions)
    emergent_clusters: list[dict] = Field(default_factory=list)
    consumer_safe_signals: list[dict] = Field(default_factory=list)
    executive_summary: str = ""
    disclaimer: str = DEFAULT_DISCLAIMER_KO
