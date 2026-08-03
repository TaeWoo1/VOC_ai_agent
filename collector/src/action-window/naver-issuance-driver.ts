/**
 * **NAVER API-issuance guided-walk driver — LIVE surface core (fixture-first, NOT yet live-verified).**
 *
 * The live sibling of `./api-issuance/issuance-fixture-driver.ts` (`IssuanceFixtureDriver`): an
 * {@link IssuanceProbeDriver} that drives the guided API-center onboarding walk over a REAL Playwright
 * `Page` the seller navigated to, instead of a data fixture. It composes the SAME sanitized classifiers the
 * fixture path uses (`observe-api-center`'s census + `api-center-adapter`'s `pageCategoryFromCensus`, so the
 * two can never disagree) and the SAME generic real-page seams the export/reply drivers already use
 * (`overlay` / `observer`), differing only in how it obtains the surface: it reads `page.url()` (reduced to a
 * host CATEGORY, never logged raw) and runs the value-free census in-page.
 *
 * LOCATION IS DELIBERATELY OUTSIDE `api-issuance/` (like `naver-live-driver.ts`) because it legitimately uses
 * `.evaluate` for the census / overlay / read-only tagging. The pure `api-issuance/` runtime carries a strict
 * source guard that forbids `.evaluate` entirely; keeping this driver out of that directory keeps that guard
 * intact. This module has its OWN guard (`naver-issuance-driver-guard.test.ts`) that allows `.evaluate` /
 * `setAttribute` but still forbids every click/type/submit and every field-VALUE read.
 *
 * HARD BOUNDARIES (enforced by that source guard + the offline driver test):
 *   - **No login, click, type, submit, create, or select.** The SELLER performs every real step in their own
 *     window. This driver only reads a sanitized page category, counts candidates, annotates read-only, arms
 *     observation, and reacts to a reported action.
 *   - **No credential read — region PRESENCE only.** For the `credentials` target it detects that a
 *     credential region/control exists (a count + a STRUCTURAL signature); it NEVER reads the Application ID
 *     or Secret value. No `.inputValue`, no `.value` read, no clipboard, no screenshot, no `page.content()`
 *     that carries values, no DOM text projected out. The structural signature is computed IN-PAGE from an
 *     element's tag + position + child count only — never from any value/attribute content.
 *   - **Sanitized outputs only.** Counts, booleans, fixed category enums, and an opaque 16-hex signature. No
 *     selector, raw URL, path, page content, or value ever leaves this module.
 *
 * CALIBRATED highlight locators come from {@link ISSUANCE_TARGET_SELECTORS} (`issuance-highlight-selectors`):
 * each highlightable target is resolved by a FIXED NAVER label (a structural candidate query + an exact label
 * such as "애플리케이션 등록"), derived without drift from the live-confirmed visual-recon adopted set. NAVER's
 * API-center controls expose no aria-label/id, so a fixed label is the only value-free anchor. Boundaries:
 *   - **`open_app` is NAVIGATION guidance, never a highlighted control.** Opening a *specific* existing app
 *     needs that app's identity (no fixed label; a broad structural row anchor measured non-unique live), so the
 *     existing-app step 2 shows text guidance ("연결할 애플리케이션을 직접 열어주세요") and the driver OBSERVES
 *     the seller's own `app_list → app_detail` navigation ({@link NaverIssuanceDriver.observeUserAction} polls
 *     the sanitized page CATEGORY and returns once the list is left). No NAVER control is located, tagged, or
 *     highlighted; the engine verifies the seller reached the detail page before reusing the calibrated
 *     `api_group` / `credentials` highlights. Its locate/highlight return a fixed synthetic guidance signature.
 *   - **`return` is guidance-only** — never a located NAVER control. Its locate/highlight show the "return to
 *     SellerOps" overlay and return a fixed, synthetic guidance signature (not derived from any page element).
 *   - `CANDIDATE_APP_ENTRY_SELECTOR` remains a `LIVE_DOM_CALIBRATION_PENDING` COUNT-only hypothesis (used to
 *     branch existing-vs-empty). A selector / label never crosses the wire (only the opaque 16-hex signature does).
 */
