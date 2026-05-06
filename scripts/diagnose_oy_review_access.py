#!/usr/bin/env python3
"""Network-aware diagnostic for OliveYoung review-page access.

When normal Chrome shows reviews but the CDP-attached Chrome shows
"등록된 리뷰가 없어요", retry / reset is the wrong tool — the issue is
session / cookie / fingerprint / IP divergence between profiles, not
anti-bot. This script attaches to the existing CDP Chrome (does NOT
launch a new one), opens the product URL, captures every review-
related network event, and produces an evidence-grade report.

Read-only on the running Chrome's session. The diagnostic does not
modify cookies, localStorage, or any state. Output files land under
`outputs/diagnostics/<UTC ts>_oy_access/`.

Privacy
-------
- Cookie VALUES are never captured. Only counts, grouped by domain.
- localStorage VALUES are never captured. Only key names.
- Sensitive HTTP headers (Authorization, Cookie, Set-Cookie,
  X-CSRF-Token, X-API-Key, X-Auth-Token) are stripped from captured
  request/response headers.
- Response bodies are capped at 8 KB so accidental PII inclusion
  is bounded. Operators inspect manually.

Usage
-----

    PYTHONPATH=. python3 scripts/diagnose_oy_review_access.py \\
        --product-url "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=A000000171427"

    # First confirm CDP is reachable:
    curl -s http://127.0.0.1:9222/json/version | python3 -m json.tool

Exit codes
----------
  0  diagnostic completed (a verdict was assigned; outputs written)
  2  CDP attach failed
  3  product URL parse error
"""
from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# URL substring patterns we treat as "review-related" for network
# capture. Case-insensitive substring match is sufficient — false
# positives are fine (the operator filters at inspection time);
# false negatives are NOT fine (they hide the actual API call we
# need to inspect).
REVIEW_URL_PATTERNS: tuple[str, ...] = (
    "review", "goods", "gdas", "evaluation", "comment",
    "goodsno", "recm", "sort",
)

# Sensitive header names — stripped before saving captured network
# events. Lowercase compare.
SENSITIVE_HEADER_NAMES: frozenset[str] = frozenset({
    "authorization", "cookie", "set-cookie",
    "x-auth-token", "x-csrf-token", "x-api-key",
    "x-session-token", "x-access-token",
})

# Response body cap — 8 KB. Captured payloads beyond this are
# truncated with a `…[truncated]` marker.
RESPONSE_BODY_CAP: int = 8 * 1024
REQUEST_BODY_CAP: int = 1 * 1024

# Korean DOM markers we test for.
EMPTY_REVIEW_MARKER: str = "등록된 리뷰가 없어요"
LOGIN_MARKERS: tuple[str, ...] = (
    "로그인이 필요", "로그인 후 이용",
)
CAPTCHA_MARKERS: tuple[str, ...] = (
    "본인 확인", "Cloudflare", "사람인지 확인",
    "보안 문자", "자동입력 방지",
)

# Review tab selectors — same priority list the connector uses.
REVIEW_TAB_SELECTORS: tuple[str, ...] = (
    'button:has-text("리뷰&셔터")',
    'button:has-text("리뷰")',
    "[data-target='review']",
    "[id*='review']",
    "a.tab_review",
)

# Sort button selectors. The page uses several patterns over
# release versions; we collect any matching.
SORT_BUTTON_SELECTORS: tuple[str, ...] = (
    "[class*='sort'] button",
    "[class*='Sort'] button",
    "[class*='filter'] button",
    "[class*='Filter'] button",
)

# Page-open hard timeout for the diagnostic. Generous enough to
# survive a slow CDN.
PAGE_OPEN_TIMEOUT_S: float = 30.0
DEFAULT_API_WAIT_S: float = 60.0


GOODS_NO_RE = re.compile(r"goodsNo=([A-Z]\d{10,})", re.IGNORECASE)


# ---------------------------------------------------------------------------
# Pure helpers (testable without Playwright)
# ---------------------------------------------------------------------------


def parse_goods_no(url: str | None) -> tuple[str | None, str | None]:
    """Extract `goodsNo=` from an OY product URL. Returns
    `(goods_no, error_message)` — exactly one is None."""
    if not url or not url.strip():
        return None, "empty url"
    s = url.strip()
    if re.fullmatch(r"[Aa]\d{10,}", s):
        return s.upper(), None
    m = GOODS_NO_RE.search(s)
    if not m:
        return None, "no goodsNo= query parameter found"
    return m.group(1).upper(), None


def is_review_related_url(url: str | None) -> bool:
    """Case-insensitive substring match against `REVIEW_URL_PATTERNS`.

    Wide net: anything we want to capture for inspection.
    """
    if not url:
        return False
    lower = url.lower()
    return any(p in lower for p in REVIEW_URL_PATTERNS)


# Predicates for distinguishing the main review LIST/CURSOR API from
# review META APIs (stats / options count / photo-reviews / goods-extra).
# The 2026-05-01 diagnosis showed the operator's bug is precisely
# "meta APIs fire but list API doesn't" — these predicates make that
# distinguishable in code.

_REVIEW_LIST_PRIMARY_PATH = "/review/api/v2/reviews"
_REVIEW_LIST_EXCLUDED_SUBPATHS: tuple[str, ...] = (
    "/photo-reviews",
    "/options/",
    "/stats",
    # `summary` is sometimes a meta endpoint; if a future build ships
    # it as a list endpoint we'd have to revisit. For now keep the
    # excluded set narrow and explicit.
)
_REVIEW_LIST_SECONDARY_HINTS: tuple[str, ...] = (
    "cursor", "gdas",
)
_REVIEW_LIST_BODY_HINTS: tuple[str, ...] = (
    "goodsReviewList",  # current OY mobile + desktop cursor shape
    "reviewList",
    "gdasList",
    "reviews\":[",
)
# Image / static-asset extensions and path fragments. The secondary
# hints (`cursor`, `gdas`) match URLs like `gdasEditor`, image CDN
# paths under `/cfimages/`, and similar — those should NEVER classify
# as the review list API.
_REVIEW_LIST_NON_API_FRAGMENTS: tuple[str, ...] = (
    "/cfimages/",
    "/static/",
    "/cdn/",
    "gdaseditor",
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".css", ".js",
)


