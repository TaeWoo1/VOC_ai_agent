"""Editorial planner tests (v2.1 — 12-section narrative + spotlight expansion).

Covers:
  * Pydantic schema validation (rejects malformed plans, including
    spotlight cardinality and 분-ending validators)
  * Mock-mode required-field coverage on a real Mediheal snapshot
  * Mock-mode generalization on synthetic non-canonical attribute keys
  * Mock-mode determinism (same input → same output)
  * Optional-section behavior (why_divides / checkpoints / all
    spotlights) — sections are absent when product-specific signal
    doesn't support them; we NEVER pad with corpus-generic advice.
  * Spotlight disjointness — caution_spotlights and checkpoints don't
    share attribute keys; insight_spotlights skip already-used keys.
  * Safety validator catches every banned-cluster phrase in plan strings
  * LLM-mode happy / sad paths with a stub callable
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from cardnews.safety_validator import (
    BANNED_FRAMINGS_KO,
    CardnewsSafetyError,
    PLANNER_ATTACK_BANNED_KO,
    PLANNER_EXPOSE_BANNED_KO,
    PLANNER_MEDICAL_BANNED_KO,
    validate_content_plan_safety,
)
from src.voc.content.editorial_planner import (
    CardnewsPlannerError,
    build_briefing,
    build_content_plan,
    build_mock_plan,
    default_output_dir,
    default_plan_path_for_report,
    product_slug_from_briefing,
    write_content_plan,
)
from src.voc.content.schemas.content_plan import ContentPlan


REPO_ROOT = Path(__file__).resolve().parents[2]
SAMPLE_REPORT = (
    REPO_ROOT
    / "outputs"
    / "content_packages"
    / "2026-04-30_mediheal_pad_run-010"
    / "shared"
    / "analysis_report.json"
)


# v2.0 required sections (always present). `why_divides` and
# `checkpoints` are intentionally absent from this set — they're
# optional and may be None when product signal doesn't support them.
V2_REQUIRED_SECTIONS = (
    "cover",
    "one_liner",
    "loved",
    "divides",
    "signature",
    "fit",
    "consider",
    "summary",
    "cta",
)


@pytest.fixture(scope="module")
def mediheal_report() -> dict:
    if not SAMPLE_REPORT.exists():
        pytest.skip(f"sample analysis_report missing: {SAMPLE_REPORT}")
    return json.loads(SAMPLE_REPORT.read_text(encoding="utf-8"))


def _synthetic_unknown_attribute_report() -> dict:
    """Analysis_report with attribute keys NOT in the canonical 12.

    The planner must produce a valid content_plan from the labels +
    counts alone — no attribute-specific hardcoded copy."""
    return {
        "schema_version": "3.0",
        "product": {
            "slug": "synthetic-fragrance-001",
            "name_ko": "테스트 향수 50ml",
            "category": "향수 > 오데드퍼퓸",
            "source_url": "https://example.com/p/123",
        },
        "corpus": {
            "n_reviews_total": 412,
            "primary_sort": "DATETIME_DESC",
            "confidence_level": "medium",
            "signal_stability": "medium",
        },
        "attributes": [
            {"key": "scent_longevity", "label_ko": "잔향 지속력",
             "n_positive": 188, "n_negative": 42, "evidence_score": 0.7},
            {"key": "projection_radius", "label_ko": "확산력",
             "n_positive": 95, "n_negative": 28, "evidence_score": 0.6},
            {"key": "top_note_balance", "label_ko": "탑노트 밸런스",
             "n_positive": 71, "n_negative": 19, "evidence_score": 0.5},
            {"key": "bottle_design", "label_ko": "용기 디자인",
             "n_positive": 33, "n_negative": 8, "evidence_score": 0.4},
        ],
        "strengths": [
            {"attribute_key": "scent_longevity", "supporting_count": 188},
            {"attribute_key": "projection_radius", "supporting_count": 95},
        ],
        "monitoring_candidates": [
            {"attribute_key": "scent_longevity", "concern_label_ko": "잔향 지속력",
             "n_negative": 42},
            {"attribute_key": "projection_radius", "concern_label_ko": "확산력",
             "n_negative": 28},
        ],
    }


# ---------------------------------------------------------------------------
# Pydantic schema validation
# ---------------------------------------------------------------------------


def test_content_plan_schema_rejects_missing_field(mediheal_report: dict) -> None:
    plan = build_content_plan(mediheal_report)
    del plan["signature"]
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        ContentPlan.model_validate(plan)


def test_content_plan_schema_rejects_extra_field(mediheal_report: dict) -> None:
    plan = build_content_plan(mediheal_report)
    plan["bonus_section"] = {"foo": "bar"}
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        ContentPlan.model_validate(plan)


def test_content_plan_schema_rejects_oversize_string(mediheal_report: dict) -> None:
    plan = build_content_plan(mediheal_report)
    plan["cover"]["headline"] = "x" * 200
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        ContentPlan.model_validate(plan)


def test_content_plan_schema_rejects_unknown_cta_type(mediheal_report: dict) -> None:
    plan = build_content_plan(mediheal_report)
    plan["cta"]["type"] = "buy_now"
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        ContentPlan.model_validate(plan)


def test_content_plan_schema_v2_cta_no_longer_accepts_ask_question(
    mediheal_report: dict,
) -> None:
    """v2.0 narrowed CTA type Literal to (comment_next_product,
    save_for_later). `ask_question` is no longer a valid type."""
    plan = build_content_plan(mediheal_report)
    plan["cta"]["type"] = "ask_question"
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        ContentPlan.model_validate(plan)


def test_content_plan_schema_rejects_fit_label_without_bun(
    mediheal_report: dict,
) -> None:
    """v2.0 — FitItem.label must end in '분' (sentence form, not tag)."""
    plan = build_content_plan(mediheal_report)
    plan["fit"]["items"][0]["label"] = "건성 피부 소유자"
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        ContentPlan.model_validate(plan)


def test_content_plan_schema_rejects_consider_label_without_bun(
    mediheal_report: dict,
) -> None:
    """v2.0 — ConsiderItem.label must end in '분' (sentence form)."""
    plan = build_content_plan(mediheal_report)
    plan["consider"]["items"][0]["label"] = "민감성 피부"
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        ContentPlan.model_validate(plan)


def test_content_plan_schema_rejects_signature_who_without_bun(
    mediheal_report: dict,
) -> None:
    plan = build_content_plan(mediheal_report)
    plan["signature"]["who_should_check"] = "건성 피부 소유자"
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        ContentPlan.model_validate(plan)


def test_content_plan_schema_checkpoints_can_be_absent(
    mediheal_report: dict,
) -> None:
    """v2.0 — checkpoints is Optional. A plan with checkpoints=None
    must still validate (per user contract: no padded slides)."""
    plan = build_content_plan(mediheal_report)
    plan["checkpoints"] = None
    ContentPlan.model_validate(plan)  # no raise


def test_content_plan_schema_why_divides_can_be_absent(
    mediheal_report: dict,
) -> None:
    plan = build_content_plan(mediheal_report)
    plan["why_divides"] = None
    ContentPlan.model_validate(plan)  # no raise


def test_content_plan_schema_checkpoints_max_3_slides(
    mediheal_report: dict,
) -> None:
    plan = build_content_plan(mediheal_report)
    plan["checkpoints"] = {
        "slides": [plan["checkpoints"]["slides"][0]] * 4
        if plan.get("checkpoints") else []
    }
    if plan["checkpoints"]["slides"]:
        from pydantic import ValidationError
        with pytest.raises(ValidationError):
            ContentPlan.model_validate(plan)


# ---------------------------------------------------------------------------
# v2.1 — Spotlight schema validation
# ---------------------------------------------------------------------------


def test_content_plan_schema_positive_spotlights_can_be_absent(
    mediheal_report: dict,
) -> None:
    plan = build_content_plan(mediheal_report)
    plan["positive_spotlights"] = None
    ContentPlan.model_validate(plan)  # no raise


def test_content_plan_schema_caution_spotlights_can_be_absent(
    mediheal_report: dict,
) -> None:
    plan = build_content_plan(mediheal_report)
    plan["caution_spotlights"] = None
    ContentPlan.model_validate(plan)  # no raise


def test_content_plan_schema_insight_spotlights_can_be_absent(
    mediheal_report: dict,
) -> None:
    plan = build_content_plan(mediheal_report)
    plan["insight_spotlights"] = None
    ContentPlan.model_validate(plan)  # no raise


def test_content_plan_schema_positive_spotlights_max_3(
    mediheal_report: dict,
) -> None:
    plan = build_content_plan(mediheal_report)
    base = (plan.get("positive_spotlights") or [None])[0]
    if base is None:
        pytest.skip("Mediheal mock did not surface positive spotlights")
    plan["positive_spotlights"] = [base] * 4
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        ContentPlan.model_validate(plan)


def test_content_plan_schema_caution_spotlights_max_4(
    mediheal_report: dict,
) -> None:
    plan = build_content_plan(mediheal_report)
    base = (plan.get("caution_spotlights") or [None])[0]
    if base is None:
        pytest.skip("Mediheal mock did not surface caution spotlights")
    plan["caution_spotlights"] = [base] * 5
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        ContentPlan.model_validate(plan)


def test_content_plan_schema_insight_spotlights_max_3(
    mediheal_report: dict,
) -> None:
    plan = build_content_plan(mediheal_report)
    base = (plan.get("insight_spotlights") or [None])[0]
    if base is None:
        pytest.skip("Mediheal mock did not surface insight spotlights")
    plan["insight_spotlights"] = [base] * 4
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        ContentPlan.model_validate(plan)


def test_content_plan_schema_rejects_positive_spotlight_who_without_bun(
    mediheal_report: dict,
) -> None:
    """v2.1 — positive_spotlight.who_benefits must end in '분'."""
    plan = build_content_plan(mediheal_report)
    spots = plan.get("positive_spotlights") or []
    if not spots:
        pytest.skip("Mediheal mock did not surface positive spotlights")
    spots[0]["who_benefits"] = "건성 피부 소유자"
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        ContentPlan.model_validate(plan)


def test_content_plan_schema_rejects_insight_spotlight_who_without_bun(
    mediheal_report: dict,
) -> None:
    plan = build_content_plan(mediheal_report)
    spots = plan.get("insight_spotlights") or []
    if not spots:
        pytest.skip("Mediheal mock did not surface insight spotlights")
    spots[0]["who_should_check"] = "민감성 피부"
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        ContentPlan.model_validate(plan)


def test_content_plan_schema_rejects_oversize_spotlight_string(
    mediheal_report: dict,
) -> None:
    plan = build_content_plan(mediheal_report)
    spots = plan.get("caution_spotlights") or []
    if not spots:
        pytest.skip("Mediheal mock did not surface caution spotlights")
    spots[0]["likely_context"] = "x" * 200
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        ContentPlan.model_validate(plan)


# ---------------------------------------------------------------------------
# Mock mode — required field coverage
# ---------------------------------------------------------------------------


def test_mock_plan_mediheal_has_all_required_sections(mediheal_report: dict) -> None:
    plan = build_content_plan(mediheal_report)
    for section in V2_REQUIRED_SECTIONS:
        assert section in plan, f"missing section {section}"
    assert plan["language"] == "ko"
    assert plan["schema_version"] == "2.2"
    ContentPlan.model_validate(plan)


def test_mock_plan_mediheal_has_optional_sections(mediheal_report: dict) -> None:
    """The Mediheal corpus is rich enough to surface a divide AND
    product-specific cautions. why_divides should fire on the divide.
    Cautions surface as EITHER caution_spotlights OR checkpoints (or
    both) — v2.1 routes the strongest cautions into spotlights first
    and pushes the rest into checkpoints, so either or both may fire
    depending on cardinality. The contract being tested is
    'caution-derived content materializes', not 'a specific section
    materializes'."""
    plan = build_content_plan(mediheal_report)
    assert plan["why_divides"] is not None, (
        "Mediheal has dual-polarity attributes — why_divides should fire"
    )
    has_caution_content = (
        (plan.get("caution_spotlights") is not None)
        or (plan.get("checkpoints") is not None)
    )
    assert has_caution_content, (
        "Mediheal has cautions — caution_spotlights and/or checkpoints "
        "should fire"
    )
    if plan.get("checkpoints") is not None:
        # v2.2 — capped at 1..2 (was 1..3).
        assert 1 <= len(plan["checkpoints"]["slides"]) <= 2