import type { Page } from "playwright";
import { log } from "../log";
import { mountOverlay, unmountOverlay } from "./overlay";
import { disarmObserver } from "./observer";
import {
  EXTRACT_API_CENTER_CENSUS,
  classifyUrlCategory,
  type ApiCenterPageCategory,
  type ApiCenterStructuralCensus,
} from "../cli/observe-api-center";
import { pageCategoryFromCensus } from "./api-issuance/api-center-adapter";
import { buildFixedLabelLocateScript } from "./api-issuance-calibration/visual-recon-inpage";
import {
  isGuidedHighlightTarget,
  isIssuanceHighlightTarget,
  isIssuanceNavigationTarget,
  locatorFor,
  type IssuanceHighlightTarget,
} from "./api-issuance-calibration/issuance-highlight-selectors";
import { ISSUANCE_TOTAL_STEPS } from "./api-issuance/issuance-stages";
import type {
  ApplicationsRead,
  IssuanceProbeDriver,
  IssuanceSurfaceProbe,
  IssuanceTarget,
} from "./api-issuance/issuance-driver";
import type { LocateResult } from "./engine";

/**
 * **CANDIDATE / LIVE_DOM_CALIBRATION_PENDING.** How an application-entry row is counted on the app-list page.
 * Generic list-row structure only — NO NAVER-specific class/id. A COUNT is all that is read (never a name/id
 * value), and a live run must confirm this maps to real application rows.
 */
export const CANDIDATE_APP_ENTRY_SELECTOR = "table tbody tr, ul li, ol li, [role='row']";

/** Default seated-operator observe window (the seller works in the API-center window). Tests override to instant. */
export const DEFAULT_ISSUANCE_OBSERVE_TIMEOUT_MS = 10 * 60_000;

/** Bounded settle before a probe read — best-effort; a thin/never-idle page just fails closed downstream. */
const SETTLE_TIMEOUT_MS = 15_000;

/**
 * Bounded retry for the value-free TAG+SIG in-page annotation that runs AFTER the locator has already resolved a
 * unique, in-view element: a NAVER app-detail SPA soft-navigation can still destroy the execution context under
 * that final `.evaluate`. It is a tiny window now (the locator confirmed a stable unique match first), so a small
 * number of extra attempts covers a transient beat; if every attempt throws the last error propagates and the
 * engine parks recoverably (`onDriveFault`). The RESOLUTION itself (find/uniqueness/scroll) no longer runs through
 * `.evaluate` at all — it is Playwright-locator based (auto-waiting), which is what survives the SPA soft-navs.
 */
const MAX_INPAGE_RETRIES = 2;

/** Pause between annotation retries — lets a one-off soft-navigation re-render land before the next tag read. */
const INPAGE_RETRY_MS = 400;

/**
 * Bounded auto-wait for the Playwright LOCATOR to resolve the fixed-label section. Unlike a raw `page.evaluate`,
 * a locator re-resolves across the SPA's client-side navigations, so this is the primitive that actually survives
 * the "execution context was destroyed" the live proof hit. On timeout the driver returns `{ count: 0 }` and the
 * engine parks `target_not_found` recoverably — a bounded miss, never an infinite wait.
 */
const LOCATOR_TIMEOUT_MS = 8_000;

/**
 * VERIFY_OPEN bounded polling: after the seller opens their existing app, the app-detail SPA hydrates for a beat
 * and can classify as a transient `unknown` before it settles to `app_detail`. So the verify probe polls the
 * sanitized page category up to {@link VERIFY_MAX_POLLS} times ({@link VERIFY_POLL_MS} apart) and returns as soon
 * as it reaches a DEFINITIVE landing (`app_detail` success, or `login` = session lost). If it never settles
 * within the bound it returns the last probe — the engine then parks `page_mismatch` recoverably, never hangs.
 */
const VERIFY_MAX_POLLS = 12;
const VERIFY_POLL_MS = 500;

/** Poll interval while observing the seller's own `app_list → app_detail` navigation for `open_app`. */
const OPEN_NAV_POLL_MS = 1_000;

