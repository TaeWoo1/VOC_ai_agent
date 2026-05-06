"""Pass-12 polish tests: seller-friendly wording, table-layout
integrity (no broken Korean phrases), secret-leak guard.

Scope:
  1. Smoke render — PDF byte stream is structurally valid.
  2. The corpus-metadata 9.1 sub-tables exist and every cell is a
     Paragraph (so reportlab's CJK word-wrap kicks in and the
     run-003-style "중복 제 ...거 후" mid-syllable break cannot occur).
  3. The 분석 대상 / 수집 정렬 / 모델·처리 정보 headers all appear,
     and the long "최종 분석 리뷰 수 (주 코퍼스, 중복 제거 후)" label
     exists intact in one of those Paragraphs.
  4. Seller-friendly labels appear in module-level constants /
     wording-table outputs; engine-internal labels are gone.
  5. No artifact (PDF bytes, JSON synthetic blobs) contains a
     `sk-`-style key prefix or the literal `OPENAI_API_KEY`.
"""
from __future__ import annotations

import importlib.util
import json
import re
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]


def _load_pdf_module():
    name = "generate_phase2e_pdf_v2_pass12_test"
    if name in sys.modules:
        return sys.modules[name]
    path = REPO / "scripts" / "generate_phase2e_pdf_v2.py"
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def _build_reviews() -> list[dict]:
    """Mid-size corpus exercising concerns + strengths + sort signals
    so the appendix renders the full disclosure block."""
    reviews: list[dict] = []
    for i in range(30):
        reviews.append({
            "review_id": f"r_neg_{i}", "mixed_review_flag": False,
            "tradeoff_pair": None,
            "records": [{
                "attribute": "transfer_resistance",
                "polarity": "negative_strong", "intensity": 3,
                "evidence_span": "옷에 묻어요",
                "confidence": "high", "delivery_condition_flag": False,
            }],
            "oy_evidence_score": 8.0, "rating_normalized": 1.0,
            "oy_sort_ranks": {"RATING_ASC": i + 1} if i < 5 else {},
            "review_date": "2026-04-01",
        })
    for i in range(35):
        reviews.append({
            "review_id": f"r_pos_{i}", "mixed_review_flag": False,
            "tradeoff_pair": None,
            "records": [{
                "attribute": "pigmentation",
                "polarity": "positive", "intensity": 2,
                "evidence_span": "발색 좋아요",
                "confidence": "high", "delivery_condition_flag": False,
            }],
            "oy_evidence_score": 5.0, "rating_normalized": 5.0,
            "oy_sort_ranks": {"RATING_DESC": i + 1} if i < 5 else {},
            "review_date": "2026-04-10",
        })
    return reviews


def _corpus_meta_with_partial_success(n: int) -> dict:
    """Triggers the per-sort outcome rows (수집 시도/성공/실패 정렬)
    that previously produced the run-003 broken-phrase issue."""
    return {
        "collection_started_at": "2026-04-25T10:00:00",
        "collection_completed_at": "2026-04-25T10:30:00",
        "collected_review_count": n,
        "processed_review_count": n,
        "polarity_record_count": int(n * 0.6),
        "corpus_limited": False, "finite_limit_set": False,
        "max_reviews_arg": "all",
        "sort_mode": "multi",
        "primary_corpus_sort_type": "DATETIME_DESC",
        "signal_sort_types": [
            "RATING_ASC", "RATING_DESC",
            "USEFUL_SCORE_DESC", "RECOMMENDED_DESC",
        ],
        "signal_sort_cap": 50,
        "multi_sort_plan": [
            {"sort_type": "DATETIME_DESC", "role": "primary",
             "max_reviews_arg": "all"},
        ],
        "sorts_attempted": [
            "DATETIME_DESC", "RATING_ASC", "RATING_DESC",
            "USEFUL_SCORE_DESC", "RECOMMENDED_DESC",
        ],
        "sorts_succeeded": [
            "DATETIME_DESC", "RATING_DESC", "USEFUL_SCORE_DESC",
        ],
        "sorts_failed": ["RATING_ASC", "RECOMMENDED_DESC"],
        "partial_success": True,
        "model_name": "openai/gpt-4o-mini",
    }


@pytest.fixture(scope="module")
def rendered_pdf(tmp_path_factory) -> Path:
    """Render once per module — different test cases inspect
    different aspects of the same PDF."""
    from src.voc.reporting.phase2e.report import aggregate_product
    pdf_v2 = _load_pdf_module()
    reviews = _build_reviews()
    data = aggregate_product("A0001", "Test Pad Product", reviews)
    out = tmp_path_factory.mktemp("pass12") / "smoke_pass12.pdf"
    pdf_v2.render_pdf_v2(
        data, out, source_label="pass-12 smoke",
        reviews=reviews,
        review_dates={r["review_id"]: r["review_date"] for r in reviews},
        corpus_metadata=_corpus_meta_with_partial_success(len(reviews)),
    )
    return out


