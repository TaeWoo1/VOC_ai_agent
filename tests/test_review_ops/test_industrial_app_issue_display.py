"""App-level repeated-issue display helpers. No OpenAI, no Streamlit E2E."""

from __future__ import annotations

from datetime import date

from app_industrial_review_ops import (
    issue_display_item,
    issue_display_mode_params,
    severity_label,
)
from src.voc.review_ops.industrial.schema import IssueCluster, WorklistRow


def _rep(review_id: str) -> WorklistRow:
    return WorklistRow(
        review_id=review_id, review_date=date(2026, 1, 20), channel="네이버",
        product_name="전선몰딩 1P", option_name="2m", rating=1.0,
        text=f"원문 {review_id}", tags=["delivery_packaging_damage"],
        tag_labels=["배송/포장 파손"],
    )


def _cluster(severity: str, *, issue_type: str = "shipping", reps: int = 2) -> IssueCluster:
    return IssueCluster(
        cluster_id="A", tag="delivery_packaging_damage", tag_label="배송/포장 파손",
        issue_title="포장 파손이 반복됩니다", issue_type=issue_type, severity=severity,
        summary="여러 건에서 박스 파손이 확인됩니다.",
        recommended_action="포장 상태를 점검할 후보로 봐주세요.",
        review_ids=[f"r{i}" for i in range(5)],
        representatives=[_rep(f"r{i}") for i in range(reps)], judged=True,
    )


def test_severity_label_maps_operator_wording():
    assert severity_label("high") == "우선 확인"
    assert severity_label("medium") == "확인 필요"
    assert severity_label("low") == "참고"


def test_severity_label_unknown_passthrough():
    assert severity_label("urgent") == "urgent"


def test_issue_display_item_fields():
    item = issue_display_item(_cluster("high", issue_type="shipping"))
    assert item["issue_title"] == "포장 파손이 반복됩니다"
    assert item["severity"] == "high"
    assert item["severity_label"] == "우선 확인"
    assert item["type_label"] == "배송/포장"
    assert item["tag_label"] == "배송/포장 파손"
    assert item["review_count"] == 5
    assert item["summary"].startswith("여러 건")
    assert item["recommended_action"].endswith("봐주세요.")


def test_issue_display_item_reps_capped_and_verbatim():
    item = issue_display_item(_cluster("medium", reps=8), max_reps=3)
    assert len(item["reps"]) == 3
    rep = item["reps"][0]
    assert set(rep.keys()) == {"작성일", "채널", "평점", "상품명", "리뷰"}
    assert rep["리뷰"] == "원문 r0"  # verbatim, not paraphrased
    assert rep["평점"] == "1"


def test_issue_display_item_type_label_fallback():
    item = issue_display_item(_cluster("low", issue_type="product"))
    assert item["type_label"] == "제품"
    assert item["severity_label"] == "참고"


def test_issue_display_mode_params_known_modes():
    assert issue_display_mode_params("자동 추천") == (5, 3)
    assert issue_display_mode_params("적게 보기") == (3, 3)
    assert issue_display_mode_params("많이 보기") == (8, 5)


def test_issue_display_mode_params_unknown_falls_back_to_auto():
    assert issue_display_mode_params("아무거나") == (5, 3)
    assert issue_display_mode_params("") == (5, 3)