/** Bounded sleep between navigation-observe polls (no wall-clock read; timer only). */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Escape a fixed label for use inside a RegExp (the label is a calibrated constant, never page-derived text). */
function escapeForRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A whitespace-tolerant EXACT-match RegExp for a FIXED NAVER label, for a locator's `hasText` filter. Playwright
 * normalizes an element's text before testing, so anchoring `^…$` (with optional surrounding whitespace) matches
 * the SAME "candidates whose normalized accessible name equals the label" the audited in-page script asserts —
 * keeping the locator's narrowing consistent with the value-free tag+sig script that follows it.
 */
function exactLabelRegex(label: string): RegExp {
  return new RegExp(`^\\s*${escapeForRegExp(label)}\\s*$`);
}

/** True for a Playwright locator TIMEOUT (a bounded miss → recoverable park), by error NAME only (never message). */
function isTimeout(e: unknown): boolean {
  return e instanceof Error && e.name === "TimeoutError";
}

/**
 * A DEFINITIVE `open_app` landing category for VERIFY_OPEN polling — the categories that STOP the poll because
 * they will not change under further hydration:
 *   - `app_detail` / `credential_issuance` — the seller reached their application's own detail page (an existing
 *     app shows its issued Application ID / Secret read-only, which the shared classifier calls
 *     `credential_issuance`); both are a SUCCESS landing the engine accepts.
 *   - `login` — the session expired mid-open (a recoverable park).
 * Transient hydration states (`unknown`, still-`app_list`) are NOT definitive — keep polling until one settles or
 * the bound elapses. The engine (`onOpenAppVerified`) owns the MEANING of each category; this only decides when
 * the category has stopped moving enough to stop polling (so a legitimate `credential_issuance` landing no longer
 * spins the poll to the bound before the engine accepts it).
 */
function isVerifyResolved(category: ApiCenterPageCategory): boolean {
  return category === "app_detail" || category === "credential_issuance" || category === "login";
}

/** The overlay step number per barrier (dev diagnostic badge only — cosmetic, mirrors the engine's plan). */
const OVERLAY_STEP: Readonly<Record<IssuanceTarget, number>> = {
  create_app: 2,
  open_app: 2,
  api_group: 3,
  credentials: 4,
  return: 5,
};

/**
 * Operator-legible dev-overlay labels for the headed live run (no product FE is present, so the badge is the
 * only in-window guidance). Diagnostic aid only — NOT the product FE's localized copy. The SELLER performs
 * every step; SellerOps never copies the Client ID / Secret (a separate masked SellerOps form does that).
 */
const OPERATOR_STEP_LABELS: Readonly<Record<IssuanceTarget, string>> = {
  create_app: "표시된 'API 애플리케이션 등록' 위치입니다. 직접 생성한 뒤 SellerOps에서 '다음'을 누르세요.",
  open_app: "기존 API 애플리케이션을 직접 여세요. (SellerOps가 상세 화면 진입을 관찰합니다.)",
  api_group: "표시된 '커머스 API' 그룹 위치를 확인한 뒤 SellerOps에서 '다음'을 누르세요.",
  credentials: "표시된 애플리케이션 ID/Secret 위치를 확인한 뒤 SellerOps에서 '다음'을 누르세요 (도구는 값을 읽지 않습니다).",
  return: "SellerOps로 돌아와 '다음'을 누르세요.",
};

/** A browser context whose newest tab may hold the step the seller opened. Structural subset of Playwright's. */
export interface IssuanceContextLike {
  pages(): Page[];
  on?(event: "close", handler: () => void): void;
}

export interface NaverIssuanceDriverOptions {
  /** Bounded window for the seller to act on a highlighted control. Defaults to {@link DEFAULT_ISSUANCE_OBSERVE_TIMEOUT_MS}. */
  observeTimeoutMs?: number;
  guidanceEnabled?: boolean;
  /**
   * Optional context so the driver reads the NEWEST tab: the seller may open the next API-center step in a new
   * tab (mirrors `observe-api-center`'s newest-tab handling). Absent → the single injected page is used.
   */
  context?: IssuanceContextLike;
  /** Pause between in-page locate/highlight retries. Defaults to {@link INPAGE_RETRY_MS}; tests set 0. */
  inpageRetryMs?: number;
  /** Pause between VERIFY_OPEN settle-polls. Defaults to {@link VERIFY_POLL_MS}; tests set 0. */
  verifyPollMs?: number;
}