def is_review_list_api(url: str | None, body: str | None = None) -> bool:
    """Strict predicate for the main review list/cursor API.

    Match if EITHER:
      1. URL contains `/review/api/v2/reviews` AND not any excluded
         subpath (photo-reviews / options/ / stats), OR
      2. URL contains a secondary hint (`cursor`, `gdas`) AND
         (no body provided, or body looks list-shaped).

    Always exclude image / static-asset URLs (gdasEditor, cfimages,
    .png/.jpg, etc.) — without this, secondary-hint matching would
    classify CDN images as "review API".

    Host-agnostic: matches both `m.oliveyoung.co.kr` (mobile) and
    `www.oliveyoung.co.kr` (desktop) cursor endpoints by path alone.
    """
    if not url:
        return False
    lower = url.lower()
    # Always exclude obvious non-API fragments first — they would
    # otherwise sneak in via the secondary-hint match.
    if any(frag in lower for frag in _REVIEW_LIST_NON_API_FRAGMENTS):
        return False
    if _REVIEW_LIST_PRIMARY_PATH in lower:
        if any(excl in lower for excl in _REVIEW_LIST_EXCLUDED_SUBPATHS):
            return False
        return True
    if any(hint in lower for hint in _REVIEW_LIST_SECONDARY_HINTS):
        if body is None:
            # No body to confirm; URL hint alone is enough — being
            # over-inclusive in the "is review list" direction is
            # safer than missing the actual API.
            return True
        return any(hint in body for hint in _REVIEW_LIST_BODY_HINTS)
    return False


def body_has_review_content(body: str | None) -> int:
    """Count `goodsReviewList` entries in a response body preview.

    Returns 0 when the body is missing or doesn't contain the marker.
    Cheap heuristic — counts occurrences of `"reviewId":` so
    truncated previews still produce a non-zero count when there's
    at least one review present. Caller uses this to populate the
    diagnostic's `review_list_reviews_seen_in_body`.
    """
    if not body:
        return 0
    if "goodsReviewList" not in body:
        return 0
    return body.count('"reviewId"')


def body_count_target_goods_no(body: str | None, target_goods_no: str) -> int:
    """Count records in a body preview whose `goodsDto.goodsNumber`
    equals `target_goods_no`. Cheap regex scan — used to populate
    `review_list_reviews_for_target_goods_no` without full parse.
    Returns 0 when body is missing or marker is absent."""
    if not body or not target_goods_no:
        return 0
    pattern = re.compile(
        r'"goodsNumber"\s*:\s*"' + re.escape(target_goods_no) + r'"',
    )
    return len(pattern.findall(body))


# Review META endpoint patterns. These fire on page load even when
# the main list API does not — they're the signal that "the page
# *thinks* there are reviews, but didn't fetch them yet".
_REVIEW_META_HINTS: tuple[str, ...] = (
    "/review/api/v2/reviews/photo-reviews",
    "/review/api/v2/reviews/options/",
    "/review/api/v2/reviews/",  # /stats path; see suffix check below
    "/goods/api/v1/extra",
)
_REVIEW_META_REQUIRES_SUFFIX: dict[str, tuple[str, ...]] = {
    "/review/api/v2/reviews/": ("/stats", "/count"),
}


def is_review_meta_api(url: str | None) -> bool:
    """True when the URL is a review META endpoint (stats / options /
    photo-reviews / goods extra). Distinct from `is_review_list_api`."""
    if not url:
        return False
    lower = url.lower()
    if "/review/api/v2/reviews/photo-reviews" in lower:
        return True
    if "/review/api/v2/reviews/options/" in lower:
        return True
    if "/review/api/v2/reviews/" in lower and (
        "/stats" in lower or "/count" in lower
    ):
        return True
    if "/goods/api/v1/extra" in lower:
        return True
    return False


def strip_sensitive_headers(headers: dict | None) -> dict:
    """Drop sensitive header names. Case-insensitive compare; the
    output preserves the original key casing for whatever survives."""
    if not headers:
        return {}
    out: dict[str, str] = {}
    for k, v in headers.items():
        if k.lower() in SENSITIVE_HEADER_NAMES:
            continue
        out[str(k)] = str(v)
    return out


def cap_text(s: str | bytes | None, cap: int) -> str:
    """Cap a string/bytes payload to `cap` chars; mark truncation."""
    if s is None:
        return ""
    if isinstance(s, (bytes, bytearray)):
        try:
            s = s.decode("utf-8", errors="replace")
        except Exception:
            s = ""
    if len(s) <= cap:
        return s
    return s[:cap] + f"\n…[truncated at {cap} chars]"


# ---------------------------------------------------------------------------
# Verdict classification
# ---------------------------------------------------------------------------


VERDICT_REVIEW_LIST_API_NOT_SEEN_BUT_REVIEW_META_SEEN: str = (
    "review_list_api_not_seen_but_review_meta_seen"
)
# Added 2026-05-01 — list API DID fire and had real review content.
# The verdict says "diagnostic itself sees the API healthy" so the
# operator looks at the connector / parser pipeline (not the
# browser/network/profile) for the next root cause hypothesis.
VERDICT_REVIEW_LIST_API_SEEN: str = "review_list_api_seen"
# Added 2026-05-01 — Playwright `connect_over_cdp` itself raised. The
# legacy `browser_attach_error` is a generic catch-all; this verdict is
# specifically "CDP attach raised an exception we can quote verbatim".
# Kept distinct so the operator (and the batch summary) can tell the
# difference between "Playwright/Chrome version wall" and "no CDP at
# all on the port".
VERDICT_CDP_ATTACH_FAILED: str = "cdp_attach_failed"
# Added 2026-05-01 — attach succeeded but `page.goto` raised. Distinct
# from CDP attach so the operator looks at network/DNS/URL, not the
# browser session.
VERDICT_PAGE_OPEN_FAILED: str = "page_open_failed"


