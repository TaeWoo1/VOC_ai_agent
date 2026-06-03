"""Render the IndustrialReport to a standalone HTML string.

Worklist-first layout: title/subtitle/caveat → short header stats → the operator
worklist ("이번 주 운영자가 볼 리뷰") → raw review appendix. No external template
engine, no JS, no PDF.
"""

from __future__ import annotations

from datetime import date
from html import escape

from src.voc.review_ops.industrial.schema import (
    HeaderStats,
    IndustrialReport,
    IndustrialReview,
    IssueCluster,
    WorklistRow,
)

_ISSUE_TYPE_LABELS: dict[str, str] = {
    "product": "제품",
    "detail_page": "상세페이지",
    "cs": "CS/교환",
    "shipping": "배송/포장",
    "positive_signal": "긍정 신호",
    "ignore": "기타",
}
# Operator-friendly severity wording (not engine "높음/보통/낮음").
_SEVERITY_LABELS: dict[str, str] = {"high": "우선 확인", "medium": "확인 필요", "low": "참고"}

_CSS = """
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { font-family: -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
       margin: 0; padding: 24px; color: #1c2024; background: #f6f7f9; line-height: 1.55; }
.wrap { max-width: 920px; margin: 0 auto; }
h1 { font-size: 22px; margin: 0 0 4px; }
.subtitle { color: #5b6470; margin: 0 0 12px; font-size: 14px; }
.caveat { background: #fff7e6; border: 1px solid #ffe2a8; color: #7a5a12;
          padding: 10px 12px; border-radius: 8px; font-size: 13px; margin: 0 0 10px; }
.note { color: #6b747e; font-size: 12px; margin: 0 0 20px; }
.card.today { border-left: 3px solid #d9480f; }
.stats { display: flex; flex-wrap: wrap; gap: 8px 16px; font-size: 13px;
         color: #3a424c; margin: 0 0 24px; padding: 12px 14px; background: #fff;
         border: 1px solid #e6e8eb; border-radius: 8px; }
.stats b { color: #1c2024; }
.stats .diag { color: #7a5a12; }
h2 { font-size: 18px; margin: 28px 0 12px; }
.count { color: #8b939c; font-weight: normal; font-size: 14px; }
.card { background: #fff; border: 1px solid #e6e8eb; border-radius: 10px;
        padding: 14px 16px; margin: 0 0 12px; }
.card .meta { font-size: 12px; color: #6b747e; margin-bottom: 6px; }
.card .quote { font-size: 14px; margin: 6px 0 10px; white-space: pre-wrap; }
.chips { margin: 6px 0; }
.chip { display: inline-block; background: #eef1f4; color: #2f3a45;
        border-radius: 999px; padding: 2px 10px; font-size: 12px; margin: 0 6px 6px 0; }
.action { font-size: 13px; }
.action .label { color: #8b939c; }
.reason { color: #b5491f; }
.suggest { color: #1f6f3f; }
.refnote { color: #8b939c; font-size: 12px; margin-top: 6px; }
.card.issue { border-left: 3px solid #1971c2; }
.issuehead { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; margin-bottom: 4px; }
.issuetitle { font-size: 15px; font-weight: 600; color: #1c2024; }
.chip.sev-high { background: #ffe3e3; color: #c92a2a; }
.chip.sev-medium { background: #fff3bf; color: #8a6d00; }
.chip.sev-low { background: #e9ecef; color: #495057; }
.reps { margin-top: 8px; border-top: 1px solid #eef1f4; padding-top: 8px; }
.reps .repslabel { color: #8b939c; font-size: 12px; margin-bottom: 4px; }
.rep { margin: 0 0 6px; }
.rep .meta { font-size: 12px; color: #6b747e; }
.rep .repquote { font-size: 13px; white-space: pre-wrap; }
table { width: 100%; border-collapse: collapse; background: #fff;
        border: 1px solid #e6e8eb; border-radius: 8px; overflow: hidden; font-size: 13px; }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #eef1f4; vertical-align: top; }
th { background: #f1f3f5; color: #3a424c; font-weight: 600; }
.empty { color: #8b939c; font-size: 14px; padding: 12px 0; }
footer { color: #8b939c; font-size: 12px; margin-top: 28px; }
"""


