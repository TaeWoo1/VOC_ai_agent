"""Worklist-first report model + HTML rendering."""

from __future__ import annotations

from datetime import date

from src.voc.review_ops.industrial.dedup import dedup
from src.voc.review_ops.industrial.normalize import normalize_rows
from src.voc.review_ops.industrial.render_html import render_report_html
from src.voc.review_ops.industrial.report_model import build_report

TODAY = date(2026, 5, 28)

ROWS = [
    # recent + risk + low rating → worklist (top)
    {"channel": "네이버", "text": "박스가 터져서 왔어요. 교환 가능한가요?", "rating": "1", "date": "2026-05-28"},
    # recent + risk + rating 4 (forced by risk tag) → worklist
    {"channel": "쿠팡", "text": "설치가 어렵네요. 설치 방법 안내가 있으면 좋겠어요", "rating": "4", "date": "2026-05-27"},
    # recent + positive + high rating → NOT worklist
    {"channel": "자사몰", "text": "튼튼하고 만족합니다. 재구매했어요", "rating": "5", "date": "2026-05-27"},
    # old + risk → NOT worklist (recency filter), but in appendix
    {"channel": "11번가", "text": "사이즈가 안맞아요. 반품했습니다", "rating": "2", "date": "2026-03-01"},
]


def _report():
    reviews = dedup(normalize_rows(ROWS))
    return build_report(reviews, today=TODAY)


def test_worklist_includes_recent_risk_excludes_positive_and_old():
    report = _report()
    texts = [row.text for row in report.worklist]
    assert any("박스가 터져" in t for t in texts)
    assert any("설치가 어렵" in t for t in texts)
    assert not any("재구매했어요" in t for t in texts)   # positive, high rating
    assert not any("반품했습니다" in t for t in texts)    # old


def test_worklist_ranks_risk_before_lower_severity():
    report = _report()
    # highest severity (risk) row first
    assert "박스가 터져" in report.worklist[0].text


def test_worklist_rows_carry_reason_action_and_chips():
    report = _report()
    row = report.worklist[0]
    assert row.reason
    assert row.suggested_action
    assert row.reason != row.suggested_action  # no echo: distinct 왜 / 조치
    assert row.tag_labels  # Korean chip labels present


def test_urgency_tiers_split_today_and_week():
    report = _report()
    today = [r for r in report.worklist if r.tier == "today"]
    week = [r for r in report.worklist if r.tier == "week"]
    # 1점 파손+교환 → 오늘; 4점 설치 → 이번 주
    assert any("박스가 터져" in r.text for r in today)
    assert any("설치가 어렵" in r.text for r in week)
    assert all(r.tier in ("today", "week") for r in report.worklist)


def test_low_rating_review_lands_in_today_tier():
    report = _report()
    for r in report.worklist:
        if r.rating is not None and r.rating <= 2:
            assert r.tier == "today"


def test_reason_includes_rating_context_for_low_rating():
    report = _report()
    top = report.worklist[0]  # 1점 파손 리뷰
    assert "1점" in top.reason


DIAG_ROWS = [
    # unknown date + risk + low rating → must NOT enter today/week, but kept in appendix
    {"channel": "11번가", "text": "박스가 찌그러져서 왔어요", "rating": "2", "date": "어제"},
    # out-of-scale rating (100-scale) + missing risk + recent → rating unknown, still surfaced
    {"channel": "쿠팡", "text": "구성품이 하나 빠졌어요", "rating": "80", "date": "2026-05-27"},
]


def _diag_report():
    reviews = dedup(normalize_rows(DIAG_ROWS))
    return build_report(reviews, today=TODAY)


def test_unknown_date_review_excluded_from_tiers_but_in_appendix():
    report = _diag_report()
    worklist_texts = [r.text for r in report.worklist]
    assert not any("찌그러져서" in t for t in worklist_texts)  # unknown date → not this-week work
    assert any("찌그러져서" in r.text for r in report.appendix)  # still preserved


def test_date_unknown_count_diagnostic():
    report = _diag_report()
    assert report.header.date_unknown_count == 1


def test_out_of_scale_rating_is_unknown_not_five_star():
    report = _diag_report()
    assert report.header.rating_unknown_count == 1
    # the 80→unknown review is not hidden: it still surfaces via its risk tag
    assert any("빠졌" in r.text for r in report.worklist)
    # and it is not counted as a 5-star review
    assert report.header.rating_distribution.get("5", 0) == 0


