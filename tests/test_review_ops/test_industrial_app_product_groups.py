"""Reviewable product-group scope presets. No OpenAI, no Streamlit E2E.

Covers the pure helpers only: assign_product_group (first-match-wins mapping),
compute_product_groups (bucketing the last result's product_summaries), and
expand_group_selection (group + individual -> raw-name filter). The sidebar
wiring (multiselects, 그룹 구성 보기 expander) is exercised by the manual smoke.
"""

from __future__ import annotations

from app_industrial_review_ops import (
    PRODUCT_GROUP_OTHER_ID,
    assign_product_group,
    compute_product_groups,
    expand_group_selection,
)


# --- assign_product_group ---------------------------------------------------


def test_molding_names_map_to_wire_molding():
    assert assign_product_group("(벌크) 신개념 일체형 전선몰딩 선바로 1P") == "wire_molding"
    assert assign_product_group("선바로 일체형 전선몰딩 열고 닫기 편한 전선몰드") == "wire_molding"
    assert assign_product_group("[벌크] 선바로 전선몰딩 전용 연결캡") == "wire_molding"


def test_pure_cup_maps_to_paper_cup():
    assert assign_product_group("나누리샵 세모금컵 4000매 생수컵 일회용종이컵") == "paper_cup"
    assert assign_product_group("나누리샵 세모금생수컵 일회용생수컵") == "paper_cup"


def test_hardware_names_map_to_cup_hardware():
    assert assign_product_group("컵보관함 수동 디스펜서 종이컵 홀더") == "cup_hardware"
    assert assign_product_group("종이컵 수거함 컵수거함 당겨바") == "cup_hardware"
    assert assign_product_group("나누리산업 꼬깔컵 수거기") == "cup_hardware"


def test_combo_cup_plus_dispenser_goes_to_hardware():
    # Combo SKU carries both 생수컵 and 디스펜서 tokens; hardware (rule 2) is
    # evaluated before the consumable cup (rule 3), so it lands in hardware.
    assert (
        assign_product_group("나누리샵 세모금컵 4000매 생수컵 + 하향식 디스펜서")
        == "cup_hardware"
    )


def test_unrelated_outlier_falls_to_other():
    assert (
        assign_product_group("스노우 누리젠/도시형 시티젠/아이젠/눈길 미끄럼방지/등산")
        == PRODUCT_GROUP_OTHER_ID
    )


def test_blank_and_none_fall_to_other():
    assert assign_product_group("") == PRODUCT_GROUP_OTHER_ID
    assert assign_product_group(None) == PRODUCT_GROUP_OTHER_ID


def test_precedence_is_locked_molding_before_hardware():
    # Synthetic name with both molding and hardware tokens -> molding wins.
    assert assign_product_group("전선몰딩 디스펜서 세트") == "wire_molding"


def test_precedence_is_locked_hardware_before_cup():
    # Synthetic name with both hardware and cup tokens -> hardware wins.
    assert assign_product_group("생수컵 디스펜서") == "cup_hardware"


# --- compute_product_groups -------------------------------------------------


def _summaries():
    # Mirrors the shape of compute_product_summaries output (count desc).
    return [
        {"product_name": "전선몰딩 선바로 1P", "review_count": 100,
         "average_rating": 4.0, "low_rating_count": 5, "recent_review_count": 10},
        {"product_name": "세모금컵 4000매 생수컵 일회용종이컵", "review_count": 80,
         "average_rating": 4.2, "low_rating_count": 3, "recent_review_count": 8},
        {"product_name": "컵보관함 수동 디스펜서 종이컵 홀더", "review_count": 50,
         "average_rating": 3.5, "low_rating_count": 10, "recent_review_count": 4},
        {"product_name": "선바로 전선몰딩 연결캡", "review_count": 20,
         "average_rating": 4.5, "low_rating_count": 1, "recent_review_count": 2},
        {"product_name": "세모금컵 4000매 생수컵 + 하향식 디스펜서", "review_count": 5,
         "average_rating": 4.0, "low_rating_count": 0, "recent_review_count": 1},
        {"product_name": "스노우 아이젠 미끄럼방지", "review_count": 1,
         "average_rating": 5.0, "low_rating_count": 0, "recent_review_count": 0},
    ]


def test_groups_ordered_and_other_last():
    groups = compute_product_groups(_summaries())
    assert [g["group_id"] for g in groups] == [
        "wire_molding", "cup_hardware", "paper_cup", PRODUCT_GROUP_OTHER_ID
    ]


def test_group_members_and_counts():
    groups = {g["group_id"]: g for g in compute_product_groups(_summaries())}
    # Members preserve summary (count-desc) order within a group.
    assert groups["wire_molding"]["products"] == ["전선몰딩 선바로 1P", "선바로 전선몰딩 연결캡"]
    assert groups["wire_molding"]["review_count"] == 120
    assert groups["wire_molding"]["low_rating_count"] == 6
    assert groups["cup_hardware"]["products"] == [
        "컵보관함 수동 디스펜서 종이컵 홀더", "세모금컵 4000매 생수컵 + 하향식 디스펜서"
    ]
    assert groups["cup_hardware"]["review_count"] == 55
    assert groups["paper_cup"]["review_count"] == 80
    assert groups[PRODUCT_GROUP_OTHER_ID]["review_count"] == 1


def test_other_dropped_when_nothing_unmatched():
    summaries = [s for s in _summaries() if "아이젠" not in s["product_name"]]
    ids = [g["group_id"] for g in compute_product_groups(summaries)]
    assert PRODUCT_GROUP_OTHER_ID not in ids


def test_partition_is_total_and_disjoint():
    summaries = _summaries()
    groups = compute_product_groups(summaries)
    members = [name for g in groups for name in g["products"]]
    # Every input SKU appears in exactly one group.
    assert sorted(members) == sorted(s["product_name"] for s in summaries)
    assert len(members) == len(set(members))


def test_compute_product_groups_empty():
    assert compute_product_groups([]) == []


# --- expand_group_selection -------------------------------------------------


def test_expand_group_only():
    groups = compute_product_groups(_summaries())
    assert expand_group_selection(["wire_molding"], [], groups) == {
        "전선몰딩 선바로 1P", "선바로 전선몰딩 연결캡"
    }


def test_expand_individual_only():
    groups = compute_product_groups(_summaries())
    assert expand_group_selection([], ["세모금컵 4000매 생수컵 일회용종이컵"], groups) == {
        "세모금컵 4000매 생수컵 일회용종이컵"
    }


def test_expand_group_and_individual_union():
    groups = compute_product_groups(_summaries())
    out = expand_group_selection(
        ["wire_molding"], ["세모금컵 4000매 생수컵 일회용종이컵"], groups
    )
    assert out == {
        "전선몰딩 선바로 1P", "선바로 전선몰딩 연결캡", "세모금컵 4000매 생수컵 일회용종이컵"
    }


def test_expand_dedupes_overlapping_individual():
    groups = compute_product_groups(_summaries())
    out = expand_group_selection(["wire_molding"], ["전선몰딩 선바로 1P"], groups)
    assert out == {"전선몰딩 선바로 1P", "선바로 전선몰딩 연결캡"}


def test_expand_nothing_selected_is_empty():
    groups = compute_product_groups(_summaries())
    assert expand_group_selection([], [], groups) == set()
