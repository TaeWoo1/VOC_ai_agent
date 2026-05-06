"""Pure-helper tests for `scripts/diagnose_oy_review_access.py`.

The async Playwright probe itself is exercised manually against
real Chrome (it's an exploratory diagnostic, not a CI gate). These
tests cover the helpers that drive the verdict + privacy contracts.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
SCRIPT = REPO / "scripts" / "diagnose_oy_review_access.py"


@pytest.fixture(scope="module")
def diag():
    sys.path.insert(0, str(REPO))
    spec = importlib.util.spec_from_file_location(
        "diagnose_oy_review_access_test", SCRIPT,
    )
    mod = importlib.util.module_from_spec(spec)
    # Register in sys.modules BEFORE exec — the @dataclass decorator
    # in Python 3.13+ looks up cls.__module__ in sys.modules during
    # class construction, which fails for spec-loaded modules unless
    # they're registered first.
    sys.modules["diagnose_oy_review_access_test"] = mod
    spec.loader.exec_module(mod)
    return mod


# ---------------------------------------------------------------------------
# parse_goods_no
# ---------------------------------------------------------------------------


class TestParseGoodsNo:
    def test_full_url(self, diag):
        gid, err = diag.parse_goods_no(
            "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=A000000171427"
        )
        assert gid == "A000000171427"
        assert err is None

    def test_bare_goods_no(self, diag):
        gid, err = diag.parse_goods_no("A000000171427")
        assert gid == "A000000171427"
        assert err is None

    def test_empty_url(self, diag):
        gid, err = diag.parse_goods_no("")
        assert gid is None
        assert err is not None

    def test_url_without_goods_no(self, diag):
        gid, err = diag.parse_goods_no("https://example.com/foo")
        assert gid is None
        assert err is not None


# ---------------------------------------------------------------------------
# is_review_related_url
# ---------------------------------------------------------------------------


class TestIsReviewRelatedUrl:
    @pytest.mark.parametrize("url", [
        "https://www.oliveyoung.co.kr/review/api/v2/reviews/cursor",
        "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do",
        "https://api.com/gdas/list",
        "https://api.com/evaluation",
        "https://api.com/comment/list",
        "https://x.com/sort?type=latest",
        "https://x.com/recm/items",
        "https://example.com/?goodsNo=A0000",
    ])
    def test_match(self, diag, url):
        assert diag.is_review_related_url(url) is True

    @pytest.mark.parametrize("url", [
        "https://www.oliveyoung.co.kr/static/main.css",
        "https://example.com/promo/banner",
        "https://api.com/auth/refresh",
    ])
    def test_no_match(self, diag, url):
        assert diag.is_review_related_url(url) is False

    def test_none_returns_false(self, diag):
        assert diag.is_review_related_url(None) is False


# ---------------------------------------------------------------------------
# strip_sensitive_headers
# ---------------------------------------------------------------------------


class TestStripSensitiveHeaders:
    def test_strips_authorization(self, diag):
        out = diag.strip_sensitive_headers({
            "Authorization": "Bearer abc",
            "Content-Type": "application/json",
        })
        assert "Authorization" not in out
        assert out["Content-Type"] == "application/json"

    def test_case_insensitive(self, diag):
        out = diag.strip_sensitive_headers({
            "authorization": "Bearer abc",
            "AUTHORIZATION": "Bearer xyz",
            "Cookie": "session=…",
            "Set-Cookie": "session=…",
            "X-CSRF-Token": "tok",
            "X-Api-Key": "key",
            "X-Auth-Token": "auth",
            "X-Custom": "ok",
        })
        assert out == {"X-Custom": "ok"}

    def test_empty_input(self, diag):
        assert diag.strip_sensitive_headers({}) == {}
        assert diag.strip_sensitive_headers(None) == {}


# ---------------------------------------------------------------------------
# cap_text
# ---------------------------------------------------------------------------


class TestCapText:
    def test_short_passes_through(self, diag):
        assert diag.cap_text("hello", 10) == "hello"

    def test_long_truncated(self, diag):
        out = diag.cap_text("a" * 100, 10)
        assert out.startswith("a" * 10)
        assert "truncated" in out

    def test_bytes_input(self, diag):
        out = diag.cap_text(b"hi there", 100)
        assert out == "hi there"

    def test_none_returns_empty(self, diag):
        assert diag.cap_text(None, 100) == ""


# ---------------------------------------------------------------------------
# Verdict classification matrix
# ---------------------------------------------------------------------------


class TestClassifyVerdict:
    def _inputs(self, diag, **overrides):
        # Default inputs: clean run where API fired and was happy.
        # The new fields `review_meta_api_seen` / `review_list_api_seen`
        # default to True/True (consistent with `review_api_fired`).
        base = dict(
            browser_attached=True,
            page_opened=True,
            login_markers=[],
            captcha_markers=[],
            empty_review_marker=False,
            review_tab_clicked=True,
            review_api_fired=True,
            review_api_returned_empty=False,
            review_count_badge=None,
            review_meta_api_seen=True,
            review_list_api_seen=True,
        )
        # Allow callers to set `review_api_fired` and have
        # `review_list_api_seen` follow when not explicitly overridden.
        base.update(overrides)
        if "review_api_fired" in overrides and "review_list_api_seen" not in overrides:
            base["review_list_api_seen"] = base["review_api_fired"]
        return diag._ClassificationInputs(**base)

    def test_attach_failure(self, diag):
        v, _ = diag.classify_verdict(self._inputs(diag, browser_attached=False))
        assert v == "browser_attach_error"

    def test_page_open_failure(self, diag):
        v, _ = diag.classify_verdict(self._inputs(diag, page_opened=False))
        assert v == "browser_attach_error"

    def test_login_required(self, diag):
        v, _ = diag.classify_verdict(self._inputs(
            diag, login_markers=["로그인이 필요"],
        ))
        assert v == "login_required"

    def test_anti_bot(self, diag):
        v, _ = diag.classify_verdict(self._inputs(
            diag, captcha_markers=["본인 확인"],
        ))
        assert v == "anti_bot_or_challenge"

    def test_review_api_empty_when_api_fired_but_dom_empty(self, diag):
        """The headline case for the operator's bug report — CDP
        Chrome shows the empty-marker but the API DID fire."""
        v, reason = diag.classify_verdict(self._inputs(
            diag,
            review_api_fired=True,
            review_api_returned_empty=True,
            empty_review_marker=True,
        ))
        assert v == "review_api_empty"
        assert "session" in reason.lower() or "cookie" in reason.lower() \
            or "ip" in reason.lower()

    def test_review_api_not_seen(self, diag):
        v, _ = diag.classify_verdict(self._inputs(
            diag,
            review_tab_clicked=True,
            review_api_fired=False,
            review_api_returned_empty=False,
        ))
        assert v == "review_api_not_seen"

    def test_selector_mismatch(self, diag):
        v, _ = diag.classify_verdict(self._inputs(
            diag,
            review_tab_clicked=False,
            review_api_fired=False,
        ))
        assert v == "selector_mismatch"

    def test_false_empty_dom(self, diag):
        """Empty marker present but no other classifying signal —
        the rare edge case."""
        v, _ = diag.classify_verdict(self._inputs(
            diag,
            review_tab_clicked=True,
            review_api_fired=True,
            review_api_returned_empty=False,
            empty_review_marker=True,
        ))
        assert v == "false_empty_dom"

    def test_unknown(self, diag):
        v, _ = diag.classify_verdict(self._inputs(
            diag,
            review_tab_clicked=True,
            review_api_fired=True,
            review_api_returned_empty=False,
            empty_review_marker=False,
            review_list_api_seen=True,
        ))
        assert v == "unknown"

    def test_review_list_api_not_seen_but_review_meta_seen(self, diag):
        """The headline new verdict from the 2026-05-01 user bug:
        meta APIs fire (stats / options / photo / extra), the page
        DOM has a review count badge, but the main list API never
        fires. Must NOT classify as anti_bot, unknown, or false_empty."""
        v, reason = diag.classify_verdict(self._inputs(
            diag,
            review_tab_clicked=True,
            review_api_fired=False,
            review_list_api_seen=False,
            review_meta_api_seen=True,
            review_count_badge="73,837",
            empty_review_marker=True,
        ))
        assert v == diag.VERDICT_REVIEW_LIST_API_NOT_SEEN_BUT_REVIEW_META_SEEN
        # Reason must explicitly disclaim anti-bot.
        assert "anti-bot" in reason.lower() or "not anti-bot" in reason.lower()

    def test_meta_seen_alone_without_badge_is_not_promoted(self, diag):
        """If meta APIs fire but neither badge nor empty-marker is
        present, we don't promote — falls back to review_api_not_seen."""
        v, _ = diag.classify_verdict(self._inputs(
            diag,
            review_tab_clicked=True,
            review_api_fired=False,
            review_list_api_seen=False,
            review_meta_api_seen=True,
            review_count_badge=None,
            empty_review_marker=False,
        ))
        assert v == "review_api_not_seen"

    def test_no_anti_bot_unless_markers_present(self, diag):
        """Critical contract: the verdict must NOT be anti_bot when
        no challenge/login markers are actually present, even when
        review APIs are missing."""
        v, _ = diag.classify_verdict(self._inputs(
            diag,
            captcha_markers=[],
            login_markers=[],
            review_tab_clicked=True,
            review_api_fired=False,
            review_list_api_seen=False,
            review_meta_api_seen=True,
            review_count_badge="73,837",
            empty_review_marker=True,
        ))
        assert v != "anti_bot_or_challenge"
        assert v != "login_required"

    def test_review_list_api_seen_with_content_takes_precedence(self, diag):
        """The 2026-05-01 captured-cursor case: list API fired AND
        body had `goodsReviewList` content. Verdict must be
        `review_list_api_seen` — pinpoints connector / parser as the
        bottleneck, NOT browser / profile / anti-bot."""
        v, reason = diag.classify_verdict(self._inputs(
            diag,
            review_tab_clicked=True,
            review_api_fired=True,
            review_list_api_seen=True,
            review_meta_api_seen=True,
            review_list_reviews_seen_in_body=12,
            empty_review_marker=False,
            review_api_returned_empty=False,
        ))
        assert v == diag.VERDICT_REVIEW_LIST_API_SEEN
        # Reason directs attention to connector / parser.
        assert "connector" in reason.lower() or "parser" in reason.lower()

    def test_review_list_api_seen_with_zero_body_falls_through(self, diag):
        """API URL fired but body had 0 reviewIds → don't promote.
        Other paths (review_api_empty / unknown) still apply."""
        v, _ = diag.classify_verdict(self._inputs(
            diag,
            review_tab_clicked=True,
            review_api_fired=True,
            review_list_api_seen=True,
            review_list_reviews_seen_in_body=0,
            empty_review_marker=True,
            review_api_returned_empty=True,
        ))
        assert v != diag.VERDICT_REVIEW_LIST_API_SEEN

    def test_classify_does_not_label_as_anti_bot_for_captured_case(
        self, diag,
    ):
        """Belt-and-suspenders: the diagnostic must NEVER classify
        the user's captured-list-API case as `anti_bot_or_challenge`
        or `review_list_api_not_seen_but_review_meta_seen`. Both
        would mislead the operator."""
        v, _ = diag.classify_verdict(self._inputs(
            diag,
            captcha_markers=[],
            login_markers=[],
            review_tab_clicked=True,
            review_api_fired=True,
            review_list_api_seen=True,
            review_meta_api_seen=True,
            review_list_reviews_seen_in_body=10,
            empty_review_marker=False,
        ))
        assert v != "anti_bot_or_challenge"
        assert v != "review_list_api_not_seen_but_review_meta_seen"
        assert v != "unknown"

    def test_cdp_attach_failed_takes_priority(self, diag):
        """Added 2026-05-01. When `cdp_attach_error` is non-empty, the
        verdict is `cdp_attach_failed` regardless of every other input
        (the error string carries the actual cause and the rest of the
        signals are zeroed out anyway)."""
        v, reason = diag.classify_verdict(self._inputs(
            diag,
            browser_attached=False,
            page_opened=False,
            cdp_attach_error=(
                "Error: BrowserType.connect_over_cdp: Protocol error "
                "(Browser.setDownloadBehavior): Browser context "
                "management is not supported."
            ),
        ))
        assert v == diag.VERDICT_CDP_ATTACH_FAILED
        assert "setDownloadBehavior" in reason

    def test_page_open_failed_distinct_from_cdp(self, diag):
        """Added 2026-05-01. `page_open_error` set with no
        `cdp_attach_error` → `page_open_failed`."""
        v, reason = diag.classify_verdict(self._inputs(
            diag,
            browser_attached=True,
            page_opened=False,
            page_open_error="Error: ERR_NAME_NOT_RESOLVED",
        ))
        assert v == diag.VERDICT_PAGE_OPEN_FAILED
        assert "ERR_NAME_NOT_RESOLVED" in reason

    def test_cdp_takes_priority_over_page_open(self, diag):
        """When both error fields are populated (defensive), the CDP
        attach error wins because attach is chronologically first."""
        v, _ = diag.classify_verdict(self._inputs(
            diag,
            browser_attached=False, page_opened=False,
            cdp_attach_error="Error: connect_over_cdp",
            page_open_error="Error: page.goto",
        ))
        assert v == diag.VERDICT_CDP_ATTACH_FAILED

    def test_verdict_never_none_on_attach_failure(self, diag):
        """Acceptance contract: every classify_verdict call returns a
        non-None verdict string. Even with all-default inputs (the
        most degenerate state) the function returns SOMETHING."""
        v, reason = diag.classify_verdict(self._inputs(
            diag,
            browser_attached=False,
            page_opened=False,
        ))
        assert v is not None
        assert isinstance(v, str) and v
        assert reason is not None and isinstance(reason, str)