def test_mock_plan_synthetic_unknown_attributes_validates() -> None:
    """v2.0 generalization contract: ANY attribute key works."""
    report = _synthetic_unknown_attribute_report()
    plan = build_content_plan(report)
    ContentPlan.model_validate(plan)
    sig_key = plan["signature"]["attribute_key"]
    assert sig_key in {"scent_longevity", "projection_radius",
                       "top_note_balance", "bottle_design"}, (
        f"signature picked {sig_key!r}, not in synthetic attribute list"
    )
    assert plan["signature"]["title"] in (
        "잔향 지속력", "확산력", "탑노트 밸런스", "용기 디자인",
    )


def test_mock_plan_is_deterministic(mediheal_report: dict) -> None:
    p1 = build_content_plan(mediheal_report)
    p2 = build_content_plan(mediheal_report)
    assert json.dumps(p1, sort_keys=True) == json.dumps(p2, sort_keys=True)


def test_mock_plan_varies_with_corpus_size() -> None:
    """Same template, different inputs → structurally different plans."""
    a = _synthetic_unknown_attribute_report()
    b = _synthetic_unknown_attribute_report()
    b["corpus"]["n_reviews_total"] = 50
    b["attributes"][0]["n_positive"] = 22
    b["strengths"][0]["supporting_count"] = 22
    pa = build_content_plan(a)
    pb = build_content_plan(b)
    # Cover corpus_footer carries the review count → it MUST differ.
    assert pa["cover"]["corpus_footer"] != pb["cover"]["corpus_footer"], (
        f"cover.corpus_footer should reflect n_reviews change "
        f"(got {pa['cover']['corpus_footer']!r} vs "
        f"{pb['cover']['corpus_footer']!r})"
    )