def test_diagnostics_surface_in_html_when_present():
    html = render_report_html(_diag_report())
    assert "날짜 확인 필요: 1건" in html
    assert "평점 확인 필요: 1건" in html


def test_positive_policy_review_stays_out_of_worklist():
    # a recent 5★ review that merely mentions return policy must not become work
    rows = [
        {"channel": "네이버",
         "text": "반품 정책이 자세히 안내되어 있어서 안심됐어요. 설치도 쉬웠고 만족합니다",
         "rating": "5", "date": "2026-05-27"},
    ]
    reviews = dedup(normalize_rows(rows))
    from src.voc.review_ops.industrial.classify import classify
    assert "cs_exchange_return_issue" not in classify(reviews[0])

    report = build_report(reviews, today=TODAY)
    assert report.worklist == []                       # not surfaced as work
    assert any("반품 정책" in r.text for r in report.appendix)  # still preserved


def test_recent_negated_positives_stay_out_of_worklist():
    # recent 5★ reviews that merely negate a problem must not become work
    rows = [
        {"channel": "네이버", "text": "파손 없이 잘 왔어요. 만족합니다", "rating": "5", "date": "2026-05-27"},
        {"channel": "쿠팡", "text": "헐거움 없이 딱 맞아요", "rating": "5", "date": "2026-05-27"},
        {"channel": "자사몰", "text": "교환 처리가 안내되어 있어 안심했습니다", "rating": "5", "date": "2026-05-27"},
    ]
    reviews = dedup(normalize_rows(rows))
    report = build_report(reviews, today=TODAY)
    assert report.worklist == []                  # none surfaced as work
    assert len(report.appendix) == 3              # all preserved


def test_recent_distant_negated_positive_stays_out_of_worklist():
    rows = [
        {"channel": "네이버", "text": "파손은 전혀 없고 잘 왔어요", "rating": "5", "date": "2026-05-27"},
    ]
    reviews = dedup(normalize_rows(rows))
    from src.voc.review_ops.industrial.classify import classify
    assert "delivery_packaging_damage" not in classify(reviews[0])

    report = build_report(reviews, today=TODAY)
    assert report.worklist == []                       # not surfaced as work
    assert any("파손은 전혀 없고" in r.text for r in report.appendix)  # preserved


def test_recent_affirmative_positives_stay_out_of_worklist():
    rows = [
        {"channel": "네이버", "text": "상세페이지 치수 확인 후 구매했더니 딱 맞아요. 만족합니다",
         "rating": "5", "date": "2026-05-27"},
        {"channel": "쿠팡", "text": "교환 가능해서 안심하고 구매했어요. 만족합니다",
         "rating": "5", "date": "2026-05-27"},
    ]
    reviews = dedup(normalize_rows(rows))
    report = build_report(reviews, today=TODAY)
    assert report.worklist == []        # none surfaced as work
    assert len(report.appendix) == 2    # both preserved


def test_density_note_renders_only_when_set():
    reviews = dedup(normalize_rows(ROWS))
    report = build_report(reviews, today=TODAY, density_note="문제 리뷰를 일부러 많이 담았습니다.")
    assert "문제 리뷰를 일부러 많이 담았습니다." in render_report_html(report)
    # default build has no density note
    assert build_report(reviews, today=TODAY).density_note is None


def test_header_stats_count_active_only():
    report = _report()
    assert report.header.total_reviews == 4
    assert sum(report.header.by_channel.values()) == 4
    assert sum(report.header.rating_distribution.values()) == 4


def test_appendix_includes_all_active_reviews():
    report = _report()
    assert len(report.appendix) == 4


def test_html_is_worklist_first_with_caveat():
    report = _report()
    html = render_report_html(report)
    assert "오늘 먼저 볼 리뷰" in html
    assert "이번 주 안에 볼 리뷰" in html
    assert "확인용으로 봐주세요" in html  # caveat
    assert "전체 리뷰 (원문)" in html      # appendix
    # worklist tiers appear before the appendix; 오늘 before 이번 주 before 원문
    assert html.index("오늘 먼저 볼 리뷰") < html.index("이번 주 안에 볼 리뷰")
    assert html.index("이번 주 안에 볼 리뷰") < html.index("전체 리뷰 (원문)")
    # subtitle frames it as a sample, not a finished product
    assert "샘플" in html
