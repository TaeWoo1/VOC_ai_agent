"""Tests for the post-Stage-2 polarity reliability guardrail.

The guardrail flags (text, claimed_polarity) pairs as suspect when
the text carries decisive cues that contradict the claim. The
adapter uses the verdict to exclude suspect quotes from polarity-
specific surfaces (e.g. monitoring_candidates.top_negative_quotes).

Acceptance is qualitative — every assertion checks a property the
guardrail must satisfy, not a percentage threshold.
"""
from __future__ import annotations

from src.voc.reporting.phase2e.polarity_guardrail import (
    PolarityCheck,
    build_audit_record,
    check_polarity,
)


# -----------------------------------------------------------------------------
# Observed run-010 false negatives — these are the canonical cases
# the guardrail was built to catch. Each came from analysis_report.json
# of run-010 with `polarity == "negative_weak"` despite the text
# clearly carrying positive sentiment.
# -----------------------------------------------------------------------------


def test_run010_false_negative_adhesion_well_attached_satisfied():
    text = (
        "엄청 잘 떼져요 ㅎㅎ 얇고 쫀쫀해서 밀착도 잘되고 촉촉하네요 탄력도 조금 좋"
    )
    check = check_polarity(text, "negative_weak")
    assert check.is_suspect is True
    assert check.suggested_polarity == "positive"
    assert check.confidence == "high"


def test_run010_false_negative_adhesion_skin_condition_pinned():
    text = ":) 좀 써보니까 패드가 부드럽게 밀착되면서 피부 컨디션을 쫀쫀하게 잡아주"
    check = check_polarity(text, "negative_weak")
    assert check.is_suspect is True
    assert check.suggested_polarity == "positive"


def test_run010_false_negative_finish_calming_feel():
    text = (
        "마데카소사이드 성분 때문인지 사용하고 나면 피부가 촉촉하면서도 "
        "붉은기가 살짝 진정되는 느낌이 있습니다"
    )
    check = check_polarity(text, "negative_weak")
    assert check.is_suspect is True
    assert check.suggested_polarity == "positive"


def test_run010_false_negative_dryness_pore_tightening():
    text = (
        "이 만족스러웠어요. 꾸준히 사용하니 모공 주변 피부가 조금 더 탄탄해진 느낌"
    )
    check = check_polarity(text, "negative_weak")
    assert check.is_suspect is True


# -----------------------------------------------------------------------------
# Clean negative — text should NOT be flagged when polarity matches.
# -----------------------------------------------------------------------------


def test_clean_negative_packaging_lid_not_closing():
    text = (
        "통이 좀 마음에 안드는데 일단 뚜껑이 잘 안 닫히는 느낌이 들고 새로"
    )
    check = check_polarity(text, "negative_strong")
    assert check.is_suspect is False
    assert "negative_cues_consistent_with_neg" in check.reasons or any(
        "neg_cues" in r for r in check.reasons
    )


def test_clean_negative_value_too_expensive():
    text = "무난한 토너패드입니다. 좀 비싼것같긴해요 효과는 모르겠어요"
    check = check_polarity(text, "negative_weak")
    assert check.is_suspect is False


def test_clean_negative_durability_disappointing():
    text = "도톰한데 빨리 마르는느낌이 있음- 밀착력도 아쉬움 리뉴되고 픽업집게는"
    check = check_polarity(text, "negative_weak")
    assert check.is_suspect is False


# -----------------------------------------------------------------------------
# Clean positive — text should NOT be flagged when polarity matches.
# -----------------------------------------------------------------------------


def test_clean_positive_value_satisfying():
    text = "톤이 밝아진 것 같아요. 200매라 가성비도 좋은편이라서 만족합니다"
    check = check_polarity(text, "positive")
    assert check.is_suspect is False


def test_clean_positive_finish_moist():
    text = "촉촉하고 좋아도 용량도 많아서 너무 만족"
    check = check_polarity(text, "positive")
    assert check.is_suspect is False


# -----------------------------------------------------------------------------
# Mixed text — both positive and negative cues. Should NOT be
# flagged (text is genuinely mixed; defer to Stage 2's call).
# -----------------------------------------------------------------------------