def test_mock_plan_handles_empty_attributes() -> None:
    minimal = {
        "schema_version": "3.0",
        "product": {"slug": "thin", "name_ko": "표본 부족 테스트"},
        "corpus": {
            "n_reviews_total": 3,
            "primary_sort": "DATETIME_DESC",
            "confidence_level": "low",
            "signal_stability": "low",
        },
        "attributes": [],
    }
    plan = build_content_plan(minimal)
    ContentPlan.model_validate(plan)
    assert plan["signature"]["attribute_key"] == "unknown"
    # No signal → optional sections absent (per contract)
    assert plan["why_divides"] is None
    assert plan["checkpoints"] is None


def test_mock_plan_checkpoints_never_padded_with_generic_advice() -> None:
    """v2.0 user contract: when no caution clears the threshold, the
    checkpoints section is dropped — NOT padded with generic advice."""
    report = {
        "schema_version": "3.0",
        "product": {"slug": "all-positive", "name_ko": "전체 호평 제품"},
        "corpus": {
            "n_reviews_total": 200,
            "primary_sort": "DATETIME_DESC",
            "confidence_level": "medium",
        },
        "attributes": [
            # Strong strengths but NO attribute clears n_negative >= 5.
            {"key": "scent_longevity", "label_ko": "잔향 지속력",
             "n_positive": 180, "n_negative": 2},
            {"key": "bottle_design", "label_ko": "용기 디자인",
             "n_positive": 80, "n_negative": 1},
        ],
    }
    plan = build_content_plan(report)
    ContentPlan.model_validate(plan)
    assert plan["checkpoints"] is None, (
        "checkpoints must be absent when no product-specific caution "
        "signal exists — never padded with corpus-generic advice"
    )


