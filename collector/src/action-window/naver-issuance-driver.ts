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
 * CANDIDATE selectors (`CANDIDATE_TARGET_SELECTORS`, `CANDIDATE_APP_ENTRY_SELECTOR`) are HYPOTHESES —
 * `LIVE_DOM_CALIBRATION_PENDING` — used ONLY in-page to COUNT matches; a selector never crosses the wire, and
 * a live run must confirm them (see the implementation report's "candidates a live run must confirm").
 */
import type { Page } from "playwright";
import { log } from "../log";
import { mountOverlay, unmountOverlay } from "./overlay";
import { armObserver, disarmObserver, waitForUserAction } from "./observer";
import { IN_PAGE_SIG_FACTORY } from "./signature";
import {
  EXTRACT_API_CENTER_CENSUS,
  classifyUrlCategory,
  type ApiCenterStructuralCensus,
} from "../cli/observe-api-center";
import { CANDIDATE_TARGET_SELECTORS, pageCategoryFromCensus } from "./api-issuance/api-center-adapter";
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
  create_app: "API 애플리케이션을 직접 생성하세요.",
  open_app: "기존 API 애플리케이션을 직접 여세요.",
  api_group: "커머스 API 그룹을 직접 추가하세요.",
  credentials: "발급된 Client ID/Secret을 직접 확인하세요 (도구는 값을 읽지 않습니다).",
  return: "SellerOps로 돌아오세요.",
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
}

/**
 * Build the in-page locate script for one candidate selector. When `tag` is true it ALSO moves the read-only
 * `data-aw-target` annotation onto the single match (clearing any prior tag first) so the generic overlay /
 * observer attach to it. It NEVER clicks and reads NO field value: the signature is computed in-page from the
 * element's tag name + document position + child count only. Returns `{ count, sig? }` (sig only on a unique
 * match). Kept ES5-plain and string-form so esbuild's `__name` shim is never referenced in the page.
 */
function inPageLocate(selector: string, tag: boolean): string {
  return `(function () {
  /* issuance-${tag ? "tag" : "locate"} */
  var sig = ${IN_PAGE_SIG_FACTORY};
  var slice = Function.prototype.call.bind(Array.prototype.slice);
  var nodes = slice(document.querySelectorAll(${JSON.stringify(selector)}));
  if (nodes.length !== 1) { return { count: nodes.length }; }
  var el = nodes[0];
  ${
    tag
      ? `var prior = slice(document.querySelectorAll('[data-aw-target]'));
  for (var p = 0; p < prior.length; p++) { prior[p].removeAttribute('data-aw-target'); }
  el.setAttribute('data-aw-target', '');`
      : ``
  }
  var all = slice(document.querySelectorAll('*'));
  var idx = all.indexOf(el);
  return { count: 1, sig: sig(el.tagName + ':' + idx, 'children:' + el.childElementCount) };
})()`;
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
    const page = this.activePage();
    const res = await this.evalStr<LocateResult>(page, inPageLocate(CANDIDATE_TARGET_SELECTORS[target], false));
    return res.count === 1 && res.sig ? { count: 1, sig: res.sig } : { count: res.count };
  }

  async highlightTarget(target: IssuanceTarget): Promise<LocateResult> {
    const page = this.activePage();
    // Anti-drift: RE-locate AND tag in one in-page pass. The engine compares this sig against the locate sig
    // and parks on page_mismatch if the unique match drifted between the two reads.
    const res = await this.evalStr<LocateResult>(page, inPageLocate(CANDIDATE_TARGET_SELECTORS[target], true));
    if (res.count === 1 && res.sig) {
      await mountOverlay(page, {
        stepNumber: OVERLAY_STEP[target],
        totalSteps: ISSUANCE_TOTAL_STEPS,
        copyKey: `actionWindow.issuance.step.${target}`,
        label: OPERATOR_STEP_LABELS[target],
        guidanceEnabled: this.opts.guidanceEnabled ?? true,
      });
      return { count: 1, sig: res.sig };
    }
    return { count: res.count };
  }

  async clearHighlight(): Promise<void> {
    const page = this.activePage();
    await unmountOverlay(page).catch(() => undefined);
    await this.evalStr(page, IN_PAGE_CLEAR_TAG).catch(() => undefined);
  }

  async armObserve(target: IssuanceTarget): Promise<void> {
    const page = this.activePage();
    // Re-tag the control (a resume/recheck may arm without a fresh highlight) then arm the read-only observer.
    await this.evalStr(page, inPageLocate(CANDIDATE_TARGET_SELECTORS[target], true)).catch(() => undefined);
    await armObserver(page);
  }

  async observeUserAction(_target: IssuanceTarget): Promise<boolean> {
    void _target;
    return waitForUserAction(this.activePage(), {
      timeoutMs: this.opts.observeTimeoutMs ?? DEFAULT_ISSUANCE_OBSERVE_TIMEOUT_MS,
    });
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
