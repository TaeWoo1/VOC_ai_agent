"""Tests guarding against fragile glyphs in PDF-bound strings.

Background
----------
On systems whose Korean CID font lacks a glyph for a particular
Western symbol, reportlab silently substitutes - and the substitution
often renders as an "integral-like" mystery glyph in the resulting PDF.
The most reliable defense is to never feed those characters into the
renderer in the first place.

This module enforces two invariants:

  1. Module-level locked-string constants in `generate_phase2e_pdf_v2.py`
     do NOT contain any banned glyphs.
  2. Module-level locked-string constants in the imported phase2e
     helpers (`snapshots`, `usage_patterns`, `recommendations`,
     `impact`) do NOT contain any banned glyphs either - the renderer
     prints these verbatim.

Banned set
----------
- ●  (U+25CF, Black Circle) - bullet substitution unreliable
- ·  (U+00B7, Middle Dot)   - reads as period in some Korean fonts
- —  (U+2014, Em Dash)      - inconsistent width / fallback risk
- ⚠  (U+26A0, Warning Sign) - emoji range, often missing in CID
- &nbsp; (HTML entity)      - U+00A0 fallback; word wrap fights it
- U+00A0 itself              - same

Allowed symbols
---------------
- → (U+2192, Rightwards Arrow) - normally present in Adobe-Korea-1
  CID; if a real PDF shows fallback boxes, ban it here too.
- ★ (U+2605, Black Star)       - present in Adobe-Korea-1; used for
  rating display.
- "->" ASCII pair               - safe everywhere.
- "-" ASCII hyphen-minus        - safe everywhere.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


REPO = Path(__file__).resolve().parents[3]


BANNED_GLYPHS: tuple[str, ...] = (
    "●",
    "·",
    "—",
    "⚠",
    " ",   # non-breaking space (would-be NBSP literal)
)
BANNED_HTML_ENTITIES: tuple[str, ...] = (
    "&nbsp;",
)


def _load_pdf_module():
    name = "generate_phase2e_pdf_v2_glyph_test"
    if name in sys.modules:
        return sys.modules[name]
    path = REPO / "scripts" / "generate_phase2e_pdf_v2.py"
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


# ---------------------------------------------------------------------------
# Locked module-level constants in the renderer itself
# ---------------------------------------------------------------------------


def _check_string_for_banned_glyphs(label: str, value: str) -> None:
    for g in BANNED_GLYPHS:
        assert g not in value, \
            f"banned glyph {g!r} (U+{ord(g):04X}) in {label}: {value!r}"
    for ent in BANNED_HTML_ENTITIES:
        assert ent not in value, \
            f"banned HTML entity {ent!r} in {label}: {value!r}"


def test_renderer_locked_constants_have_no_banned_glyphs():
    """The module-level Korean phrase constants in the PDF generator
    feed directly into rendered Paragraphs - any banned glyph here
    would surface in every report."""
    pdf_v2 = _load_pdf_module()
    locked = {
        "HERO_TITLE_KO": pdf_v2.HERO_TITLE_KO,
        "HERO_VALUE_STATEMENT_KO": pdf_v2.HERO_VALUE_STATEMENT_KO,
        "DATA_COVERAGE_OBSERVED_KO": pdf_v2.DATA_COVERAGE_OBSERVED_KO,
        "DATA_COVERAGE_FULL_CORPUS_KO": pdf_v2.DATA_COVERAGE_FULL_CORPUS_KO,
        "DATA_COVERAGE_INCREMENTAL_KO": pdf_v2.DATA_COVERAGE_INCREMENTAL_KO,
    }
    for label, value in locked.items():
        _check_string_for_banned_glyphs(label, value)


def test_internal_check_questions_have_no_banned_glyphs():
    pdf_v2 = _load_pdf_module()
    for attr, questions in pdf_v2.INTERNAL_CHECK_QUESTIONS_KO.items():
        for i, q in enumerate(questions):
            _check_string_for_banned_glyphs(
                f"INTERNAL_CHECK_QUESTIONS_KO[{attr}][{i}]", q,
            )


def test_impact_framings_have_no_banned_glyphs():
    pdf_v2 = _load_pdf_module()
    for attr, framings in pdf_v2.IMPACT_FRAMING_KO.items():
        for i, f in enumerate(framings):
            _check_string_for_banned_glyphs(
                f"IMPACT_FRAMING_KO[{attr}][{i}].category_ko",
                f.category_ko,
            )
            _check_string_for_banned_glyphs(
                f"IMPACT_FRAMING_KO[{attr}][{i}].sentence_ko",
                f.sentence_ko,
            )


# ---------------------------------------------------------------------------
# Locked constants imported from sibling phase2e modules
# ---------------------------------------------------------------------------


def test_snapshot_locked_phrases_have_no_banned_glyphs():
    from src.voc.reporting.phase2e import snapshots
    locked = {
        "COVERAGE_WARNING_KO": snapshots.COVERAGE_WARNING_KO,
        "INCOMPARABLE_SORT_REASON_KO": snapshots.INCOMPARABLE_SORT_REASON_KO,
        "INCOMPARABLE_CAP_REASON_KO": snapshots.INCOMPARABLE_CAP_REASON_KO,
        "INCOMPARABLE_CORPUS_TYPE_REASON_KO":
            snapshots.INCOMPARABLE_CORPUS_TYPE_REASON_KO,
        "INCOMPARABLE_STRATEGY_REASON_KO":
            snapshots.INCOMPARABLE_STRATEGY_REASON_KO,
        "INCOMPARABLE_SAMPLE_SIZE_REASON_KO":
            snapshots.INCOMPARABLE_SAMPLE_SIZE_REASON_KO,
        "NON_PRIMARY_SORT_REASON_KO": snapshots.NON_PRIMARY_SORT_REASON_KO,
        "LOW_CONFIDENCE_DIRECTIONAL_RISING_KO":
            snapshots.LOW_CONFIDENCE_DIRECTIONAL_RISING_KO,
        "LOW_CONFIDENCE_DIRECTIONAL_IMPROVING_KO":
            snapshots.LOW_CONFIDENCE_DIRECTIONAL_IMPROVING_KO,
        "LOW_CONFIDENCE_ACTION_CHIP_KO":
            snapshots.LOW_CONFIDENCE_ACTION_CHIP_KO,
        "STABILITY_VERDICT_HIGH_KO": snapshots.STABILITY_VERDICT_HIGH_KO,
        "STABILITY_VERDICT_MEDIUM_KO": snapshots.STABILITY_VERDICT_MEDIUM_KO,
        "STABILITY_VERDICT_LOW_KO": snapshots.STABILITY_VERDICT_LOW_KO,
    }
    for label, value in locked.items():
        _check_string_for_banned_glyphs(label, value)


def test_recommendations_phrases_have_no_banned_glyphs():
    from src.voc.reporting.phase2e import recommendations
    for attr, phrase in recommendations.RECOMMENDATIONS_KO.items():
        _check_string_for_banned_glyphs(
            f"RECOMMENDATIONS_KO[{attr}]", phrase,
        )


def test_impact_module_phrases_have_no_banned_glyphs():
    from src.voc.reporting.phase2e import impact
    for attr, phrase in impact.IMPACTS_KO.items():
        _check_string_for_banned_glyphs(f"IMPACTS_KO[{attr}]", phrase)
    if hasattr(impact, "BUSINESS_IMPACT_KO"):
        for attr, biz in impact.BUSINESS_IMPACT_KO.items():
            for field_name in ("revenue_ko", "churn_ko", "cs_cost_ko"):
                v = getattr(biz, field_name, None)
                if v:
                    _check_string_for_banned_glyphs(
                        f"BUSINESS_IMPACT_KO[{attr}].{field_name}", v,
                    )


def test_usage_patterns_module_constants_have_no_banned_glyphs():
    from src.voc.reporting.phase2e import usage_patterns
    for bucket_key, (tokens, label) in (
        usage_patterns.USAGE_CONTEXT_BUCKETS_KO.items()
    ):
        _check_string_for_banned_glyphs(
            f"USAGE_CONTEXT_BUCKETS_KO[{bucket_key}].label", label,
        )
        for i, t in enumerate(tokens):
            _check_string_for_banned_glyphs(
                f"USAGE_CONTEXT_BUCKETS_KO[{bucket_key}].token[{i}]", t,
            )


# ---------------------------------------------------------------------------
# Sentinel test - confirms the banned set actually catches a violation
# ---------------------------------------------------------------------------


def test_check_helper_flags_a_known_violation():
    import pytest as _pytest
    with _pytest.raises(AssertionError):
        _check_string_for_banned_glyphs("test", "hello ● world")
    with _pytest.raises(AssertionError):
        _check_string_for_banned_glyphs("test", "left—right")
    with _pytest.raises(AssertionError):
        _check_string_for_banned_glyphs("test", "with &nbsp; entity")
    with _pytest.raises(AssertionError):
        _check_string_for_banned_glyphs("test", "non break")