# ---------------------------------------------------------------------------
# v2.1 — Spotlight mock-mode behavior
# ---------------------------------------------------------------------------


def test_mock_plan_mediheal_surfaces_some_spotlights(mediheal_report: dict) -> None:
    """A rich corpus should surface at least one spotlight section
    (positive / caution / insight) — that's how the carousel expands
    beyond the 9-page base toward the 10–20 target band."""
    plan = build_content_plan(mediheal_report)
    spotlight_count = (
        len(plan.get("positive_spotlights") or [])
        + len(plan.get("caution_spotlights") or [])
        + len(plan.get("insight_spotlights") or [])
    )
    assert spotlight_count >= 1, (
        "Mediheal corpus is rich enough — at least one spotlight should fire"
    )


def test_mock_plan_caution_spotlights_disjoint_from_checkpoints(
    mediheal_report: dict,
) -> None:
    """Mock builder must not let caution_spotlights and checkpoints
    deep-dive on the same attribute (narrative repetition)."""
    plan = build_content_plan(mediheal_report)
    spot_keys = {
        s["attribute_key"] for s in (plan.get("caution_spotlights") or [])
    }
    cp = plan.get("checkpoints")
    if not cp or not spot_keys:
        return
    cp_labels = {s["label"] for s in cp.get("slides") or []}
    # Mediheal labels by attribute_key — derive via briefing
    briefing = build_briefing(mediheal_report)
    label_to_key = {a["label_ko"]: a["key"] for a in briefing["attributes"]}
    cp_keys = {label_to_key.get(lbl) for lbl in cp_labels} - {None}
    overlap = spot_keys & cp_keys
    assert not overlap, (
        f"caution_spotlights and checkpoints must not share attributes; "
        f"overlap={overlap}"
    )


