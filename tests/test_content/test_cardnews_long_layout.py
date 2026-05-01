"""Long-form cardnews layout tests.

Goldens-against-snapshot: build the layout from a real persisted
analysis_report.json and assert structural + safety contracts.
The test does not depend on Playwright.
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
# Structural contract
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
        "generated_at",
    ):
        assert key in layout, f"missing top-level field: {key}"


def test_language_field_is_ko_at_root_and_every_page(layout: dict) -> None:
    assert layout["language"] == "ko"
    for p in layout["pages"]:
        assert p["language"] == "ko", f"page {p['index']} language={p.get('language')}"


def test_page_count_within_band_for_rich_corpus(layout: dict) -> None:
    # v1.2 dropped per-attribute fan-out and added the signature page;
    # the deck is now 9 fixed pages for any corpus with at least one
    # qualifying attribute. Allow 8..10 to absorb future tweaks.
    assert 8 <= layout["page_count"] <= 10
    assert layout["page_count"] == len(layout["pages"])


def test_page_order_locked(layout: dict) -> None:
    """v1.2 narrative flow — locked.

    1. cover  2. hook  3. loved  4. divides  5. signature
    6. checkpoints  7. audience  8. method  9. cta

    Method moved from index 3 → index 8 (compact, supports trust
    without interrupting opening momentum). Caution_attr / positive_attr
    fan-out removed. Signature added at index 5.
    """
    page_types = [p["type"] for p in layout["pages"]]
    assert page_types[0] == "cover"
    assert page_types[1] == "hook"
    assert page_types[2] == "loved"
    assert page_types[3] == "divides"
    assert page_types[4] == "signature"
    assert page_types[5] == "checkpoints"
    assert page_types[6] == "audience"
    assert page_types[7] == "method"
    assert page_types[-1] == "cta"


def test_page_indices_are_one_based_contiguous(layout: dict) -> None:
    for i, p in enumerate(layout["pages"], start=1):
        assert p["index"] == i


# ---------------------------------------------------------------------------
# Char-budget contract
# ---------------------------------------------------------------------------


def test_titles_within_budget_or_truncated(layout: dict) -> None:
    # Cover & cta titles exceed the slide-title budget (we use a wider
    # cap there); content/attr pages must obey it.
    for p in layout["pages"]:
        if p["type"] in ("cover", "cta"):
            continue
        title = p.get("title") or ""
        assert len(title) <= max(SLIDE_TITLE_MAX_CHARS_KO, 14) + 4, (
            f"page {p['index']} ({p['type']}) title too long: {title!r}"
        )


def test_bullets_within_budget(layout: dict) -> None:
    for p in layout["pages"]:
        for b in p.get("bullets") or []:
            assert len(b) <= BULLET_MAX_CHARS_KO + 1, (
                f"page {p['index']} bullet too long ({len(b)} chars): {b!r}"
            )


# ---------------------------------------------------------------------------
# Evidence sanitization + audit fidelity contract
# ---------------------------------------------------------------------------


def test_caution_pages_use_sanitized_phrases_not_quotes(
    layout: dict, sample_report: dict
) -> None:
    """Public evidence_phrase_ko must come from EVIDENCE_PHRASE_KO,
    NOT from a verbatim review_id quote. v1.2 dropped per-attribute
    caution_attr fan-out, so this test now skips when no qualifying
    page exists; if a future layout reintroduces caution_attr, the
    contract still applies."""
    seen = False
    for p in layout["pages"]:
        if p["type"] != "caution_attr":
            continue
        seen = True
        public_phrase = p.get("evidence_phrase_ko") or ""
        raw = (p.get("audit") or {}).get("evidence_span_raw")
        if raw:
            assert public_phrase != raw, (
                f"page {p['index']} leaks verbatim quote to evidence_phrase_ko"
            )
    # Skipping is OK in v1.2 — defense remains for any future revival.
    _ = seen


def test_audit_evidence_span_matches_a_real_quote(
    layout: dict, sample_report: dict
) -> None:
    """When a caution_attr page is present its audit.evidence_span_raw
    must byte-match a real top_negative_quotes[].text from the source
    analysis_report. v1.2 doesn't emit caution_attr by default; the
    test stays in place to defend the audit-fidelity contract for any
    future layout that revives the per-attribute fan-out."""
    raw_quotes_by_attr: dict[str, set[str]] = {}
    for entry in sample_report.get("monitoring_candidates") or []:
        key = entry.get("attribute_key") or ""
        texts = {
            (q.get("text") or "")
            for q in (entry.get("top_negative_quotes") or [])
            if q.get("text")
        }
        if key and texts:
            raw_quotes_by_attr[key] = texts

    for p in layout["pages"]:
        if p["type"] != "caution_attr":
            continue
        attr = p.get("attribute_key")
        raw = (p.get("audit") or {}).get("evidence_span_raw")
        if not raw or not attr:
            continue
        assert raw in raw_quotes_by_attr.get(attr, set()), (
            f"page {p['index']} audit.evidence_span_raw doesn't match a real "
            f"top_negative_quotes entry for attribute {attr!r}"
        )


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
    # Should NOT raise.
    validate_cardnews_safety(layout)


def test_safety_validator_catches_planted_banned_phrase(layout: dict) -> None:
    """Inject a banned phrase into a public field and confirm the
    validator flags it. Defense against future regressions."""
    poisoned = json.loads(json.dumps(layout))
    # v1.1 dropped the legacy `bullets` field; poison a field that is
    # both present on every layout and inside the validator's text
    # allowlist (cover.subtitle).
    cover = next(p for p in poisoned["pages"] if p["type"] == "cover")
    cover["subtitle"] = "이건 광고에 속지 마세요 같은 클릭베이트입니다"
    with pytest.raises(CardnewsSafetyError):
        validate_cardnews_safety(poisoned)


def test_evidence_phrase_table_covers_every_attribute_in_report(
    layout: dict, sample_report: dict
) -> None:
    """When a per-attribute spotlight page is present (legacy v1.1
    fan-out OR future revival), its evidence_phrase_ko must be
    non-empty. v1.2 doesn't emit such pages by default; the test stays
    so a regression that adds them with empty phrases would still
    fail."""
    for p in layout["pages"]:
        if p["type"] not in ("caution_attr", "positive_attr"):
            continue
        key = p.get("attribute_key") or ""
        polarity = "caution" if p["type"] == "caution_attr" else "positive"
        assert (p.get("evidence_phrase_ko") or "").strip(), (
            f"page {p['index']} ({polarity}/{key}) emitted empty evidence_phrase_ko"
        )


def test_fanout_respects_min_count_floor(layout: dict, sample_report: dict) -> None:
    """When per-attribute spotlight pages are emitted, they must
    respect the n>=5 floor. v1.2 doesn't emit them, so this test
    no-ops for the current layout. Test stays as a guard for future
    revivals of fan-out."""
    counts_by_attr = {
        a["key"]: a for a in (sample_report.get("attributes") or [])
    }
    for p in layout["pages"]:
        if p["type"] == "caution_attr":
            attr = counts_by_attr.get(p["attribute_key"]) or {}
            assert (attr.get("n_negative") or 0) >= 5, (
                f"caution_attr fan-out for {p['attribute_key']} below n>=5 floor"
            )
        elif p["type"] == "positive_attr":
            attr = counts_by_attr.get(p["attribute_key"]) or {}
            assert (attr.get("n_positive") or 0) >= 5, (
                f"positive_attr fan-out for {p['attribute_key']} below n>=5 floor"
            )


def test_signature_page_has_editorial_payload(layout: dict) -> None:
    """v1.2 — the signature page must carry a non-empty headline,
    context paragraph, and 2 aside items (왜 / 누가). It's the deck's
    editorial centerpiece; an empty signature page is a regression."""
    sig = next((p for p in layout["pages"] if p["type"] == "signature"), None)
    assert sig is not None, "v1.2 layout must include a signature page"
    assert (sig.get("headline") or "").strip(), "signature.headline empty"
    assert (sig.get("lead") or "").strip(), "signature.lead (context) empty"
    asides = sig.get("aside_items") or []
    assert len(asides) == 2, f"signature should have 2 asides, got {len(asides)}"
    for a in asides:
        assert (a.get("label") or "").strip()
        assert (a.get("note") or "").strip()


def test_cta_has_single_primary_action(layout: dict) -> None:
    """v1.2 — CTA reduced to one primary action (was 3 in v1.1)."""
    cta = next(p for p in layout["pages"] if p["type"] == "cta")
    actions = cta.get("actions") or []
    assert len(actions) == 1, (
        f"v1.2 CTA must carry exactly 1 action, got {len(actions)}"
    )


# ---------------------------------------------------------------------------
# Disclosure + image schema
# ---------------------------------------------------------------------------


def test_method_page_carries_disclosure(layout: dict) -> None:
    method = next(p for p in layout["pages"] if p["type"] == "method")
    assert (method.get("disclosure") or "").strip(), "method page missing disclosure"


def test_cta_page_carries_disclosure_and_url(layout: dict) -> None:
    cta = next(p for p in layout["pages"] if p["type"] == "cta")
    assert (cta.get("disclosure") or "").strip()
    # v1.1: the source URL is preserved in audit metadata for the
    # manifest, but never rendered on the public CTA surface.
    assert "source_url" not in cta
    audit_url = (cta.get("audit") or {}).get("source_url") or ""
    assert audit_url.startswith("https://")
    # CTA must offer Instagram-native actions (save / comment / request)
    # rather than a click-out URL.
    assert isinstance(cta.get("actions"), list) and len(cta["actions"]) >= 1


def test_product_image_descriptor_always_present(layout: dict) -> None:
    pi = layout["product_image"]
    assert pi["source"] in (
        "cli_path", "cli_url", "analysis_report", "fallback_gradient",
    )
    assert pi["usage"] == "cover_full_bleed"
    assert "url" in pi and "local_path" in pi


# ---------------------------------------------------------------------------
# v2.0 — content_plan-driven flow
# ---------------------------------------------------------------------------


def test_layout_v2_default_path_calls_planner_in_mock_mode(
    sample_report: dict,
) -> None:
    """build_long_cardnews_layout(report) without a content_plan should
    still produce a valid 9-page deck — the layout calls the planner
    in mock mode internally."""
    layout = build_long_cardnews_layout(sample_report)
    assert layout["schema_version"] == "2.0"
    assert layout["page_count"] == 9
    # Plan hash present for audit
    assert "content_plan_sha256" in layout
    assert len(layout["content_plan_sha256"]) == 64


def test_layout_v2_accepts_external_content_plan(sample_report: dict) -> None:
    """The preferred flow: caller builds plan first, layout consumes it."""
    plan = build_content_plan(sample_report)
    layout = build_long_cardnews_layout(sample_report, content_plan=plan)
    # The cover headline on the page must equal the plan's cover headline
    cover = next(p for p in layout["pages"] if p["type"] == "cover")
    assert cover["headline"] == plan["cover"]["headline"]
    sig = next(p for p in layout["pages"] if p["type"] == "signature")
    assert sig["attribute_key"] == plan["signature"]["attribute_key"]
    assert sig["headline"] == plan["signature"]["headline"]
    cta = next(p for p in layout["pages"] if p["type"] == "cta")
    assert cta["title"] == plan["cta"]["headline"]


def test_layout_v2_audit_attached_to_signature_page(sample_report: dict) -> None:
    """Even with content_plan-driven copy, the layout should attach an
    audit dict to the signature page so the operator can trace any
    visible signal back to a verbatim review row."""
    layout = build_long_cardnews_layout(sample_report)
    sig = next(p for p in layout["pages"] if p["type"] == "signature")
    audit = sig.get("audit") or {}
    # Mediheal corpus is rich enough that signature has a real audit
    assert "evidence_review_id_truncated" in audit or "evidence_span_raw" in audit


def test_layout_v2_page_record_shape_unchanged(sample_report: dict) -> None:
    """Templates are stable across v1.2 → v2.0 — the field names every
    template reads must still be present."""
    layout = build_long_cardnews_layout(sample_report)
    by_type = {p["type"]: p for p in layout["pages"]}

    assert {"chip", "title", "headline", "subtitle", "chip_strip", "product_image"} <= set(by_type["cover"])
    assert {"chip", "title", "lead_line", "supporting_lines", "mini_metrics", "note"} <= set(by_type["hook"])
    assert {"chip", "title", "subtitle", "ranked_items"} <= set(by_type["loved"])
    assert {"chip", "title", "subtitle", "comparison_items"} <= set(by_type["divides"])
    assert {"chip", "headline", "subtitle", "lead", "aside_items"} <= set(by_type["signature"])
    assert {"chip", "title", "subtitle", "numbered_items"} <= set(by_type["checkpoints"])
    assert {"chip", "title", "subtitle", "fit_items", "consider_items"} <= set(by_type["audience"])
    assert {"chip", "title", "subtitle", "mini_cards", "note", "disclosure"} <= set(by_type["method"])
    assert {"chip", "title", "lead", "actions", "disclosure"} <= set(by_type["cta"])


def test_layout_v2_renders_synthetic_unknown_attribute_report() -> None:
    """The whole point of v2.0: ANY product (not just the 12 canonical
    Phase 2E attribute keys) produces a valid, safety-clean layout."""
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
    validate_cardnews_safety(layout)  # no raise
    assert layout["page_count"] == 9
    sig = next(p for p in layout["pages"] if p["type"] == "signature")
    assert sig["attribute_key"] in {"scent_longevity", "projection_radius"}