_NEXT_ACTIONS_BY_VERDICT: dict[str, list[str]] = {
    "browser_attach_error": [
        "Confirm CDP is up: curl -s http://127.0.0.1:9222/json/version",
        "If not, run: PYTHONPATH=. python3 scripts/open_oy_chrome_debug.py --wait",
    ],
    VERDICT_CDP_ATTACH_FAILED: [
        "Read verdict_reason — it contains the exact CDP attach exception.",
        "If the message contains 'Browser.setDownloadBehavior' or "
        "'Browser context management is not supported', this is a known "
        "Playwright/Chrome CDP compatibility wall.",
        "Workarounds (do NOT reset the profile; this is not a profile problem):",
        "  1. Switch CDP target to Playwright's bundled Chromium 143:",
        "       PYTHONPATH=. python3 scripts/open_oy_chromium_debug.py "
        "--profile-dir ~/chrome-oy-profile-pw --wait",
        "     (operator re-logs in ONCE inside that window; system Chrome",
        "      stays untouched; session does NOT carry over from system",
        "      Chrome.)",
        "  2. Downgrade system Chrome to <= 146.x if Chromium-143 is not",
        "     viable (anti-bot fingerprint mismatch, etc.).",
        "  3. Pinning Playwright (e.g. 'playwright<1.58') was attempted",
        "     and STILL reproduced the wall on 1.57.0 + Chrome 147 — treat",
        "     any version pin as an unverified candidate, not a guaranteed",
        "     fix.",
        "See docs/oy_cdp_attach_compatibility.md for full rationale.",
        "Confirm CDP is up before re-running: "
        "curl -s http://127.0.0.1:9222/json/version",
    ],
    VERDICT_PAGE_OPEN_FAILED: [
        "Read verdict_reason — it contains the exact page.goto exception.",
        "Common causes: DNS failure, ERR_CONNECTION_REFUSED, navigation "
        "timeout. CDP itself is healthy — only the navigation failed.",
        "Try opening the same URL manually in the CDP-attached Chrome "
        "window. If that also fails, the network path is the cause.",
    ],
    "url_parse_error": [
        "Pass a URL with goodsNo, e.g. "
        "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=A000000xxxxxxx",
    ],
    "login_required": [
        "Sign into OliveYoung in the CDP Chrome window.",
        "Verify the session cookie set is comparable to your normal Chrome.",
        "After login, re-run this diagnostic.",
    ],
    "anti_bot_or_challenge": [
        "Solve the CAPTCHA / 본인 확인 in the Chrome window.",
        "If it persists, your IP may be soft-blocked — try a different network "
        "(mobile hotspot is the fastest test).",
        "DO NOT reset the profile — anti-bot is not a profile-state problem.",
    ],
    "review_api_empty": [
        "The cursor API fired but the response body is empty. The session is "
        "talking to OY but OY is returning zero reviews FOR THIS SESSION.",
        "Compare your CDP session vs your normal Chrome:",
        "  - Same logged-in user? (cookies count by domain in summary)",
        "  - Same IP? (egress check from a separate terminal)",
        "  - Same userAgent? (summary.browser.userAgent)",
        "Inspect outputs/.../network_review_candidates.json — open the "
        "200-status review API response and look at the JSON body.",
        "DO NOT reset the profile yet. Profile state didn't cause this.",
    ],
    "review_api_not_seen": [
        "The cursor API never fired. The page rendered but the JS never "
        "asked OY for reviews — selector drift or JS init failure.",
        "Inspect screenshot_after.png — is the review section visually present?",
        "Compare with normal Chrome: open DevTools → Network → reload, look "
        "for any /review/api/v2/reviews/ request.",
        "If JS console shows errors, that's the failure root cause.",
    ],
    "selector_mismatch": [
        "The review tab selector did not match anything on the page. Either "
        "the page is not the product detail page, or layout has changed.",
        "Inspect screenshot_before.png — is the review tab visually present?",
        "If layout has changed, update REVIEW_TAB_SELECTORS in this script "
        "and the connector.",
    ],
    "false_empty_dom": [
        "The DOM contains '등록된 리뷰가 없어요' but the diagnostic could not "
        "decisively classify the cause.",
        "Inspect page_text.txt and the screenshots.",
        "Compare against normal Chrome on the same URL.",
    ],
    VERDICT_REVIEW_LIST_API_NOT_SEEN_BUT_REVIEW_META_SEEN: [
        "Review META endpoints fired (stats / options / photo-reviews / "
        "goods-extra) — the page knows there are reviews — BUT the main "
        "review list/cursor API did NOT fire. The page rendered an empty "
        "fallback even though metadata says reviews exist.",
        "This is NOT anti-bot, NOT a profile/session problem, NOT a login "
        "issue. The trigger gesture (tab click + scroll + 더보기) didn't "
        "wake up the lazy-load.",
        "Compare normal Chrome's Network tab on the same URL: which "
        "request fired the cursor API? Look at the initiator stack trace "
        "to identify the JS hook (button click, scroll, IntersectionObserver).",
        "If the connector code path matches but the API still doesn't "
        "fire, the operator may need to manually scroll inside the review "
        "panel in the CDP Chrome window once — sometimes the IntersectionObserver "
        "needs a second nudge.",
        "DO NOT reset the profile. DO NOT classify this as anti-bot. "
        "DO NOT add infinite retries.",
    ],
    VERDICT_REVIEW_LIST_API_SEEN: [
        "The main review list/cursor API fired AND the response body "
        "contains review records (goodsReviewList non-empty). The "
        "browser-side path is healthy. If the scraper still reports zero "
        "rows for the same URL, the bottleneck is in the connector / "
        "parser, NOT in browser, network, or profile.",
        "Compare the captured response (network_review_candidates.json) "
        "against the connector's expected shape. Check `goodsDto.goodsNumber` "
        "in the response — for 기획 set products it may include sibling "
        "sub-product reviews that the connector's goods-filter drops; "
        "look at the `rows_filtered_by_goods_no` telemetry in batch_summary.",
        "Inspect the URL host: mobile (m.oliveyoung.co.kr) and desktop "
        "(www.oliveyoung.co.kr) cursor responses are both valid; the "
        "connector matches by path so both should be captured.",
        "DO NOT reset the profile. DO NOT classify this as anti-bot.",
    ],
    "unknown": [
        "No definitive failure mode matched. Inspect the diagnostic outputs "
        "manually.",
        "Compare to a known-good run if available.",
    ],
}


@dataclass
class _ClassificationInputs:
    """The minimum signal set needed for the verdict matrix.

    Kept as a dataclass so unit tests can construct synthetic
    inputs without standing up a full diagnostic result.

    `review_meta_api_seen` and `review_count_badge` together encode
    "the page KNOWS there are reviews" — they're the precondition for
    the `review_list_api_not_seen_but_review_meta_seen` verdict.

    `review_list_reviews_seen_in_body` lifts that further: when the
    list API DID fire AND the response body contained at least one
    `reviewId`, the diagnostic is healthy and the bottleneck (if the
    scraper still reports zero rows) is in the connector / parser.
    """
    browser_attached: bool
    page_opened: bool
    login_markers: list[str]
    captcha_markers: list[str]
    empty_review_marker: bool
    review_tab_clicked: bool
    review_api_fired: bool
    review_api_returned_empty: bool
    review_count_badge: str | None
    # Added 2026-05-01 — separates review-meta from review-list signals.
    review_meta_api_seen: bool = False
    review_list_api_seen: bool = False
    # Added 2026-05-01 — number of reviewId entries in any captured
    # list-API response body. Non-zero means the API delivered real
    # content; the operator should look at parser, not browser.
    review_list_reviews_seen_in_body: int = 0
    # Added 2026-05-01 — exact exception strings from the early-failure
    # paths. Non-empty values short-circuit classification to a specific
    # verdict (cdp_attach_failed / page_open_failed) so the operator
    # never sees Verdict=None and never has to guess at root cause.
    cdp_attach_error: str | None = None
    page_open_error: str | None = None