def test_mock_plan_no_spotlights_when_corpus_thin() -> None:
    """Genuinely thin corpus → no spotlights surface (per contract:
    no padding with generic advice)."""
    minimal = {
        "schema_version": "3.0",
        "product": {"slug": "thin", "name_ko": "표본 부족 테스트"},
        "corpus": {
            "n_reviews_total": 3,
            "primary_sort": "DATETIME_DESC",
            "confidence_level": "low",
        },
        "attributes": [],
    }
    plan = build_content_plan(minimal)
    ContentPlan.model_validate(plan)
    assert plan["positive_spotlights"] is None
    assert plan["caution_spotlights"] is None
    assert plan["insight_spotlights"] is None


def test_mock_plan_positive_spotlights_only_for_strong_strengths() -> None:
    """A weak strength (n_positive < POSITIVE_SPOTLIGHT_MIN=20) must
    NOT trigger a positive_spotlight — that's borderline signal,
    surfaced as generic copy if amplified."""
    report = {
        "schema_version": "3.0",
        "product": {"slug": "weak-pos", "name_ko": "약한 호평 제품"},
        "corpus": {
            "n_reviews_total": 60,
            "primary_sort": "DATETIME_DESC",
            "confidence_level": "low",
        },
        "attributes": [
            # Just barely clears SIGNAL_MIN_COUNT=5 but well below
            # POSITIVE_SPOTLIGHT_MIN=20.
            {"key": "scent_longevity", "label_ko": "잔향 지속력",
             "n_positive": 8, "n_negative": 1},
        ],
    }
    plan = build_content_plan(report)
    ContentPlan.model_validate(plan)
    assert plan["positive_spotlights"] is None, (
        "n_positive=8 should not surface a positive_spotlight (threshold=20)"
    )


# ---------------------------------------------------------------------------
# Briefing layer — sanitization
# ---------------------------------------------------------------------------


def test_briefing_strips_review_text_and_ids(mediheal_report: dict) -> None:
    briefing = build_briefing(mediheal_report)
    blob = json.dumps(briefing, ensure_ascii=False)

    seen_ids: set[str] = set()
    seen_quotes: set[str] = set()
    for entry in mediheal_report.get("monitoring_candidates") or []:
        for q in entry.get("top_negative_quotes") or []:
            rid = q.get("review_id")
            if rid:
                seen_ids.add(rid)
            text = q.get("text")
            if text:
                seen_quotes.add(text)
    for s in mediheal_report.get("strengths") or []:
        rep = s.get("representative_quote")
        if isinstance(rep, dict):
            if rep.get("review_id"):
                seen_ids.add(rep["review_id"])
            if rep.get("text"):
                seen_quotes.add(rep["text"])

    for rid in list(seen_ids)[:5]:
        assert rid not in blob, f"briefing leaked review_id {rid}"
    for q in list(seen_quotes)[:5]:
        if len(q) > 20:
            assert q not in blob, f"briefing leaked verbatim quote: {q[:40]}…"


def test_briefing_keeps_signature_candidates_with_rationale(
    mediheal_report: dict,
) -> None:
    briefing = build_briefing(mediheal_report)
    cands = briefing.get("signature_candidates") or []
    assert cands, "no signature candidates surfaced from a rich corpus"
    for c in cands:
        for k in ("key", "label_ko", "score", "rationale", "polarity_shape"):
            assert k in c, f"signature candidate missing {k}: {c}"


def test_briefing_signature_candidates_ranked_descending(
    mediheal_report: dict,
) -> None:
    briefing = build_briefing(mediheal_report)
    cands = briefing.get("signature_candidates") or []
    scores = [c["score"] for c in cands]
    assert scores == sorted(scores, reverse=True)


# ---------------------------------------------------------------------------
# Safety validation — every banned cluster is caught in plan strings
# ---------------------------------------------------------------------------


@pytest.fixture
def clean_plan(mediheal_report: dict) -> dict:
    return build_content_plan(mediheal_report)


