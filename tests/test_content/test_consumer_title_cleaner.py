"""Cardnews consumer-title cleaner — strips seller promo noise from raw
OliveYoung product names so cover headlines / cover titles never expose
strings like "[말끔모공]", "더블 기획", "리필기획", "100+100매" to consumers.

The cleaner exists in two near-identical forms (one in
src/voc/content/cardnews_long_layout.py, one in src/voc/content/editorial_planner.py)
because both modules independently render `_short_product_name` into the
cover. Tests cover both copies so they don't drift.
"""

from __future__ import annotations

import pytest

from src.voc.content.cardnews_long_layout import (
    _clean_consumer_title as clean_layout,
    _short_product_name as short_layout,
)
from src.voc.content.editorial_planner import (
    _clean_consumer_title as clean_planner,
    _short_product_name as short_planner,
)

_CLEANERS = (
    pytest.param(clean_layout, id="cardnews_long_layout"),
    pytest.param(clean_planner, id="editorial_planner"),
)
_SHORTS = (
    pytest.param(short_layout, id="cardnews_long_layout"),
    pytest.param(short_planner, id="editorial_planner"),
)


# ── 5 SKU-specific cases from visual QA ──────────────────────────────


@pytest.mark.parametrize("clean", _CLEANERS)
def test_beplain_cleansing_foam(clean):
    assert clean(
        "[말끔모공] 비플레인 녹두 약산성 클렌징폼 160ml 더블 기획"
    ) == "비플레인 녹두 약산성 클렌징폼"


@pytest.mark.parametrize("clean", _CLEANERS)
def test_hince_gel_tint(clean):
    assert clean(
        "[뮤트스위치글로스 증정/신규컬러] 힌스 로 글로우 젤 틴트 24 Colors 한정 기획"
    ) == "힌스 로 글로우 젤 틴트"


@pytest.mark.parametrize("clean", _CLEANERS)
def test_tirtir_red_cushion(clean):
    assert clean(
        "[NEW단독기획] 티르티르 마스크 핏 레드 쿠션 (기획/단품)"
    ) == "티르티르 마스크 핏 레드 쿠션"


@pytest.mark.parametrize("clean", _CLEANERS)
def test_fwee_pudding_pot(clean):
    assert clean(
        "[망곰콜라보] 퓌 립앤치크 블러리 푸딩팟 5g 단품/기획"
    ) == "퓌 립앤치크 블러리 푸딩팟"


@pytest.mark.parametrize("clean", _CLEANERS)
def test_fwee_cushion(clean):
    assert clean(
        "[퓌X민스코] 퓌 올데이 커버 블랙 쿠션 리필기획 5종"
    ) == "퓌 올데이 커버 블랙 쿠션"


@pytest.mark.parametrize("clean", _CLEANERS)
def test_already_clean_unchanged(clean):
    assert clean("무지개맨션 오브제 워터 틴트") == "무지개맨션 오브제 워터 틴트"


# ── extra robustness ──────────────────────────────────────────────────


@pytest.mark.parametrize("clean", _CLEANERS)
def test_empty_inputs_safe(clean):
    assert clean("") == ""
    assert clean(None) == ""


@pytest.mark.parametrize("clean", _CLEANERS)
def test_multiple_leading_brackets_stripped(clean):
    assert clean("[A][B] 브랜드 제품") == "브랜드 제품"


@pytest.mark.parametrize("clean", _CLEANERS)
def test_only_brackets_falls_back_to_original(clean):
    # If cleaning would empty the string, return the trimmed original
    # so we never blank out the title.
    assert clean("[전부괄호]") == "[전부괄호]"


@pytest.mark.parametrize("clean", _CLEANERS)
def test_capacity_in_middle_handled_via_trailing_iteration(clean):
    # Capacity is anchored at end; the iteration peels trailing promo
    # phrases first to expose it.
    assert clean(
        "[프로모] 메디힐 더마 패드 200매 대용량 기획 세트 7종 골라담기"
    ) == "메디힐 더마 패드"


# ── _short_product_name end-to-end (cleaner + truncate) ───────────────


@pytest.mark.parametrize("short", _SHORTS)
def test_short_product_name_strips_promo_then_truncates(short):
    out = short("[말끔모공] 비플레인 녹두 약산성 클렌징폼 160ml 더블 기획")
    assert "[말끔모공]" not in out
    assert "더블 기획" not in out
    assert "비플레인" in out
    assert len(out) <= 22


@pytest.mark.parametrize("short", _SHORTS)
def test_short_product_name_unchanged_for_already_clean_input(short):
    out = short("무지개맨션 오브제 워터 틴트")
    assert out == "무지개맨션 오브제 워터 틴트"


# ── consumer-cover regression: rendered banned tokens ─────────────────


_BANNED_IN_COVER_TITLE: tuple[str, ...] = (
    "[말끔모공]", "[뮤트스위치글로스", "[NEW단독기획]",
    "[망곰콜라보]", "[퓌X민스코]",
    "더블 기획", "단품/기획", "리필기획",
)


@pytest.mark.parametrize("clean", _CLEANERS)
def test_no_banned_promo_tokens_in_cleaned_titles(clean):
    raws = (
        "[말끔모공] 비플레인 녹두 약산성 클렌징폼 160ml 더블 기획",
        "[뮤트스위치글로스 증정/신규컬러] 힌스 로 글로우 젤 틴트 24 Colors 한정 기획",
        "[NEW단독기획] 티르티르 마스크 핏 레드 쿠션 (기획/단품)",
        "[망곰콜라보] 퓌 립앤치크 블러리 푸딩팟 5g 단품/기획",
        "[퓌X민스코] 퓌 올데이 커버 블랙 쿠션 리필기획 5종",
    )
    for raw in raws:
        out = clean(raw)
        for banned in _BANNED_IN_COVER_TITLE:
            assert banned not in out, f"{banned!r} still in {out!r} (raw={raw!r})"