# ---------------------------------------------------------------------------
# `_finalize_classification` helper + `_print_summary` defensive None-guard.
# Added 2026-05-01.
# ---------------------------------------------------------------------------


class TestFinalizeClassification:
    def _seed_result(self, diag, out_dir):
        """Build a result dict matching the shape `_async_diagnose`
        creates — minimum needed by the helper."""
        return {
            "schema_version": "1.1",
            "browser": {"attached": False, "userAgent": None, "error": None},
            "page": {
                "opened": False, "url": None, "title": None,
                "load_ms": None, "error": None,
            },
            "session": {},
            "dom": {
                "page_text_length": None,
                "empty_review_marker": False,
                "empty_review_marker_after": False,
                "login_markers_seen": [],
                "captcha_markers_seen": [],
                "review_tab_visible": False,
                "review_tab_selector": None,
                "review_tab_clicked": False,
                "review_count_badge_text": None,
                "sort_button_labels": [],
            },
            "network": {
                "review_list_api_seen": False,
                "review_meta_api_seen": False,
                "review_list_api_responses": [],
                "review_meta_api_responses": [],
                "captured_count": 0,
            },
            "verdict": None,
            "verdict_reason": "",
            "next_actions": [],
            "artifacts": {"out_dir": str(out_dir)},
            "skipped_artifacts": [],
        }

    def test_helper_writes_cdp_verdict(self, diag, tmp_path):
        result = self._seed_result(diag, tmp_path)
        diag._finalize_classification(
            result,
            cdp_attach_error="Error: connect_over_cdp: setDownloadBehavior",
        )
        assert result["verdict"] == diag.VERDICT_CDP_ATTACH_FAILED
        assert "setDownloadBehavior" in result["verdict_reason"]
        assert isinstance(result["next_actions"], list)
        assert result["next_actions"]  # non-empty

    def test_helper_writes_page_open_verdict(self, diag, tmp_path):
        result = self._seed_result(diag, tmp_path)
        result["browser"]["attached"] = True
        diag._finalize_classification(
            result,
            page_open_error="Error: ERR_CONNECTION_REFUSED",
        )
        assert result["verdict"] == diag.VERDICT_PAGE_OPEN_FAILED
        assert "ERR_CONNECTION_REFUSED" in result["verdict_reason"]

    def test_helper_idempotent(self, diag, tmp_path):
        """Calling the helper twice with the same inputs writes the
        same verdict — no accumulation, no double-actions."""
        result = self._seed_result(diag, tmp_path)
        diag._finalize_classification(
            result, cdp_attach_error="Error: foo",
        )
        first_verdict = result["verdict"]
        first_actions = list(result["next_actions"])
        diag._finalize_classification(
            result, cdp_attach_error="Error: foo",
        )
        assert result["verdict"] == first_verdict
        assert result["next_actions"] == first_actions

    def test_helper_never_leaves_verdict_none(self, diag, tmp_path):
        """Acceptance contract: the helper writes a verdict even
        with all-default inputs (no error strings)."""
        result = self._seed_result(diag, tmp_path)
        diag._finalize_classification(result)
        assert result["verdict"] is not None
        assert isinstance(result["verdict"], str) and result["verdict"]


