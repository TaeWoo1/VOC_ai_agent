"""Run-003 QA pass-4 acceptance tests.

The pass-4 spec lifts the v3 PDF from "auto-generated analysis report"
to "B2B Review Intelligence Business Report" by:
  1. Moving internal metadata (Run ID, goodsNo, OliveYoung review
     corpus, generated_at) off the cover into the Appendix.
  2. Adding a Top 3 Insight block to the executive summary.
  3. Rewriting the caveat in seller-friendly Korean.
  4. Discovering Korean fonts on the local system (Noto / Apple SD
     Gothic Neo / Nanum) so `<b>` tags render as actual bold.
  5. Removing repetitive cardnews lines + 와(과)/은(는)/을(를)
     literals.
"""
from __future__ import annotations

import importlib.util
import io
import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]


def _load_pdf_module():
    name = "generate_phase2e_pdf_v2_pass4"
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(
        name, REPO / "scripts" / "generate_phase2e_pdf_v2.py",
    )
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def _sample_report() -> dict:
    """Same fixture shape as test_business_report_v3.py uses."""
    from tests.test_reporting.test_phase2e.test_business_report_v3 import (  # type: ignore
        _sample_analysis_report,
    )
    return _sample_analysis_report()


def _sample_collection() -> dict:
    from tests.test_reporting.test_phase2e.test_business_report_v3 import (  # type: ignore
        _sample_collection_summary,
    )
    return _sample_collection_summary()


@pytest.fixture(scope="module")
def rendered_pass4_pdf(tmp_path_factory) -> bytes:
    pdf_v2 = _load_pdf_module()
    out_dir = tmp_path_factory.mktemp("br3_pass4")
    out_path = out_dir / "v3_pass4.pdf"
    pdf_v2.render_seller_business_report_v3(
        analysis_report=_sample_report(),
        collection_summary=_sample_collection(),
        out_path=out_path,
        run_id="2026-05-02_run-003-pass4",
        generated_at="2026-05-02T11:00:00Z",
    )
    return out_path.read_bytes()


def _extract_text(pdf_bytes: bytes) -> tuple[str, list[str]]:
    """Return (full_text, per_page_text_list)."""
    from pypdf import PdfReader
    r = PdfReader(io.BytesIO(pdf_bytes))
    pages = [p.extract_text() or "" for p in r.pages]
    return "\n".join(pages), pages


def _split_pre_appendix(full_text: str) -> tuple[str, str]:
    """Slice the rendered PDF text into (pre-appendix, appendix). The
    Appendix legitimately carries Run ID / goodsNo / coverage table
    / 신호 / etc., so QA scans should target the pre-Appendix portion."""
    marker = "7. Appendix"
    idx = full_text.find(marker)
    if idx < 0:
        return full_text, ""
    return full_text[:idx], full_text[idx:]


# ---------------------------------------------------------------------------
# Test 1: first page does not expose internal metadata
# ---------------------------------------------------------------------------


def test_pdf_first_page_does_not_expose_internal_metadata(rendered_pass4_pdf):
    """Run-003 QA pass-4 lock: the first page is for brand readers,
    not operators. Run ID, goodsNo, source URL, generated_at, and the
    "OliveYoung review corpus" label all move to the Appendix."""
    _full, pages = _extract_text(rendered_pass4_pdf)
    page1 = pages[0] if pages else ""
    forbidden_on_page1 = (
        "Run ID",
        "goodsNo",
        "OliveYoung review corpus",
        "수집 시작",
        "발행일",
    )
    for token in forbidden_on_page1:
        assert token not in page1, (
            f"page 1 still exposes internal metadata: {token!r}\n"
            f"page1={page1[:400]!r}"
        )


# ---------------------------------------------------------------------------
# Test 2: PDF body uses seller-friendly terms (no analyst jargon)
# ---------------------------------------------------------------------------