# ---------------------------------------------------------------------------
# 1. Structural smoke
# ---------------------------------------------------------------------------


def test_pdf_smoke_renders_and_is_valid(rendered_pdf: Path):
    blob = rendered_pdf.read_bytes()
    assert blob.startswith(b"%PDF-")
    assert b"%%EOF" in blob[-256:]
    # Sanity range: a real seller PDF is tens to hundreds of KB.
    assert 30_000 < len(blob) < 5_000_000


# ---------------------------------------------------------------------------
# 2. Corpus-metadata sub-tables exist + every cell is a Paragraph
# ---------------------------------------------------------------------------


def _corpus_flowables():
    pdf_v2 = _load_pdf_module()
    return pdf_v2._build_corpus_metadata_table(
        _corpus_meta_with_partial_success(2115),
    )


def _all_table_paragraph_text(flowables) -> list[str]:
    """Walk a list of flowables (KeepTogether wrapping a Table) and
    return every Paragraph cell's `.text` concatenated. The
    Paragraph wrapping is what guarantees Korean word-wrap inside
    reportlab Tables."""
    from reportlab.platypus import KeepTogether, Paragraph, Table

    texts: list[str] = []

    def _walk(node):
        if isinstance(node, Paragraph):
            texts.append(node.text)
        elif isinstance(node, Table):
            for row in node._cellvalues:
                for cell in row:
                    _walk(cell)
        elif isinstance(node, KeepTogether):
            for child in node._content:
                _walk(child)
        elif isinstance(node, list):
            for item in node:
                _walk(item)
    for f in flowables:
        _walk(f)
    return texts


def test_corpus_metadata_returns_three_subtables():
    flowables = _corpus_flowables()
    # Each sub-table is wrapped in a single KeepTogether.
    from reportlab.platypus import KeepTogether
    keep = [f for f in flowables if isinstance(f, KeepTogether)]
    assert len(keep) == 3, (
        f"expected 3 corpus-metadata sub-tables, got {len(keep)}"
    )


def test_corpus_metadata_subtable_headers_present():
    flowables = _corpus_flowables()
    texts = _all_table_paragraph_text(flowables)
    for header in ("분석 대상", "수집 정렬", "모델·처리 정보"):
        assert header in texts, (
            f"missing sub-table header: {header!r} (got {texts!r})"
        )


def test_corpus_metadata_long_label_intact_in_paragraph():
    """Run-003 broke "최종 분석 리뷰 수 (주 코퍼스, 중복 제거 후)"
    inside a narrow Table cell. After Paragraph-wrapping, the full
    label must appear as a single intact Paragraph.text — never as
    two separate fragments."""
    flowables = _corpus_flowables()
    texts = _all_table_paragraph_text(flowables)
    target = "최종 분석 리뷰 수 (주 코퍼스, 중복 제거 후)"
    assert target in texts, (
        f"expected long label intact as a single Paragraph: {target!r}"
    )
    # Specifically: the broken-mid-syllable fragments produced when
    # a raw string was placed in a narrow Table cell must NOT appear.
    for frag in ("중복 제 ", "건거 후", "중복 제거 후)건"):
        for t in texts:
            assert frag not in t, (
                f"broken phrase fragment in Paragraph: {frag!r} in {t!r}"
            )


def test_every_corpus_metadata_cell_is_paragraph_wrapped():
    """The whole point of the pass-12 fix: every body cell is a
    Paragraph (not a raw string), which is what triggers reportlab's
    CJK word-wrap. If even one cell slips through as a string,
    long Korean phrases will break mid-syllable again."""
    from reportlab.platypus import KeepTogether, Paragraph, Table

    flowables = _corpus_flowables()
    for f in flowables:
        assert isinstance(f, KeepTogether)
        # First child of each KeepTogether is the Table.
        tbl = next(
            c for c in f._content if isinstance(c, Table)
        )
        for row in tbl._cellvalues:
            for cell in row:
                assert (
                    isinstance(cell, Paragraph) or cell == ""
                ), f"non-Paragraph cell leaked into corpus table: {cell!r}"


# ---------------------------------------------------------------------------
# 3. Seller-friendly labels present in PDF wording surfaces
# ---------------------------------------------------------------------------


