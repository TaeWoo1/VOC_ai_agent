"""Seller-PDF quality tests against the run-010 regenerated artifact.

Locks the publishability bar surfaced in the operator's audit:
  - coverage line shows the analyzed corpus count (2029), not the
    snapshot's per-sort count (494)
  - suppressed makeup attribute labels (발색, 색/톤 매칭, 립앤치크 호환성)
    only appear in the methodology metadata footer, NOT in the
    monitoring / priority / appendix tables
  - profile-aware skincare_pad labels surface (패드 밀착력, 촉촉함/마무리감,
    건조감/당김, 용기/집게)
  - interview hooks land under a "리서치 인터뷰 후보" label
  - the regenerated PDF still extracts to text (no rendering crash)
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
RUN = REPO / "outputs" / "2026-04-30_product-83743e299623_run-010"
PDF = RUN / "seller_report" / "seller_report_ko.pdf"


pytest.importorskip("pypdf")


@pytest.fixture(scope="module")
def pdf_text() -> str:
    if not PDF.is_file():
        pytest.skip(f"Regenerated seller PDF missing: {PDF}")
    from pypdf import PdfReader
    reader = PdfReader(str(PDF))
    return "\n".join((p.extract_text() or "") for p in reader.pages)


# ---------------------------------------------------------------------------
# Coverage count
# ---------------------------------------------------------------------------


class TestCoverageCount:
    def test_shows_analyzed_total(self, pdf_text):
        assert "2,029" in pdf_text or "2029" in pdf_text

    def test_does_not_show_per_sort_count(self, pdf_text):
        # The legacy bug surfaced "494" (snapshot's per-sort count)
        # in the §2 coverage line. The fix uses
        # `analysis_report.corpus.n_reviews_analyzed` which is 2029.
        assert "494" not in pdf_text


# ---------------------------------------------------------------------------
# Suppressed-attribute leakage
# ---------------------------------------------------------------------------


METHODOLOGY_LIST_TOKEN = "12개 속성"


class TestSuppressedAttributeLeakage:
    """For a skincare_pad product, the makeup-coded labels must NOT
    appear outside the methodology footer's 12-attribute list."""

    @pytest.mark.parametrize("label", [
        "발색",
        "색/톤 매칭",
        "립앤치크",  # part of "립앤치크 호환성"
        "마스크/옷 묻어남 저항",  # transfer_resistance label
    ])
    def test_suppressed_label_only_in_methodology_list(self, pdf_text, label):
        """Each suppressed makeup label may appear AT MOST once,
        and only in the methodology footer line that documents the
        12 canonical attributes the analyzer scans."""
        occurrences = pdf_text.count(label)
        assert occurrences <= 1, (
            f"{label!r} appears {occurrences} times — should be ≤ 1 "
            f"(methodology list only)"
        )
        if occurrences == 1:
            # Confirm the surviving occurrence is inside the
            # methodology footer's 12-attribute list. Line breaks in
            # the PDF disperse the surrounding tokens, so use a
            # generous 200-char window.
            idx = pdf_text.find(label)
            window = pdf_text[max(0, idx - 200): idx + 200]
            assert METHODOLOGY_LIST_TOKEN in window, (
                f"{label!r} appears outside the methodology list: ...{window}..."
            )


# ---------------------------------------------------------------------------
# Profile-aware label surfacing
# ---------------------------------------------------------------------------


class TestProfileLabelOverrides:
    @pytest.mark.parametrize("label", [
        "패드 밀착력",
        "촉촉함/마무리감",
        "건조감/당김",
        "용기/집게",
        "대용량/가성비",
        "수분 지속감",
    ])
    def test_skincare_pad_label_present(self, pdf_text, label):
        assert label in pdf_text, f"{label!r} missing from seller PDF"


# ---------------------------------------------------------------------------
# Interview hooks (SCAMPER P)
# ---------------------------------------------------------------------------


class TestInterviewHooks:
    def test_research_interview_label_present(self, pdf_text):
        assert "리서치 인터뷰 후보" in pdf_text

    def test_at_least_one_hook_phrase_surfaces(self, pdf_text):
        # The top-2 priority cards in Mediheal's skincare_pad run
        # are packaging_container + adhesion_base_interaction; their
        # interview hooks are "용기/트위저 사용 불편 — …" and
        # "정착력 — 베이스/선크림 위 들뜸 / 밀착 차이". At least one
        # must be present in the regenerated PDF.
        assert (
            "용기/트위저 사용 불편" in pdf_text
            or "정착력 — 베이스/선크림" in pdf_text
            or "도포 직후 건조함" in pdf_text
            or "마무리 텍스처 — 흡수 후" in pdf_text
            or "지속력 후기" in pdf_text
        )


# ---------------------------------------------------------------------------
# Render integrity
# ---------------------------------------------------------------------------


class TestRenderIntegrity:
    def test_pdf_extracts_text(self, pdf_text):
        # Sanity: the rebuilt PDF must produce at least a few KB
        # of extractable text (not a corrupt render).
        assert len(pdf_text) > 2000, f"text len={len(pdf_text)}"

    def test_required_section_headers_present(self, pdf_text):
        for header in (
            "데이터 커버리지 안내",
            "관찰된 사용 패턴",
            "분석 기준",
        ):
            assert header in pdf_text, f"missing header: {header}"

    def test_methodology_disclaimer_kept(self, pdf_text):
        # CLAUDE.md:8 — the interpretation note ("권고하는 자료가
        # 아닙니다 / 검토 후보를 제안합니다") must remain on the PDF.
        assert "권고하는 자료가 아닙니다" in pdf_text \
            or "검토 후보를 제안합니다" in pdf_text


# ---------------------------------------------------------------------------
# Generic phrase removal (partial — full removal needs aggregation
# changes which the user explicitly excluded)
# ---------------------------------------------------------------------------


class TestGenericPhraseReduction:
    """The user's spec listed three legacy generic phrases for
    removal. Some live inside `usage_patterns.py` /
    `segment_patterns.py` which the user explicitly told us NOT to
    modify (aggregation tree). What we CAN guarantee at the
    deterministic-renderer layer:

      - Suppressed-attribute generic phrases vanish (because the
        attribute itself is filtered upstream)
      - Profile-aware labels replace makeup-coded labels in every
        observed-pattern bullet that survives.

    The remaining "잘 맞았다는 의견이 반복적으로 관찰됩니다" patterns
    in §4 segment signals come from `segment_patterns.py` (covered
    by the aggregation no-touch rule) — not in scope for this
    deterministic-renderer pass.
    """

    def test_no_suppressed_attribute_paired_generic(self, pdf_text):
        # `<suppressed_label> 관련 부정 의견` was the leak shape on
        # run-005. After filtering, no such pairings should exist
        # for the 5 suppressed makeup attributes.
        for label in ("발색", "색/톤 매칭", "립앤치크"):
            for token in ("관련 부정 의견", "관련 호평", "관련 의견"):
                pat = f"{label} {token}"
                assert pat not in pdf_text, pat