def test_pdf_body_uses_seller_friendly_terms(rendered_pass4_pdf):
    """Body text (sections 1-6) must be free of internal-tool jargon.
    The Appendix is exempt — diagnostic terms like "Run ID" land
    there legitimately.

    Pass-19I: "우선 검토" was the legacy hedge-verdict tail (e.g.
    "우선 검토 후보로 보입니다"). The new Signal Dashboard uses
    "우선 개선 검토 필요" — that's seller action phrasing, NOT
    analyst jargon. The forbidden list now targets the specific
    hedge-tail form the legacy verdict produced.
    """
    full, _pages = _extract_text(rendered_pass4_pdf)
    pre, _ap = _split_pre_appendix(full)
    forbidden = (
        "관찰 신호", "주요 신호", "우선 검토 후보",
        "부정 신호", "긍정 신호",
        "모니터링 후보", "모니터링 후보 신호", "모니터링 가치",
        "신뢰도 낮음", "신뢰도 높음", "신뢰도 보통",
        "안정성 높음", "안정성 보통", "안정성 낮음",
        "관측된 반복 신호",
        "코퍼스 정보가 전달되지 않아",
        "코퍼스",
        "Data Coverage",
        "Reliability",
        "evidence reliability",
        "collection completeness",
        "와(과)", "은(는)", "을(를)",
    )
    hits = [t for t in forbidden if t in pre]
    assert hits == [], f"PDF body leaks analyst-tool jargon: {hits}"


# ---------------------------------------------------------------------------
# Test 3: PDF first page contains seller-focused header + summary
# ---------------------------------------------------------------------------


def test_pdf_contains_seller_focused_first_page(rendered_pass4_pdf):
    """Pass-19I: the first page must surface verdict + decision
    cards. Headers are now: 종합 판정 (verdict line) + Top 2
    strengths + Top 2 frictions + Top 3 actions, plus the
    data-coverage caveat.
    """
    _full, pages = _extract_text(rendered_pass4_pdf)
    page1 = pages[0] if pages else ""
    # Title + product + corpus-size lead.
    assert "Review Intelligence Report" in page1
    assert "Test Pad" in page1  # product name from fixture
    assert "실사용 리뷰" in page1
    assert "건 기반" in page1
    # Executive summary KPI surface.
    assert "1. Executive Summary" in page1
    # Pass-19I cards: at least one of the verdict / Top 2 / Top 3
    # headers must appear on page 1 (the legacy "주요 인사이트" /
    # "가장 강한 만족" headers were replaced by the new structure).
    assert any(h in page1 for h in (
        "종합 판정",
        "잘되고 있는 점",
        "부족한 점",
        "우선 액션",
    )), "no Pass-19I executive-summary card found on page 1"
    # Compact caveat — seller-friendly Korean.
    assert "실제보다 적게 반영" in page1


# ---------------------------------------------------------------------------
# Test 4: Appendix contains the metadata section moved off page 1
# ---------------------------------------------------------------------------


def test_appendix_contains_metadata(rendered_pass4_pdf):
    """Run ID / goodsNo / source URL / generated_at are in the
    Appendix — that's where operator/QA-grade detail lives."""
    full, _pages = _extract_text(rendered_pass4_pdf)
    _pre, appendix = _split_pre_appendix(full)
    assert "Run ID" in appendix
    assert "goodsNo" in appendix
    # The collection-state subsection is in the appendix too.
    assert "수집 상태 요약" in appendix or "리뷰 표본 범위" in appendix


# ---------------------------------------------------------------------------
# Test 5: Korean font registration discovered + bold variant present
# ---------------------------------------------------------------------------


class TestKoreanFontRegistration:
    def test_discover_returns_a_name(self):
        from src.voc.reporting.phase2e.korean_fonts import (
            discover_korean_font_family,
        )
        r = discover_korean_font_family()
        assert isinstance(r, dict)
        assert isinstance(r.get("name"), str) and r["name"]
        # Either a real Korean font was found (preferred) OR the
        # function fell back gracefully to the CID font. Both are
        # acceptable — what's NOT acceptable is a crash.
        assert r.get("source") in {
            "NotoSansKR", "NotoSansCJK-KR", "AppleSDGothicNeo",
            "NanumGothic", "fallback",
        }

    def test_fallback_does_not_crash_pdf_render(self, tmp_path):
        """Even if no Korean font is installed, render must produce a
        valid PDF byte stream."""
        pdf_v2 = _load_pdf_module()
        out_path = tmp_path / "fallback_smoke.pdf"
        pdf_v2.render_seller_business_report_v3(
            analysis_report=_sample_report(),
            collection_summary=_sample_collection(),
            out_path=out_path, run_id="rid", generated_at="ts",
        )
        b = out_path.read_bytes()
        assert b.startswith(b"%PDF-")
        assert b"%%EOF" in b[-32:]

    def test_styles_use_bold_when_family_registered(self):
        """When a Bold variant was registered, the heading
        ParagraphStyles must reference it (so `<b>...</b>` HTML
        tags render as actual bold)."""
        pdf_v2 = _load_pdf_module()
        styles = pdf_v2._br3_styles()
        bold_name = pdf_v2.KOREAN_FONT_BOLD or pdf_v2.KOREAN_FONT
        assert styles["report_title"].fontName == bold_name
        assert styles["section_h1"].fontName == bold_name
        assert styles["kpi_value"].fontName == bold_name


