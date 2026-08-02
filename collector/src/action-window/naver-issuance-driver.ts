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
 * Bounded IN-PAGE retry for a locate/highlight read: the NAVER app-detail SPA can re-render/hydrate for a beat
 * AFTER `networkidle`, destroying the execution context under a fixed-label `.evaluate` (the live-proof failure).
 * So a locate/highlight settles then reads, and on an execution-context error it settles again and retries — up
 * to this many EXTRA attempts before it gives up and throws (→ the engine parks recoverably). Small: a page that
 * keeps destroying the context on every read is a genuine fault, not a transient beat.
 */
const MAX_INPAGE_RETRIES = 2;

/** Pause between in-page retries — lets a one-off post-navigation re-render land before the next read. */
const INPAGE_RETRY_MS = 400;

/** Poll interval while observing the seller's own `app_list → app_detail` navigation for `open_app`. */
const OPEN_NAV_POLL_MS = 1_000;

/** Bounded sleep between navigation-observe polls (no wall-clock read; timer only). */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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
   * SETTLE then run an in-page locate/highlight read, retrying on an execution-context error (the app-detail SPA
   * re-rendered under the `.evaluate` right after `networkidle`). Bounded by {@link MAX_INPAGE_RETRIES}: each
   * retry re-settles and pauses so a one-off post-navigation re-render can land, then re-reads. If every attempt
   * throws, the last error propagates — the engine then parks recoverably (`onDriveFault`), so a genuinely broken
   * page fails closed rather than looping. Value-free: it only runs the caller's value-free script.
   */
  private async evalWithSettleRetry<R>(page: Page, script: string): Promise<R> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= MAX_INPAGE_RETRIES; attempt++) {
      await this.settle(page);
      try {
        return await this.evalStr<R>(page, script);
      } catch (e) {
        lastErr = e;
        if (attempt < MAX_INPAGE_RETRIES) await sleep(this.opts.inpageRetryMs ?? INPAGE_RETRY_MS);
      }
    }
    throw lastErr;
  }

  async probeSurface(): Promise<IssuanceSurfaceProbe> {
    const page = this.activePage();
    await this.settle(page);
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
    const script = guidedLocateScript(target, false);
    if (!script) return { count: 0 }; // fail closed rather than highlight a non-calibrated control
    // Settle + bounded retry: the fixed-label read must not race a still-settling post-navigation re-render.
    const res = await this.evalWithSettleRetry<LocateResult>(this.activePage(), script);
    return res.count === 1 && res.sig ? { count: 1, sig: res.sig } : { count: res.count };
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
    const script = guidedLocateScript(target, true);
    if (!script) return { count: 0 }; // fail closed → park, never a wrong highlight
    // Anti-drift: RE-locate AND tag in one in-page pass (settle + bounded retry against a post-nav re-render). The
    // engine compares this sig against the locate sig and parks on page_mismatch if the unique match drifted.
    const res = await this.evalWithSettleRetry<LocateResult>(page, script);
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
