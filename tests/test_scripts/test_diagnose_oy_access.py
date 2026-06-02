"""Pure-function tests for `scripts/diagnose_oy_access.py`.

Loaded via importlib because the script lives outside the package
tree. Tests cover:
  - `parse_goods_no` edge cases
  - `decide_verdict` decision matrix across the five gate classes
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest


REPO = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def diag():
    sys.path.insert(0, str(REPO))
    spec = importlib.util.spec_from_file_location(
        "diag", REPO / "scripts" / "diagnose_oy_access.py",
    )
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ---------------------------------------------------------------------------
# parse_goods_no
# ---------------------------------------------------------------------------


class TestParseGoodsNo:
    def test_full_url(self, diag):
        gid, err = diag.parse_goods_no(
            "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do"
            "?goodsNo=A000000171427&tab=review",
        )
        assert gid == "A000000171427"
        assert err is None

    def test_bare_goods_no(self, diag):
        gid, err = diag.parse_goods_no("A000000171427")
        assert gid == "A000000171427"
        assert err is None

    def test_lowercase_bare_goods_no_uppercased(self, diag):
        gid, _ = diag.parse_goods_no("a000000171427")
        assert gid == "A000000171427"

    def test_lowercase_in_url_still_matches(self, diag):
        gid, _ = diag.parse_goods_no(
            "https://www.oliveyoung.co.kr/...?goodsno=a000000171427",
        )
        # Regex is case-insensitive; result is uppercased.
        assert gid == "A000000171427"

    def test_mobile_url(self, diag):
        gid, _ = diag.parse_goods_no(
            "https://m.oliveyoung.co.kr/m/store/goods/getGoodsDetail.do"
            "?goodsNo=A000000999999",
        )
        assert gid == "A000000999999"

    def test_empty_url(self, diag):
        gid, err = diag.parse_goods_no("")
        assert gid is None
        assert err == "empty url"

    def test_none_url(self, diag):
        gid, err = diag.parse_goods_no(None)
        assert gid is None
        assert err == "empty url"

    def test_whitespace_only(self, diag):
        gid, err = diag.parse_goods_no("   ")
        assert gid is None
        assert err == "empty url"

    def test_url_without_goods_no(self, diag):
        gid, err = diag.parse_goods_no(
            "https://www.oliveyoung.co.kr/store/main",
        )
        assert gid is None
        assert "goodsNo" in err

    def test_short_id_rejected(self, diag):
        # Less than 10 digits → not a valid goodsNo.
        gid, err = diag.parse_goods_no("A123")
        assert gid is None


# ---------------------------------------------------------------------------
# decide_verdict
# ---------------------------------------------------------------------------


def _base_obs(**overrides) -> dict:
    """Observation with all gates green by default."""
    obs = {
        "goods_no_parse_ok": True,
        "browser_attach": {"ok": True, "mode": "cdp", "error": None},
        "page_open": {
            "ok": True, "title": "x", "final_url": "x",
            "elapsed_ms": 1000, "error": None,
        },
        "interstitial_markers_seen": [],
        "human_check_detected": False,
        "login_wall_detected": False,
        "breadcrumb_visible": True,
        "breadcrumb_path": ["뷰티", "스킨케어", "패드"],
        "review_tab_visible": True,
        "review_card_visible": True,
        "review_api_observed": {
            "fired": True, "elapsed_ms": 4500, "first_status": 200,
        },
    }
    obs.update(overrides)
    return obs


class TestDecideVerdict:
    def test_all_green_yields_ok(self, diag):
        v, _, _ = diag.decide_verdict(_base_obs())
        assert v == "ok"

    def test_url_parse_error_takes_precedence(self, diag):
        obs = _base_obs(goods_no_parse_ok=False)
        v, reason, actions = diag.decide_verdict(obs)
        assert v == "url_parse_error"
        assert "goodsNo" in reason
        assert any("goodsNo" in a for a in actions)

    def test_browser_attach_cdp_failure(self, diag):
        obs = _base_obs(browser_attach={
            "ok": False, "mode": "cdp",
            "cdp_endpoint": "http://localhost:9222",
            "error": "ECONNREFUSED",
        })
        v, reason, actions = diag.decide_verdict(obs)
        assert v == "browser_attach_error"
        assert "ECONNREFUSED" in reason
        assert any("9222" in a for a in actions)

    def test_browser_attach_owned_failure(self, diag):
        obs = _base_obs(browser_attach={
            "ok": False, "mode": "owned",
            "cdp_endpoint": None, "error": "missing chromium",
        })
        v, _, actions = diag.decide_verdict(obs)
        assert v == "browser_attach_error"
        assert any("playwright install" in a.lower() for a in actions)

    def test_page_open_timeout_classified_as_network(self, diag):
        obs = _base_obs(page_open={
            "ok": False, "title": None, "final_url": None,
            "elapsed_ms": None,
            "error": "TimeoutError: Timeout 30000ms exceeded.",
        })
        v, _, actions = diag.decide_verdict(obs)
        assert v == "network_throttle"
        assert any("network" in a.lower() or "ip" in a.lower() for a in actions)

    def test_page_open_net_error_classified_as_network(self, diag):
        obs = _base_obs(page_open={
            "ok": False, "title": None, "final_url": None,
            "elapsed_ms": None,
            "error": "Error: net::ERR_CONNECTION_RESET at https://...",
        })
        v, _, _ = diag.decide_verdict(obs)
        assert v == "network_throttle"

    def test_page_open_other_error(self, diag):
        obs = _base_obs(page_open={
            "ok": False, "title": None, "final_url": None,
            "elapsed_ms": None, "error": "RendererCrashed",
        })
        v, _, _ = diag.decide_verdict(obs)
        assert v == "page_open_error"

    def test_login_required_takes_precedence_over_anti_bot(self, diag):
        # The probe sets BOTH flags if both kinds of markers happened
        # to match. Login wall is the more actionable signal — it
        # should win.
        obs = _base_obs(
            login_wall_detected=True,
            human_check_detected=True,
            interstitial_markers_seen=["로그인이 필요"],
        )
        v, reason, actions = diag.decide_verdict(obs)
        assert v == "login_required"
        assert "로그인" in reason or "Login" in reason
        assert any("Sign into" in a or "log in" in a.lower() for a in actions)

    def test_anti_bot_when_only_human_check_marker(self, diag):
        obs = _base_obs(
            human_check_detected=True,
            interstitial_markers_seen=["잠시만 기다려"],
        )
        v, reason, actions = diag.decide_verdict(obs)
        assert v == "anti_bot"
        assert any(
            "CAPTCHA" in a or "본인 확인" in a or "강 " in a
            or "fresh CDP" in a or "reset" in a.lower()
            for a in actions
        )

    def test_review_load_race_when_api_missing(self, diag):
        obs = _base_obs(
            review_api_observed={
                "fired": False, "elapsed_ms": None, "first_status": None,
            },
        )
        v, reason, _ = diag.decide_verdict(obs)
        assert v == "review_load_race"
        assert "Cursor API" in reason or "fire" in reason

    def test_review_load_race_when_review_tab_missing(self, diag):
        obs = _base_obs(
            review_tab_visible=False,
            review_card_visible=False,
        )
        v, reason, _ = diag.decide_verdict(obs)
        assert v == "review_load_race"
        assert "review" in reason.lower() or "Review" in reason

    def test_review_load_race_when_breadcrumb_missing(self, diag):
        obs = _base_obs(breadcrumb_visible=False, breadcrumb_path=[])
        v, _, _ = diag.decide_verdict(obs)
        assert v == "review_load_race"

    def test_ok_requires_all_three(self, diag):
        # API fired AND review surface visible AND breadcrumb visible.
        # Drop any one and verdict should NOT be ok.
        for missing in (
            "review_api_observed",
            "review_tab_visible",
            "breadcrumb_visible",
        ):
            obs = _base_obs()
            if missing == "review_api_observed":
                obs[missing] = {"fired": False, "elapsed_ms": None, "first_status": None}
            else:
                obs[missing] = False
                if missing == "review_tab_visible":
                    obs["review_card_visible"] = False
            v, _, _ = diag.decide_verdict(obs)
            assert v != "ok", missing

    def test_review_tab_OR_card_satisfies_review_visibility(self, diag):
        # If only the card is visible (tab DOM missing), API fired,
        # breadcrumb visible → still considered "ok" because the
        # review surface is reachable.
        obs = _base_obs(review_tab_visible=False, review_card_visible=True)
        v, _, _ = diag.decide_verdict(obs)
        assert v == "ok"

    def test_next_actions_always_populated(self, diag):
        # Every verdict path should set at least one actionable step.
        for case in (
            _base_obs(goods_no_parse_ok=False),
            _base_obs(browser_attach={"ok": False, "mode": "cdp", "error": "x"}),
            _base_obs(page_open={"ok": False, "error": "TimeoutError"}),
            _base_obs(login_wall_detected=True),
            _base_obs(human_check_detected=True),
            _base_obs(review_api_observed={
                "fired": False, "elapsed_ms": None, "first_status": None,
            }),
            _base_obs(),
        ):
            v, reason, actions = diag.decide_verdict(case)
            assert reason, v
            assert isinstance(actions, list) and actions, v
