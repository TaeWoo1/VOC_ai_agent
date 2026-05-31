#!/usr/bin/env python3
"""Local demo UI for the industrial review-ops pilot.

A non-technical operator uploads a CSV or XLSX review export and gets the same
worklist-first HTML report the pipeline already produces — downloadable, with a
lightweight keyword search tab. Run locally:

    streamlit run app_industrial_review_ops.py

This is a LOCAL demo, not a SaaS app. No auth, no billing, no database, no API
server, no persistent storage (uploads stay in memory). It reuses the existing
industrial review-ops pipeline unchanged and needs no OPENAI_API_KEY and no
backend — the pipeline is self-contained (pydantic + stdlib).

XLSX support is a small stdlib reader (zipfile + xml.etree); no openpyxl. Rows
are mapped through the SAME header aliases the CSV path uses
(``ingest.COLUMN_ALIASES`` / ``ingest._build_header_map``), so CSV and XLSX
produce identical canonical rows. ``src/.../ingest.py`` is not modified.
"""

from __future__ import annotations

import csv
import io
import zipfile
from datetime import date
from xml.etree import ElementTree as ET

import streamlit as st

from src.voc.review_ops.industrial import rag, refine
from src.voc.review_ops.industrial.classify import classify
from src.voc.review_ops.industrial.dedup import dedup
from src.voc.review_ops.industrial.ingest import _build_header_map
from src.voc.review_ops.industrial.normalize import normalize_rows
from src.voc.review_ops.industrial.render_html import render_report_html
from src.voc.review_ops.industrial.report_model import RECENT_DAYS, build_report
from src.voc.review_ops.industrial.schema import IndustrialReview
from src.voc.review_ops.industrial.taxonomy import CATEGORIES, CATEGORY_BY_ID

# ---------------------------------------------------------------------------
# File reading: CSV and (stdlib) XLSX -> canonical pipeline rows
# ---------------------------------------------------------------------------

_MAIN_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
_REL_NS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"


def _col_letters(ref: str) -> str:
    out = []
    for ch in ref:
        if ch.isalpha():
            out.append(ch)
        else:
            break
    return "".join(out)


def _col_index(letters: str) -> int:
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch.upper()) - 64)
    return n


def _first_sheet_path(z: zipfile.ZipFile) -> str:
    """Resolve the first worksheet's path via workbook.xml + its rels."""
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    sheet = wb.find(f"{_MAIN_NS}sheets/{_MAIN_NS}sheet")
    rid = sheet.get(f"{_REL_NS}id") if sheet is not None else None
    target = None
    if rid:
        rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        for rel in rels:
            if rel.get("Id") == rid:
                target = rel.get("Target")
                break
    if not target:
        target = "worksheets/sheet1.xml"
    if target.startswith("/"):
        return target.lstrip("/")
    return "xl/" + target


def read_xlsx(data: bytes) -> tuple[list[str], list[dict[str, str]]]:
    """Read the first sheet of an XLSX into (header names, raw-header rows).

    stdlib only. Handles shared strings, inline strings, and numeric/text cells.
    Dates stored as text (the common Korean commerce export form, e.g.
    ``2026.01.21. 19:58:59``) pass through verbatim; numeric-serial dates are not
    converted (rare for these exports).
    """
    z = zipfile.ZipFile(io.BytesIO(data))

    sst: list[str] = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")):
            sst.append("".join(t.text or "" for t in si.iter(f"{_MAIN_NS}t")))

    def cell_value(c: ET.Element) -> str:
        t = c.get("t")
        if t == "s":
            v = c.find(f"{_MAIN_NS}v")
            if v is not None and v.text is not None:
                idx = int(v.text)
                return sst[idx] if 0 <= idx < len(sst) else ""
            return ""
        if t == "inlineStr":
            isn = c.find(f"{_MAIN_NS}is")
            return "".join(x.text or "" for x in isn.iter(f"{_MAIN_NS}t")) if isn is not None else ""
        v = c.find(f"{_MAIN_NS}v")
        return v.text if (v is not None and v.text is not None) else ""

    root = ET.fromstring(z.read(_first_sheet_path(z)))
    sheet_data = root.find(f"{_MAIN_NS}sheetData")
    rows_el = sheet_data.findall(f"{_MAIN_NS}row") if sheet_data is not None else []
    if not rows_el:
        return [], []

    header_cells: dict[str, str] = {}
    for c in rows_el[0].findall(f"{_MAIN_NS}c"):
        header_cells[_col_letters(c.get("r", ""))] = cell_value(c)
    ordered_cols = sorted((col for col in header_cells if col), key=_col_index)
    fieldnames = [header_cells[col] for col in ordered_cols]

    raw_rows: list[dict[str, str]] = []
    for r in rows_el[1:]:
        cells: dict[str, str] = {}
        for c in r.findall(f"{_MAIN_NS}c"):
            cells[_col_letters(c.get("r", ""))] = cell_value(c)
        raw_rows.append({header_cells[col]: cells.get(col, "") for col in ordered_cols})
    return fieldnames, raw_rows