@pytest.mark.parametrize("term", BANNED_FRAMINGS_KO)
def test_safety_catches_banned_framing_in_plan(clean_plan: dict, term: str) -> None:
    poisoned = json.loads(json.dumps(clean_plan))
    poisoned["cover"]["headline"] = f"테스트 {term} 카피"
    with pytest.raises(CardnewsSafetyError) as exc:
        validate_content_plan_safety(poisoned)
    rules = {v.rule for v in exc.value.violations}
    assert "banned_framing" in rules or rules & {
        "brand_attack", "expose_framing",
    }, f"term {term!r} produced rules={rules}"


@pytest.mark.parametrize("term", PLANNER_MEDICAL_BANNED_KO)
def test_safety_catches_medical_claim_in_plan(clean_plan: dict, term: str) -> None:
    poisoned = json.loads(json.dumps(clean_plan))
    poisoned["signature"]["lead"] = (
        f"이 제품은 {term} 효과가 있는 것처럼 묘사된 후기가 모였어요."
    )
    with pytest.raises(CardnewsSafetyError) as exc:
        validate_content_plan_safety(poisoned)
    rules = {v.rule for v in exc.value.violations}
    assert "medical_claim" in rules, f"term {term!r} → rules={rules}"


@pytest.mark.parametrize("term", PLANNER_ATTACK_BANNED_KO)
def test_safety_catches_brand_attack_in_plan(clean_plan: dict, term: str) -> None:
    poisoned = json.loads(json.dumps(clean_plan))
    poisoned["divides"]["items"][0]["note"] = f"{term}로 보이는 후기가 있어요"
    with pytest.raises(CardnewsSafetyError) as exc:
        validate_content_plan_safety(poisoned)
    rules = {v.rule for v in exc.value.violations}
    assert "brand_attack" in rules, f"term {term!r} → rules={rules}"


@pytest.mark.parametrize("term", PLANNER_EXPOSE_BANNED_KO)
def test_safety_catches_expose_framing_in_plan(clean_plan: dict, term: str) -> None:
    poisoned = json.loads(json.dumps(clean_plan))
    poisoned["cta"]["body"] = f"브랜드가 {term} 진실을 정리합니다"
    with pytest.raises(CardnewsSafetyError) as exc:
        validate_content_plan_safety(poisoned)
    rules = {v.rule for v in exc.value.violations}
    assert "expose_framing" in rules or "brand_attack" in rules


def test_safety_catches_galineun_jepum_chuchun(clean_plan: dict) -> None:
    """v2.0 — '갈리는 제품 추천' framing positions the carousel as a
    recommendation aggregator and is banned by the user contract."""
    poisoned = json.loads(json.dumps(clean_plan))
    poisoned["cta"]["body"] = "호불호 갈리는 제품 추천 받고 싶다면 댓글 남겨주세요"
    with pytest.raises(CardnewsSafetyError) as exc:
        validate_content_plan_safety(poisoned)
    rules = {v.rule for v in exc.value.violations}
    assert "banned_framing" in rules


def test_safety_catches_missing_language_in_plan(clean_plan: dict) -> None:
    poisoned = json.loads(json.dumps(clean_plan))
    del poisoned["language"]
    with pytest.raises(CardnewsSafetyError) as exc:
        validate_content_plan_safety(poisoned)
    rules = {v.rule for v in exc.value.violations}
    assert "language_invalid" in rules


def test_clean_plan_passes_safety(clean_plan: dict) -> None:
    validate_content_plan_safety(clean_plan)


# ---------------------------------------------------------------------------
# LLM mode
# ---------------------------------------------------------------------------


def test_llm_mode_happy_path(mediheal_report: dict) -> None:
    canonical = build_mock_plan(build_briefing(mediheal_report))

    def stub(_prompt: str) -> str:
        return json.dumps(canonical, ensure_ascii=False)

    plan = build_content_plan(mediheal_report, mode="llm", llm_client=stub)
    assert plan["language"] == "ko"
    assert plan["cover"]["headline"] == canonical["cover"]["headline"]


def test_llm_mode_handles_code_fences(mediheal_report: dict) -> None:
    canonical = build_mock_plan(build_briefing(mediheal_report))

    def stub(_prompt: str) -> str:
        return f"```json\n{json.dumps(canonical, ensure_ascii=False)}\n```"

    plan = build_content_plan(mediheal_report, mode="llm", llm_client=stub)
    assert plan["cover"]["headline"] == canonical["cover"]["headline"]