/**
 * A FIXED, synthetic guidance signature for `return`. Returning to SellerOps is NOT a NAVER control — it is
 * text guidance — so this signature is NOT derived from any page element. It is a stable opaque 16-hex constant
 * so the engine's locate↔highlight anti-drift check (which requires the two signatures to match) still passes.
 */
const RETURN_GUIDANCE_SIG = "5e11e40b5e11e40b";

/**
 * A FIXED, synthetic guidance signature for `open_app`. Opening an existing application is NAVIGATION guidance,
 * not a highlighted NAVER control — so, like `return`, this signature is NOT derived from any page element. It
 * is a stable opaque 16-hex constant (distinct from {@link RETURN_GUIDANCE_SIG}) so the engine's locate↔highlight
 * anti-drift check still passes for the guidance overlay.
 */
const OPEN_APP_GUIDANCE_SIG = "09a90b1109a90b11";

/**
 * The value-free FIXED-LABEL locate/tag script for a highlightable target (the three label targets only). When
 * `tag` is true it also moves the read-only `data-aw-target` annotation onto the unique match. The script (in
 * `visual-recon-inpage`) returns only `{ count, sig? }` — never any text/value.
 */
function issuanceLocateScript(target: IssuanceHighlightTarget, tag: boolean): string {
  const loc = locatorFor(target);
  return buildFixedLabelLocateScript({ candidateQuery: loc.candidateQuery, exactText: loc.exactText, tag });
}

/**
 * The locate/tag script the GUIDED highlight walk may run for a target — null unless the target is
 * {@link isGuidedHighlightTarget} (a `live_confirmed`, calibrated control). Kept as a fail-closed gate so a
 * future non-calibrated highlight target parks `target_not_found` rather than being highlighted blind.
 */
function guidedLocateScript(target: IssuanceHighlightTarget, tag: boolean): string | null {
  return isGuidedHighlightTarget(target) ? issuanceLocateScript(target, tag) : null;
}

/** Remove every read-only `data-aw-target` annotation. Value-free; safe on a page with none. */
const IN_PAGE_CLEAR_TAG = `(function () {
  /* issuance-cleartag */
  var slice = Function.prototype.call.bind(Array.prototype.slice);
  var els = slice(document.querySelectorAll('[data-aw-target]'));
  for (var i = 0; i < els.length; i++) { els[i].removeAttribute('data-aw-target'); }
  return true;
})()`;

/** Count candidate application-entry rows — a COUNT only, never a name/id/value. */
const IN_PAGE_APP_ENTRY_COUNT = `(function () {
  /* issuance-appcount */
  return document.querySelectorAll(${JSON.stringify(CANDIDATE_APP_ENTRY_SELECTOR)}).length;
})()`;

export class NaverIssuanceDriver implements IssuanceProbeDriver {
  private readonly page: Page;
  private readonly opts: NaverIssuanceDriverOptions;
  private readonly closed: Promise<void>;

  constructor(page: Page, opts: NaverIssuanceDriverOptions = {}) {
    this.page = page;
    this.opts = opts;
    // Resolve when the seller closes the API-center window (page or, if provided, the whole context), so the
    // session parks recoverably instead of arming an observation on a dead page.
    this.closed = new Promise<void>((resolve) => {
      let done = false;
      const fire = (): void => {
        if (!done) {
          done = true;
          resolve();
        }
      };
      page.on("close", fire);
      opts.context?.on?.("close", fire);
    });
  }

  /** The page all surface work runs against: the newest tab when a context is injected, else the single page. */
  private activePage(): Page {
    const pages = this.opts.context?.pages() ?? [];
    return pages.length > 0 ? pages[pages.length - 1]! : this.page;
  }

  /** Evaluate a STRING snippet (not a function) so esbuild's `__name` shim is never referenced in the page. */
  private evalStr<R>(page: Page, script: string): Promise<R> {
    return (page as unknown as { evaluate<T>(s: string): Promise<T> }).evaluate<R>(script);
  }