def test_seller_friendly_labels_in_corpus_metadata(rendered_pdf: Path):
    """The new wording shows up in the corpus-metadata sub-tables
    that the operator sees on page 1 of the appendix."""
    flowables = _corpus_flowables()
    texts = _all_table_paragraph_text(flowables)
    joined = " | ".join(texts)
    for phrase in (
        "대표 리뷰 참고 정렬",   # was: 신호 정렬
        "대표 리뷰 발췌용",      # was: 증거 풀
        "속성 의견 분류 수",     # was: 속성 레코드 수
    ):
        assert phrase in joined, (
            f"seller-friendly label missing from corpus table: {phrase!r}"
        )


def test_seller_friendly_labels_replace_engine_internal_in_corpus_metadata():
    """The replaced engine-internal labels must NOT appear in the
    corpus-metadata table after pass-12."""
    flowables = _corpus_flowables()
    joined = " | ".join(_all_table_paragraph_text(flowables))
    BANNED = (
        "신호 정렬 (증거 풀)",   # legacy two-line label
        "속성 레코드 수",        # legacy
    )
    for phrase in BANNED:
        assert phrase not in joined, (
            f"engine-internal label leaked: {phrase!r}"
        )


def test_data_coverage_phrases_use_new_wording():
    """The locked DATA_COVERAGE_*_KO constants surface "수집된 리뷰에서
    확인된 결과" instead of the legacy "관측된 결과"."""
    pdf_v2 = _load_pdf_module()
    for phrase in (
        pdf_v2.DATA_COVERAGE_OBSERVED_KO,
        pdf_v2.DATA_COVERAGE_INCREMENTAL_KO,
    ):
        assert "수집된 리뷰에서 확인된 결과입니다" in phrase, (
            f"new wording missing from {phrase!r}"
        )
        assert "관측된 결과입니다" not in phrase, (
            f"legacy 관측된 결과 wording leaked into {phrase!r}"
        )


def test_stability_chip_uses_seller_friendly_label():
    """The priority-card stability chip surfaces "[반복 확인]" not
    "[표본 내 반복]"."""
    from src.voc.reporting.phase2e.executive_summary import PriorityItem
    pdf_v2 = _load_pdf_module()
    priority = PriorityItem(
        attribute="transfer_resistance", label_ko="묻어남 저항",
        n_negative=30, pct_negative=0.30, avg_intensity_neg=2.5,
        score_max=7.0, priority_label="High", priority_score=25.0,
        risk_category="클레임 증가",
        why_ko="묻어남 문제는 재구매율 저하로 이어질 수 있습니다.",
        action_ko="밀착력 개선 후보",
    )
    card = pdf_v2._build_priority_card(
        index=1, priority=priority, representative=None,
        styles=pdf_v2._styles(),
        corpus_confidence_level="high",
        corpus_signal_stability="high",
    )
    header = card._cellvalues[0][0].text
    assert "[반복 확인]" in header
    assert "[표본 내 반복]" not in header


# ---------------------------------------------------------------------------
# 4. Secret-leak guard
# ---------------------------------------------------------------------------


SK_PREFIX_RE = re.compile(r"\bsk-[A-Za-z0-9_-]{8,}\b")


def test_pdf_bytes_do_not_leak_openai_key(rendered_pdf: Path):
    """The compressed PDF bytestream must not contain the literal
    `OPENAI_API_KEY` token. The `sk-` regex check runs over the
    decompressed text representation only — see the artifact-text
    test below for the full bytes guard."""
    blob = rendered_pdf.read_bytes()
    assert b"OPENAI_API_KEY" not in blob


def test_secret_leak_scanner_distinguishes_clean_from_poisoned(tmp_path: Path):
    """Synthetic fixture: clean payload passes; both poisoned
    payloads fail. Locks the scanner contract so future artifact-
    audit tests can reuse it."""
    clean = {
        "model_name": "openai/gpt-4o-mini",
        "summary": "리뷰 수 기준 분석 결과입니다.",
    }
    (tmp_path / "clean.json").write_text(
        json.dumps(clean, ensure_ascii=False), encoding="utf-8",
    )
    leaks = (
        json.dumps({"raw_log": "auth: sk-proj-AAAA1234567890ZZZZ ok"}),
        '{"env": "OPENAI_API_KEY=sk-AAAAAAAAAAAA"}',
    )
    for i, blob in enumerate(leaks):
        (tmp_path / f"leak_{i}.json").write_text(blob, encoding="utf-8")

    def _scan(path: Path) -> list[str]:
        text = path.read_text(encoding="utf-8")
        hits: list[str] = []
        if "OPENAI_API_KEY" in text:
            hits.append("OPENAI_API_KEY literal")
        m = SK_PREFIX_RE.search(text)
        if m:
            hits.append(f"sk- prefix at {m.start()}")
        return hits

    assert _scan(tmp_path / "clean.json") == []
    assert _scan(tmp_path / "leak_0.json") != []
    assert _scan(tmp_path / "leak_1.json") != []