def classify_verdict(inputs: _ClassificationInputs) -> tuple[str, str]:
    """Return `(verdict_code, reason)` from the captured signals.

    Decision order: hard-attach failures first, then auth / anti-bot
    (only when markers are actually present), then network-vs-DOM
    divergence, then meta-vs-list-API divergence (the
    `review_list_api_not_seen_but_review_meta_seen` headline case),
    then layout drift.
    """
    # Specific attach/navigation failures take precedence — when we have
    # the exception string, surface it verbatim so the operator never
    # has to guess between "no CDP at all" and "Playwright/Chrome wall".
    if inputs.cdp_attach_error:
        return (
            VERDICT_CDP_ATTACH_FAILED,
            f"Playwright connect_over_cdp raised: {inputs.cdp_attach_error}",
        )
    if inputs.page_open_error:
        return (
            VERDICT_PAGE_OPEN_FAILED,
            f"page.goto raised: {inputs.page_open_error}",
        )
    if not inputs.browser_attached:
        return ("browser_attach_error",
                "Could not attach to the CDP browser.")
    if not inputs.page_opened:
        return ("browser_attach_error",
                "Page did not reach domcontentloaded.")
    if inputs.login_markers:
        return ("login_required",
                f"Login wall detected: {inputs.login_markers}")
    if inputs.captcha_markers:
        return ("anti_bot_or_challenge",
                f"Anti-bot challenge detected: {inputs.captcha_markers}")
    # NEW 2026-05-01: list API fired AND body contained review content.
    # The diagnostic itself is healthy — bottleneck is downstream
    # (connector / parser / goods-filter). Takes precedence over
    # `review_api_empty` because seeing real content in the body is a
    # stronger signal than the DOM marker (DOM might still show the
    # empty fallback while the network actually delivered reviews).
    if (
        inputs.review_list_api_seen
        and inputs.review_list_reviews_seen_in_body > 0
    ):
        return (
            VERDICT_REVIEW_LIST_API_SEEN,
            f"Review list API fired and the response body contained "
            f"{inputs.review_list_reviews_seen_in_body} `reviewId` "
            f"entries. The browser-side path is healthy; if the "
            f"scraper still reports zero rows, look at the connector / "
            f"parser, NOT browser / profile / anti-bot.",
        )
    # Network-vs-DOM divergence is the original headline signal for the
    # "CDP shows empty but normal Chrome works" case (when the list
    # API DID fire).
    if inputs.review_list_api_seen and inputs.review_api_returned_empty:
        return ("review_api_empty",
                "Review list API fired but DOM still shows "
                "'등록된 리뷰가 없어요'. Likely: session / cookie / IP "
                "divergence vs the working Chrome.")
    # NEW 2026-05-01 — meta APIs fired but the list API never did, AND
    # the page has a visible review-count badge OR the empty marker
    # showed up. The page KNOWS reviews exist; the trigger gesture
    # didn't wake the lazy-load.
    if (
        inputs.review_meta_api_seen
        and not inputs.review_list_api_seen
        and (inputs.review_count_badge or inputs.empty_review_marker)
    ):
        return (
            VERDICT_REVIEW_LIST_API_NOT_SEEN_BUT_REVIEW_META_SEEN,
            "Review meta APIs fired (stats / options / photo-reviews / "
            "goods-extra) but the main list API did not. The page knows "
            "there are reviews — see the count badge — but the trigger "
            "gesture didn't wake the lazy-load. NOT anti-bot, NOT a "
            "profile/session problem.",
        )
    if inputs.review_tab_clicked and not inputs.review_list_api_seen:
        return ("review_api_not_seen",
                "Review tab clicked but the list API never fired within "
                "the wait budget. Likely: client-side JS init issue or "
                "selector drift.")
    if not inputs.review_tab_clicked:
        return ("selector_mismatch",
                "No review tab selector matched. Page layout may have "
                "changed, or the URL is not a product detail page.")
    if inputs.empty_review_marker:
        return ("false_empty_dom",
                "DOM contains '등록된 리뷰가 없어요' but no further signal "
                "to classify the cause.")
    return ("unknown",
            "No definitive failure mode matched.")


def next_actions_for(verdict: str) -> list[str]:
    return list(_NEXT_ACTIONS_BY_VERDICT.get(verdict, _NEXT_ACTIONS_BY_VERDICT["unknown"]))


# --- 2026-05-01 ---------------------------------------------------------
# Skipped-artifact tags. The diagnose function appends one of these to
# `result["skipped_artifacts"]` whenever an early-failure path returns
# before writing the corresponding artifact. Surfaced in the CLI summary
# so the operator doesn't read "(not created)" as a normal outcome.
_SKIP_REASON_CDP_ATTACH_FAILED = "cdp_attach_failed"
_SKIP_REASON_NO_BROWSER_CONTEXT = "no_browser_context_after_attach"
_SKIP_REASON_PAGE_OPEN_FAILED = "page_open_failed"


def _finalize_classification(
    result: dict,
    *,
    cdp_attach_error: str | None = None,
    page_open_error: str | None = None,
    review_list_reviews_seen_in_body: int = 0,
) -> dict:
    """Compute verdict / verdict_reason / next_actions from the current
    state of `result` and write them in. Idempotent — safe to call
    multiple times; the last call wins.

    Used by both the early-failure return paths (so we never leave
    verdict=None) and the normal end-of-run path (so the classification
    is in one place). The two error fields short-circuit verdict to
    `cdp_attach_failed` / `page_open_failed` even when the underlying
    flags (browser_attached, page_opened) would otherwise classify
    generically.
    """
    inputs = _ClassificationInputs(
        browser_attached=bool(result.get("browser", {}).get("attached")),
        page_opened=bool(result.get("page", {}).get("opened")),
        login_markers=list(result.get("dom", {}).get("login_markers_seen") or []),
        captcha_markers=list(result.get("dom", {}).get("captcha_markers_seen") or []),
        empty_review_marker=bool(
            result.get("dom", {}).get("empty_review_marker")
            or result.get("dom", {}).get("empty_review_marker_after"),
        ),
        review_tab_clicked=bool(result.get("dom", {}).get("review_tab_clicked")),
        review_api_fired=bool(result.get("network", {}).get("review_list_api_seen")),
        review_api_returned_empty=bool(
            result.get("network", {}).get("review_list_api_seen")
            and result.get("dom", {}).get("empty_review_marker_after"),
        ),
        review_count_badge=result.get("dom", {}).get("review_count_badge_text"),
        review_meta_api_seen=bool(result.get("network", {}).get("review_meta_api_seen")),
        review_list_api_seen=bool(result.get("network", {}).get("review_list_api_seen")),
        review_list_reviews_seen_in_body=int(review_list_reviews_seen_in_body),
        cdp_attach_error=cdp_attach_error,
        page_open_error=page_open_error,
    )
    verdict, reason = classify_verdict(inputs)
    result["verdict"] = verdict
    result["verdict_reason"] = reason
    result["next_actions"] = next_actions_for(verdict)
    return result


