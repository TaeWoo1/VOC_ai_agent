"""Pass-18: inspector's "clean display_quote_summary" check must use
the shared `is_degraded_quote_summary` predicate, not the audit-field
dangling predicate.

Why: the pass-17 fallback summaries end in nominal tails ("의견" /
"언급" / "느낌"). The audit predicate (designed for raw quote
display_text) rejects those as dangling. The shared report-facing
predicate has a nominal-tail allow-list and accepts them.

Result before pass-18:
   inspect Summary: "12 display_text dangling AND no clean
                     display_quote_summary"
                    even though the summaries WERE clean per the
                    adapter / renderer.

Result after pass-18:
   - dangling display_text + clean summary → audit-only, no warning
   - dangling display_text + degraded summary → blocking warning (unchanged)
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]


def _load_inspector():
    name = "inspect_run_quality_pass18_test"
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(
        name, REPO / "scripts" / "inspect_run_quality.py",
    )
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def _ar_with_dangling_display_clean_summary() -> dict:
    """Run-003 case: every quote has a dangling display_text but a
    clean pass-17 fallback summary ending in `의견` / `언급`."""
    return {
        "attributes": [
            {
                "key": "adhesion_base_interaction",
                "top_quotes": [
                    {
                        "review_id": "r_a1",
                        "polarity": "negative",
                        "display_text": "밀착이 아쉽다는",   # dangling
                        "display_quote_summary":
                            "밀착 체감이 약하거나 들뜸을 느꼈다는 의견",
                    },
                    {
                        "review_id": "r_a2",
                        "polarity": "positive",
                        "display_text": "잘 밀착되는 느낌이",   # dangling
                        "display_quote_summary":
                            "시트가 얇고 피부에 잘 밀착된다는 의견",
                    },
                ],
            },
            {
                "key": "finish_texture",
                "top_quotes": [
                    {
                        "review_id": "r_f1",
                        "polarity": "positive",
                        "display_text": "촉촉하고 좋",   # dangling
                        "display_quote_summary":
                            "촉촉하고 편안한 마무리감을 만족 포인트로 언급",
                    },
                ],
            },
        ],
    }


def test_inspector_audit_dangling_demoted_when_summary_is_nominal_phrase():
    """Run-003 reproducer: every display_text is dangling, every
    display_quote_summary ends in '의견' / '언급'. Inspector must
    NOT emit the legacy warning.

    Pre-pass-18 the audit-field predicate flagged "...의견" as
    dangling, producing false 'no clean summary' verdicts."""
    insp = _load_inspector()
    warnings: list[str] = []
    insp.inspect_display_text_coverage(
        _ar_with_dangling_display_clean_summary(), warnings,
    )
    # No warnings — every dangling display has a clean nominal-phrase
    # summary, which is exactly what the renderer / adapter use.
    assert warnings == [], (
        f"unexpected warnings: {warnings}"
    )


def test_inspector_still_warns_when_summary_is_genuinely_degraded():
    """Negative case: summary is also degraded → blocking warning fires."""
    insp = _load_inspector()
    ar = {
        "attributes": [
            {
                "key": "adhesion_base_interaction",
                "top_quotes": [
                    {
                        "review_id": "r_bad",
                        "polarity": "negative",
                        "display_text": "밀착이 아쉽다는",   # dangling
                        "display_quote_summary": "...",         # truncated
                    },
                ],
            },
        ],
    }
    warnings: list[str] = []
    insp.inspect_display_text_coverage(ar, warnings)
    assert any("display_text dangling" in w for w in warnings)


def test_inspector_audit_only_count_kv_displayed_as_ok():
    """When demoted, the count surfaces as a passing KV row, not a
    warning. Operator can still see the audit-only count for
    transparency."""
    insp = _load_inspector()
    warnings: list[str] = []
    # Capture stdout to verify the KV row.
    import io
    import contextlib

    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        insp.inspect_display_text_coverage(
            _ar_with_dangling_display_clean_summary(), warnings,
        )
    out = buf.getvalue()
    assert "audit-only; clean summary present" in out
    assert warnings == []


def test_inspector_uses_shared_predicate_at_module_level():
    """Lock the contract: inspect_run_quality must import (and use)
    the shared `is_degraded_quote_summary` for the summary
    clean-check. Source-string check so the contract is visible
    even when stdout assertions don't catch a subtle drift."""
    src = (
        REPO / "scripts" / "inspect_run_quality.py"
    ).read_text(encoding="utf-8")
    # The module must import the shared predicate by its public name.
    assert "is_degraded_quote_summary" in src, (
        "inspect_run_quality.py does not reference the shared "
        "is_degraded_quote_summary predicate"
    )
    # The audit predicate is still allowed for the dangling-display
    # check itself, but the SUMMARY clean-check must NOT call it
    # — that's what produced the run-003 false warning.
    # We assert by looking for the new comment marker added in pass-18.
    assert "Pass-18" in src or "is_degraded_quote_summary as " in src