def read_csv(data: bytes) -> tuple[list[str], list[dict[str, str]]]:
    text = data.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    fieldnames = list(reader.fieldnames or [])
    return fieldnames, list(reader)


def canonicalize(
    fieldnames: list[str], raw_rows: list[dict[str, str]]
) -> tuple[list[dict[str, str]], bool]:
    """Map raw rows to canonical pipeline rows. Mirrors ``ingest.load_csv``.

    Returns ``(rows, has_channel_column)``. Raises ``ValueError`` if no column
    maps to the required ``text`` field.
    """
    header_map = _build_header_map(fieldnames)
    canon_fields = set(header_map.values())
    if "text" not in canon_fields:
        raise ValueError(
            "리뷰 내용(text) 열을 찾을 수 없습니다. "
            "리뷰내용 / 리뷰 / 후기 / 내용 / review / text 중 하나가 필요합니다."
        )

    rows: list[dict[str, str]] = []
    for raw in raw_rows:
        canon: dict[str, str] = {}
        for raw_key, value in raw.items():
            field = header_map.get(raw_key)
            if field:
                canon[field] = (value or "").strip() if isinstance(value, str) else (
                    "" if value is None else str(value).strip()
                )
        if canon.get("text"):
            rows.append(canon)
    return rows, ("channel" in canon_fields)


def load_upload(
    filename: str, data: bytes, channel_override: str | None
) -> tuple[list[dict[str, str]], bool]:
    """Read an uploaded CSV/XLSX into canonical rows; apply a channel override.

    Returns ``(rows, had_channel_column)``.
    """
    if filename.lower().endswith(".xlsx"):
        fieldnames, raw_rows = read_xlsx(data)
    else:
        fieldnames, raw_rows = read_csv(data)
    rows, has_channel = canonicalize(fieldnames, raw_rows)

    override = (channel_override or "").strip()
    if override:
        for row in rows:
            if not row.get("channel"):
                row["channel"] = override
    return rows, has_channel


# ---------------------------------------------------------------------------
# Lightweight search: keyword shortcuts -> taxonomy categories
# ---------------------------------------------------------------------------

# Plain-Korean query shortcuts. Typing one of these also matches reviews carrying
# the mapped taxonomy tag (not just literal substring hits). NOT AI/RAG.
QUERY_SHORTCUTS: dict[str, str] = {
    "배송 파손": "delivery_packaging_damage",
    "파손": "delivery_packaging_damage",
    "답글": "needs_reply",
    "문의": "needs_reply",
    "사이즈": "spec_size_confusion",
    "규격": "spec_size_confusion",
    "설치": "installation_difficulty",
    "구성품": "missing_or_wrong_components",
    "누락": "missing_or_wrong_components",
    "교환": "cs_exchange_return_issue",
    "반품": "cs_exchange_return_issue",
    "cs": "cs_exchange_return_issue",
    "재구매": "reorder_bulk_purchase_signal",
    "대량": "reorder_bulk_purchase_signal",
    "상세페이지": "detail_page_faq_candidate",
    "faq": "detail_page_faq_candidate",
}