# ---------------------------------------------------------------------------
# Async diagnostic runner (Playwright)
# ---------------------------------------------------------------------------


# Step names — ordered. Each step records which network responses
# arrived during it.
_STEP_INITIAL = "step_1_initial"
_STEP_REVIEW_TAB = "step_2_review_tab_click"
_STEP_SCROLL = "step_3_scroll_review_area"
_STEP_REVIEW_MORE = "step_4_click_review_more"
_STEP_SORT = "step_5_sort_click_if_available"


def _split_response_by_step(
    responses: list[dict], step_name: str,
) -> list[dict]:
    """Slice the captured response list to entries tagged with `step_name`."""
    return [r for r in responses if r.get("step") == step_name]


def _summarize_step(
    step_name: str,
    captured_so_far: list[dict],
    captured_before_step: int,
) -> dict:
    """Build a per-step summary block. `captured_before_step` is the
    `len(captured)` snapshot taken right before the step started."""
    new_entries = captured_so_far[captured_before_step:]
    review_list_seen = any(
        is_review_list_api(e.get("url"), e.get("response_body_preview"))
        for e in new_entries if e.get("type") == "response"
    )
    review_meta_seen = any(
        is_review_meta_api(e.get("url"))
        for e in new_entries if e.get("type") == "response"
    )
    return {
        "step": step_name,
        "new_response_count": sum(
            1 for e in new_entries if e.get("type") == "response"
        ),
        "new_response_urls": [
            e.get("url")
            for e in new_entries if e.get("type") == "response"
        ][:30],
        "review_list_api_seen_in_step": review_list_seen,
        "review_meta_api_seen_in_step": review_meta_seen,
    }


