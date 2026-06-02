"""Tests for the unique-insights schema constants + dataclasses.

Pin every literal value the validator and candidate pool key off so
a casual edit to `schema.py` triggers a test failure rather than
silent contract drift.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from src.voc.content.schemas import UNIQUE_PRODUCT_INSIGHTS_SCHEMA_PATH
from src.voc.content.unique_insights.schema import (
    BASELINE_CAVEAT_PROFILE_CURATED_KO,
    BASELINE_CAVEAT_UNCERTAIN_KO,
    BASELINE_SOURCES,
    CONFIDENCE_LEVELS,
    INSIGHT_TYPES,
    KNOWN_RISK_FLAGS,
    MAX_CONCENTRATED_COMPLAINTS,
    MAX_CROSS_ATTRIBUTE_TRADEOFFS,
    MAX_EVIDENCE_REVIEW_IDS,
    MAX_EXPLANATION_CHARS_KO,
    MAX_HIGH_FREQUENCY_STRENGTHS,
    MAX_INSIGHTS,
    MAX_POLARITY_OUTLIERS,
    MAX_TITLE_CHARS_KO,
    MAX_USAGE_CONTEXT_SIGNALS,
    MAX_WHAT_MAKES_UNIQUE_CHARS_KO,
    MIN_EVIDENCE_REVIEW_IDS,
    RELEVANCE_LEVELS,
    UNIQUE_INSIGHTS_SCHEMA_VERSION,
    CandidateBucketEntry,
    CandidatePool,
)


class TestEnums:
    def test_insight_types(self):
        assert INSIGHT_TYPES == (
            "unique_strength",
            "unique_weakness",
            "unique_tradeoff",
            "usage_context",
            "packaging_value",
        )

    def test_confidence_levels(self):
        assert CONFIDENCE_LEVELS == ("weak", "moderate", "strong")

    def test_relevance_levels(self):
        assert RELEVANCE_LEVELS == ("high", "moderate", "low")

    def test_baseline_sources(self):
        assert BASELINE_SOURCES == ("profile_curated", "snapshot_aggregate", "uncertain")

    def test_known_risk_flags(self):
        assert KNOWN_RISK_FLAGS == (
            "category_baseline_uncertain",
            "evidence_thin",
            "polarity_ambiguous",
            "low_corpus_n",
        )


class TestLimits:
    def test_max_insights(self):
        assert MAX_INSIGHTS == 6

    def test_evidence_id_bounds(self):
        assert MIN_EVIDENCE_REVIEW_IDS == 2
        assert MAX_EVIDENCE_REVIEW_IDS == 5

    def test_text_length_caps(self):
        assert MAX_TITLE_CHARS_KO == 30
        assert MAX_EXPLANATION_CHARS_KO == 200
        assert MAX_WHAT_MAKES_UNIQUE_CHARS_KO == 200

    def test_per_bucket_caps(self):
        assert MAX_HIGH_FREQUENCY_STRENGTHS == 5
        assert MAX_CONCENTRATED_COMPLAINTS == 5
        assert MAX_CROSS_ATTRIBUTE_TRADEOFFS == 3
        assert MAX_POLARITY_OUTLIERS == 5
        assert MAX_USAGE_CONTEXT_SIGNALS == 3


class TestSchemaVersion:
    def test_version_string(self):
        assert UNIQUE_INSIGHTS_SCHEMA_VERSION == "1.0"


class TestBaselineCaveats:
    def test_uncertain_phrase_pinned(self):
        assert "가설" in BASELINE_CAVEAT_UNCERTAIN_KO

    def test_profile_curated_phrase_pinned(self):
        assert "프로파일" in BASELINE_CAVEAT_PROFILE_CURATED_KO


class TestDataclasses:
    def test_candidate_bucket_entry_to_dict_roundtrip(self):
        e = CandidateBucketEntry(
            candidate_id="cand_strength_001",
            attribute_key="pigmentation",
            label_ko="발색",
            n_pos=10, n_neg=2, n_mixed=1,
            evidence_review_ids=("r1", "r2"),
            evidence_excerpts_preview=("a", "b"),
            baseline_comparison=0.12,
        )
        d = e.to_dict()
        assert d["candidate_id"] == "cand_strength_001"
        assert d["attribute_key"] == "pigmentation"
        assert d["evidence_review_ids"] == ["r1", "r2"]
        assert d["evidence_excerpts_preview"] == ["a", "b"]
        assert d["baseline_comparison"] == 0.12

    def test_candidate_pool_to_dict_roundtrip(self):
        e = CandidateBucketEntry(
            candidate_id="cand_strength_001",
            attribute_key="x", label_ko=None,
            n_pos=0, n_neg=0, n_mixed=0,
            evidence_review_ids=(), evidence_excerpts_preview=(),
            baseline_comparison=None,
        )
        p = CandidatePool(
            high_frequency_strengths=(e,),
            concentrated_complaints=(),
            cross_attribute_tradeoffs=(),
            polarity_outliers=(),
            usage_context_signals=(),
            category_baseline_source="uncertain",
            baseline_caveat_ko=BASELINE_CAVEAT_UNCERTAIN_KO,
            bounded_review_excerpts=(("r1", "..."),),
        )
        d = p.to_dict()
        assert d["category_baseline_source"] == "uncertain"
        assert d["bounded_review_excerpts"] == {"r1": "..."}
        assert d["high_frequency_strengths"][0]["attribute_key"] == "x"

    def test_pool_excerpts_as_dict(self):
        p = CandidatePool(
            high_frequency_strengths=(), concentrated_complaints=(),
            cross_attribute_tradeoffs=(), polarity_outliers=(),
            usage_context_signals=(),
            category_baseline_source="uncertain",
            baseline_caveat_ko="...",
            bounded_review_excerpts=(("r1", "x"), ("r2", "y")),
        )
        assert p.excerpts_as_dict() == {"r1": "x", "r2": "y"}

    def test_candidate_pool_is_frozen(self):
        e = CandidateBucketEntry(
            candidate_id="cand_strength_001",
            attribute_key="x", label_ko=None,
            n_pos=0, n_neg=0, n_mixed=0,
            evidence_review_ids=(), evidence_excerpts_preview=(),
            baseline_comparison=None,
        )
        with pytest.raises(Exception):
            e.attribute_key = "y"  # type: ignore[misc]


class TestJsonSchemaFile:
    def test_file_exists(self):
        assert UNIQUE_PRODUCT_INSIGHTS_SCHEMA_PATH.is_file()

    def test_schema_version_matches_python_const(self):
        raw = json.loads(UNIQUE_PRODUCT_INSIGHTS_SCHEMA_PATH.read_text(encoding="utf-8"))
        # `schema_version` field has a const of "1.0".
        assert raw["properties"]["schema_version"]["const"] == UNIQUE_INSIGHTS_SCHEMA_VERSION

    def test_insight_type_enum_matches(self):
        raw = json.loads(UNIQUE_PRODUCT_INSIGHTS_SCHEMA_PATH.read_text(encoding="utf-8"))
        json_enum = raw["$defs"]["insight"]["properties"]["type"]["enum"]
        assert tuple(json_enum) == INSIGHT_TYPES

    def test_baseline_source_enum_matches(self):
        raw = json.loads(UNIQUE_PRODUCT_INSIGHTS_SCHEMA_PATH.read_text(encoding="utf-8"))
        json_enum = raw["properties"]["candidate_pool"]["properties"][
            "category_baseline_source"]["enum"]
        assert tuple(json_enum) == BASELINE_SOURCES

    def test_insight_id_pattern_matches(self):
        raw = json.loads(UNIQUE_PRODUCT_INSIGHTS_SCHEMA_PATH.read_text(encoding="utf-8"))
        pat = raw["$defs"]["insight"]["properties"]["insight_id"]["pattern"]
        assert pat == "^ins_\\d{3}$"

    def test_max_insights_matches(self):
        raw = json.loads(UNIQUE_PRODUCT_INSIGHTS_SCHEMA_PATH.read_text(encoding="utf-8"))
        assert raw["properties"]["insights"]["maxItems"] == MAX_INSIGHTS