def test_mixed_cues_not_flagged():
    text = (
        "패드가 부드러워서 피부에 자극 없이 밀착되고 좋아요 근데 뚜껑이 "
        "잘 안 닫혀서 아쉬워요"
    )
    check = check_polarity(text, "positive")
    assert check.is_suspect is False
    assert check.confidence in ("low", "medium")


# -----------------------------------------------------------------------------
# Negation walker — a positive cue followed by a negation should
# NOT count as a positive cue.
# -----------------------------------------------------------------------------


def test_negated_positive_in_positive_claim_flagged():
    # "만족스럽지 않아요" — positive morpheme inside a denial.
    # Claimed positive should be flagged as suspect.
    text = "기대 이하예요. 만족스럽지 않아서 환불 진행했어요"
    check = check_polarity(text, "positive")
    assert check.is_suspect is True


def test_negated_positive_consistent_with_negative_claim():
    text = "만족스럽지 않아요"
    check = check_polarity(text, "negative_weak")
    assert check.is_suspect is False


# -----------------------------------------------------------------------------
# No decisive cues — defer to Stage 2.
# -----------------------------------------------------------------------------


def test_no_cues_not_flagged():
    text = "한 번 써봤어요. 다음에 또 써보려고 해요."
    check = check_polarity(text, "negative_weak")
    assert check.is_suspect is False
    assert check.confidence == "low"


def test_empty_text_not_flagged():
    check = check_polarity("", "positive")
    assert check.is_suspect is False
    assert check.confidence == "low"


# -----------------------------------------------------------------------------
# PolarityCheck dataclass shape.
# -----------------------------------------------------------------------------


def test_polarity_check_to_dict_shape():
    check = check_polarity("좋아요 만족합니다", "negative_weak")
    d = check.to_dict()
    assert set(d.keys()) >= {
        "is_suspect", "claimed_polarity", "suggested_polarity",
        "confidence", "reasons",
    }
    assert isinstance(d["reasons"], list)


# -----------------------------------------------------------------------------
# Audit aggregator — counts and samples.
# -----------------------------------------------------------------------------


def test_audit_record_aggregates_per_attribute():
    quotes_by_attr = {
        "adhesion_base_interaction": [
            {
                "text": "엄청 잘 떼져요 ㅎㅎ 밀착도 잘되고 촉촉하네요",
                "polarity": "negative_weak",
                "review_id": "abc123",
            },
            {
                "text": "도톰한데 빨리 마르는느낌이 있음- 밀착력도 아쉬움",
                "polarity": "negative_weak",
                "review_id": "def456",
            },
        ],
        "value_price": [
            {
                "text": "가성비도 좋은편이라서 만족합니다",
                "polarity": "positive",
                "review_id": "ghi789",
            },
        ],
    }
    audit = build_audit_record(quotes_by_attr)

    assert audit["n_total_quotes"] == 3
    assert audit["n_total_suspect"] >= 1
    assert "adhesion_base_interaction" in audit["by_attribute"]
    assert audit["by_attribute"]["adhesion_base_interaction"]["n_total"] == 2
    assert audit["by_attribute"]["adhesion_base_interaction"]["n_suspect"] >= 1
    # samples are diagnostic — should include the suspect adhesion entry
    assert len(audit["samples"]) >= 1
    suspect_review_ids = {s["review_id"] for s in audit["samples"]}
    assert "abc123" in suspect_review_ids


def test_audit_record_handles_empty_input():
    audit = build_audit_record({})
    assert audit["n_total_quotes"] == 0
    assert audit["n_total_suspect"] == 0
    assert audit["by_attribute"] == {}
    assert audit["samples"] == []


def test_audit_record_handles_malformed_entries():
    # Defensive — non-dict entries / missing fields shouldn't crash.
    audit = build_audit_record({
        "x": [None, "not a dict", {"text": "", "polarity": "positive"}],
    })
    assert audit["n_total_quotes"] >= 0  # malformed skipped gracefully