# ---------------------------------------------------------------------------
# Test 6: cardnews body has no repeated boilerplate
# ---------------------------------------------------------------------------


def test_cardnews_body_not_repetitive():
    """Run-003 QA pass-4: the loved_point closing line ("여러 사용자가
    비슷한 결의 좋았던 점을 짚어 줍니다") was repeated verbatim across
    every loved_point slide. The new closings rotate, so the same
    sentence cannot appear twice."""
    from src.voc.content.cardnews_buyer_journey import (
        build_buyer_journey_cardnews,
    )
    cn = build_buyer_journey_cardnews(_sample_report())
    bodies: list[str] = []
    for s in cn["slides"]:
        for line in s.get("body_lines") or []:
            bodies.append(line)
    # No body line should repeat verbatim 2+ times across the deck.
    counts: dict[str, int] = {}
    for line in bodies:
        counts[line] = counts.get(line, 0) + 1
    repeats = {k: v for k, v in counts.items() if v >= 2}
    assert repeats == {}, (
        f"cardnews body has repeated lines: {repeats}"
    )


def test_cardnews_no_dup_aswiwoom_phrase():
    """display_text in checkpoint slides must not contain the
    "...아쉬움 ... 아쉬움 의견" duplication that the report-summary
    helper was designed to avoid."""
    from src.voc.content.cardnews_buyer_journey import (
        build_buyer_journey_cardnews,
    )
    cn = build_buyer_journey_cardnews(_sample_report())
    for s in cn["slides"]:
        for q in s.get("evidence_quotes") or []:
            disp = q.get("display_text") or ""
            assert disp.count("아쉬움") < 2, (
                f"slide #{s.get('index')} ({s.get('type')}) leaks "
                f"...아쉬움...아쉬움 duplication: {disp!r}"
            )


def test_cardnews_no_particle_fallback_literal():
    """The cardnews body must use the grammar-correct 과/와 / 은/는 /
    을/를 directly. Literal "와(과)" / "은(는)" / "을(를)" reads as
    machine-generated."""
    from src.voc.content.cardnews_buyer_journey import (
        build_buyer_journey_cardnews,
    )
    cn = build_buyer_journey_cardnews(_sample_report())
    for s in cn["slides"]:
        title = s.get("title", "")
        body = " ".join(s.get("body_lines") or [])
        for forbidden in ("와(과)", "은(는)", "을(를)"):
            assert forbidden not in title, (
                f"slide #{s.get('index')} title leaks {forbidden!r}: "
                f"{title!r}"
            )
            assert forbidden not in body, (
                f"slide #{s.get('index')} body leaks {forbidden!r}: "
                f"{body!r}"
            )


# ---------------------------------------------------------------------------
# Test 7: forbidden math symbols absent from rendered PDF
# ---------------------------------------------------------------------------


def test_forbidden_symbols_absent(rendered_pass4_pdf):
    from src.voc.content.reader_friendly_wording import (
        FORBIDDEN_SYMBOLS, scan_forbidden_symbols,
    )
    full, _pages = _extract_text(rendered_pass4_pdf)
    hits = scan_forbidden_symbols(full)
    assert hits == [], (
        f"PDF body still contains forbidden math symbols: {hits} "
        f"(must be empty per Run-003 QA pass-4)"
    )


# ---------------------------------------------------------------------------
# Test 8: korean text renders without tofu / □
# ---------------------------------------------------------------------------


def test_korean_text_extractable_no_tofu(rendered_pass4_pdf):
    """If a font fails to embed Hangul, pypdf surfaces tofu (□) or
    drops the glyph entirely. Verify a known Hangul fragment from
    the report is still extractable."""
    full, _pages = _extract_text(rendered_pass4_pdf)
    # The product name has Hangul; assert at least the first chars
    # appear in extracted text. If they don't, the font fell through
    # without rendering Hangul correctly.
    assert "촉촉함" in full, (
        "Korean glyph 촉촉함 missing from extracted text — font "
        "registration may have failed."
    )
    assert "리뷰" in full
    # No literal □ tofu glyph.
    assert "□" not in full