LABEL_TO_ID: dict[str, str] = {c.label_ko: c.id for c in CATEGORIES}


def _rating_bucket(rating: float | None) -> str:
    return "미상" if rating is None else str(int(round(rating)))


# ---------------------------------------------------------------------------
# Pipeline driver
# ---------------------------------------------------------------------------


def generate(
    rows: list[dict[str, str]],
    *,
    title: str,
    today: date | None,
    recent_days: int,
    do_refine: bool = False,
    refine_top_n: int = refine.DEFAULT_TOP_N,
) -> dict:
    reviews = dedup(normalize_rows(rows))
    active = [r for r in reviews if not r.is_duplicate]
    report = build_report(
        reviews, today=today, recent_days=recent_days, title=title, density_note=None
    )

    # Optional LLM refinement of the top-N worklist candidates only. Any failure
    # (no key, bad JSON, network) falls back to the rule-based report.
    refine_summary: dict | None = None
    if do_refine:
        api_key = rag.resolve_api_key()
        if not api_key:
            refine_summary = {"status": "no_key"}
        else:
            try:
                report, summary = refine.refine_worklist(
                    report, api_key=api_key, top_n=refine_top_n
                )
                refine_summary = {"status": "ok", **summary}
            except Exception as e:  # whole-feature fallback
                refine_summary = {"status": "error", "error": str(e)}

    html = render_report_html(report, recent_days=recent_days)
    tagged = [(r, classify(r)) for r in active]
    today_count = sum(1 for w in report.worklist if w.tier == "today")
    return {
        "html": html,
        "tagged": tagged,
        "total": report.header.total_reviews,
        "duplicates": len(reviews) - len(active),
        "today_count": today_count,
        "week_count": len(report.worklist) - today_count,
        "date_unknown": report.header.date_unknown_count,
        "rating_unknown": report.header.rating_unknown_count,
        "channels": sorted({r.channel for r in active}),
        "recent_days": recent_days,
        "refine_summary": refine_summary,
    }


# ---------------------------------------------------------------------------
# UI
# ---------------------------------------------------------------------------


