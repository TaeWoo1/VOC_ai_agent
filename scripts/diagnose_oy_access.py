"""Quick diagnostic for OliveYoung review-page access.

Goal: when a `run_all.py` / strict-mode scrape fails repeatedly, find
out which gate is closed BEFORE adding more retry/backoff/reset
machinery. The five gates we distinguish:

    1. url_parse_error      — goodsNo couldn't be parsed.
    2. login_required       — login wall on the product page.
    3. anti_bot             — CAPTCHA / Cloudflare / "본인 확인".
    4. review_load_race     — page renders, review tab/card or cursor
                              API never fires within 60s.
    5. network_throttle /   — page itself never reaches
       page_open_error        domcontentloaded.
    plus `ok` (everything visible + cursor API observed).

The script does NOT scrape reviews. It does NOT call Stage 1 / Stage 2
/ aggregation. It does NOT retry — every probe runs once and reports
what it saw. Artifacts (screenshot, HTML snippet, result JSON) land
under `data/diagnostics/<UTC-timestamp>/`.

Usage:

    PYTHONPATH=. python3 scripts/diagnose_oy_access.py \\
        --product-url "https://www.oliveyoung.co.kr/.../goodsNo=A000000xxxxx"

    # Owned-browser mode (no CDP), useful for fingerprint comparison:
    PYTHONPATH=. python3 scripts/diagnose_oy_access.py \\
        --product-url "..." --cdp-endpoint "" --headless

The result JSON schema is documented under `_RESULT_SCHEMA` below.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

# Re-use marker / selector constants from the production connector
# so a marker added there automatically flows into the diagnostic.
from src.voc.connectors.oliveyoung_browser_api import (  # noqa: E402
    OliveYoungBrowserAPIConnector,
    parse_breadcrumb_text,
)

# ---------------------------------------------------------------------------
# Result schema (1.0)
# ---------------------------------------------------------------------------

_RESULT_SCHEMA: dict = {
    "schema_version": "1.1",
    # Top-level
    "ran_at_utc": "ISO-8601 UTC string",
    "product_url": "str",
    "goods_no": "str | None",
    "goods_no_parse_ok": "bool",

    # Browser attach + profile context (1.1)
    "browser_attach": {
        "mode": "cdp | owned",
        "cdp_endpoint": "str | null",
        "ok": "bool",
        "error": "str | null",
        # Path of the Chrome profile the CDP browser is using, when
        # discoverable. CDP exposes `userDataDir` via /json/version on
        # newer Chromium builds; absent on older ones.
        "profile_path": "str | null",
        "profile_detection_method": "cdp_json_version | candidate_match | null",
    },

    # Page open
    "page_open": {
        "ok": "bool",
        "title": "str | null",
        "final_url": "str | null",
        "elapsed_ms": "int | null",
        "error": "str | null",
    },

    # DOM probes
    "interstitial_markers_seen": ["...matched substrings..."],
    "human_check_detected": "bool",
    "login_wall_detected": "bool",
    "breadcrumb_visible": "bool",
    "breadcrumb_path": ["..."],
    "review_tab_visible": "bool",
    "review_card_visible": "bool",

    # API observation
    "review_api_observed": {
        "fired": "bool",
        "elapsed_ms": "int | null",
        "first_status": "int | null",
    },

    # Artifacts
    "artifacts": {
        "screenshot_path": "str | null",
        "html_snippet_path": "str | null",
        "result_json_path": "str",
        "out_dir": "str",
    },

    # Verdict
    "verdict": (
        "url_parse_error | browser_attach_error | page_open_error | "
        "login_required | anti_bot | review_load_race | "
        "network_throttle | ok"
    ),
    "verdict_reason": "str",
    "next_actions": ["..."],
}


# ---------------------------------------------------------------------------
# Pure helpers (testable without Playwright)
# ---------------------------------------------------------------------------

GOODS_NO_RE = re.compile(r"goodsNo=([A-Z]\d{10,})", re.IGNORECASE)

# Subset of `INTERSTITIAL_MARKERS_KO` that means "user must log in"
# rather than "anti-bot CAPTCHA". Recovery action differs (sign in
# vs solve CAPTCHA / wait for IP cooldown), so the verdict
# distinguishes them.
LOGIN_WALL_MARKERS_KO: tuple[str, ...] = (
    "로그인이 필요",
    "로그인 후 이용",
)

# Breadcrumb selectors — same priority list as the connector's
# `_capture_breadcrumb_from_dom`. Listed here so this script stays
# self-contained.
BREADCRUMB_SELECTORS: tuple[str, ...] = (
    "nav.breadcrumb",
    "ol.breadcrumb",
    "[class*='breadcrumb']",
    "[itemtype*='BreadcrumbList']",
    ".cate_info",
    ".prd_category",
)

# Review-tab + review-card probes. Tab presence means the page has
# rendered far enough for the user-visible review UI; card means
# at least one review row has rendered into the DOM.
REVIEW_TAB_SELECTORS: tuple[str, ...] = (
    'button:has-text("리뷰&셔터")',
    'button:has-text("리뷰")',
    "[data-target='review']",
    "[id*='review']",
    "a.tab_review",
)
REVIEW_CARD_SELECTORS: tuple[str, ...] = (
    "li.review-list-item",
    "[class*='review-list-item']",
    ".review-content",
    "[class*='ReviewItem']",
)

# Page-open hard timeout. Diagnostic is a one-shot probe — we want
# to bail quickly so the operator can see results. Generous enough
# to account for CDN / IP throttling without hanging forever.
PAGE_OPEN_TIMEOUT_S: float = 30.0
DEFAULT_API_WAIT_S: float = 60.0


# Chrome profile candidates — same priority order as
# `scripts/reset_oy_chrome_profile.sh`. Used as a fallback when the
# CDP `/json/version` endpoint doesn't expose `userDataDir` (older
# Chromium builds).
_PROFILE_CANDIDATES: tuple[str, ...] = (
    "/tmp/chrome-debug-oy",
    "~/Library/Chrome-OY-debug",
    "~/chrome-oy-profile",
    "/tmp/chrome-oy-profile",
)


def detect_chrome_profile_path(
    cdp_endpoint: str | None,
) -> tuple[str | None, str | None]:
    """Best-effort Chrome profile path resolution.

    Strategy:
      1. CDP `/json/version` exposes `userDataDir` on Chromium ≥ 119.
         When reachable and populated, use it verbatim.
      2. Otherwise, return the first candidate path that exists on
         disk. If multiple candidates exist, prefer the one most
         recently modified — best proxy for "the one Chrome is using
         right now."
      3. Otherwise, return None.

    Returns `(path, method)`. `method` is one of
    `"cdp_json_version" | "candidate_match" | None`. The diagnostic
    surfaces `method` so the operator can tell the difference between
    "Chrome told us" and "we guessed from disk."
    """
    import os
    import urllib.error
    import urllib.request

    if cdp_endpoint:
        try:
            with urllib.request.urlopen(  # nosec — local CDP endpoint
                f"{cdp_endpoint.rstrip('/')}/json/version",
                timeout=2.0,
            ) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
            udd = payload.get("userDataDir")
            if isinstance(udd, str) and udd.strip():
                return udd, "cdp_json_version"
        except (urllib.error.URLError, OSError, ValueError, TimeoutError):
            pass

    # Disk fallback. Sort candidates by mtime DESC; return first
    # existing one.
    found: list[tuple[float, str]] = []
    for cand in _PROFILE_CANDIDATES:
        expanded = os.path.expanduser(cand)
        if os.path.isdir(expanded):
            try:
                mtime = os.path.getmtime(expanded)
            except OSError:
                mtime = 0.0
            found.append((mtime, expanded))
    if found:
        found.sort(reverse=True)
        return found[0][1], "candidate_match"
    return None, None


def parse_goods_no(url: str | None) -> tuple[str | None, str | None]:
    """Extract `goodsNo=` from an OY product URL.

    Returns `(goods_no, error)` — exactly one is None. Bare goods
    numbers (`A000000123456`) are also accepted for convenience.
    """
    if not url or not url.strip():
        return None, "empty url"
    s = url.strip()
    # Bare goodsNo shortcut.
    if re.fullmatch(r"[Aa]\d{10,}", s):
        return s.upper(), None
    m = GOODS_NO_RE.search(s)
    if not m:
        return None, "no goodsNo= query parameter found"
    return m.group(1).upper(), None


def decide_verdict(obs: dict) -> tuple[str, str, list[str]]:
    """Return `(verdict, reason, next_actions)` from the observation
    dict the async probe builds. Pure — no I/O, no DOM access. Easy
    to unit-test.

    Decision order matters: a hard failure earlier in the chain
    (URL → browser → page → markers) takes precedence over later
    DOM observations.
    """
    if not obs.get("goods_no_parse_ok", False):
        return (
            "url_parse_error",
            "Could not parse goodsNo from the URL.",
            [
                "Pass a URL of the form "
                "`https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do"
                "?goodsNo=A000000xxxxxxx` or the bare goodsNo.",
            ],
        )
    ba = obs.get("browser_attach") or {}
    if not ba.get("ok", False):
        mode = ba.get("mode") or "cdp"
        err = ba.get("error") or "unknown"
        if mode == "cdp":
            return (
                "browser_attach_error",
                f"CDP attach failed: {err}",
                [
                    "Verify Chrome is launched with "
                    "`--remote-debugging-port=9222`.",
                    "`curl http://localhost:9222/json/version` should "
                    "return JSON.",
                    "Try `--cdp-endpoint \"\"` to launch an owned "
                    "browser instead, for fingerprint comparison.",
                ],
            )
        return (
            "browser_attach_error",
            f"Owned-browser launch failed: {err}",
            [
                "Run `playwright install chromium` if Chromium is "
                "missing.",
            ],
        )
    po = obs.get("page_open") or {}
    if not po.get("ok", False):
        err = po.get("error") or "unknown"
        # Distinguish a plain navigation timeout (network/IP
        # throttling family) from other open-time errors.
        if "timeout" in err.lower() or "net::" in err.lower():
            return (
                "network_throttle",
                f"Page never reached domcontentloaded: {err}",
                [
                    "Check egress IP — if you've been hitting OY hard "
                    "from this network, the IP may be soft-blocked.",
                    "Try a different network (mobile hotspot) and "
                    "re-run this diagnostic.",
                    "If `curl https://www.oliveyoung.co.kr/` is also "
                    "slow, this is upstream / ISP-level.",
                ],
            )
        return (
            "page_open_error",
            f"Page navigation error: {err}",
            ["Re-run the diagnostic; transient renderer crash is possible."],
        )
    # Page opened. Markers next.
    if obs.get("login_wall_detected"):
        return (
            "login_required",
            (
                "Login wall detected on the product page "
                f"(matched: {obs.get('interstitial_markers_seen') or []})."
            ),
            [
                "Sign into OliveYoung in the CDP-attached Chrome window.",
                "If you cleared cookies recently, you'll need to log "
                "in again.",
                "After login, re-run this diagnostic to confirm and "
                "then re-run `run_all.py`.",
            ],
        )
    if obs.get("human_check_detected"):
        return (
            "anti_bot",
            (
                "Anti-bot / human-verification interstitial detected "
                f"(matched: {obs.get('interstitial_markers_seen') or []})."
            ),
            [
                "Solve the CAPTCHA / 본인 확인 in the Chrome window.",
                "If the wall persists after solving, your IP is "
                "likely soft-blocked — switch network and retry.",
                "When running `run_all.py`, use "
                "`--strict-reset-session-on-block` so the next "
                "subprocess gets a fresh CDP context.",
            ],
        )
    api = obs.get("review_api_observed") or {}
    api_fired = bool(api.get("fired", False))
    review_visible = bool(
        obs.get("review_tab_visible") or obs.get("review_card_visible")
    )
    breadcrumb_visible = bool(obs.get("breadcrumb_visible"))
    if api_fired and review_visible and breadcrumb_visible:
        return (
            "ok",
            (
                "Page opens cleanly, review tab/card DOM visible, "
                "and the cursor API fired "
                f"({api.get('elapsed_ms')}ms, status="
                f"{api.get('first_status')})."
            ),
            ["Access path looks healthy; re-run `run_all.py` normally."],
        )
    # Page renders but the review surface didn't materialize.
    bullets: list[str] = []
    if not breadcrumb_visible:
        bullets.append("Breadcrumb not detected.")
    if not obs.get("review_tab_visible"):
        bullets.append("Review tab DOM not detected.")
    if not obs.get("review_card_visible"):
        bullets.append("No review card rendered into the DOM.")
    if not api_fired:
        bullets.append(
            f"Cursor API ({OliveYoungBrowserAPIConnector.REVIEW_API_PATH}) "
            "did not fire within the wait budget."
        )
    return (
        "review_load_race",
        (
            "Page opens but the review surface is incomplete. "
            + " ".join(bullets)
        ),
        [
            "If review-tab DOM is missing, the page layout may have "
            "changed — refresh and inspect manually.",
            "If the cursor API never fires, the review tab click "
            "probably did not register; try clicking it manually in "
            "Chrome and re-run this diagnostic.",
            "If only the cursor API is missing while the DOM is "
            "present, false-empty / soft-block is likely. The "
            "existing connector handles this with the "
            "`reload_and_reopen_review_tab` page-recreate path.",
        ],
    )


# ---------------------------------------------------------------------------
# Async probe
# ---------------------------------------------------------------------------


async def _async_diagnose(
    *,
    product_url: str,
    cdp_endpoint: str | None,
    headless: bool,
    api_wait_seconds: float,
    out_dir: Path,
) -> dict:
    """Open the page once, probe markers, observe API. Returns the
    observation dict the verdict function consumes."""
    from playwright.async_api import async_playwright  # type: ignore

    obs: dict = {
        "browser_attach": {
            "mode": "cdp" if cdp_endpoint else "owned",
            "cdp_endpoint": cdp_endpoint or None,
            "ok": False,
            "error": None,
            # profile_path / profile_detection_method are filled at
            # the top-level skeleton in main(); the async probe only
            # touches `ok` / `error` so the values aren't clobbered
            # by the merge in main().
        },
        "page_open": {
            "ok": False,
            "title": None,
            "final_url": None,
            "elapsed_ms": None,
            "error": None,
        },
        "interstitial_markers_seen": [],
        "human_check_detected": False,
        "login_wall_detected": False,
        "breadcrumb_visible": False,
        "breadcrumb_path": [],
        "review_tab_visible": False,
        "review_card_visible": False,
        "review_api_observed": {
            "fired": False,
            "elapsed_ms": None,
            "first_status": None,
        },
    }

    pw = None
    browser = None
    ctx = None
    page = None
    own_browser = False
    own_context = False
    api_path = OliveYoungBrowserAPIConnector.REVIEW_API_PATH

    try:
        pw = await async_playwright().start()

        # ---- 1. Browser attach -------------------------------------
        try:
            if cdp_endpoint:
                browser = await pw.chromium.connect_over_cdp(cdp_endpoint)
                if browser.contexts:
                    ctx = browser.contexts[0]
                else:
                    ctx = await browser.new_context(locale="ko-KR")
                    own_context = True
            else:
                browser = await pw.chromium.launch(headless=headless)
                own_browser = True
                ctx = await browser.new_context(locale="ko-KR")
                own_context = True
            page = await ctx.new_page()
            obs["browser_attach"]["ok"] = True
        except Exception as exc:
            obs["browser_attach"]["error"] = f"{type(exc).__name__}: {exc}"
            return obs

        # ---- 2. Attach API listener BEFORE navigation --------------
        api_first: dict = {"fired": False, "status": None, "t0": time.monotonic()}

        async def _on_response(response):
            try:
                if api_path in response.url and not api_first["fired"]:
                    api_first["fired"] = True
                    api_first["status"] = response.status
                    api_first["elapsed_ms"] = int(
                        (time.monotonic() - api_first["t0"]) * 1000
                    )
            except Exception:
                pass

        page.on("response", _on_response)

        # ---- 3. Page open ------------------------------------------
        t0 = time.monotonic()
        try:
            await page.goto(
                product_url,
                wait_until="domcontentloaded",
                timeout=int(PAGE_OPEN_TIMEOUT_S * 1000),
            )
            obs["page_open"]["ok"] = True
            obs["page_open"]["elapsed_ms"] = int(
                (time.monotonic() - t0) * 1000
            )
            try:
                obs["page_open"]["title"] = await page.title()
            except Exception:
                pass
            try:
                obs["page_open"]["final_url"] = page.url
            except Exception:
                pass
        except Exception as exc:
            obs["page_open"]["error"] = f"{type(exc).__name__}: {exc}"
            # Try one more probe burst even on open failure — some
            # markers (login wall) render before domcontentloaded.

        # ---- 4. DOM probes -----------------------------------------
        async def _has_text(marker: str) -> bool:
            try:
                loc = page.locator(f"text={marker}").first
                return await loc.count() > 0
            except Exception:
                return False

        for marker in OliveYoungBrowserAPIConnector.INTERSTITIAL_MARKERS_KO:
            if await _has_text(marker):
                obs["interstitial_markers_seen"].append(marker)
                if marker in LOGIN_WALL_MARKERS_KO:
                    obs["login_wall_detected"] = True
                else:
                    obs["human_check_detected"] = True

        # Breadcrumb
        for sel in BREADCRUMB_SELECTORS:
            try:
                loc = page.locator(sel).first
                if await loc.count() == 0:
                    continue
                txt = await loc.inner_text(timeout=1500)
                nodes = parse_breadcrumb_text(txt)
                if nodes:
                    obs["breadcrumb_visible"] = True
                    obs["breadcrumb_path"] = list(nodes)
                    break
            except Exception:
                continue

        # Review tab
        for sel in REVIEW_TAB_SELECTORS:
            try:
                if await page.locator(sel).first.count() > 0:
                    obs["review_tab_visible"] = True
                    break
            except Exception:
                continue

        # Try clicking the review tab once (best-effort) so the
        # cursor API has a reason to fire. Skip if not visible.
        if obs["review_tab_visible"]:
            for sel in REVIEW_TAB_SELECTORS:
                try:
                    loc = page.locator(sel).first
                    if await loc.count() > 0:
                        await loc.click(timeout=3000)
                        break
                except Exception:
                    continue

        # ---- 5. Wait for API response (one-shot, bounded) ----------
        deadline = time.monotonic() + api_wait_seconds
        # Reset the t0 to now so elapsed_ms reflects post-click wait.
        api_first["t0"] = time.monotonic()
        while time.monotonic() < deadline and not api_first["fired"]:
            try:
                await asyncio.sleep(0.5)
            except Exception:
                break
        obs["review_api_observed"]["fired"] = api_first["fired"]
        if api_first["fired"]:
            obs["review_api_observed"]["elapsed_ms"] = api_first.get(
                "elapsed_ms",
            )
            obs["review_api_observed"]["first_status"] = api_first.get(
                "status",
            )

        # Re-probe review card after the wait — cards might have
        # rendered while we were waiting on the API.
        for sel in REVIEW_CARD_SELECTORS:
            try:
                if await page.locator(sel).first.count() > 0:
                    obs["review_card_visible"] = True
                    break
            except Exception:
                continue

        # ---- 6. Artifacts ------------------------------------------
        out_dir.mkdir(parents=True, exist_ok=True)
        screenshot_path = out_dir / "screenshot.png"
        html_path = out_dir / "page.html"
        try:
            await page.screenshot(
                path=str(screenshot_path), full_page=False,
                timeout=10000,
            )
            obs.setdefault("artifacts", {})["screenshot_path"] = str(
                screenshot_path,
            )
        except Exception as e:
            obs.setdefault("artifacts", {})["screenshot_path"] = None
            obs.setdefault("artifacts", {})["screenshot_error"] = (
                f"{type(e).__name__}: {e}"
            )
        try:
            html = await page.content()
            # Cap at 200 KB so legacy DOM dumps don't explode disk
            # usage when run repeatedly.
            html_path.write_text(html[:200_000], encoding="utf-8")
            obs["artifacts"]["html_snippet_path"] = str(html_path)
        except Exception as e:
            obs.setdefault("artifacts", {})["html_snippet_path"] = None
            obs["artifacts"]["html_error"] = (
                f"{type(e).__name__}: {e}"
            )

    finally:
        # Don't close the user's main CDP browser; only close what we
        # own (page + owned context, owned browser).
        if page is not None:
            try:
                await page.close()
            except Exception:
                pass
        if own_context and ctx is not None:
            try:
                await ctx.close()
            except Exception:
                pass
        if own_browser and browser is not None:
            try:
                await browser.close()
            except Exception:
                pass
        if pw is not None:
            try:
                await pw.stop()
            except Exception:
                pass

    return obs


# ---------------------------------------------------------------------------
# Public entry
# ---------------------------------------------------------------------------


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="diagnose_oy_access",
        description=__doc__.split("\n\n", 1)[0],
    )
    p.add_argument("--product-url", required=True,
                   help="OliveYoung product URL or bare goodsNo.")
    p.add_argument(
        "--cdp-endpoint",
        default="http://localhost:9222",
        help="CDP endpoint of an attached Chrome (default "
             "`http://localhost:9222`). Pass the empty string to "
             "force an owned-browser launch.",
    )
    p.add_argument(
        "--headless", action="store_true",
        help="Headless mode for owned-browser path. Ignored under CDP.",
    )
    p.add_argument(
        "--api-wait-seconds", type=float, default=DEFAULT_API_WAIT_S,
        help=f"Max seconds to wait for the cursor API response after "
             f"opening the page (default {DEFAULT_API_WAIT_S:.0f}).",
    )
    p.add_argument(
        "--out-dir", type=Path, default=None,
        help="Diagnostic artifact directory. Default: "
             "`<repo>/data/diagnostics/<UTC timestamp>/`.",
    )
    return p.parse_args(argv)


def _print_summary(result: dict) -> None:
    """One-screen operator summary; full detail lives in result.json."""
    v = result.get("verdict") or "unknown"
    reason = result.get("verdict_reason") or ""
    next_actions = result.get("next_actions") or []
    out_dir = (result.get("artifacts") or {}).get("out_dir") or "(unknown)"
    ba = result.get("browser_attach") or {}
    profile_path = ba.get("profile_path")
    profile_method = ba.get("profile_detection_method")
    api = result.get("review_api_observed") or {}
    artifacts = result.get("artifacts") or {}
    screenshot = artifacts.get("screenshot_path")

    print()
    print("=" * 78)
    print(f"  Verdict: {v}")
    print("=" * 78)
    print(f"  {reason}")
    print()
    print("  Observations:")
    print(
        f"    profile_path        : {profile_path or '(not detected)'}"
        + (f"  [{profile_method}]" if profile_method else "")
    )
    print(
        f"    review_dom_visible  : "
        f"tab={result.get('review_tab_visible')!r}  "
        f"card={result.get('review_card_visible')!r}"
    )
    print(
        f"    review_api_observed : fired={api.get('fired')!r}  "
        f"status={api.get('first_status')!r}  "
        f"elapsed_ms={api.get('elapsed_ms')!r}"
    )
    print(
        f"    auth_wall           : {bool(result.get('login_wall_detected'))}"
    )
    print(
        f"    anti_bot_human_check: {bool(result.get('human_check_detected'))}"
    )
    markers = result.get("interstitial_markers_seen") or []
    if markers:
        print(f"    markers_matched     : {markers}")
    if screenshot:
        print(f"    screenshot          : {screenshot}")
    if next_actions:
        print()
        print("  Suggested next actions:")
        for a in next_actions:
            print(f"    - {a}")
    # Specific guidance: when DOM renders but API never fires AND the
    # condition has persisted across a manual reload window, suggest
    # the profile reset script. Heuristic only — the operator confirms.
    dom_visible = bool(
        result.get("review_tab_visible") or result.get("review_card_visible")
    )
    if (
        v == "review_load_race"
        and dom_visible
        and not api.get("fired")
    ):
        print()
        print(
            "  ⚠ False-empty pattern detected (DOM renders, cursor API "
            "never fires)."
        )
        print(
            "    If this state has persisted >30 minutes across a manual"
        )
        print(
            "    reload, the profile is likely contaminated. Reset it:"
        )
        print()
        print("      scripts/reset_oy_chrome_profile.sh")
        print()
        print(
            "    See docs/oy_chrome_profile_reset.md for the full"
        )
        print(
            "    operator playbook."
        )
    print()
    print(f"  Artifacts: {out_dir}")
    print()


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)

    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out_dir: Path = (
        args.out_dir
        if args.out_dir is not None
        else REPO / "data" / "diagnostics" / ts
    )
    out_dir.mkdir(parents=True, exist_ok=True)

    goods_no, parse_err = parse_goods_no(args.product_url)
    # Profile detection runs before the async probe so the path is
    # surfaced even when CDP attach fails (operator wants to know
    # *which* profile they're trying to attach to).
    profile_path, profile_method = detect_chrome_profile_path(
        args.cdp_endpoint or None,
    )
    result: dict = {
        "schema_version": "1.1",
        "ran_at_utc": ts.replace("T", "T").replace("Z", ""),
        "product_url": args.product_url,
        "goods_no": goods_no,
        "goods_no_parse_ok": goods_no is not None,
        "browser_attach": {
            "mode": "cdp" if args.cdp_endpoint else "owned",
            "cdp_endpoint": args.cdp_endpoint or None,
            "ok": False,
            "error": None,
            "profile_path": profile_path,
            "profile_detection_method": profile_method,
        },
        "page_open": {
            "ok": False, "title": None, "final_url": None,
            "elapsed_ms": None, "error": None,
        },
        "interstitial_markers_seen": [],
        "human_check_detected": False,
        "login_wall_detected": False,
        "breadcrumb_visible": False,
        "breadcrumb_path": [],
        "review_tab_visible": False,
        "review_card_visible": False,
        "review_api_observed": {
            "fired": False, "elapsed_ms": None, "first_status": None,
        },
        "artifacts": {
            "screenshot_path": None,
            "html_snippet_path": None,
            "result_json_path": str(out_dir / "result.json"),
            "out_dir": str(out_dir),
        },
    }

    if not goods_no:
        verdict, reason, actions = decide_verdict(result)
        result["verdict"] = verdict
        result["verdict_reason"] = reason
        result["next_actions"] = actions
        _write_result(result)
        _print_summary(result)
        return 0

    cdp = args.cdp_endpoint or None
    try:
        obs = asyncio.run(_async_diagnose(
            product_url=args.product_url,
            cdp_endpoint=cdp,
            headless=bool(args.headless),
            api_wait_seconds=float(args.api_wait_seconds),
            out_dir=out_dir,
        ))
        # Merge observation into the result skeleton.
        for k, v in obs.items():
            if k == "artifacts":
                result["artifacts"].update(v)
            elif k == "browser_attach":
                # Partial update so the pre-populated profile_path /
                # profile_detection_method survive the merge.
                result["browser_attach"].update(v)
            else:
                result[k] = v
    except KeyboardInterrupt:
        print("\nInterrupted; partial result will be written.", file=sys.stderr)
    except Exception as e:
        # Defensive: any unexpected error becomes a browser_attach
        # failure rather than a stack trace landing on the operator.
        result["browser_attach"]["ok"] = False
        result["browser_attach"]["error"] = (
            f"unexpected: {type(e).__name__}: {e}"
        )

    verdict, reason, actions = decide_verdict(result)
    result["verdict"] = verdict
    result["verdict_reason"] = reason
    result["next_actions"] = actions
    _write_result(result)
    _print_summary(result)
    return 0


def _write_result(result: dict) -> None:
    path = Path(result["artifacts"]["result_json_path"])
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(result, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


if __name__ == "__main__":
    raise SystemExit(main())