  /** Best-effort settle; a page without `waitForLoadState` (offline fake) is left as-is. */
  private async settle(page: Page): Promise<void> {
    const p = page as unknown as { waitForLoadState?: (s: string, o?: { timeout?: number }) => Promise<void> };
    if (typeof p.waitForLoadState !== "function") return;
    try {
      await p.waitForLoadState("networkidle", { timeout: SETTLE_TIMEOUT_MS });
    } catch {
      /* timeout is fine — the classifier fails closed on thin signals */
    }
  }

  /**
   * Best-effort settle of the current surface before the engine's next locate. The session calls this at the top
   * of a `guide` so the fixed-label locate/highlight never fires on a still-settling post-navigation page (the
   * `app_list → app_detail` transition that destroyed the execution context in the live proof). Bounded and
   * value-free — it waits for `networkidle` only, reads nothing, and a page that never idles just proceeds and
   * fails closed downstream, exactly like {@link probeSurface}.
   */
  async settleSurface(): Promise<void> {
    await this.settle(this.activePage());
  }

  /**
   * **The SPA-stable resolution of a fixed-label highlight target — Playwright LOCATOR based, not `.evaluate`.**
   *
   * The live-proof failure was a raw `page.evaluate(querySelectorAll…)` throwing "execution context was destroyed"
   * on the NAVER app-detail SPA — a raw evaluate does not survive the SPA's client-side (soft) navigations. So the
   * SEARCH now runs through a Playwright locator, which auto-waits and RE-RESOLVES across those navigations:
   *   1. Build a locator narrowing the structural candidate query to the FIXED NAVER label (exact, whitespace-
   *      tolerant) and wait (bounded) for it to be ATTACHED — this is the primitive that rides out the soft-navs.
   *   2. Enforce UNIQUENESS with `locator.count()` (the calibrated targets are matchCount===1); anything else is a
   *      recoverable park upstream.
   *   3. `scrollIntoViewIfNeeded` (read-only; scrolling is not a click) so the section is on screen before tagging.
   *   4. ONLY THEN run the AUDITED value-free tag+sig IIFE ({@link buildFixedLabelLocateScript}) on the now-settled,
   *      unique, in-view element — wrapped in a small bounded retry for a soft-nav that lands mid-annotation. This
   *      keeps the value-free OUTPUT + exact-label match + structural anti-drift signature byte-for-byte unchanged.
   *
   * Re-reads {@link activePage} on every attempt so a context/frame change (a newly-opened tab) is picked up. On a
   * locator TIMEOUT it returns `{ count: 0 }` (→ `target_not_found` park, recoverable, bounded — never an infinite
   * wait); on a non-unique match `{ count }`; if the final annotation keeps throwing, the last error propagates and
   * the session's `onDriveError → engine.onDriveFault` parks `page_mismatch` recoverably.
   */
  private async resolveFixedLabelTarget(target: IssuanceHighlightTarget, tag: boolean): Promise<LocateResult> {
    const loc = locatorFor(target);
    const hasText = exactLabelRegex(loc.exactText);
    const script = guidedLocateScript(target, tag);
    if (!script) return { count: 0 }; // fail closed rather than resolve a non-calibrated control
    let lastErr: unknown;
    for (let attempt = 0; attempt <= MAX_INPAGE_RETRIES; attempt++) {
      // Re-resolve the active page/frame each attempt so a context change (new tab) is followed, not stale-bound.
      const page = this.activePage();
      const located = page.locator(loc.candidateQuery, { hasText });
      try {
        // Auto-waiting resolution that survives the SPA's soft-navigations (the actual live fix). EVERY locator op
        // (waitFor / count / scroll) AND the audited `.evaluate` share this one try, so a soft-nav that destroys the
        // context under ANY of them is retried up to the bound rather than escaping unbounded.
        await located.first().waitFor({ state: "attached", timeout: LOCATOR_TIMEOUT_MS });
        const matchCount = await located.count();
        if (matchCount !== 1) return { count: matchCount }; // non-unique → engine parks target_not_found (recoverable)
        // Read-only: bring the section into view (never a click) so the tag lands on an on-screen element. Scroll is
        // best-effort — a scroll timeout/miss must not fail the resolve, so it never reaches the catch below.
        await located.first().scrollIntoViewIfNeeded({ timeout: LOCATOR_TIMEOUT_MS }).catch(() => undefined);
        // The ONLY remaining `.evaluate` — the audited value-free tag+sig on the already-resolved unique element.
        const res = await this.evalStr<LocateResult>(page, script);
        return res.count === 1 && res.sig ? { count: 1, sig: res.sig } : { count: res.count };
      } catch (e) {
        // A locator TIMEOUT is a bounded miss (the label never rendered) → recoverable target_not_found, returned
        // WITHOUT retrying (retrying a timeout would just wait another full window). Any other error (a soft-nav
        // destroying the context under count/evaluate) is retried up to the bound, then propagates → onDriveFault.
        if (isTimeout(e)) return { count: 0 };
        lastErr = e;
        if (attempt < MAX_INPAGE_RETRIES) await sleep(this.opts.inpageRetryMs ?? INPAGE_RETRY_MS);
      }
    }
    throw lastErr;
  }