class TestPrintSummary:
    def test_print_summary_handles_none_verdict_defensively(self, diag, capsys):
        """If a future caller bypasses `_finalize_classification`
        and `verdict` is still None, the CLI must NOT print the
        literal string 'None' — fall back to 'unknown_error'."""
        result = {
            "verdict": None,
            "verdict_reason": "",
            "next_actions": [],
            "artifacts": {"out_dir": "/tmp/none"},
            "skipped_artifacts": [],
        }
        diag._print_summary(result)
        captured = capsys.readouterr()
        # The defensive fallback string must appear verbatim.
        assert "Verdict: unknown_error" in captured.out
        # AND the literal "Verdict: None" must NOT appear.
        assert "Verdict: None" not in captured.out

    def test_print_summary_surfaces_skipped_artifacts(self, diag, capsys):
        """Files marked as skipped show their reason inline so the
        operator doesn't read '(not created)' as a normal outcome."""
        result = {
            "verdict": "cdp_attach_failed",
            "verdict_reason": "Playwright connect_over_cdp raised: ...",
            "next_actions": [],
            "artifacts": {"out_dir": "/tmp/skip"},
            "skipped_artifacts": [
                {"artifact": "screenshot_before",
                 "reason": "cdp_attach_failed"},
                {"artifact": "page_text",
                 "reason": "cdp_attach_failed"},
            ],
        }
        diag._print_summary(result)
        out = capsys.readouterr().out
        assert "screenshot_before.png (skipped: cdp_attach_failed)" in out
        assert "page_text.txt (skipped: cdp_attach_failed)" in out

    def test_print_summary_shows_browser_error(self, diag, capsys):
        """`browser.error` is printed under the verdict so the
        operator can read the underlying string without opening
        diagnostic_summary.json."""
        result = {
            "verdict": "cdp_attach_failed",
            "verdict_reason": "Playwright connect_over_cdp raised: foo",
            "next_actions": [],
            "browser": {"error": "Error: setDownloadBehavior: not supported"},
            "page": {"error": None, "opened": False},
            "artifacts": {"out_dir": "/tmp"},
            "skipped_artifacts": [],
        }
        diag._print_summary(result)
        out = capsys.readouterr().out
        assert "browser.error: Error: setDownloadBehavior" in out