def test_llm_mode_fails_closed_on_bad_json(mediheal_report: dict) -> None:
    def stub(_prompt: str) -> str:
        return "{this is not valid JSON"
    with pytest.raises(CardnewsPlannerError):
        build_content_plan(mediheal_report, mode="llm", llm_client=stub)


def test_llm_mode_fails_closed_on_schema_violation(mediheal_report: dict) -> None:
    canonical = build_mock_plan(build_briefing(mediheal_report))
    canonical["cover"]["headline"] = ""

    def stub(_prompt: str) -> str:
        return json.dumps(canonical, ensure_ascii=False)

    with pytest.raises(CardnewsPlannerError):
        build_content_plan(mediheal_report, mode="llm", llm_client=stub)


def test_llm_mode_fails_closed_on_safety_violation(mediheal_report: dict) -> None:
    canonical = build_mock_plan(build_briefing(mediheal_report))
    canonical["cover"]["headline"] = "브랜드가 숨긴 진실"

    def stub(_prompt: str) -> str:
        return json.dumps(canonical, ensure_ascii=False)

    with pytest.raises(CardnewsPlannerError):
        build_content_plan(mediheal_report, mode="llm", llm_client=stub)


def test_llm_mode_falls_through_to_mock_when_allowed(mediheal_report: dict) -> None:
    def stub(_prompt: str) -> str:
        return "this is not JSON"

    plan = build_content_plan(
        mediheal_report,
        mode="llm",
        llm_client=stub,
        allow_mock_fallback=True,
    )
    assert plan["language"] == "ko"
    assert plan["cover"]["headline"]


def test_llm_mode_without_client_fails_closed(mediheal_report: dict) -> None:
    with pytest.raises(CardnewsPlannerError):
        build_content_plan(mediheal_report, mode="llm")


def test_llm_mode_saves_raw_response_on_parse_failure(
    mediheal_report: dict, tmp_path: Path,
) -> None:
    def stub(_prompt: str) -> str:
        return "not json at all"

    with pytest.raises(CardnewsPlannerError) as exc:
        build_content_plan(
            mediheal_report,
            mode="llm",
            llm_client=stub,
            raw_dump_dir=tmp_path,
        )
    raw_path = exc.value.raw_response_path
    assert raw_path is not None and raw_path.exists()
    assert raw_path.read_text(encoding="utf-8") == "not json at all"


# ---------------------------------------------------------------------------
# Output paths + write helper
# ---------------------------------------------------------------------------


def test_default_output_dir_uses_product_slug(mediheal_report: dict) -> None:
    out = default_output_dir(mediheal_report, base=Path("/tmp/test-content"))
    assert out.parts[-1] == "ko"
    assert "product-83743e299623" in str(out)


def test_default_plan_path_under_canonical_run_package(tmp_path: Path) -> None:
    """Mirror of cardnews.render._default_out_dir_for_report — the
    planner CLI and the renderer must agree on where the content_plan
    lives so step 1 → step 2 of the skill chains automatically."""
    run = tmp_path / "outputs" / "content_packages" / "run_x"
    report = run / "shared" / "analysis_report.json"
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text("{}", encoding="utf-8")

    derived = default_plan_path_for_report(report)
    assert derived is not None
    assert derived == (run / "cardnews" / "ko" / "content_plan.json").resolve()


def test_default_plan_path_returns_none_for_offpattern(tmp_path: Path) -> None:
    odd = tmp_path / "scratch" / "report.json"
    odd.parent.mkdir(parents=True, exist_ok=True)
    odd.write_text("{}", encoding="utf-8")
    assert default_plan_path_for_report(odd) is None


def test_product_slug_falls_back_to_goods_no() -> None:
    briefing = {
        "product": {
            "slug": "",
            "source_url": "https://www.oliveyoung.co.kr/?goodsNo=A000000999999",
            "name_ko": "",
        }
    }
    assert product_slug_from_briefing(briefing) == "a000000999999"


def test_product_slug_falls_back_to_name_when_no_url() -> None:
    briefing = {
        "product": {"slug": "", "source_url": "", "name_ko": "테스트 제품 X"}
    }
    slug = product_slug_from_briefing(briefing)
    assert slug == "테스트_제품_X"


