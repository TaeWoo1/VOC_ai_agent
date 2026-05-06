"""Tests for `src/voc/reporting/phase2e/usage_patterns.py`.

Coverage:
  - contradiction pattern fires when both n_pos and n_neg ≥ floor
  - usage_context pattern fires when context tokens hit per-attribute
    threshold on negative spans
  - tradeoff pattern fires from data.tradeoff_pairs
  - max_patterns cap honored, sorted by evidence_count desc
  - graceful empty-output when nothing clears thresholds
  - banned wording absent (no 원인 / 해야 / 개선 필요)
  - per-attribute context scan: weak attribute (few negative spans)
    does NOT spawn context patterns even if keywords present
  - tradeoff parser tolerates malformed pair strings
"""

from __future__ import annotations

from collections import Counter

import pytest

from src.voc.reporting.phase2e.report import (
    AttributeSummary,
    ProductReportData,
    aggregate_product,
)
from src.voc.reporting.phase2e.usage_patterns import (
    CONTEXT_MIN_HITS,
    CONTEXT_MIN_PER_ATTR,
    CONTRADICTION_MIN_PER_SIDE,
    MAX_PATTERNS_DEFAULT,
    TRADEOFF_MIN_COUNT,
    USAGE_CONTEXT_BUCKETS_KO,
    ObservedPattern,
    detect_patterns,
)


# ---------------------------------------------------------------------------
# Fixture builders
# ---------------------------------------------------------------------------


def _attr_summary(
    attribute: str = "x",
    *,
    n_positive: int = 0,
    n_negative: int = 0,
    avg_intensity_neg: float = 0.0,
) -> AttributeSummary:
    return AttributeSummary(
        attribute=attribute,
        n_total=n_positive + n_negative,
        n_positive=n_positive,
        n_negative=n_negative,
        avg_intensity_neg=avg_intensity_neg,
    )


def _data_with_attrs(
    attrs: dict[str, AttributeSummary],
    *,
    n_reviews: int = 100,
    tradeoff_pairs: Counter | None = None,
) -> ProductReportData:
    return ProductReportData(
        product_id="A0001",
        product_name="Test Product",
        n_reviews=n_reviews,
        n_records=sum(s.n_total for s in attrs.values()),
        n_mixed_reviews=0,
        n_with_tradeoff=0,
        attribute_summaries=attrs,
        tradeoff_pairs=tradeoff_pairs or Counter(),
        mixed_attribute_pairs=[],
        delivery_condition_records_total=0,
    )


def _negative_block(attribute: str, span: str) -> dict:
    """Build a Stage-2 review block carrying one negative record."""
    return {
        "review_id": f"r_{abs(hash(span)) % 100000}",
        "mixed_review_flag": False,
        "tradeoff_pair": None,
        "records": [{
            "attribute": attribute,
            "polarity": "negative_strong",
            "intensity": 3,
            "evidence_span": span,
            "confidence": "high",
            "delivery_condition_flag": False,
        }],
    }


# ---------------------------------------------------------------------------
# Contradiction
# ---------------------------------------------------------------------------


def test_contradiction_fires_when_both_sides_clear_floor():
    data = _data_with_attrs({
        "pigmentation": _attr_summary(
            "pigmentation", n_positive=10, n_negative=10,
        ),
    })
    patterns = detect_patterns(data)
    assert any(p.kind == "contradiction" for p in patterns)
    sentence = next(p for p in patterns if p.kind == "contradiction").sentence_ko
    assert "발색" in sentence
    assert "긍정 10건" in sentence
    assert "부정 10건" in sentence


def test_contradiction_silent_when_one_side_below_floor():
    """Below CONTRADICTION_MIN_PER_SIDE on either side → no
    contradiction surfaced."""
    data = _data_with_attrs({
        "pigmentation": _attr_summary(
            "pigmentation",
            n_positive=10,
            n_negative=CONTRADICTION_MIN_PER_SIDE - 1,
        ),
    })
    patterns = detect_patterns(data)
    assert not any(p.kind == "contradiction" for p in patterns)


def test_contradiction_silent_when_only_positive():
    data = _data_with_attrs({
        "pigmentation": _attr_summary(
            "pigmentation", n_positive=20, n_negative=0,
        ),
    })
    patterns = detect_patterns(data)
    assert not any(p.kind == "contradiction" for p in patterns)