def _fmt_date(d: date | None) -> str:
    return d.isoformat() if d else "날짜 미상"


def _fmt_rating(rating: float | None) -> str:
    if rating is None:
        return "평점 미상"
    return f"{rating:g}점"


def _stats_html(header: HeaderStats) -> str:
    channels = ", ".join(f"{escape(ch)} {n}" for ch, n in header.by_channel.items()) or "-"
    ratings = ", ".join(f"{escape(b)}점 {n}" if b != "미상" else f"미상 {n}"
                        for b, n in header.rating_distribution.items()) or "-"
    spans = [
        f"<span><b>전체 리뷰</b> {header.total_reviews}건</span>",
        f"<span><b>채널별</b> {channels}</span>",
        f"<span><b>평점 분포</b> {ratings}</span>",
    ]
    # Lightweight, non-alarming import diagnostics — shown only when relevant.
    if header.date_unknown_count:
        spans.append(f'<span class="diag">날짜 확인 필요: {header.date_unknown_count}건</span>')
    if header.rating_unknown_count:
        spans.append(f'<span class="diag">평점 확인 필요: {header.rating_unknown_count}건</span>')
    return '<div class="stats">' + "".join(spans) + "</div>"


def _worklist_card(row: WorklistRow) -> str:
    meta_bits = [_fmt_date(row.review_date), escape(row.channel), _fmt_rating(row.rating)]
    if row.product_name:
        meta_bits.append(escape(row.product_name))
    if row.option_name:
        meta_bits.append(f"옵션: {escape(row.option_name)}")
    meta = " · ".join(meta_bits)

    chips = "".join(f'<span class="chip">{escape(label)}</span>' for label in row.tag_labels)
    chips_html = f'<div class="chips">{chips}</div>' if chips else ""
    card_class = "card today" if row.tier == "today" else "card"

    # Subtle, non-promotional note for LLM-refined rows — the report should not
    # read as an "AI product".
    refnote_html = ""
    if row.refined:
        conf = f" · 신뢰도 {escape(row.confidence)}" if row.confidence else ""
        refnote_html = f'<div class="refnote">문구 다듬음{conf}</div>'

    return (
        f'<div class="{card_class}">'
        f'<div class="meta">{meta}</div>'
        f'<div class="quote">{escape(row.text)}</div>'
        f"{chips_html}"
        f'<div class="action reason"><span class="label">왜 봐야 하나요:</span> {escape(row.reason)}</div>'
        f'<div class="action suggest"><span class="label">다음 조치:</span> {escape(row.suggested_action)}</div>'
        f"{refnote_html}"
        "</div>"
    )


def _tier_section(heading: str, rows: list[WorklistRow], empty_msg: str) -> str:
    if rows:
        body = "".join(_worklist_card(r) for r in rows)
    else:
        body = f'<div class="empty">{escape(empty_msg)}</div>'
    return (
        f'<h2>{escape(heading)} <span class="count">({len(rows)}건)</span></h2>'
        f"{body}"
    )


def _appendix_row(r: IndustrialReview) -> str:
    return (
        "<tr>"
        f"<td>{_fmt_date(r.review_date)}</td>"
        f"<td>{escape(r.channel)}</td>"
        f"<td>{escape(r.product_name or '-')}</td>"
        f"<td>{escape(r.option_name or '-')}</td>"
        f"<td>{_fmt_rating(r.rating)}</td>"
        f"<td>{escape(r.text)}</td>"
        "</tr>"
    )


def _issue_rep(rep: WorklistRow) -> str:
    meta_bits = [_fmt_date(rep.review_date), escape(rep.channel), _fmt_rating(rep.rating)]
    if rep.product_name:
        meta_bits.append(escape(rep.product_name))
    meta = " · ".join(meta_bits)
    return (
        '<div class="rep">'
        f'<div class="meta">{meta}</div>'
        f'<div class="repquote">{escape(rep.text)}</div>'
        "</div>"
    )