def test_write_content_plan_round_trip(
    mediheal_report: dict, tmp_path: Path,
) -> None:
    plan = build_content_plan(mediheal_report)
    path = write_content_plan(plan, out_dir=tmp_path)
    assert path.exists()
    round_tripped = json.loads(path.read_text(encoding="utf-8"))
    assert round_tripped == plan


# ---------------------------------------------------------------------------
# Persona label suffix preservation under truncation
# ---------------------------------------------------------------------------
#
# Regression: the Needly skincare_pad smoke produced a consider label
# `'촉촉함/마무리감 호불호가 갈리는 환경에서…'` (28 chars) because the
# template-formatted primary `'촉촉함/마무리감 호불호가 갈리는 환경에서
# 사용하는 분'` was 29 chars, one over LABEL_MAX, and the generic
# `_truncate` from cardnews_generator cut at max-1 and appended `…`,
# stripping the trailing '분' suffix. The schema validator
# `_consider_label_ends_with_bun` then raised. Same pattern existed in
# the fit / signature.who_should_check / checkpoint.who_note builders.

def _build_long_label_report() -> dict:
    """Synthetic report whose attribute label is long enough that
    every persona-suffix template will overflow LABEL_MAX after
    formatting, forcing the new helper's truncation path."""
    return {
        "schema_version": "analysis_report.v0",
        "product": {
            "slug": "test-long-label",
            "display_product_name": "테스트 긴 라벨",
            "selected_profile_id": "skincare_pad",
        },
        "corpus": {
            "total_reviews": 500,
            "average_rating": 4.5,
        },
        "attributes": [
            {
                "key": "dryness_skin_texture",
                "label_ko": "촉촉함/마무리감",
                "n_positive": 120,
                "n_negative": 60,
                "n_total": 180,
                "polarity": "mixed",
                "evidence_score": 0.75,
            },
            {
                "key": "adhesion_base_interaction",
                "label_ko": "밀착력/베이스 호환",
                "n_positive": 80,
                "n_negative": 40,
                "n_total": 120,
                "polarity": "mixed",
                "evidence_score": 0.6,
            },
        ],
    }


def test_consider_label_survives_long_attribute_truncation() -> None:
    """The Needly regression case: the long-label attribute previously
    truncated to '…' and broke the schema. Now the persona suffix
    must survive."""
    report = _build_long_label_report()
    plan = build_content_plan(report)
    consider_items = plan.get("consider", {}).get("items") or []
    assert consider_items, "consider.items should be populated"
    for item in consider_items:
        label = item["label"]
        assert not label.endswith("…"), (
            f"consider label must not end in ellipsis, got {label!r}"
        )
        assert label.rstrip(" .!?…)、,。·").endswith("분"), (
            f"consider label must end in '분', got {label!r}"
        )


def test_fit_label_survives_long_attribute_truncation() -> None:
    """Same hazard exists in fit.items[].label — guard it."""
    report = _build_long_label_report()
    plan = build_content_plan(report)
    fit_items = plan.get("fit", {}).get("items") or []
    assert fit_items, "fit.items should be populated"
    for item in fit_items:
        label = item["label"]
        assert not label.endswith("…"), (
            f"fit label must not end in ellipsis, got {label!r}"
        )
        assert label.rstrip(" .!?…)、,。·").endswith("분"), (
            f"fit label must end in '분', got {label!r}"
        )


def test_truncate_persona_label_helper() -> None:
    """Direct unit test of the helper: returns input as-is when it
    fits, drops leading tokens to preserve '분' when too long, and
    falls back to the curated string when even the suffix-only form
    cannot fit within max_chars."""
    from src.voc.content.editorial_planner import _truncate_persona_label
    fb = "기본값 분"
    # Fits and ends in 분 → unchanged
    assert _truncate_persona_label(
        "잘 맞는 분", 28, fallback=fb,
    ) == "잘 맞는 분"
    # Too long, ends in 분 → drop leading tokens, keep suffix
    long = "촉촉함/마무리감 호불호가 갈리는 환경에서 사용하는 분"  # 29 chars
    out = _truncate_persona_label(long, 28, fallback=fb)
    assert len(out) <= 28
    assert out.endswith("분")
    assert "사용하는 분" in out
    # Doesn't end in 분 → fallback
    assert _truncate_persona_label(
        "끝이 다른 표현", 28, fallback=fb,
    ) == fb