def _render_generate_tab() -> None:
    st.subheader("리뷰 파일 업로드")
    uploaded = st.file_uploader(
        "CSV 또는 XLSX 파일을 올려주세요", type=["csv", "xlsx"], accept_multiple_files=False
    )

    with st.expander("선택 입력 (제목 · 기준 날짜 · 기간 · 채널)", expanded=False):
        title = st.text_input("리포트 제목", value="산업자재 리뷰 운영 점검")
        auto_today = st.checkbox("기준 날짜 자동 (가장 최근 리뷰 날짜)", value=True)
        today_input = st.date_input("기준 날짜 (today)", value=date.today(), disabled=auto_today)
        recent_days = st.number_input(
            "최근 며칠 이내를 '이번 주에 볼 리뷰'로 볼까요?",
            min_value=1, max_value=120, value=int(RECENT_DAYS), step=1,
        )
        channel_override = st.text_input(
            "채널 이름 (파일에 채널 열이 없을 때만 사용)", value="",
            placeholder="예: 네이버",
        )

    with st.expander("LLM 문구 다듬기 (선택 · 기본 꺼짐)", expanded=False):
        do_refine = st.checkbox("LLM으로 worklist 문구 다듬기", value=False)
        refine_top_n = st.number_input(
            "다듬을 상위 후보 수 (top-N)",
            min_value=1, max_value=100, value=int(refine.DEFAULT_TOP_N), step=5,
            disabled=not do_refine,
        )
        if do_refine:
            if rag.resolve_api_key():
                st.caption(
                    f"예상 LLM 호출: 최대 {int(refine_top_n)}회 "
                    "(worklist 상위 후보에만 적용, 전체 리뷰 아님)."
                )
            else:
                st.warning(
                    "OPENAI_API_KEY를 찾을 수 없습니다. 다듬기를 켜도 규칙 기반 결과로 표시됩니다."
                )

    if st.button("리포트 생성", type="primary", disabled=uploaded is None):
        try:
            rows, had_channel = load_upload(
                uploaded.name, uploaded.getvalue(), channel_override
            )
        except ValueError as e:
            st.error(str(e))
            return
        except Exception as e:  # malformed file -> friendly message, no crash
            st.error(f"파일을 읽지 못했습니다: {e}")
            return

        if not rows:
            st.warning("리뷰 내용이 있는 행을 찾지 못했습니다.")
            return
        if not had_channel and not channel_override.strip():
            st.info("파일에 채널 열이 없어 채널이 '미상'으로 표시됩니다. 선택 입력에서 채널 이름을 지정할 수 있습니다.")

        with st.spinner("리포트 생성 중..." + (" (LLM 다듬기 포함)" if do_refine else "")):
            result = generate(
                rows,
                title=title.strip() or "산업자재 리뷰 운영 점검",
                today=None if auto_today else today_input,
                recent_days=int(recent_days),
                do_refine=do_refine,
                refine_top_n=int(refine_top_n),
            )
        st.session_state["result"] = result
        st.session_state["report_title"] = title.strip() or "report"
        # New corpus -> drop any stale RAG index/chat from a previous file.
        for key in ("rag_index", "rag_messages", "rag_last_results"):
            st.session_state.pop(key, None)

    result = st.session_state.get("result")
    if not result:
        st.caption("파일을 올리고 '리포트 생성'을 누르면 결과가 여기에 표시됩니다.")
        return

    st.divider()
    c1, c2, c3 = st.columns(3)
    c1.metric("전체 리뷰", f"{result['total']}건")
    c2.metric("중복", f"{result['duplicates']}건")
    c3.metric("채널 수", f"{len(result['channels'])}개")
    c4, c5, c6, c7 = st.columns(4)
    c4.metric("오늘 먼저 볼 리뷰", f"{result['today_count']}건")
    c5.metric(f"최근 {result.get('recent_days', RECENT_DAYS)}일 내 확인", f"{result['week_count']}건")
    c6.metric("날짜 확인 필요", f"{result['date_unknown']}건")
    c7.metric("평점 확인 필요", f"{result['rating_unknown']}건")

    summary = result.get("refine_summary")
    if summary:
        status = summary.get("status")
        if status == "ok":
            st.success(
                f"LLM 다듬기: 후보 {summary['candidates']}건 중 "
                f"{summary['refined']}건 보정 · {summary['excluded']}건 제외 · "
                f"{summary['failed']}건 규칙기반 유지"
            )
        elif status == "no_key":
            st.warning("OPENAI_API_KEY가 없어 규칙 기반 결과로 표시했습니다.")
        elif status == "error":
            st.warning(f"LLM 다듬기에 실패해 규칙 기반 결과로 표시했습니다: {summary.get('error', '')}")

    st.download_button(
        "HTML 리포트 다운로드",
        data=result["html"].encode("utf-8"),
        file_name=f"{st.session_state.get('report_title', 'report')}.html",
        mime="text/html",
    )

    st.subheader("리포트 미리보기")
    st.components.v1.html(result["html"], height=820, scrolling=True)


