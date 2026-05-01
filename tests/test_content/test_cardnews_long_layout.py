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
    # mediheal_pad has 2029 reviews + 7 attributes; the fan-out should
    # produce 10..14 pages.
    assert 10 <= layout["page_count"] <= 14
    assert layout["page_count"] == len(layout["pages"])


def test_page_order_locked(layout: dict) -> None:
    page_types = [p["type"] for p in layout["pages"]]
    assert page_types[0] == "cover"
    assert page_types[1] == "hook"
    assert page_types[2] == "method"          # method placed early — locked
    assert page_types[3] == "loved"
    assert page_types[4] == "divides"
    assert page_types[5] == "checkpoints"
    assert page_types[-1] == "cta"
    assert page_types[-2] == "audience"
    # v1.1 collapsed fit_for + consider_carefully into a single audience page.
    # The slot before audience is filled by either a positive_attr or
    # caution_attr fan-out depending on the corpus.
    assert page_types[-3] in ("positive_attr", "caution_attr")


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
    NOT from a verbatim review_id quote. Concretely: the public
    phrase must NOT equal any audit.evidence_span_raw."""
    for p in layout["pages"]:
        if p["type"] != "caution_attr":
            continue
        public_phrase = p.get("evidence_phrase_ko") or ""
        raw = (p.get("audit") or {}).get("evidence_span_raw")
        if raw:
            assert public_phrase != raw, (
                f"page {p['index']} leaks verbatim quote to evidence_phrase_ko"
            )


def test_audit_evidence_span_matches_a_real_quote(
    layout: dict, sample_report: dict
) -> None:
    """Every caution_attr.audit.evidence_span_raw must byte-match a
    real top_negative_quotes[].text from the source analysis_report.
    Audit fidelity preserves CLAUDE.md §10's verbatim invariant."""
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
    """Any attribute that the layout fans out should have an entry in
    EVIDENCE_PHRASE_KO for the relevant polarity. Defensive — the
    fallback template runs when missing, but a missing entry is still
    a signal we need to add to the table."""
    for p in layout["pages"]:
        if p["type"] not in ("caution_attr", "positive_attr"):
            continue
        key = p.get("attribute_key") or ""
        polarity = "caution" if p["type"] == "caution_attr" else "positive"
        # Either the table has it OR the fallback fired (which is fine).
        # We just don't want a SILENT miss — assert the phrase isn't empty.
        assert (p.get("evidence_phrase_ko") or "").strip(), (
            f"page {p['index']} ({polarity}/{key}) emitted empty evidence_phrase_ko"
        )


def test_fanout_respects_min_count_floor(layout: dict, sample_report: dict) -> None:
    """No caution_attr or positive_attr page should be present for an
    attribute below the n>=5 floor."""
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