  async probeSurface(): Promise<IssuanceSurfaceProbe> {
    await this.settle(this.activePage());
    return this.readSurface();
  }

  /**
   * Classify the CURRENT surface WITHOUT settling — the value-free census + host-category read that
   * {@link probeSurface} runs after its settle. Split out so VERIFY_OPEN's poll can re-read the category cheaply
   * between short delays: a settle waits `networkidle` up to {@link SETTLE_TIMEOUT_MS} (15 s), and running it on
   * every one of {@link VERIFY_MAX_POLLS} polls of a never-idle SPA would stall VERIFY for minutes. The poll
   * settles ONCE up front (via the first `probeSurface`) then quick-reads here.
   */
  private async readSurface(): Promise<IssuanceSurfaceProbe> {
    const page = this.activePage();
    const census = await this.evalStr<ApiCenterStructuralCensus>(page, EXTRACT_API_CENTER_CENSUS);
    // The raw URL is reduced to a host CATEGORY and never logged/emitted; only the enum is used.
    const urlCategory = classifyUrlCategory(page.url());
    const { pageCategory, signals } = pageCategoryFromCensus(urlCategory, census);
    if (pageCategory === "login") {
      log("aw_issuance_probe", { pageCategory, ok: false });
      return { ok: false, pageCategory: "login", blockerCode: "LOGIN_REQUIRED" };
    }
    log("aw_issuance_probe", { pageCategory, ok: true });
    return { ok: true, pageCategory, signals };
  }

  /**
   * VERIFY_OPEN's bounded-polling probe: after the seller opens their existing app the app-detail SPA hydrates for
   * a beat and can classify as a transient `unknown` (or briefly still `app_list`) before it settles. Rather than
   * fail the verify on that first transient read (the live-proof flake), poll {@link probeSurface} up to
   * {@link VERIFY_MAX_POLLS} times ({@link VERIFY_POLL_MS} apart) and return as soon as a DEFINITIVE landing is
   * reached — `app_detail` (success) or `login` (session lost, recoverable). If it never settles within the bound,
   * return the LAST probe unchanged: the engine then parks `page_mismatch` recoverably. Value-free and bounded — no
   * wall-clock read, only the sanitized category, and it can never wait forever.
   */
  async probeSurfaceSettled(): Promise<IssuanceSurfaceProbe> {
    const pollMs = this.opts.verifyPollMs ?? VERIFY_POLL_MS;
    // Settle ONCE up front (give the just-started navigation a beat), then quick-read the category between short
    // delays — NOT a full 15 s settle per poll, which would stall VERIFY for minutes on a never-idle SPA.
    let last = await this.probeSurface();
    for (let i = 1; i < VERIFY_MAX_POLLS && !isVerifyResolved(last.pageCategory); i++) {
      if (pollMs > 0) await sleep(pollMs); // pollMs 0 (tests) stays microtask-only; live waits a real beat
      last = await this.readSurface();
    }
    return last;
  }