def _render_search_tab() -> None:
    st.subheader("간단 검색 (리뷰 찾기)")
    st.caption("키워드·태그로 원문 리뷰를 찾는 기능입니다. AI/RAG가 아닌 단순 검색입니다.")

    result = st.session_state.get("result")
    if not result:
        st.info("먼저 '리포트 생성' 탭에서 파일을 올려 리포트를 생성하세요.")
        return

    tagged: list[tuple[IndustrialReview, list[str]]] = result["tagged"]

    selected_labels = st.multiselect("태그 필터", options=list(LABEL_TO_ID.keys()))
    selected_tag_ids = {LABEL_TO_ID[label] for label in selected_labels}

    keyword = st.text_input("키워드 검색 (원문 리뷰)", value="", placeholder="예: 파손, 교환, 설치 ...")

    col_a, col_b = st.columns(2)
    channel_filter = col_a.multiselect("채널", options=result["channels"])
    rating_filter = col_b.multiselect("평점", options=["5", "4", "3", "2", "1", "미상"])

    # Query shortcuts: a matched term also pulls in reviews carrying its tag.
    kw = keyword.strip().lower()
    shortcut_ids = {tag for term, tag in QUERY_SHORTCUTS.items() if term in kw} if kw else set()
    if shortcut_ids:
        labels = ", ".join(sorted(CATEGORY_BY_ID[t].label_ko for t in shortcut_ids))
        st.caption(f"'{keyword.strip()}' → 태그로도 검색: {labels}")

    results: list[dict[str, str]] = []
    for review, tags in tagged:
        if selected_tag_ids and not (selected_tag_ids & set(tags)):
            continue
        if kw:
            if kw not in review.text.lower() and not (shortcut_ids & set(tags)):
                continue
        if channel_filter and review.channel not in channel_filter:
            continue
        if rating_filter and _rating_bucket(review.rating) not in rating_filter:
            continue
        results.append(
            {
                "작성일": review.review_date.isoformat() if review.review_date else "미상",
                "채널": review.channel,
                "상품명": review.product_name or "-",
                "평점": _rating_bucket(review.rating),
                "태그": ", ".join(CATEGORY_BY_ID[t].label_ko for t in tags) or "-",
                "리뷰": review.text,
            }
        )

    st.write(f"검색 결과: {len(results)}건")
    if results:
        st.dataframe(results, use_container_width=True, hide_index=True)

    st.divider()
    st.caption("자연어 질의/LLM 요약은 실제 데이터 검증 후 추가 예정.")


RAG_EXAMPLES = [
    "배송 파손 리뷰 보여줘",
    "사이즈 관련 불만 있어?",
    "답글 필요한 리뷰 찾아줘",
    "재구매 언급 리뷰 보여줘",
    "상세페이지에 추가할 만한 내용 있어?",
]


def _rag_result_card(result: rag.SearchResult) -> None:
    m = result.doc.metadata
    rating = f"{m['rating']:g}점" if m.get("rating") is not None else "평점미상"
    bits = [m.get("date") or "날짜미상", str(m.get("channel") or "-"), rating]
    if m.get("product_name"):
        bits.append(str(m["product_name"]))
    if m.get("option_name"):
        bits.append(f"옵션: {m['option_name']}")
    st.markdown(f"**{' · '.join(bits)}**  ·  유사도 {result.similarity:.3f}")
    if m.get("tag_labels"):
        st.caption("태그: " + ", ".join(m["tag_labels"]))
    st.write(m.get("text", ""))
    st.divider()


def _process_rag_query(query: str, index: rag.RagIndex, api_key: str | None) -> None:
    query = (query or "").strip()
    if not query:
        return
    try:
        query_emb = rag.embed_texts([query], api_key=api_key, model=rag.embedding_model())[0]
    except Exception as e:  # embedding the question failed -> tell the user, no crash
        st.error(f"질문 임베딩 실패: {e}")
        return

    results = index.rank(query_emb, query_text=query, top_k=8, strict_tags=True)
    st.session_state["rag_last_results"] = results

    # Strict-tag note: query clearly maps to a tag, but no review carries it.
    tag_note = ""
    if rag.boosted_ids_for_query(query) and index.tag_match_count(query) == 0:
        tag_note = (
            "해당 태그로 분류된 리뷰는 거의 없습니다. 의미상 가까운 리뷰를 대신 보여드립니다."
        )

    answer = rag.generate_answer(query, results, api_key=api_key, model=rag.chat_model())
    if answer is None:
        answer = (
            f"검색된 리뷰 {len(results)}건을 오른쪽에서 확인하세요. "
            "(AI 요약을 사용할 수 없어 검색 결과만 표시합니다.)"
        )
    if tag_note:
        answer = f"{tag_note}\n\n{answer}"
    messages = st.session_state.setdefault("rag_messages", [])
    messages.append({"role": "user", "content": query})
    messages.append({"role": "assistant", "content": answer})