# ---------------------------------------------------------------------------
# Predicate tightening — image / asset URLs must NOT classify as list API.
# ---------------------------------------------------------------------------


class TestPredicateExcludesAssets:
    @pytest.mark.parametrize("url", [
        "https://image.oliveyoung.co.kr/cfimages/contents/review/wc/empty-default.png",
        "https://image.oliveyoung.co.kr/static/gdasEditor.js",
        "https://cdn.example.com/cursor.png",
        "https://cdn.example.com/gdas.css",
        "https://cdn.example.com/cursor.svg",
    ])
    def test_asset_urls_not_list_api(self, diag, url):
        """Image and asset URLs (gdasEditor / cfimages / .png /
        .css / .svg) must NOT register as list API matches even
        though the secondary URL hints (`cursor`, `gdas`) appear
        in them."""
        assert diag.is_review_list_api(url) is False

    def test_real_mobile_cursor_endpoint_still_matches(self, diag):
        """Sanity: the mobile cursor endpoint the user captured
        must still classify as list API."""
        assert diag.is_review_list_api(
            "https://m.oliveyoung.co.kr/review/api/v2/reviews/cursor",
        ) is True

    def test_real_desktop_cursor_endpoint_still_matches(self, diag):
        """Desktop counterpart matches too — host-agnostic match
        by path."""
        assert diag.is_review_list_api(
            "https://www.oliveyoung.co.kr/review/api/v2/reviews/cursor",
        ) is True