def test_contradiction_uses_em_dash_not_particle():
    """Korean grammar safety: avoid 은(는) / 을(를) particle agreement
    by using em-dash separator for arbitrary attribute names."""
    data = _data_with_attrs({
        "pigmentation": _attr_summary(
            "pigmentation", n_positive=10, n_negative=10,
        ),
    })
    patterns = detect_patterns(data)
    sentence = next(p for p in patterns if p.kind == "contradiction").sentence_ko
    assert "은(는)" not in sentence
    assert "을(를)" not in sentence
    # The em-dash separator is the locked design.
    assert "-" in sentence


# ---------------------------------------------------------------------------
# Usage context
# ---------------------------------------------------------------------------


def test_usage_context_fires_when_keyword_dominates_attribute_negative_spans():
    """≥CONTEXT_MIN_HITS spans contain the bucket's keywords AND the
    attribute has ≥CONTEXT_MIN_PER_ATTR negative spans."""
    n_per_attr = max(CONTEXT_MIN_HITS, CONTEXT_MIN_PER_ATTR) + 2
    review_blocks = [
        _negative_block("transfer_resistance", "마스크에 다 묻어요")
        for _ in range(n_per_attr)
    ]
    data = _data_with_attrs({
        "transfer_resistance": _attr_summary(
            "transfer_resistance", n_positive=0,
            n_negative=n_per_attr,
        ),
    })
    patterns = detect_patterns(data, review_blocks=review_blocks)
    ctx_patterns = [p for p in patterns if p.kind == "usage_context"]
    assert ctx_patterns, "expected at least one usage_context pattern"
    sentence = ctx_patterns[0].sentence_ko
    assert "마스크/외출 상황" in sentence
    assert "마스크/옷 묻어남 저항" in sentence


def test_usage_context_silent_when_keyword_below_hit_floor():
    """Below CONTEXT_MIN_HITS keyword matches → no pattern."""
    # CONTEXT_MIN_PER_ATTR negative spans, but only 1 contains the
    # keyword. CONTEXT_MIN_HITS - 1 → fail.
    n_per_attr = max(CONTEXT_MIN_HITS, CONTEXT_MIN_PER_ATTR) + 2
    review_blocks = [
        _negative_block("transfer_resistance", "마스크에 다 묻어요")
    ] + [
        _negative_block("transfer_resistance", "발색이 별로네요")
        for _ in range(n_per_attr - 1)
    ]
    data = _data_with_attrs({
        "transfer_resistance": _attr_summary(
            "transfer_resistance", n_positive=0, n_negative=n_per_attr,
        ),
    })
    patterns = detect_patterns(data, review_blocks=review_blocks)
    assert not any(p.kind == "usage_context" for p in patterns)


def test_usage_context_silent_when_attribute_negative_spans_too_few():
    """Even with high keyword density, an attribute with too few
    negative spans isn't worth surfacing - guards against pattern
    inflation on thin data."""
    # 4 negative spans (below CONTEXT_MIN_PER_ATTR=5), all carrying
    # the keyword.
    review_blocks = [
        _negative_block("transfer_resistance", "마스크에 다 묻어요")
        for _ in range(CONTEXT_MIN_PER_ATTR - 1)
    ]
    data = _data_with_attrs({
        "transfer_resistance": _attr_summary(
            "transfer_resistance",
            n_positive=0,
            n_negative=CONTEXT_MIN_PER_ATTR - 1,
        ),
    })
    patterns = detect_patterns(data, review_blocks=review_blocks)
    assert not any(p.kind == "usage_context" for p in patterns)


def test_usage_context_silent_without_review_blocks():
    """No review_blocks → no context scan possible. Other pattern
    kinds may still fire from ProductReportData alone."""
    data = _data_with_attrs({
        "pigmentation": _attr_summary(
            "pigmentation", n_positive=10, n_negative=10,
        ),
    })
    patterns = detect_patterns(data, review_blocks=None)
    assert not any(p.kind == "usage_context" for p in patterns)
    # Contradiction still fires.
    assert any(p.kind == "contradiction" for p in patterns)