def _render_rag_tab() -> None:
    st.subheader("리뷰에게 물어보기 (로컬 RAG 데모)")
    st.caption("업로드한 리뷰를 임베딩해 자연어로 검색·질문합니다. 외부 저장 없이 메모리에서만 동작합니다.")

    result = st.session_state.get("result")
    if not result:
        st.info("먼저 '리포트 생성' 탭에서 파일을 올려 리포트를 생성하세요.")
        return

    api_key = rag.resolve_api_key()

    # --- Indexing gate: embed the corpus once, on demand ---
    if "rag_index" not in st.session_state:
        st.write(f"리뷰 **{len(result['tagged'])}건**을 임베딩하면 질문할 수 있습니다.")
        if not api_key:
            st.warning(
                "OPENAI_API_KEY를 찾을 수 없어 임베딩을 만들 수 없습니다. "
                ".env에 키를 추가하세요. ('간단 검색' 탭은 키 없이도 동작합니다.)"
            )
        if st.button("리뷰 인덱싱 시작 (임베딩)", type="primary", disabled=not api_key):
            with st.spinner("리뷰 임베딩 중... (건수에 따라 시간이 걸릴 수 있습니다)"):
                try:
                    index = rag.build_index(
                        result["tagged"], api_key=api_key, model=rag.embedding_model()
                    )
                    st.session_state["rag_index"] = index
                    st.session_state.setdefault("rag_messages", [])
                    st.success(f"{len(index)}건 인덱싱 완료")
                    st.rerun()
                except Exception as e:
                    st.error(f"임베딩 실패: {e}")
        return

    index: rag.RagIndex = st.session_state["rag_index"]
    st.caption(f"인덱싱된 리뷰: {len(index)}건")

    left, right = st.columns(2)

    with left:
        st.markdown("#### 질문")
        st.write("예시 질문:")
        for i, example in enumerate(RAG_EXAMPLES):
            if st.button(example, key=f"rag_ex_{i}"):
                st.session_state["rag_pending"] = example
        with st.form("rag_form", clear_on_submit=True):
            typed = st.text_input("질문을 입력하세요", value="")
            submitted = st.form_submit_button("질문하기", type="primary")
        if submitted and typed.strip():
            st.session_state["rag_pending"] = typed

        pending = st.session_state.pop("rag_pending", None)
        if pending:
            with st.spinner("검색 중..."):
                _process_rag_query(pending, index, api_key)

        st.markdown("#### 대화")
        for message in st.session_state.get("rag_messages", []):
            with st.chat_message(message["role"]):
                st.write(message["content"])

    with right:
        st.markdown("#### 검색된 리뷰")
        results = st.session_state.get("rag_last_results", [])
        if not results:
            st.caption("질문하면 관련 원문 리뷰가 여기에 표시됩니다.")
        for res in results:
            _rag_result_card(res)


def main() -> None:
    st.set_page_config(page_title="산업자재 리뷰 운영 점검", layout="wide")
    st.title("산업자재 리뷰 운영 점검 (로컬 데모)")
    st.caption(
        "여러 채널 리뷰를 한곳에 모아, 운영자가 먼저 확인할 리뷰를 정리합니다. "
        "키워드 기반 우선 분류이며, 확인용으로 봐주세요."
    )

    tab_report, tab_search, tab_rag = st.tabs(
        ["리포트 생성", "간단 검색 (리뷰 찾기)", "리뷰에게 물어보기 (RAG)"]
    )
    with tab_report:
        _render_generate_tab()
    with tab_search:
        _render_search_tab()
    with tab_rag:
        _render_rag_tab()


if __name__ == "__main__":
    main()