  async readApplications(): Promise<ApplicationsRead> {
    const page = this.activePage();
    const census = await this.evalStr<ApiCenterStructuralCensus>(page, EXTRACT_API_CENTER_CENSUS);
    // CANDIDATE / LIVE_DOM_CALIBRATION_PENDING: a COUNT of application-entry rows — never a name/id/value.
    const applicationEntryRowCount = await this.evalStr<number>(page, IN_PAGE_APP_ENTRY_COUNT);
    log("aw_issuance_read_apps", { hasEntries: applicationEntryRowCount > 0 });
    return { census, applicationEntryRowCount };
  }

  async locateTarget(target: IssuanceTarget): Promise<LocateResult> {
    // `return` and `open_app` are GUIDANCE, not queried NAVER controls — each resolves to a fixed synthetic
    // signature (return = "go back to SellerOps"; open_app = "open your existing app yourself" — the driver
    // then OBSERVES the app_detail navigation, it never highlights a specific app row).
    if (target === "return") return { count: 1, sig: RETURN_GUIDANCE_SIG };
    if (target === "open_app") return { count: 1, sig: OPEN_APP_GUIDANCE_SIG };
    // Only the fixed-label controls are highlightable.
    if (!isIssuanceHighlightTarget(target)) return { count: 0 };
    // SPA-stable: the search is Playwright-locator based (auto-waiting, survives soft-navs), not a raw `.evaluate`.
    return this.resolveFixedLabelTarget(target, false);
  }

  async highlightTarget(target: IssuanceTarget): Promise<LocateResult> {
    const page = this.activePage();
    // `return` and `open_app` show a GUIDANCE overlay — no NAVER control is located/tagged for either. For
    // open_app the overlay tells the seller to open their app; the app_detail transition is observed next.
    if (target === "return") {
      await this.mountStepOverlay(page, "return");
      return { count: 1, sig: RETURN_GUIDANCE_SIG };
    }
    if (target === "open_app") {
      await this.mountStepOverlay(page, "open_app");
      return { count: 1, sig: OPEN_APP_GUIDANCE_SIG };
    }
    if (!isIssuanceHighlightTarget(target)) return { count: 0 };
    // Anti-drift: the locator RE-resolves the unique match (surviving soft-navs) and scrolls it into view, then the
    // audited script RE-tags + re-signs it. The engine compares this sig against the locate sig and parks on
    // page_mismatch if the unique match drifted between the two passes.
    const res = await this.resolveFixedLabelTarget(target, true);
    if (res.count === 1 && res.sig) {
      // Same-page viewport checkpoint: mount the reused overlay, which SCROLLS the tagged section into the
      // viewport centre (see `overlay.ts`) and shows the "여기입니다" pointer — the operator sees where the API
      // group / Application ID is without any NAVER click being awaited (`REVEAL_SECTION_IN_VIEWPORT`).
      await this.mountStepOverlay(page, target);
      return { count: 1, sig: res.sig };
    }
    return { count: res.count };
  }

  /** Mount the reused read-only step overlay for one target's operator-legible dev badge. Never clicks/types. */
  private mountStepOverlay(page: Page, target: IssuanceTarget): Promise<void> {
    return mountOverlay(page, {
      stepNumber: OVERLAY_STEP[target],
      totalSteps: ISSUANCE_TOTAL_STEPS,
      copyKey: `actionWindow.issuance.step.${target}`,
      label: OPERATOR_STEP_LABELS[target],
      guidanceEnabled: this.opts.guidanceEnabled ?? true,
    });
  }

  async clearHighlight(): Promise<void> {
    const page = this.activePage();
    await unmountOverlay(page).catch(() => undefined);
    await this.evalStr(page, IN_PAGE_CLEAR_TAG).catch(() => undefined);
  }

  async armObserve(_target: IssuanceTarget): Promise<void> {
    // No click observer is EVER armed for issuance now. The only observed target — `open_app` — is watched as a
    // page CATEGORY transition (see `observeUserAction` → `observeLeftApplicationsList`), not as a click on a
    // tagged control; the same-page viewport checkpoints (api_group / credentials / create_app / return) advance
    // on the operator's own SellerOps "다음", never on a NAVER click. So arming observation is a deliberate no-op.
    return;
  }