# ---------------------------------------------------------------------------
# Body content scanners — review counter heuristics.
# ---------------------------------------------------------------------------


class TestBodyContentScanners:
    def test_body_has_review_content_counts_reviewids(self, diag):
        body = (
            '{"data":{"goodsReviewList":['
            '{"reviewId":1},'
            '{"reviewId":2},'
            '{"reviewId":3}]}}'
        )
        assert diag.body_has_review_content(body) == 3

    def test_body_has_review_content_no_marker_returns_zero(self, diag):
        assert diag.body_has_review_content('{"foo":"bar"}') == 0
        assert diag.body_has_review_content(None) == 0
        assert diag.body_has_review_content("") == 0

    def test_body_count_target_goods_no(self, diag):
        body = (
            '{"data":{"goodsReviewList":['
            '{"reviewId":1,"goodsDto":{"goodsNumber":"A000000171427"}},'
            '{"reviewId":2,"goodsDto":{"goodsNumber":"A000000171426"}},'
            '{"reviewId":3,"goodsDto":{"goodsNumber":"A000000171427"}}]}}'
        )
        assert diag.body_count_target_goods_no(body, "A000000171427") == 2
        assert diag.body_count_target_goods_no(body, "A000000171426") == 1
        assert diag.body_count_target_goods_no(body, "A000000999999") == 0

    def test_body_count_handles_missing_inputs(self, diag):
        assert diag.body_count_target_goods_no("", "A0") == 0
        assert diag.body_count_target_goods_no("body", "") == 0
        assert diag.body_count_target_goods_no(None, "A0") == 0