async def _async_diagnose(
    *,
    product_url: str,
    port: int,
    profile_dir: Path,
    out_dir: Path,
    api_wait_seconds: float,
) -> dict:
    """The actual probe. Connects to CDP, captures, classifies. Returns
    the diagnostic dict (also written to disk by the caller).

    The probe runs as a 5-step interaction:
      step_1_initial            — after navigation, before any clicks
      step_2_review_tab_click   — click the 리뷰&셔터 tab
      step_3_scroll_review_area — scroll into view of review section
      step_4_click_review_more  — click 리뷰 더보기 if visible
      step_5_sort_click         — click the first available sort button

    Each step's network slice is captured separately so the operator
    can pinpoint which gesture actually wakes the list API.
    """
    from playwright.async_api import async_playwright  # type: ignore

    out_dir.mkdir(parents=True, exist_ok=True)

    result: dict = {
        "schema_version": "1.1",
        "ran_at_utc": datetime.now(timezone.utc).strftime(
            "%Y-%m-%dT%H:%M:%SZ",
        ),
        "product_url": product_url,
        "goods_no": parse_goods_no(product_url)[0],
        "cdp_port": int(port),
        "profile_dir": str(profile_dir),
        "out_dir": str(out_dir),
        # Flattened top-level summary block — added 2026-05-01 so an
        # operator scanning the JSON can see the headline signals
        # without traversing nested dicts. Same fields are also
        # surfaced in the nested blocks below.
        "summary": {
            "current_url": None,
            "userAgent": None,
            "empty_review_marker_present": False,
            "review_count_badge": None,
            "available_sort_button_labels": [],
            "cookie_count_by_domain": None,
            "local_storage_keys": None,
            "review_list_api_seen": False,
            "review_meta_api_seen": False,
            "trigger_step_that_woke_list_api": None,
            # Added 2026-05-01 — distinguishes "API fired" from "API
            # fired with REAL content". The first scenario could be a
            # zero-result legitimate response; the second is the one
            # that proves the connector/parser is the bottleneck.
            "review_list_api_response_count": 0,
            "review_list_reviews_seen_in_body": 0,
            "review_list_reviews_for_target_goods_no": 0,
            "review_list_reviews_filtered_other_goods_no": 0,
        },
        "browser": {"attached": False, "userAgent": None, "error": None},
        "page": {
            "opened": False, "url": None, "title": None,
            "load_ms": None, "error": None,
        },
        "session": {
            "cookie_total": None,
            "cookie_count_by_domain": None,
            "localStorage_count": None,
            "localStorage_keys": None,
        },
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
        "steps": [],
        "verdict": None,
        "verdict_reason": "",
        "next_actions": [],
        "artifacts": {
            "diagnostic_summary": str(out_dir / "diagnostic_summary.json"),
            "network_review_candidates": str(out_dir / "network_review_candidates.json"),
            "page_text": str(out_dir / "page_text.txt"),
            "screenshot_before": str(out_dir / "screenshot_before.png"),
            "screenshot_after": str(out_dir / "screenshot_after.png"),
            "out_dir": str(out_dir),
        },
        # Added 2026-05-01 — when an early-failure path returns before
        # writing page-text / screenshots / network capture, list each
        # one with a short reason so the CLI doesn't pretend the absence
        # is normal. Empty list on a clean run.
        "skipped_artifacts": [],
    }

    captured: list[dict] = []
    current_step = _STEP_INITIAL  # mutable closure over the listener

    async with async_playwright() as pw:
        # ---- 1. CDP attach -------------------------------------------------
        try:
            browser = await pw.chromium.connect_over_cdp(
                f"http://127.0.0.1:{int(port)}",
            )
        except Exception as e:
            err_str = f"{type(e).__name__}: {e}"
            result["browser"]["error"] = err_str
            # Tell the operator which artifacts didn't get written and
            # why — page/network capture and screenshots all require an
            # attached browser, so they're all skipped here.
            for k in (
                "network_review_candidates",
                "page_text",
                "screenshot_before",
                "screenshot_after",
            ):
                result["skipped_artifacts"].append({
                    "artifact": k,
                    "reason": _SKIP_REASON_CDP_ATTACH_FAILED,
                })
            _finalize_classification(result, cdp_attach_error=err_str)
            return result
        result["browser"]["attached"] = True

        contexts = browser.contexts
        if not contexts:
            err_str = "no contexts in attached browser"
            result["browser"]["error"] = err_str
            for k in (
                "network_review_candidates",
                "page_text",
                "screenshot_before",
                "screenshot_after",
            ):
                result["skipped_artifacts"].append({
                    "artifact": k,
                    "reason": _SKIP_REASON_NO_BROWSER_CONTEXT,
                })
            _finalize_classification(result, cdp_attach_error=err_str)
            return result
        ctx = contexts[0]

        # ---- 2. Cookie + storage counts (NO values) -----------------------
        try:
            cookies = await ctx.cookies()
            by_domain: dict[str, int] = {}
            for c in cookies:
                d = c.get("domain") or "(unknown)"
                by_domain[d] = by_domain.get(d, 0) + 1
            result["session"]["cookie_total"] = len(cookies)
            result["session"]["cookie_count_by_domain"] = by_domain
        except Exception as e:
            result["session"]["cookies_error"] = (
                f"{type(e).__name__}: {e}"
            )

        page = await ctx.new_page()

        # ---- 3. Wire response capture BEFORE navigation -------------------
        async def _on_response(response):
            try:
                url = response.url
                if not is_review_related_url(url):
                    return
                req = response.request
                req_headers = await req.all_headers()
                resp_headers = await response.all_headers()
                entry = {
                    "type": "response",
                    "url": url,
                    "method": req.method,
                    "status": response.status,
                    "content_type": resp_headers.get("content-type", ""),
                    "request_headers": strip_sensitive_headers(req_headers),
                    "response_headers": strip_sensitive_headers(resp_headers),
                    "timestamp": time.time(),
                    "step": current_step,
                }
                if req.method in ("POST", "PUT"):
                    try:
                        body = req.post_data
                        entry["request_body_preview"] = cap_text(
                            body, REQUEST_BODY_CAP,
                        )
                    except Exception:
                        pass
                if response.status not in (304,):
                    try:
                        body = await response.body()
                        entry["response_body_preview"] = cap_text(
                            body, RESPONSE_BODY_CAP,
                        )
                    except Exception as e:
                        entry["response_body_error"] = (
                            f"{type(e).__name__}: {e}"
                        )
                captured.append(entry)
            except Exception as e:
                captured.append({
                    "type": "listener_error",
                    "error": f"{type(e).__name__}: {e}",
                    "step": current_step,
                })

        page.on(
            "response",
            lambda r: asyncio.create_task(_on_response(r)),
        )

        # ---- 4. STEP 1: navigate + initial settle -------------------------
        current_step = _STEP_INITIAL
        step_start_idx = len(captured)
        t0 = time.monotonic()
        try:
            await page.goto(
                product_url,
                wait_until="domcontentloaded",
                timeout=int(PAGE_OPEN_TIMEOUT_S * 1000),
            )
            result["page"]["opened"] = True
            result["page"]["load_ms"] = int(
                (time.monotonic() - t0) * 1000,
            )
        except Exception as e:
            result["page"]["error"] = f"{type(e).__name__}: {e}"

        try:
            result["page"]["url"] = page.url
            result["page"]["title"] = await page.title()
        except Exception:
            pass
        try:
            result["browser"]["userAgent"] = await page.evaluate(
                "() => navigator.userAgent",
            )
        except Exception:
            pass
        try:
            ls_keys = await page.evaluate("() => Object.keys(localStorage)")
            if isinstance(ls_keys, list):
                result["session"]["localStorage_keys"] = list(ls_keys)
                result["session"]["localStorage_count"] = len(ls_keys)
        except Exception as e:
            result["session"]["localStorage_error"] = (
                f"{type(e).__name__}: {e}"
            )

        try:
            await page.screenshot(
                path=str(out_dir / "screenshot_before.png"),
                full_page=False, timeout=10000,
            )
        except Exception as e:
            result["dom"]["screenshot_before_error"] = (
                f"{type(e).__name__}: {e}"
            )

        page_text = ""
        try:
            page_text = await page.evaluate(
                "() => document.body.innerText || ''",
            ) or ""
        except Exception:
            pass
        result["dom"]["page_text_length"] = len(page_text)
        result["dom"]["empty_review_marker"] = (
            EMPTY_REVIEW_MARKER in page_text
        )
        result["dom"]["login_markers_seen"] = [
            m for m in LOGIN_MARKERS if m in page_text
        ]
        result["dom"]["captcha_markers_seen"] = [
            m for m in CAPTCHA_MARKERS if m in page_text
        ]

        # Settle for late-loading scripts.
        await asyncio.sleep(2.0)
        result["steps"].append(_summarize_step(
            _STEP_INITIAL, captured, step_start_idx,
        ))

        # ---- 5. STEP 2: review tab click ----------------------------------
        current_step = _STEP_REVIEW_TAB
        step_start_idx = len(captured)
        for sel in REVIEW_TAB_SELECTORS:
            try:
                loc = page.locator(sel).first
                if await loc.count() > 0:
                    result["dom"]["review_tab_visible"] = True
                    try:
                        await loc.click(timeout=3000)
                        result["dom"]["review_tab_clicked"] = True
                        result["dom"]["review_tab_selector"] = sel
                        break
                    except Exception:
                        continue
            except Exception:
                continue
        await asyncio.sleep(3.0)
        result["steps"].append(_summarize_step(
            _STEP_REVIEW_TAB, captured, step_start_idx,
        ))

        # ---- 6. STEP 3: scroll into review area ---------------------------
        current_step = _STEP_SCROLL
        step_start_idx = len(captured)
        scrolled = False
        for sel in REVIEW_TAB_SELECTORS:
            try:
                loc = page.locator(sel).first
                if await loc.count() > 0:
                    await loc.scroll_into_view_if_needed(timeout=3000)
                    scrolled = True
                    break
            except Exception:
                continue
        # Also do an explicit page scroll to wake up IntersectionObservers
        # that the scroll_into_view_if_needed didn't trigger.
        try:
            await page.evaluate(
                "() => window.scrollBy(0, window.innerHeight * 2)"
            )
        except Exception:
            pass
        result["dom"]["scrolled_to_review_area"] = scrolled
        await asyncio.sleep(2.0)
        result["steps"].append(_summarize_step(
            _STEP_SCROLL, captured, step_start_idx,
        ))

        # ---- 7. STEP 4: 리뷰 더보기 click (if visible) ---------------------
        current_step = _STEP_REVIEW_MORE
        step_start_idx = len(captured)
        more_clicked = False
        for more_sel in (
            'button:has-text("리뷰 더보기")',
            'a:has-text("리뷰 더보기")',
            '[class*="more"] button:has-text("리뷰")',
        ):
            try:
                loc = page.locator(more_sel).first
                if await loc.count() > 0:
                    try:
                        await loc.click(timeout=3000)
                        more_clicked = True
                        break
                    except Exception:
                        continue
            except Exception:
                continue
        result["dom"]["review_more_button_clicked"] = more_clicked
        await asyncio.sleep(3.0)
        result["steps"].append(_summarize_step(
            _STEP_REVIEW_MORE, captured, step_start_idx,
        ))

        # ---- 8. STEP 5: first sort button click (if available) ------------
        current_step = _STEP_SORT
        step_start_idx = len(captured)
        sort_clicked = False
        for sel in SORT_BUTTON_SELECTORS:
            try:
                btns = page.locator(sel)
                count = await btns.count()
                if count == 0:
                    continue
                # Click the first non-empty button.
                for i in range(min(count, 5)):
                    try:
                        await btns.nth(i).click(timeout=2000)
                        sort_clicked = True
                        break
                    except Exception:
                        continue
                if sort_clicked:
                    break
            except Exception:
                continue
        result["dom"]["sort_button_clicked"] = sort_clicked
        await asyncio.sleep(3.0)
        result["steps"].append(_summarize_step(
            _STEP_SORT, captured, step_start_idx,
        ))

        # ---- 9. Wait extra time if list API still missing -----------------
        deadline = time.monotonic() + max(0.0, float(api_wait_seconds) - 13.0)
        while time.monotonic() < deadline:
            seen = any(
                is_review_list_api(
                    e.get("url"), e.get("response_body_preview"),
                )
                for e in captured if e.get("type") == "response"
            )
            if seen:
                break
            await asyncio.sleep(0.5)

        # ---- 10. Final DOM probe ------------------------------------------
        try:
            page_text_after = await page.evaluate(
                "() => document.body.innerText || ''",
            ) or ""
        except Exception:
            page_text_after = page_text
        result["dom"]["empty_review_marker_after"] = (
            EMPTY_REVIEW_MARKER in page_text_after
        )

        # Review count badge.
        for sel in (
            "[class*='reviewCount']", "[class*='review_count']",
            "[class*='goodsReview'] span", "[class*='reviewNum']",
        ):
            try:
                loc = page.locator(sel).first
                if await loc.count() > 0:
                    txt = (await loc.inner_text(timeout=1500)).strip()
                    if txt and any(c.isdigit() for c in txt):
                        result["dom"]["review_count_badge_text"] = txt
                        break
            except Exception:
                continue

        # Sort button labels.
        labels: list[str] = []
        for sel in SORT_BUTTON_SELECTORS:
            try:
                btns = page.locator(sel)
                count = await btns.count()
                for i in range(min(count, 20)):
                    try:
                        t = (await btns.nth(i).inner_text(
                            timeout=1000,
                        )).strip()
                        if t and t not in labels:
                            labels.append(t)
                    except Exception:
                        continue
            except Exception:
                continue
        result["dom"]["sort_button_labels"] = labels

        try:
            await page.screenshot(
                path=str(out_dir / "screenshot_after.png"),
                full_page=False, timeout=10000,
            )
        except Exception as e:
            result["dom"]["screenshot_after_error"] = (
                f"{type(e).__name__}: {e}"
            )
        try:
            (out_dir / "page_text.txt").write_text(
                page_text_after or page_text or "",
                encoding="utf-8",
            )
        except Exception as e:
            result["dom"]["page_text_save_error"] = (
                f"{type(e).__name__}: {e}"
            )

        # ---- 11. Network rollups ------------------------------------------
        review_list_responses = [
            {"url": e.get("url"), "status": e.get("status"),
             "step": e.get("step")}
            for e in captured
            if e.get("type") == "response"
            and is_review_list_api(
                e.get("url"), e.get("response_body_preview"),
            )
        ]
        review_meta_responses = [
            {"url": e.get("url"), "status": e.get("status"),
             "step": e.get("step")}
            for e in captured
            if e.get("type") == "response"
            and is_review_meta_api(e.get("url"))
        ]
        result["network"]["review_list_api_responses"] = review_list_responses
        result["network"]["review_meta_api_responses"] = review_meta_responses
        result["network"]["review_list_api_seen"] = bool(review_list_responses)
        result["network"]["review_meta_api_seen"] = bool(review_meta_responses)
        result["network"]["captured_count"] = sum(
            1 for e in captured if e.get("type") == "response"
        )
        try:
            (out_dir / "network_review_candidates.json").write_text(
                json.dumps(captured, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except Exception as e:
            result["network"]["save_error"] = (
                f"{type(e).__name__}: {e}"
            )

        # Identify which step woke the list API (first appearance).
        trigger_step = None
        for entry in captured:
            if entry.get("type") != "response":
                continue
            if is_review_list_api(
                entry.get("url"), entry.get("response_body_preview"),
            ):
                trigger_step = entry.get("step")
                break

        try:
            await page.close()
        except Exception:
            pass

    # ---- 12. Flatten summary block ---------------------------------------
    result["summary"]["current_url"] = result["page"]["url"]
    result["summary"]["userAgent"] = result["browser"]["userAgent"]
    result["summary"]["empty_review_marker_present"] = (
        result["dom"]["empty_review_marker"]
        or result["dom"]["empty_review_marker_after"]
    )
    result["summary"]["review_count_badge"] = result["dom"]["review_count_badge_text"]
    result["summary"]["available_sort_button_labels"] = result["dom"]["sort_button_labels"]
    result["summary"]["cookie_count_by_domain"] = result["session"]["cookie_count_by_domain"]
    result["summary"]["local_storage_keys"] = result["session"]["localStorage_keys"]
    result["summary"]["review_list_api_seen"] = result["network"]["review_list_api_seen"]
    result["summary"]["review_meta_api_seen"] = result["network"]["review_meta_api_seen"]
    result["summary"]["trigger_step_that_woke_list_api"] = trigger_step

    # Body-content rollups across every captured list-API response.
    # Cheap regex passes — caller already capped each body at 8 KB.
    target_goods_no = result.get("goods_no") or ""
    list_api_response_count = 0
    reviews_in_body_total = 0
    reviews_for_target = 0
    list_api_entries = [
        e for e in captured
        if e.get("type") == "response"
        and is_review_list_api(
            e.get("url"), e.get("response_body_preview"),
        )
    ]
    for entry in list_api_entries:
        list_api_response_count += 1
        body_preview = entry.get("response_body_preview") or ""
        reviews_in_body_total += body_has_review_content(body_preview)
        if target_goods_no:
            reviews_for_target += body_count_target_goods_no(
                body_preview, target_goods_no,
            )
    result["summary"]["review_list_api_response_count"] = list_api_response_count
    result["summary"]["review_list_reviews_seen_in_body"] = reviews_in_body_total
    result["summary"]["review_list_reviews_for_target_goods_no"] = reviews_for_target
    result["summary"]["review_list_reviews_filtered_other_goods_no"] = max(
        0, reviews_in_body_total - reviews_for_target,
    )

    # ---- 13. Classify ----------------------------------------------------
    # If `page.goto` raised earlier, surface that distinctly (verdict
    # `page_open_failed`). The screenshot/page-text artifacts may still
    # have been written by best-effort blocks above, so we DON'T
    # back-fill skipped_artifacts here — only the early-attach paths do.
    page_open_error = result.get("page", {}).get("error")
    if page_open_error and not result.get("page", {}).get("opened"):
        for k in ("page_text", "screenshot_after"):
            # Only mark skipped if the file truly wasn't written.
            path = Path(result["artifacts"].get(k, ""))
            if not path.is_file():
                # Don't double-add if a different code path already
                # listed this artifact as skipped.
                if not any(
                    e.get("artifact") == k for e in result["skipped_artifacts"]
                ):
                    result["skipped_artifacts"].append({
                        "artifact": k,
                        "reason": _SKIP_REASON_PAGE_OPEN_FAILED,
                    })
    _finalize_classification(
        result,
        page_open_error=page_open_error if not result["page"]["opened"] else None,
        review_list_reviews_seen_in_body=reviews_in_body_total,
    )

    return result


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _print_summary(result: dict) -> None:
    print()
    print("=" * 78)
    # Defensive None-guard. Every code path through `_async_diagnose`
    # now writes a verdict via `_finalize_classification`, but if a
    # future caller bypasses that we still want a non-empty banner
    # rather than the literal string "None".
    verdict = result.get("verdict") or "unknown_error"
    print(f"  Verdict: {verdict}")
    print("=" * 78)
    print(f"  {result.get('verdict_reason') or '(no reason)'}")
    # Surface a brief CDP/page error line directly under the verdict so
    # the operator sees the underlying string without cracking the JSON.
    browser_error = (result.get("browser") or {}).get("error")
    page_error = (result.get("page") or {}).get("error")
    if browser_error:
        print(f"  browser.error: {browser_error}")
    if page_error and not (result.get("page") or {}).get("opened"):
        print(f"  page.error: {page_error}")
    actions = result.get("next_actions") or []
    if actions:
        print()
        print("  Next actions:")
        for a in actions:
            print(f"    - {a}")
    art = result.get("artifacts") or {}
    print()
    print(f"  Outputs at: {art.get('out_dir', '?')}")
    # Build a quick lookup of skip reasons by artifact key.
    skipped = {
        e.get("artifact"): e.get("reason")
        for e in (result.get("skipped_artifacts") or [])
        if isinstance(e, dict)
    }
    print("  Files:")
    for k, fn in (
        ("diagnostic_summary", "diagnostic_summary.json"),
        ("network_review_candidates", "network_review_candidates.json"),
        ("page_text", "page_text.txt"),
        ("screenshot_before", "screenshot_before.png"),
        ("screenshot_after", "screenshot_after.png"),
    ):
        path = Path(art.get(k, ""))
        if path.is_file():
            print(f"    - {fn} ({path.stat().st_size} bytes)")
        elif k in skipped:
            print(f"    - {fn} (skipped: {skipped[k]})")
        else:
            print(f"    - {fn} (not created)")
    print()
    # Honest privacy reminder.
    print(
        "  Privacy: cookie/localStorage VALUES are NOT captured. "
        "Sensitive headers are stripped. Response bodies are capped."
    )


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        prog="diagnose_oy_review_access",
        description=__doc__.split("\n\n")[0],
    )
    p.add_argument("--product-url", required=True,
                   help="OliveYoung product URL or bare goodsNo.")
    p.add_argument("--port", type=int, default=9222,
                   help="CDP port (default 9222).")
    p.add_argument("--profile-dir", type=Path,
                   default=Path.home() / "chrome-oy-profile",
                   help="Chrome profile dir; logged but not enforced "
                        "(the diagnostic attaches to whatever CDP "
                        "is on the port).")
    p.add_argument("--out-dir", type=Path, default=None,
                   help="Diagnostic artifact directory. Default: "
                        "outputs/diagnostics/<UTC ts>_oy_access/")
    p.add_argument("--api-wait-seconds", type=float, default=DEFAULT_API_WAIT_S,
                   help=f"Max seconds to wait for the cursor API "
                        f"(default {DEFAULT_API_WAIT_S:.0f}).")
    args = p.parse_args(argv)

    # URL parse first — bail before opening Chrome if URL is bad.
    goods_no, parse_err = parse_goods_no(args.product_url)
    if not goods_no:
        print(f"✗ url parse error: {parse_err}", file=sys.stderr)
        return 3

    if args.out_dir is None:
        ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        args.out_dir = REPO / "outputs" / "diagnostics" / f"{ts}_oy_access"
    args.out_dir.mkdir(parents=True, exist_ok=True)

    print(f"  CDP port    : {args.port}")
    print(f"  profile_dir : {args.profile_dir}")
    print(f"  goodsNo     : {goods_no}")
    print(f"  out_dir     : {args.out_dir}")
    print()
    print("  First confirm CDP is reachable:")
    print(f"    curl -s http://127.0.0.1:{args.port}/json/version | python3 -m json.tool")
    print()
    print("  Running diagnostic (this may take 30–90 seconds)...")

    try:
        result = asyncio.run(_async_diagnose(
            product_url=args.product_url,
            port=args.port,
            profile_dir=args.profile_dir,
            out_dir=args.out_dir,
            api_wait_seconds=float(args.api_wait_seconds),
        ))
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        return 1

    # Persist the summary.
    try:
        (args.out_dir / "diagnostic_summary.json").write_text(
            json.dumps(result, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except Exception as e:
        print(f"⚠ could not save diagnostic_summary.json: {e}", file=sys.stderr)

    _print_summary(result)

    # Exit code 2 = environment / attach failure (operator must act before
    # any further scrape attempt). Exit code 0 = diagnostic completed
    # (verdict may still be a failure code, but the run itself succeeded
    # in producing artifacts).
    if result.get("verdict") in (
        "browser_attach_error",
        VERDICT_CDP_ATTACH_FAILED,
        VERDICT_PAGE_OPEN_FAILED,
    ):
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