def test_usage_context_picks_correct_bucket_for_skin_type_keywords():
    n_per_attr = CONTEXT_MIN_HITS + 1
    review_blocks = [
        _negative_block("dryness_skin_texture", "건성 피부에 너무 안 맞아요")
        for _ in range(n_per_attr)
    ]
    data = _data_with_attrs({
        "dryness_skin_texture": _attr_summary(
            "dryness_skin_texture", n_positive=0, n_negative=n_per_attr,
        ),
    })
    patterns = detect_patterns(data, review_blocks=review_blocks)
    matching = [
        p for p in patterns
        if p.kind == "usage_context" and "건성 피부" in p.sentence_ko
    ]
    assert matching, f"expected 건성 피부 bucket; got: {patterns}"


# ---------------------------------------------------------------------------
# Tradeoff
# ---------------------------------------------------------------------------


def test_tradeoff_fires_for_well_formed_pair_above_floor():
    pairs = Counter({
        "finish_texture:positive -> persistence:negative_strong": 5,
    })
    data = _data_with_attrs({}, tradeoff_pairs=pairs)
    patterns = detect_patterns(data)
    tradeoffs = [p for p in patterns if p.kind == "tradeoff"]
    assert tradeoffs
    sentence = tradeoffs[0].sentence_ko
    assert "마무리감" in sentence
    assert "지속력" in sentence
    assert "5건 관측됩니다" in sentence


def test_tradeoff_silent_below_count_floor():
    pairs = Counter({
        "finish_texture:positive -> persistence:negative_strong":
            TRADEOFF_MIN_COUNT - 1,
    })
    data = _data_with_attrs({}, tradeoff_pairs=pairs)
    patterns = detect_patterns(data)
    assert not any(p.kind == "tradeoff" for p in patterns)


def test_tradeoff_skips_malformed_pair_string_without_raising():
    """Defensive: aggregator format is stable but a bad pair string
    must not crash the section."""
    pairs = Counter({
        "this is malformed": 10,
    })
    data = _data_with_attrs({}, tradeoff_pairs=pairs)
    patterns = detect_patterns(data)
    assert not any(p.kind == "tradeoff" for p in patterns)


def test_tradeoff_skips_self_loop():
    """Schema forbids self-loops, but defend at the pattern layer."""
    pairs = Counter({
        "finish_texture:positive -> finish_texture:negative_strong": 10,
    })
    data = _data_with_attrs({}, tradeoff_pairs=pairs)
    patterns = detect_patterns(data)
    assert not any(p.kind == "tradeoff" for p in patterns)


# ---------------------------------------------------------------------------
# max_patterns cap + ordering
# ---------------------------------------------------------------------------


def test_max_patterns_cap_honored():
    # Build many contradictions.
    attrs = {
        f"attr_{i}": _attr_summary(
            f"attr_{i}",
            n_positive=10 + i, n_negative=10 + i,
        )
        for i in range(10)
    }
    data = _data_with_attrs(attrs)
    patterns = detect_patterns(data, max_patterns=4)
    assert len(patterns) == 4


def test_patterns_sorted_by_evidence_count_desc():
    """Highest evidence count first - operator scans top-to-bottom
    most-supported-first."""
    pairs = Counter({
        "finish_texture:positive -> persistence:negative_strong": 7,
    })
    data = _data_with_attrs(
        {
            "pigmentation": _attr_summary(
                "pigmentation", n_positive=20, n_negative=20,
            ),
            # Lower-evidence contradiction.
            "color_tone_matching": _attr_summary(
                "color_tone_matching", n_positive=6, n_negative=6,
            ),
        },
        tradeoff_pairs=pairs,
    )
    patterns = detect_patterns(data)
    # The 40-evidence contradiction should come before the 12-evidence
    # contradiction.
    contras = [p for p in patterns if p.kind == "contradiction"]
    assert contras[0].evidence_count >= contras[-1].evidence_count


# ---------------------------------------------------------------------------
# Graceful empty
# ---------------------------------------------------------------------------


def test_empty_data_returns_empty_list():
    data = _data_with_attrs({})
    patterns = detect_patterns(data, review_blocks=[])
    assert patterns == []


def test_thin_data_below_thresholds_returns_empty_list():
    data = _data_with_attrs({
        "pigmentation": _attr_summary(
            "pigmentation",
            n_positive=CONTRADICTION_MIN_PER_SIDE - 1,
            n_negative=CONTRADICTION_MIN_PER_SIDE - 1,
        ),
    })
    patterns = detect_patterns(data, review_blocks=[])
    assert patterns == []


# ---------------------------------------------------------------------------
# Wording-safety contract
# ---------------------------------------------------------------------------