# ---------------------------------------------------------------------------
# is_review_list_api / is_review_meta_api predicates
# ---------------------------------------------------------------------------


class TestReviewListApiPredicate:
    @pytest.mark.parametrize("url", [
        "https://www.oliveyoung.co.kr/review/api/v2/reviews/cursor",
        "https://www.oliveyoung.co.kr/review/api/v2/reviews/A000000171427",
        "https://www.oliveyoung.co.kr/review/api/v2/reviews?sort=DATE",
    ])
    def test_matches_list_api(self, diag, url):
        assert diag.is_review_list_api(url) is True

    @pytest.mark.parametrize("url", [
        "https://www.oliveyoung.co.kr/review/api/v2/reviews/photo-reviews",
        "https://www.oliveyoung.co.kr/review/api/v2/reviews/options/A000000171427/count",
        "https://www.oliveyoung.co.kr/review/api/v2/reviews/A000000171427/stats",
    ])
    def test_excludes_meta_endpoints(self, diag, url):
        assert diag.is_review_list_api(url) is False

    def test_secondary_url_with_body(self, diag):
        """Cursor / gdas hint with body confirmation."""
        assert diag.is_review_list_api(
            "https://api/cursor/v1",
            body='{"reviewList":[{"id":"r1"}]}',
        ) is True

    def test_secondary_url_no_body_still_matches(self, diag):
        """Hint alone is sufficient — being over-inclusive in the
        list direction is the safer error."""
        assert diag.is_review_list_api(
            "https://api/cursor/v1", body=None,
        ) is True


class TestReviewMetaApiPredicate:
    @pytest.mark.parametrize("url", [
        "https://www.oliveyoung.co.kr/review/api/v2/reviews/photo-reviews",
        "https://www.oliveyoung.co.kr/review/api/v2/reviews/options/A000/count",
        "https://www.oliveyoung.co.kr/review/api/v2/reviews/A000/stats",
        "https://www.oliveyoung.co.kr/goods/api/v1/extra?goodsNo=A000",
    ])
    def test_matches_meta(self, diag, url):
        assert diag.is_review_meta_api(url) is True

    @pytest.mark.parametrize("url", [
        "https://www.oliveyoung.co.kr/review/api/v2/reviews/cursor",
        "https://www.oliveyoung.co.kr/review/api/v2/reviews/A000",
        "https://www.oliveyoung.co.kr/static/main.css",
    ])
    def test_excludes_non_meta(self, diag, url):
        assert diag.is_review_meta_api(url) is False


