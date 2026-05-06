"""Long-form cardnews layout tests (v2.1 — 10-20 expandable carousel).

Goldens-against-snapshot: build the layout from a real persisted
analysis_report.json and assert structural + safety contracts. The
test does not depend on Playwright.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from cardnews.safety_validator import (
    BANNED_FRAMINGS_KO,
    CardnewsSafetyError,
    validate_cardnews_safety,
)
from src.voc.content.cardnews_long_layout import (
    BULLET_MAX_CHARS_KO,
    EVIDENCE_PHRASE_KO,
    EVIDENCE_TIP_KO,
    SLIDE_TITLE_MAX_CHARS_KO,
    build_long_cardnews_layout,
)
from src.voc.content.editorial_planner import build_content_plan


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
def sample_report() -> dict:
    if not SAMPLE_REPORT.exists():
        pytest.skip(f"sample analysis_report missing: {SAMPLE_REPORT}")
    return json.loads(SAMPLE_REPORT.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def layout(sample_report: dict) -> dict:
    return build_long_cardnews_layout(sample_report)


# ---------------------------------------------------------------------------
# Structural contract (v2.0)
# ---------------------------------------------------------------------------


def test_layout_has_required_top_level_fields(layout: dict) -> None:
    for key in (
        "schema_version",
        "language",
        "channel",
        "format",
        "product",
        "product_image",
        "corpus",
        "page_count",
        "pages",
        "analysis_report_sha256",
        "content_plan_sha256",
        "generated_at",
    ):
        assert key in layout, f"missing top-level field: {key}"
    assert layout["schema_version"] == "2.2"


def test_language_field_is_ko_at_root_and_every_page(layout: dict) -> None:
    assert layout["language"] == "ko"
    for p in layout["pages"]:
        assert p["language"] == "ko", f"page {p['index']} language={p.get('language')}"


def test_page_count_within_v2_1_band_for_rich_corpus(layout: dict) -> None:
    """v2.1 narrative: 9 required + 0..14 optional, capped at 20.

    Mediheal corpus has divides + cautions + several strong loved
    attributes → expect at least 10 pages and never more than 20."""
    assert 10 <= layout["page_count"] <= 20, (
        f"Mediheal layout should land in 10..20 page band; "
        f"got {layout['page_count']}"
    )
    assert layout["page_count"] == len(layout["pages"])


def test_page_order_v2_1_locked(layout: dict) -> None:
    """v2.1 narrative — locked.

    cover → one_liner → loved → [positive_spotlight × 0..3] → divides
    → [why_divides?] → [caution_spotlight × 0..4] →
    [insight_spotlight × 0..3] → signature → [checkpoint × 0..3] →
    fit → consider → summary → cta

    Mediheal's rich corpus exercises positive + caution + insight
    spotlights and both optional sections (why_divides, checkpoints)."""
    page_types = [p["type"] for p in layout["pages"]]

    # Head — cover, one_liner, loved are always first
    assert page_types[0] == "cover"
    assert page_types[1] == "one_liner"
    assert page_types[2] == "loved"

    # Tail — fit → consider → summary → cta is locked
    assert page_types[-1] == "cta"
    assert page_types[-2] == "summary"
    assert page_types[-3] == "consider"
    assert page_types[-4] == "fit"

    # Anchors — divides and signature both present, in order
    assert "divides" in page_types
    assert "signature" in page_types
    div_idx = page_types.index("divides")
    sig_idx = page_types.index("signature")
    assert div_idx < sig_idx, (
        f"divides must come before signature; "
        f"got div={div_idx}, sig={sig_idx}"
    )

    # Positive spotlights (if any) sit between loved (idx=2) and divides
    pos_indices = [i for i, t in enumerate(page_types)
                   if t == "positive_spotlight"]
    for i in pos_indices:
        assert 3 <= i < div_idx, (
            f"positive_spotlight at idx {i} should sit between loved "
            f"and divides (divides @ {div_idx})"
        )

    # Caution + insight spotlights sit between divides+why_divides and signature
    cau_indices = [i for i, t in enumerate(page_types)
                   if t == "caution_spotlight"]
    ins_indices = [i for i, t in enumerate(page_types)
                   if t == "insight_spotlight"]
    for i in cau_indices + ins_indices:
        assert div_idx < i < sig_idx, (
            f"spotlight at idx {i} ({page_types[i]}) should sit between "
            f"divides ({div_idx}) and signature ({sig_idx})"
        )

    # Checkpoints sit after signature
    cp_indices = [i for i, t in enumerate(page_types) if t == "checkpoint"]
    for i in cp_indices:
        assert sig_idx < i < page_types.index("fit"), (
            f"checkpoint at idx {i} should sit between signature and fit"
        )


def test_page_count_capped_at_20(layout: dict) -> None:
    """v2.1 hard cap. Layout must never emit more than 20 pages even
    on a corpus that could trigger every spotlight."""
    assert layout["page_count"] <= 20


def test_page_indices_are_one_based_contiguous(layout: dict) -> None:
    for i, p in enumerate(layout["pages"], start=1):
        assert p["index"] == i


def test_v2_no_method_or_hook_or_audience_pages(layout: dict) -> None:
    """v2.0/v2.1 removed `hook`, `audience`, `method` page types. The
    analysis basis lives in cover.corpus_footer + cta.disclosure now."""
    types = {p["type"] for p in layout["pages"]}
    assert "hook" not in types
    assert "audience" not in types
    assert "method" not in types


def test_v2_1_no_raw_quote_fanout_pages(layout: dict) -> None:
    """v2.1 spotlights are LLM-interpreted pages, NOT the legacy
    per-attribute quote fan-out pages from v1.x."""
    types = {p["type"] for p in layout["pages"]}
    assert "caution_attr" not in types
    assert "positive_attr" not in types


def test_cover_page_carries_corpus_footer(layout: dict) -> None:
    """v2.0 — analysis basis is on the cover as a micro-text footer."""
    cover = next(p for p in layout["pages"] if p["type"] == "cover")
    assert (cover.get("corpus_footer") or "").strip(), (
        "cover must carry a non-empty corpus_footer (분석 기준 micro-text)"
    )


def test_cta_page_carries_disclosure(layout: dict) -> None:
    """v2.0 — methodology disclosure absorbed into the CTA footer."""
    cta = next(p for p in layout["pages"] if p["type"] == "cta")
    assert (cta.get("disclosure") or "").strip(), (
        "cta must carry the methodology disclosure"
    )


# ---------------------------------------------------------------------------
# Optional-section contract — checkpoints + why_divides
# ---------------------------------------------------------------------------


def test_checkpoints_emit_one_page_per_slide(layout: dict) -> None:
    """v2.0 — each checkpoint slide gets its own carousel page (한 장에
    한 메시지). v2.2 capped the slide count at 1..2 (was 1..3) to lift
    info density per page."""
    cps = [p for p in layout["pages"] if p["type"] == "checkpoint"]
    assert 0 <= len(cps) <= 2
    for cp in cps:
        for k in ("number", "label", "count", "tip", "why_note", "who_note"):
            assert (cp.get(k) or "").strip() or k == "number", (
                f"checkpoint page missing {k!r}"
            )


def test_v2_4_skeleton_locked_cover_one_liner_summary_cta() -> None:
    """v2.4 — the four skeleton positions are locked across all arcs:
    cover at index 1, one_liner at index 2, summary at second-to-last,
    cta at last. The middle reorders by story arc."""
    reports = [
        # caution-dominant → caution_lead arc
        {
            "schema_version": "3.0",
            "product": {"slug": "lip", "name_ko": "매트 립스틱"},
            "corpus": {"n_reviews_total": 320},
            "attributes": [
                {"key": "p", "label_ko": "지속력",
                 "n_positive": 6, "n_negative": 42},
                {"key": "d", "label_ko": "건조감",
                 "n_positive": 2, "n_negative": 25},
            ],
        },
        # strong positive → positive_lead arc
        {
            "schema_version": "3.0",
            "product": {"slug": "sun", "name_ko": "데일리 선스틱"},
            "corpus": {"n_reviews_total": 850},
            "attributes": [
                {"key": "d", "label_ko": "데일리 사용감",
                 "n_positive": 240, "n_negative": 1},
                {"key": "w", "label_ko": "백탁 없음",
                 "n_positive": 95, "n_negative": 2},
            ],
        },
    ]
    for report in reports:
        layout = build_long_cardnews_layout(report)
        types = [p["type"] for p in layout["pages"]]
        assert types[0] == "cover"
        assert types[1] == "one_liner"
        assert types[-1] == "cta"
        assert types[-2] == "summary"
        # fit + consider always pair just before summary
        assert types[-3] == "consider"
        assert types[-4] == "fit"


def test_v2_4_story_arc_varies_by_signal_shape() -> None:
    """Two products with different signal shapes pick different story
    arcs → different middle orderings, so the carousel doesn't feel
    like the same template across runs."""
    caution_dominant = {
        "schema_version": "3.0",
        "product": {"slug": "lip", "name_ko": "매트 립스틱"},
        "corpus": {"n_reviews_total": 320},
        "attributes": [
            {"key": "p", "label_ko": "지속력",
             "n_positive": 6, "n_negative": 42},
        ],
    }
    positive_dominant = {
        "schema_version": "3.0",
        "product": {"slug": "sun", "name_ko": "데일리 선스틱"},
        "corpus": {"n_reviews_total": 850},
        "attributes": [
            {"key": "d", "label_ko": "데일리 사용감",
             "n_positive": 240, "n_negative": 1},
        ],
    }
    a = build_long_cardnews_layout(caution_dominant)
    b = build_long_cardnews_layout(positive_dominant)
    assert a["story_arc"] == "caution_lead"
    assert b["story_arc"] == "positive_lead"
    # The two arcs differ → at least one middle page type appears at
    # different positions across the two carousels.
    types_a = [p["type"] for p in a["pages"]]
    types_b = [p["type"] for p in b["pages"]]
    assert types_a != types_b, (
        "different arcs should produce different page sequences"
    )


def test_v2_4_cover_hook_varies_across_products() -> None:
    """v2.4 cover-hook controlled-variety contract: two products with
    similar signal shapes should NOT produce identical headlines.

    Tests by composing two synthetic products that both pick the
    `caution_signal` intent but differ in product name + counts so
    the deterministic pattern selector lands on different patterns."""
    from src.voc.content.editorial_planner import build_content_plan
    a_plan = build_content_plan({
        "schema_version": "3.0",
        "product": {"slug": "p_a", "name_ko": "테스트 클렌저 A"},
        "corpus": {"n_reviews_total": 220},
        "attributes": [
            {"key": "f", "label_ko": "거품감",
             "n_positive": 12, "n_negative": 28},
        ],
    })
    b_plan = build_content_plan({
        "schema_version": "3.0",
        "product": {"slug": "p_b", "name_ko": "테스트 토너 B"},
        "corpus": {"n_reviews_total": 410},
        "attributes": [
            {"key": "s", "label_ko": "흡수감",
             "n_positive": 18, "n_negative": 36},
        ],
    })
    # Different product → different headline (the whole point of v2.4).
    assert a_plan["cover"]["headline"] != b_plan["cover"]["headline"], (
        "two synthetic products must produce different cover headlines"
    )


def test_synthetic_no_caution_signal_drops_checkpoints_section() -> None:
    """User contract: no product-specific caution signal → no
    checkpoint pages emitted. NEVER padded with corpus-generic advice."""
    report = {
        "schema_version": "3.0",
        "product": {"slug": "all-positive", "name_ko": "전체 호평 제품"},
        "corpus": {
            "n_reviews_total": 200,
            "primary_sort": "DATETIME_DESC",
            "confidence_level": "medium",
        },
        "attributes": [
            {"key": "scent_longevity", "label_ko": "잔향 지속력",
             "n_positive": 180, "n_negative": 2},
            {"key": "bottle_design", "label_ko": "용기 디자인",
             "n_positive": 80, "n_negative": 1},
        ],
        "strengths": [
            {"attribute_key": "scent_longevity", "supporting_count": 180},
        ],
    }
    layout = build_long_cardnews_layout(report)
    types = [p["type"] for p in layout["pages"]]
    assert "checkpoint" not in types, (
        "no caution clears the threshold → no checkpoint pages should fire"
    )


def test_synthetic_no_divide_signal_drops_why_divides_section() -> None:
    """No dual-polarity attribute → why_divides section absent."""
    report = {
        "schema_version": "3.0",
        "product": {"slug": "all-positive", "name_ko": "전체 호평 제품"},
        "corpus": {
            "n_reviews_total": 200,
            "primary_sort": "DATETIME_DESC",
            "confidence_level": "medium",
        },
        "attributes": [
            # Strong positive only — no attribute is dual-polarity.
            {"key": "scent_longevity", "label_ko": "잔향 지속력",
             "n_positive": 180, "n_negative": 2},
            {"key": "bottle_design", "label_ko": "용기 디자인",
             "n_positive": 80, "n_negative": 1},
        ],
    }
    layout = build_long_cardnews_layout(report)
    types = [p["type"] for p in layout["pages"]]
    assert "why_divides" not in types


def test_synthetic_strong_strengths_emit_positive_spotlights() -> None:
    """A corpus with strong loved attrs (n_positive ≥ 20) should
    surface positive_spotlight pages — that's how the carousel
    expands without quote fan-outs."""
    report = {
        "schema_version": "3.0",
        "product": {"slug": "all-positive", "name_ko": "전체 호평 제품"},
        "corpus": {
            "n_reviews_total": 200,
            "primary_sort": "DATETIME_DESC",
            "confidence_level": "medium",
        },
        "attributes": [
            {"key": "scent_longevity", "label_ko": "잔향 지속력",
             "n_positive": 180, "n_negative": 2},
            {"key": "bottle_design", "label_ko": "용기 디자인",
             "n_positive": 80, "n_negative": 1},
        ],
    }
    layout = build_long_cardnews_layout(report)
    types = [p["type"] for p in layout["pages"]]
    pos_count = sum(1 for t in types if t == "positive_spotlight")
    assert pos_count >= 1, (
        f"strong-strength corpus should surface positive_spotlights; "
        f"got {pos_count} (types={types})"
    )


def test_synthetic_thin_corpus_drops_all_spotlights_no_padding() -> None:
    """User contract: weak corpus → no spotlights, NO generic-advice
    padding. Layout returns 9 base pages (under the 10-floor target,
    which is acceptable when no real signal supports expansion)."""
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
    layout = build_long_cardnews_layout(minimal)
    types = [p["type"] for p in layout["pages"]]
    assert "positive_spotlight" not in types
    assert "caution_spotlight" not in types
    assert "insight_spotlight" not in types
    # 9-base floor when corpus is genuinely empty (acceptable degraded
    # mode — not padded with generic advice to fake 10).
    assert layout["page_count"] == 9


# ---------------------------------------------------------------------------
# Char-budget contract
# ---------------------------------------------------------------------------


def test_titles_within_budget_or_truncated(layout: dict) -> None:
    for p in layout["pages"]:
        if p["type"] in ("cover", "cta"):
            continue
        title = p.get("title") or ""
        assert len(title) <= max(SLIDE_TITLE_MAX_CHARS_KO, 14) + 4, (
            f"page {p['index']} ({p['type']}) title too long: {title!r}"
        )


# ---------------------------------------------------------------------------
# Audit + privacy contract
# ---------------------------------------------------------------------------


def test_review_id_never_leaks_into_public_field(layout: dict) -> None:
    """Collect every audit.evidence_review_id_truncated and assert no
    other (non-audit) string in the layout contains it."""
    audit_ids: set[str] = set()
    for p in layout["pages"]:
        rid = (p.get("audit") or {}).get("evidence_review_id_truncated")
        if rid:
            audit_ids.add(rid)

    def walk_public(node, path):
        if isinstance(node, dict):
            for k, v in node.items():
                if k == "audit":
                    continue
                yield from walk_public(v, f"{path}.{k}")
        elif isinstance(node, list):
            for i, item in enumerate(node):
                yield from walk_public(item, f"{path}[{i}]")
        elif isinstance(node, str):
            yield path, node

    for path, text in walk_public(layout, ""):
        for rid in audit_ids:
            assert rid not in text, (
                f"review_id leak: {rid!r} found in {path}: {text!r}"
            )


# ---------------------------------------------------------------------------
# Safety validator integration
# ---------------------------------------------------------------------------


def test_layout_passes_safety_validator(layout: dict) -> None:
    validate_cardnews_safety(layout)


def test_safety_validator_catches_planted_banned_phrase(layout: dict) -> None:
    poisoned = json.loads(json.dumps(layout))
    cover = next(p for p in poisoned["pages"] if p["type"] == "cover")
    cover["subtitle"] = "이건 광고에 속지 마세요 같은 클릭베이트입니다"
    with pytest.raises(CardnewsSafetyError):
        validate_cardnews_safety(poisoned)


def test_signature_page_has_editorial_payload(layout: dict) -> None:
    sig = next((p for p in layout["pages"] if p["type"] == "signature"), None)
    assert sig is not None, "v2.0 layout must include a signature page"
    assert (sig.get("headline") or "").strip()
    assert (sig.get("lead") or "").strip()
    asides = sig.get("aside_items") or []
    assert len(asides) == 2
    for a in asides:
        assert (a.get("label") or "").strip()
        assert (a.get("note") or "").strip()


def test_cta_has_single_primary_action(layout: dict) -> None:
    cta = next(p for p in layout["pages"] if p["type"] == "cta")
    actions = cta.get("actions") or []
    assert len(actions) == 1


def test_product_image_descriptor_always_present(layout: dict) -> None:
    """v2.4 — the layout always carries a `product_image` descriptor.
    Source can be any of the known channels; usage is `cover_cutout`
    when an image is available (URL or local_path) and
    `cover_full_bleed` when nothing is available (text-only cover)."""
    pi = layout["product_image"]
    assert pi["source"] in (
        "cli_path", "cli_url", "analysis_report",
        "analysis_report_local", "oliveyoung", "coupang", "manual",
        "fallback_gradient",
    ), f"unexpected image source: {pi['source']!r}"
    assert pi["usage"] in ("cover_cutout", "cover_full_bleed"), (
        f"unexpected image usage: {pi['usage']!r}"
    )
    assert "url" in pi and "local_path" in pi


# ---------------------------------------------------------------------------
# v2.0 — content_plan-driven flow
# ---------------------------------------------------------------------------


def test_layout_v2_default_path_calls_planner_in_mock_mode(
    sample_report: dict,
) -> None:
    """build_long_cardnews_layout(report) without a content_plan should
    produce a valid v2.1 layout — the layout calls the planner in mock
    mode internally."""
    layout = build_long_cardnews_layout(sample_report)
    assert layout["schema_version"] == "2.2"
    assert 10 <= layout["page_count"] <= 20
    assert "content_plan_sha256" in layout
    assert len(layout["content_plan_sha256"]) == 64


def test_layout_v2_accepts_external_content_plan(sample_report: dict) -> None:
    plan = build_content_plan(sample_report)
    layout = build_long_cardnews_layout(sample_report, content_plan=plan)
    cover = next(p for p in layout["pages"] if p["type"] == "cover")
    assert cover["headline"] == plan["cover"]["headline"]
    sig = next(p for p in layout["pages"] if p["type"] == "signature")
    assert sig["attribute_key"] == plan["signature"]["attribute_key"]
    assert sig["headline"] == plan["signature"]["headline"]
    cta = next(p for p in layout["pages"] if p["type"] == "cta")
    assert cta["title"] == plan["cta"]["headline"]


def test_layout_v2_audit_attached_to_signature_page(sample_report: dict) -> None:
    layout = build_long_cardnews_layout(sample_report)
    sig = next(p for p in layout["pages"] if p["type"] == "signature")
    audit = sig.get("audit") or {}
    assert "evidence_review_id_truncated" in audit or "evidence_span_raw" in audit


def test_layout_v2_page_record_shape(sample_report: dict) -> None:
    """v2.1 — page record fields each template reads must be present."""
    layout = build_long_cardnews_layout(sample_report)
    by_type: dict[str, dict] = {}
    for p in layout["pages"]:
        # multiple checkpoint / spotlight pages — keep the first
        by_type.setdefault(p["type"], p)

    assert {"chip", "title", "headline", "subtitle", "chip_strip",
            "corpus_footer", "product_image"} <= set(by_type["cover"])
    assert {"chip", "title", "headline", "sub"} <= set(by_type["one_liner"])
    assert {"chip", "title", "subtitle", "ranked_items"} <= set(by_type["loved"])
    assert {"chip", "title", "subtitle", "comparison_items"} <= set(by_type["divides"])
    if "why_divides" in by_type:
        assert {"chip", "title", "headline", "axes", "axis_pairs", "note"} <= set(by_type["why_divides"])
    assert {"chip", "headline", "subtitle", "lead", "aside_items"} <= set(by_type["signature"])
    if "checkpoint" in by_type:
        assert {"chip", "number", "label", "count", "tip",
                "why_note", "who_note"} <= set(by_type["checkpoint"])
    if "positive_spotlight" in by_type:
        assert {"chip", "headline", "count", "what_reviewers_liked",
                "why_it_matters", "who_benefits"} <= set(by_type["positive_spotlight"])
    if "caution_spotlight" in by_type:
        assert {"chip", "headline", "split_signal", "likely_context",
                "check_before_buy"} <= set(by_type["caution_spotlight"])
    if "insight_spotlight" in by_type:
        assert {"chip", "headline", "signal_count", "interpretation",
                "who_should_check"} <= set(by_type["insight_spotlight"])
    assert {"chip", "title", "subtitle", "items"} <= set(by_type["fit"])
    assert {"chip", "title", "subtitle", "items"} <= set(by_type["consider"])
    assert {"chip", "title", "headline", "takeaways", "closing_note"} <= set(by_type["summary"])
    assert {"chip", "title", "lead", "actions", "disclosure"} <= set(by_type["cta"])


def test_layout_v2_1_caps_at_20_pages_under_extreme_corpus() -> None:
    """Pathological corpus with many strong attributes triggers every
    spotlight type maxed out — layout must still cap at 20 pages."""
    # 5 strong-positive + 5 strong-caution + 5 strong-divide attributes.
    # Mock thresholds: positive≥20, caution≥12, insight≥8 each polarity.
    attrs = []
    for i in range(5):
        attrs.append({
            "key": f"strong_pos_{i}", "label_ko": f"강한호평{i}",
            "n_positive": 100, "n_negative": 1,
        })
    for i in range(5):
        attrs.append({
            "key": f"strong_cau_{i}", "label_ko": f"강한주의{i}",
            "n_positive": 2, "n_negative": 60,
        })
    for i in range(5):
        attrs.append({
            "key": f"strong_div_{i}", "label_ko": f"강한갈림{i}",
            "n_positive": 50, "n_negative": 30,
        })
    report = {
        "schema_version": "3.0",
        "product": {"slug": "extreme", "name_ko": "극단적 신호 제품"},
        "corpus": {
            "n_reviews_total": 5000,
            "primary_sort": "DATETIME_DESC",
            "confidence_level": "high",
        },
        "attributes": attrs,
    }
    layout = build_long_cardnews_layout(report)
    assert layout["page_count"] <= 20, (
        f"hard cap violation: extreme corpus produced {layout['page_count']} pages"
    )
    assert layout["page_count"] >= 10


def test_layout_v2_renders_synthetic_unknown_attribute_report() -> None:
    """v2.0 generalization: ANY product produces a valid, safety-clean layout."""
    synthetic = {
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
        ],
        "strengths": [
            {"attribute_key": "scent_longevity", "supporting_count": 188},
        ],
        "monitoring_candidates": [
            {"attribute_key": "scent_longevity", "concern_label_ko": "잔향 지속력",
             "n_negative": 42},
        ],
    }
    layout = build_long_cardnews_layout(synthetic)
    validate_cardnews_safety(layout)
    assert 9 <= layout["page_count"] <= 20
    sig = next(p for p in layout["pages"] if p["type"] == "signature")
    assert sig["attribute_key"] in {"scent_longevity", "projection_radius"}


# ---------------------------------------------------------------------------
# v2.1.1 — caution_spotlight.interpretation + one_liner roadmap mini-nav
# ---------------------------------------------------------------------------


def test_v2_1_1_caution_spotlight_carries_interpretation(
    sample_report: dict,
) -> None:
    """Every caution_spotlight page surfaces the v2.1.1 body interpretation
    slot. Mock planner fills it with a safe neutral phrase; layout is
    expected to fall back when missing — either way the rendered page
    cannot leave the body card empty."""
    layout = build_long_cardnews_layout(sample_report)
    spotlights = [p for p in layout["pages"] if p["type"] == "caution_spotlight"]
    if not spotlights:
        pytest.skip("snapshot did not produce any caution_spotlight pages")
    for sp in spotlights:
        assert "interpretation" in sp, (
            f"caution_spotlight page {sp['index']} missing interpretation slot"
        )
        text = sp["interpretation"]
        assert isinstance(text, str) and text.strip(), (
            f"caution_spotlight page {sp['index']} interpretation is empty"
        )


def test_v2_1_1_caution_spotlight_interpretation_falls_back_when_planner_omits(
    sample_report: dict,
) -> None:
    """If a content_plan omits the optional interpretation field (older
    plans, partial LLM output) the layout must still emit a non-empty
    body sentence so the template never renders a blank card."""
    plan = build_content_plan(sample_report, mode="mock")
    spots = plan.get("caution_spotlights") or []
    if not spots:
        pytest.skip("planner produced no caution_spotlights for this snapshot")
    for s in spots:
        s.pop("interpretation", None)
    layout = build_long_cardnews_layout(sample_report, content_plan=plan)
    sp_pages = [p for p in layout["pages"] if p["type"] == "caution_spotlight"]
    assert sp_pages, "expected caution_spotlight pages from this snapshot"
    for sp in sp_pages:
        assert sp["interpretation"], (
            f"page {sp['index']} fallback interpretation should be non-empty"
        )
    validate_cardnews_safety(layout)


def test_v2_2_one_liner_carries_metric_pills_and_framing_note(
    layout: dict,
) -> None:
    """v2.2 — one_liner densification. Replaces the v2.1.1 roadmap
    mini-nav with 2..3 numeric pills + a one-line framing note. Rich
    corpora populate both."""
    one_liner = next(p for p in layout["pages"] if p["type"] == "one_liner")
    pills = one_liner.get("metric_pills")
    assert isinstance(pills, list) and 2 <= len(pills) <= 3, (
        f"metric_pills should be a 2..3 item list, got {pills!r}"
    )
    for p in pills:
        assert isinstance(p, str) and 0 < len(p) <= 16, (
            f"each metric pill must be ≤16 chars, got {p!r}"
        )
    framing = one_liner.get("framing_note")
    assert isinstance(framing, str) and framing.strip(), (
        "one_liner.framing_note should be a non-empty string"
    )


def test_v2_2_one_liner_no_longer_emits_roadmap(layout: dict) -> None:
    """v2.2 — the v2.1.1 roadmap mini-nav was removed (read as a
    slide-deck agenda). Layout must NOT inject `roadmap_items` /
    `roadmap_label` on the one_liner page."""
    one_liner = next(p for p in layout["pages"] if p["type"] == "one_liner")
    assert "roadmap_items" not in one_liner, (
        "v2.2 must not emit roadmap_items on one_liner; got "
        f"{one_liner.get('roadmap_items')!r}"
    )
    assert "roadmap_label" not in one_liner, (
        "v2.2 must not emit roadmap_label on one_liner; got "
        f"{one_liner.get('roadmap_label')!r}"
    )


def test_v2_2_one_liner_passes_safety_validator(layout: dict) -> None:
    """Sanity: metric_pills + framing_note are walked by the safety
    allowlist and contain no banned framings."""
    validate_cardnews_safety(layout)


def test_v2_2_why_divides_axis_pairs_each_carry_axis_and_why(
    sample_report: dict,
) -> None:
    """v2.2 — every why_divides axis pairs with a one-line `why`
    explanation. Mock planner emits axis_whys; layout exposes
    `axis_pairs` to the template."""
    layout = build_long_cardnews_layout(sample_report)
    why = next(
        (p for p in layout["pages"] if p["type"] == "why_divides"),
        None,
    )
    if why is None:
        pytest.skip("snapshot did not produce a why_divides page")
    pairs = why.get("axis_pairs")
    assert isinstance(pairs, list) and pairs, (
        "axis_pairs must be a non-empty list"
    )
    for pair in pairs:
        assert set(pair) == {"axis", "why"}, (
            f"unexpected axis_pair shape: {pair}"
        )
        assert pair["axis"]
        assert pair["why"], (
            f"axis_pair {pair!r} missing why explanation — v2.2 requires it"
        )


def test_v2_2_cta_carries_support_actions(layout: dict) -> None:
    """v2.2 — CTA page surfaces 1..3 supporting Instagram actions
    (save / like / comment) below the primary call."""
    cta = next(p for p in layout["pages"] if p["type"] == "cta")
    sa = cta.get("support_actions")
    assert isinstance(sa, list) and 1 <= len(sa) <= 3, (
        f"support_actions should be a 1..3 item list, got {sa!r}"
    )
    for a in sa:
        assert isinstance(a, str) and a.strip()


def test_v2_1_1_caution_spotlight_interpretation_passes_safety(
    sample_report: dict,
) -> None:
    """Planted banned phrase in interpretation must trigger the safety
    contract — confirms the new field is walked by the validator."""
    layout = build_long_cardnews_layout(sample_report)
    sp = next(
        (p for p in layout["pages"] if p["type"] == "caution_spotlight"),
        None,
    )
    if sp is None:
        pytest.skip("snapshot did not produce any caution_spotlight pages")
    sp["interpretation"] = (
        f"{BANNED_FRAMINGS_KO[0]} 이라는 라벨로 다시 풀어 봤어요."
    )
    with pytest.raises(CardnewsSafetyError):
        validate_cardnews_safety(layout)