def test_no_pattern_uses_banned_wording():
    """Wording-safety contract: pattern sentences must not contain
    원인 / 해야 / 개선 필요 / 발생합니다 / 원인 확정."""
    BANNED = (
        "원인 확정", "원인은", "해야 합니다", "해야 함",
        "개선 필요", "발생합니다",
    )
    # Build a corpus that produces all three pattern kinds.
    n_per_attr = CONTEXT_MIN_HITS + 2
    review_blocks = [
        _negative_block("transfer_resistance", "마스크에 다 묻어요")
        for _ in range(n_per_attr)
    ]
    data = _data_with_attrs(
        {
            "transfer_resistance": _attr_summary(
                "transfer_resistance",
                n_positive=10, n_negative=n_per_attr,
            ),
            "pigmentation": _attr_summary(
                "pigmentation", n_positive=10, n_negative=10,
            ),
        },
        tradeoff_pairs=Counter({
            "finish_texture:positive -> persistence:negative_strong": 5,
        }),
    )
    patterns = detect_patterns(data, review_blocks=review_blocks)
    assert patterns
    for p in patterns:
        for term in BANNED:
            assert term not in p.sentence_ko, \
                f"banned wording '{term}' in {p.kind} sentence: {p.sentence_ko!r}"


def test_pattern_sentences_use_observational_verbs():
    """Sentences must end in 등장합니다 / 언급됩니다 / 관측됩니다 -
    not directive verbs. Locked tone."""
    data = _data_with_attrs({
        "pigmentation": _attr_summary(
            "pigmentation", n_positive=10, n_negative=10,
        ),
    })
    patterns = detect_patterns(data, review_blocks=[])
    for p in patterns:
        assert any(
            verb in p.sentence_ko
            for verb in ("등장합니다", "언급됩니다", "관측됩니다")
        ), f"non-observational verb in: {p.sentence_ko!r}"


def test_max_patterns_default_is_six():
    """Locked: section-length cap. Operators must still skim in
    30 seconds - pair any change with a stakeholder discussion."""
    assert MAX_PATTERNS_DEFAULT == 6


def test_usage_context_buckets_have_korean_labels():
    """Every bucket in USAGE_CONTEXT_BUCKETS_KO has a non-empty
    Korean context label that the renderer prints."""
    for bucket_key, (tokens, label) in USAGE_CONTEXT_BUCKETS_KO.items():
        assert tokens, f"bucket {bucket_key} has empty token tuple"
        assert label, f"bucket {bucket_key} has empty label"
        assert isinstance(label, str)


# ---------------------------------------------------------------------------
# End-to-end smoke through aggregate_product → detect_patterns
# ---------------------------------------------------------------------------


def test_e2e_aggregate_product_to_patterns_pipeline():
    """Build a synthetic corpus the full way through aggregate_product,
    then run detect_patterns. Confirms there's no integration gap."""
    reviews = []
    # 10 negative on transfer_resistance, all mention 마스크 → context
    for i in range(10):
        reviews.append({
            "review_id": f"r_neg_{i}",
            "mixed_review_flag": False, "tradeoff_pair": None,
            "records": [{
                "attribute": "transfer_resistance",
                "polarity": "negative_strong",
                "intensity": 3,
                "evidence_span": "마스크에 다 묻어요",
                "confidence": "high",
                "delivery_condition_flag": False,
            }],
        })
    # 10 positive on pigmentation + 10 negative → contradiction
    for i in range(10):
        reviews.append({
            "review_id": f"r_pos_{i}",
            "mixed_review_flag": False, "tradeoff_pair": None,
            "records": [{
                "attribute": "pigmentation",
                "polarity": "positive", "intensity": 2,
                "evidence_span": "발색 너무 좋아요",
                "confidence": "high",
                "delivery_condition_flag": False,
            }],
        })
    for i in range(10):
        reviews.append({
            "review_id": f"r_pneg_{i}",
            "mixed_review_flag": False, "tradeoff_pair": None,
            "records": [{
                "attribute": "pigmentation",
                "polarity": "negative_strong",
                "intensity": 2,
                "evidence_span": "발색이 별로네요",
                "confidence": "high",
                "delivery_condition_flag": False,
            }],
        })

    data = aggregate_product("A0001", "P", reviews)
    patterns = detect_patterns(data, review_blocks=reviews)
    kinds = {p.kind for p in patterns}
    assert "contradiction" in kinds
    assert "usage_context" in kinds