# ---------------------------------------------------------------------------
# next_actions_for — every verdict should have an actionable list.
# ---------------------------------------------------------------------------


class TestNextActions:
    @pytest.mark.parametrize("verdict", [
        "browser_attach_error", "url_parse_error", "login_required",
        "anti_bot_or_challenge", "review_api_empty",
        "review_api_not_seen", "selector_mismatch",
        "false_empty_dom", "unknown",
        "review_list_api_not_seen_but_review_meta_seen",
    ])
    def test_each_verdict_has_actions(self, diag, verdict):
        actions = diag.next_actions_for(verdict)
        assert isinstance(actions, list)
        assert len(actions) >= 1
        # Each action is a non-empty string.
        for a in actions:
            assert isinstance(a, str) and a.strip()

    def test_review_api_empty_advises_against_reset(self, diag):
        """Critical contract: when CDP shows empty but normal Chrome
        works, the diagnostic must tell the operator NOT to reset."""
        actions = diag.next_actions_for("review_api_empty")
        joined = " ".join(actions).lower()
        assert "do not reset" in joined or "don't reset" in joined

    def test_anti_bot_advises_against_reset_too(self, diag):
        """Anti-bot is also not a profile-state problem."""
        actions = diag.next_actions_for("anti_bot_or_challenge")
        joined = " ".join(actions).lower()
        assert "do not reset" in joined or "don't reset" in joined

    def test_new_verdict_advises_against_reset_and_anti_bot_label(self, diag):
        """Operator's explicit constraint: the new verdict's
        next-actions must NOT add infinite retries, must NOT auto-
        reset, and must NOT call this anti-bot."""
        actions = diag.next_actions_for(
            "review_list_api_not_seen_but_review_meta_seen",
        )
        joined = " ".join(actions).lower()
        assert "do not reset" in joined or "don't reset" in joined
        assert "do not classify this as anti-bot" in joined or (
            "not anti-bot" in joined
        )
        assert "infinite retr" in joined

    def test_cdp_attach_failed_actions_do_not_claim_pin_is_guaranteed(self, diag):
        """2026-05-01 — Playwright 1.57.0 was attempted and STILL hit
        the wall. The next-actions text must not claim that
        downgrading Playwright (or any version pin) is a guaranteed
        fix. Banned phrasings: language that implies the pin alone
        resolves the issue."""
        actions = diag.next_actions_for(diag.VERDICT_CDP_ATTACH_FAILED)
        joined = " ".join(actions).lower()
        # Must point at the bundled-Chromium launcher (workaround #1).
        assert "open_oy_chromium_debug" in joined
        # Must NOT claim that a Playwright pin alone is the fix.
        # The phrase shape we ban: "pin Playwright to <= 1.57" stated
        # without the "still reproduces" qualifier. The simplest test:
        # if the text mentions a Playwright pin, it must also flag
        # that the pin was attempted and is unverified.
        if "playwright" in joined and "1.5" in joined:
            assert (
                "still reproduced" in joined
                or "unverified" in joined
                or "not a guaranteed" in joined
            )


# ---------------------------------------------------------------------------
# Privacy contract — at the constants level.
# ---------------------------------------------------------------------------


class TestPrivacyContract:
    def test_sensitive_headers_includes_canonical_set(self, diag):
        s = diag.SENSITIVE_HEADER_NAMES
        for h in (
            "authorization", "cookie", "set-cookie",
            "x-auth-token", "x-csrf-token", "x-api-key",
        ):
            assert h in s

    def test_response_body_cap_is_bounded(self, diag):
        """Cap must be small enough that accidental PII inclusion
        is bounded. Hard ceiling: 16 KB (anything bigger reads like
        a dump, not a preview)."""
        assert diag.RESPONSE_BODY_CAP <= 16 * 1024

    def test_request_body_cap_smaller_than_response(self, diag):
        assert diag.REQUEST_BODY_CAP <= diag.RESPONSE_BODY_CAP


# ---------------------------------------------------------------------------
# CLI argparse — bad URL exits 3 BEFORE attempting CDP attach.
# ---------------------------------------------------------------------------


class TestCLIArgs:
    def test_bad_url_exits_3(self, diag):
        rc = diag.main(["--product-url", "not-a-url"])
        assert rc == 3
