"""Editorial planner tests.

Covers:
  * Pydantic schema validation (rejects malformed plans)
  * Mock-mode required-field coverage on a real Mediheal snapshot
  * Mock-mode generalization on synthetic non-canonical attribute keys
  * Mock-mode determinism (same input → same output)
  * Safety validator catches every banned-cluster phrase in plan strings
  * LLM-mode happy path with a stub callable
  * LLM-mode fail-closed on bad JSON / schema / safety violations
  * LLM-mode falls through to mock when allow_mock_fallback=True
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


# ---------------------------------------------------------------------------
# Mock mode — required field coverage
# ---------------------------------------------------------------------------


def test_mock_plan_mediheal_has_all_sections(mediheal_report: dict) -> None:
    plan = build_content_plan(mediheal_report)
    for section in ("cover", "hook", "loved", "divides", "signature",
                    "checkpoints", "audience", "method", "cta"):
        assert section in plan, f"missing section {section}"
    assert plan["language"] == "ko"
    # ContentPlan round-trip should pass clean
    ContentPlan.model_validate(plan)


def test_mock_plan_synthetic_unknown_attributes_validates() -> None:
    """The whole point of v2.0 — ANY attribute key works, not just the
    12 canonical Phase 2E keys. This is the generalization contract."""
    report = _synthetic_unknown_attribute_report()
    plan = build_content_plan(report)
    ContentPlan.model_validate(plan)
    # Signature attribute_key must come from the briefing's attribute list
    sig_key = plan["signature"]["attribute_key"]
    assert sig_key in {"scent_longevity", "projection_radius",
                       "top_note_balance", "bottle_design"}, (
        f"signature picked {sig_key!r}, not in synthetic attribute list"
    )
    # And the Korean label flows through end-to-end
    assert plan["signature"]["title"] in ("잔향 지속력", "확산력",
                                          "탑노트 밸런스", "용기 디자인")


def test_mock_plan_is_deterministic(mediheal_report: dict) -> None:
    p1 = build_content_plan(mediheal_report)
    p2 = build_content_plan(mediheal_report)
    assert json.dumps(p1, sort_keys=True) == json.dumps(p2, sort_keys=True)


def test_mock_plan_varies_with_corpus_size() -> None:
    """Mock mode must produce structurally different plans across
    products. Same template can stay, but the data-driven slots
    (counts, labels) MUST differ when inputs differ."""
    a = _synthetic_unknown_attribute_report()
    b = _synthetic_unknown_attribute_report()
    b["corpus"]["n_reviews_total"] = 50  # weak corpus
    b["attributes"][0]["n_positive"] = 22
    b["strengths"][0]["supporting_count"] = 22
    pa = build_content_plan(a)
    pb = build_content_plan(b)
    # The hook headline tracks confidence which should differ
    # (412 reviews → strong/moderate; 50 reviews → weak)
    assert pa["hook"]["headline"] != pb["hook"]["headline"] or (
        pa["hook"]["metrics"][0]["value"] != pb["hook"]["metrics"][0]["value"]
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
    # A completely empty attribute list still produces a usable plan
    # (graceful degradation rather than schema fail).
    assert plan["signature"]["attribute_key"] == "unknown"


# ---------------------------------------------------------------------------
# Briefing layer — sanitization
# ---------------------------------------------------------------------------


def test_briefing_strips_review_text_and_ids(mediheal_report: dict) -> None:
    """The compact briefing sent to the LLM must NOT carry verbatim
    review quotes or review_ids. Defense against accidental leakage
    into LLM prompt logs."""
    briefing = build_briefing(mediheal_report)
    blob = json.dumps(briefing, ensure_ascii=False)

    # Pull a known review_id and quote from the source report and
    # confirm neither shows up in the briefing.
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

    for rid in list(seen_ids)[:5]:  # sample first 5
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
    assert scores == sorted(scores, reverse=True), (
        f"signature candidates not score-sorted: {scores}"
    )


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
    assert "expose_framing" in rules or "brand_attack" in rules, (
        f"term {term!r} → rules={rules}"
    )


def test_safety_catches_missing_language_in_plan(clean_plan: dict) -> None:
    poisoned = json.loads(json.dumps(clean_plan))
    del poisoned["language"]
    with pytest.raises(CardnewsSafetyError) as exc:
        validate_content_plan_safety(poisoned)
    rules = {v.rule for v in exc.value.violations}
    assert "language_invalid" in rules


def test_clean_plan_passes_safety(clean_plan: dict) -> None:
    validate_content_plan_safety(clean_plan)  # no raise


# ---------------------------------------------------------------------------
# LLM mode
# ---------------------------------------------------------------------------


def test_llm_mode_happy_path(mediheal_report: dict) -> None:
    """LLM client returns a valid plan JSON → parsed + validated."""
    canonical = build_mock_plan(build_briefing(mediheal_report))

    def stub(_prompt: str) -> str:
        return json.dumps(canonical, ensure_ascii=False)

    plan = build_content_plan(mediheal_report, mode="llm", llm_client=stub)
    assert plan["language"] == "ko"
    assert plan["cover"]["headline"] == canonical["cover"]["headline"]


def test_llm_mode_handles_code_fences(mediheal_report: dict) -> None:
    """Some models stubbornly wrap JSON in ```json fences. The
    planner should tolerate this — it's far more recoverable than
    raising a `not valid JSON` error on a usable response."""
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
    canonical["cover"]["headline"] = ""  # min_length=1 violation

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
    assert plan["cover"]["headline"]  # mock filled it


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
    # Mediheal report carries product.slug = product-83743e299623
    assert "product-83743e299623" in str(out)


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