  async observeUserAction(target: IssuanceTarget): Promise<boolean> {
    // `open_app` is the ONE observed target: it completes when the seller navigates from the applications list
    // into the app detail — an OBSERVED page-category transition, not a click on a tagged control. The engine
    // then re-probes (VERIFY_OPEN) and verifies the landing page is app_detail before the same-page checkpoints.
    if (isIssuanceNavigationTarget(target)) return this.observeLeftApplicationsList();
    // Every other target is a same-page viewport checkpoint (or `return` guidance): SellerOps never waits for a
    // NAVER action on it — the operator advances with "다음" — so this is never armed for them. Return true as a
    // safe default should it ever be called, so no barrier can hang.
    return true;
  }

  /**
   * Observe the seller's own `app_list → app_detail` navigation for `open_app`, value-free: it polls the
   * sanitized page CATEGORY (the same census + host-category read `probeSurface` uses) and resolves `true` the
   * moment the page is no longer the applications list — i.e. the seller opened their app themselves. It NEVER
   * clicks, tags, or reads a value; only a coarse category enum is inspected, never a URL/DOM value. On timeout
   * (still on the list — the seller has not acted yet) it returns `false` so the session re-arms; the engine's
   * app_detail VERIFICATION (not this method) decides whether the landing page is correct.
   */
  private async observeLeftApplicationsList(): Promise<boolean> {
    const timeoutMs = this.opts.observeTimeoutMs ?? DEFAULT_ISSUANCE_OBSERVE_TIMEOUT_MS;
    const maxPolls = Math.max(1, Math.ceil(timeoutMs / OPEN_NAV_POLL_MS));
    for (let i = 0; i < maxPolls; i++) {
      // A census read can reject while the page is mid-navigation — treat that as "still navigating" and keep
      // polling rather than failing the barrier; the engine's VERIFY_OPEN re-probe is the authority afterwards.
      const category = await this.readPageCategory(this.activePage()).catch(() => "app_list" as ApiCenterPageCategory);
      if (category !== "app_list") return true; // the seller navigated off the applications list
      if (i < maxPolls - 1) await sleep(OPEN_NAV_POLL_MS);
    }
    return false; // still on the list — not acted yet; the session re-arms a fresh observation window
  }

  /** The sanitized page CATEGORY of a page (census + host-category only — never a URL or DOM value). */
  private async readPageCategory(page: Page): Promise<ApiCenterPageCategory> {
    const census = await this.evalStr<ApiCenterStructuralCensus>(page, EXTRACT_API_CENTER_CENSUS);
    const urlCategory = classifyUrlCategory(page.url());
    return pageCategoryFromCensus(urlCategory, census).pageCategory;
  }

  /**
   * READ-ONLY: measure how many candidates a highlight target's fixed-label locator matches on the CURRENT page,
   * and whether it resolves uniquely (matchCount===1). Value-free — it runs the locate script WITHOUT tagging (no
   * `data-aw-target` write) and mounts NO overlay, so it never mutates the page, clicks, types, or reads a value.
   * This is what the read-only `API_ISSUANCE_SELECTOR_PROBE` phase calls to confirm the driver's own mechanism.
   * (`open_app` is not a highlight target — it is navigation guidance — so it is never probed here.)
   */
  async probeTargetMatch(target: IssuanceHighlightTarget): Promise<{ matchCount: number; canHighlight: boolean }> {
    const script = issuanceLocateScript(target, false);
    const res = await this.evalStr<LocateResult>(this.activePage(), script);
    const matchCount = typeof res?.count === "number" && res.count >= 0 ? res.count : 0;
    return { matchCount, canHighlight: matchCount === 1 };
  }

  async cleanup(): Promise<void> {
    const page = this.activePage();
    await unmountOverlay(page).catch(() => undefined);
    await disarmObserver(page).catch(() => undefined);
    await this.evalStr(page, IN_PAGE_CLEAR_TAG).catch(() => undefined);
  }

  whenSurfaceClosed(): Promise<void> {
    return this.closed;
  }
}