def _issue_card(cluster: IssueCluster) -> str:
    sev_label = _SEVERITY_LABELS.get(cluster.severity, cluster.severity)
    type_label = _ISSUE_TYPE_LABELS.get(cluster.issue_type, cluster.issue_type)
    chips = (
        f'<span class="chip sev-{escape(cluster.severity)}">{escape(sev_label)}</span>'
        f'<span class="chip">{escape(type_label)}</span>'
        f'<span class="chip">{escape(cluster.tag_label)}</span>'
    )
    # Up to 3 representative original reviews (verbatim).
    reps = "".join(_issue_rep(r) for r in cluster.representatives[:3])
    reps_html = (
        f'<div class="reps"><div class="repslabel">원문 근거</div>{reps}</div>' if reps else ""
    )
    return (
        '<div class="card issue">'
        '<div class="issuehead">'
        f'<span class="issuetitle">{escape(cluster.issue_title)}</span>'
        f'<span class="count">관련 리뷰 {cluster.review_count}건</span>'
        "</div>"
        f'<div class="chips">{chips}</div>'
        f'<div class="action reason"><span class="label">요약:</span> {escape(cluster.summary)}</div>'
        f'<div class="action suggest"><span class="label">추천 조치:</span> {escape(cluster.recommended_action)}</div>'
        f"{reps_html}"
        "</div>"
    )


def _issues_section(clusters: list[IssueCluster]) -> str:
    """Repeated-issue section. Rendered only when clusters exist (callers pass an
    empty list otherwise, which omits the section entirely)."""
    if not clusters:
        return ""
    body = "".join(_issue_card(c) for c in clusters)
    return (
        f'<h2>🔁 반복 이슈 <span class="count">({len(clusters)}건)</span></h2>'
        f"{body}"
    )


def render_report_html(report: IndustrialReport, recent_days: int | None = None) -> str:
    today_rows = [r for r in report.worklist if r.tier == "today"]
    week_rows = [r for r in report.worklist if r.tier != "today"]
    # The period-tier heading is dynamic: with recent_days it reflects the chosen
    # window ("최근 30일 ..."); without it, the original wording is preserved.
    period_heading = (
        f"최근 {recent_days}일 내 확인할 리뷰" if recent_days else "이번 주 안에 볼 리뷰"
    )
    today_section = _tier_section(
        "오늘 먼저 볼 리뷰", today_rows, "오늘 먼저 볼 리뷰가 없습니다."
    )
    week_section = _tier_section(
        period_heading, week_rows, f"{period_heading}가 없습니다."
    )
    note_html = (
        f'<div class="note">{escape(report.density_note)}</div>'
        if report.density_note
        else ""
    )
    # Repeated-issue rollup above the worklist; empty -> section omitted.
    issues_section = _issues_section(report.issue_clusters)

    appendix_rows = "".join(_appendix_row(r) for r in report.appendix)

    return f"""<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{escape(report.title)}</title>
<style>{_CSS}</style>
</head>
<body>
<div class="wrap">
  <h1>{escape(report.title)}</h1>
  <p class="subtitle">{escape(report.subtitle)}</p>
  <div class="caveat">{escape(report.caveat)}</div>
  {note_html}

  {_stats_html(report.header)}

  {issues_section}

  {today_section}

  {week_section}

  <h2>전체 리뷰 (원문) <span class="count">({len(report.appendix)}건)</span></h2>
  <table>
    <thead>
      <tr><th>작성일</th><th>채널</th><th>상품명</th><th>옵션</th><th>평점</th><th>리뷰 원문</th></tr>
    </thead>
    <tbody>{appendix_rows}</tbody>
  </table>

  <footer>생성 시각: {report.generated_at:%Y-%m-%d %H:%M} · 산업자재 리뷰 운영 점검 검증 샘플</footer>
</div>
</body>
</html>
"""
