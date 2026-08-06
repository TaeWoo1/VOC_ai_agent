/**
 * **Coupang WING credential-RENEWAL guided-walk driver — LIVE surface core (SCAFFOLD, NEVER run this unit).**
 *
 * The live sibling of `./coupang-renewal/coupang-renewal-fixture-driver.ts`, and the renewal analog of
 * `./coupang-wing-issuance-driver.ts`: a {@link CoupangRenewalProbeDriver} that drives the guided WING renewal
 * walk over a REAL Playwright `Page` the seller navigated to. It composes the SAME sanitized classifier the
 * fixture path uses (`coupang-wing-classifier`'s census + `wingPageCategoryFromCensus`) and the SAME generic
 * real-page seams the issuance driver uses (`overlay`, the audited value-free `buildFixedLabelLocateScript`).
 *
 * LOCATION IS DELIBERATELY OUTSIDE `coupang-renewal/` (like `coupang-wing-issuance-driver.ts`) because it
 * legitimately uses `.evaluate` for the census / overlay / read-only tagging. The pure `coupang-renewal/` runtime
 * carries a strict source guard that forbids `.evaluate`; keeping this driver out preserves that guard. This
 * module has its OWN guard (`coupang-wing-renewal-driver-guard.test.ts`) that allows `.evaluate` / `setAttribute`
 * but still forbids every click/type/submit/re-issue and every field-VALUE read.
 *
 * HARD BOUNDARIES (enforced by that source guard):
 *   - **No login, click, type, submit, re-issue, or select.** The SELLER performs every real step — including
 *     pressing `재발급` themselves. This driver only reads a sanitized page category, resolves + annotates a
 *     fixed-label section read-only, and reacts to a reported action.
 *   - **No credential read — region PRESENCE only.** For `credentials` it detects the region exists (a count + a
 *     STRUCTURAL signature); it NEVER reads the new Access Key / Secret Key / 업체코드.
 *   - **The ONE allowed value read is the `유효기간` DATE**, via the ALLOWLISTED {@link readValidityDate} seam
 *     (delegated to `coupang-renewal/wing-validity-reader`, whose in-page read returns only a date-shaped token,
 *     then sanitized to ISO or null). No other value/text/clipboard/screenshot ever leaves the page.
 *
 * ⚠ **CALIBRATION PENDING (`LIVE_DOM_CALIBRATION_PENDING`) — NOT calibrated.** {@link WING_RENEWAL_HIGHLIGHT_LABELS}
 * are PROPOSED fixed-label candidates from WING's Korean UI (유효기간 / 재발급 / Access Key). They are NOT proven
 * against the real WING DOM. This driver is a scaffold gated behind the live-run approval and is NEVER run in this
 * unit; a live WING walk must confirm each label resolves uniquely before it is trusted.
 */
import type { Page } from "playwright";
import { log } from "../log";
import { mountOverlay, unmountOverlay, overlayMounted } from "./overlay";
import {
  EXTRACT_WING_CENSUS,
  LIVE_DOM_CALIBRATION_PENDING,
  classifyWingUrlCategory,
  observeFrom,
  wingPageCategoryFromCensus,
  type WingObservation,
  type WingPageCategory,
  type WingStructuralCensus,
} from "../cli/coupang-wing-classifier";
import { buildFixedLabelLocateScript } from "./api-issuance-calibration/visual-recon-inpage";
import { COUPANG_RENEWAL_TOTAL_STEPS } from "./coupang-renewal/coupang-renewal-stages";
import type { CoupangRenewalProbeDriver, CoupangRenewalTarget, WingSurfaceProbe } from "./coupang-renewal/coupang-renewal-driver";
import { buildValidityDateExtractScript, sanitizeValidityDate, type ValidityDateExtractResult } from "./coupang-renewal/wing-validity-reader";
import type { LocateResult } from "./engine";

/** The highlightable fixed-label targets (everything except the guidance-only `reach_open_api` / `return`). */
export type WingRenewalHighlightTarget = "check_expiry" | "reissue" | "credentials";

/** Whether {@link WING_RENEWAL_HIGHLIGHT_LABELS} are calibrated against the REAL WING DOM — NOT (pending). */
export const WING_RENEWAL_HIGHLIGHT_CALIBRATION = LIVE_DOM_CALIBRATION_PENDING;

/**
 * **CANDIDATE / `LIVE_DOM_CALIBRATION_PENDING`.** Proposed fixed WING labels for each highlightable renewal
 * target. `유효기간` and `재발급` are the two NEW candidates this unit introduces (never proven live); `Access Key`
 * reuses the issuance credential-region anchor. A live walk must confirm each resolves to exactly one element.
 */
export const WING_RENEWAL_HIGHLIGHT_LABELS: Readonly<Record<WingRenewalHighlightTarget, { candidateQuery: string; exactText: string; tagAncestor?: string }>> = {
  check_expiry: { candidateQuery: "label,span,div,dt,th,strong", exactText: "유효기간", tagAncestor: "tr" },
  reissue: { candidateQuery: "button,a,span,div", exactText: "재발급" },
  credentials: { candidateQuery: "label,span,div,dt,th,strong", exactText: "Access Key", tagAncestor: "tr" },
};

function isWingRenewalHighlightTarget(target: CoupangRenewalTarget): target is WingRenewalHighlightTarget {
  return target === "check_expiry" || target === "reissue" || target === "credentials";
}

export const DEFAULT_WING_OBSERVE_TIMEOUT_MS = 10 * 60_000;
const SETTLE_TIMEOUT_MS = 15_000;
const LOCATOR_SETTLE_MS = 400;
const VERIFY_MAX_POLLS = 12;
const VERIFY_POLL_MS = 500;
const OPEN_NAV_POLL_MS = 1_000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isVerifyResolved(category: WingPageCategory): boolean {
  return category === "open_api_issuance" || category === "credential_shown" || category === "login";
}

/** The overlay step number per barrier (dev diagnostic badge only — cosmetic, mirrors the engine's plan). */
const OVERLAY_STEP: Readonly<Record<CoupangRenewalTarget, number>> = {
  reach_open_api: 1,
  check_expiry: 2,
  reissue: 3,
  credentials: 4,
  return: 5,
};

/** Operator-legible dev-overlay labels for the headed live run (diagnostic aid only — NOT the product FE copy). */
const OPERATOR_STEP_LABELS: Readonly<Record<CoupangRenewalTarget, string>> = {
  reach_open_api: "WING 홈에서 '오픈API 키 발급' 페이지로 직접 이동하세요. (SellerOps가 이동을 관찰합니다.)",
  check_expiry: "표시된 '유효기간'을 직접 확인한 뒤 SellerOps에서 '다음'을 누르세요. (도구는 만료일만 읽습니다.)",
  reissue: "표시된 '재발급' 버튼을 직접 누르세요. SellerOps는 대신 누르지 않습니다. 재발급 후 '다음'을 누르세요.",
  credentials: "새로 표시된 Access Key / Secret Key / 업체코드를 직접 복사한 뒤 '다음'을 누르세요 (도구는 값을 읽지 않습니다).",
  return: "SellerOps로 돌아와 '다음'을 누르세요.",
};

/** A browser context whose newest tab may hold the step the seller opened. Structural subset of Playwright's. */
export interface WingContextLike {
  pages(): Page[];
  on?(event: "close", handler: () => void): void;
}

export interface CoupangWingRenewalDriverOptions {
  observeTimeoutMs?: number;
  guidanceEnabled?: boolean;
  context?: WingContextLike;
  verifyPollMs?: number;
}

/** FIXED, synthetic guidance signatures for the two guidance-only targets (`reach_open_api`, `return`). */
const REACH_OPEN_API_GUIDANCE_SIG = "c0a9b17ec0a9b17e";
const RETURN_GUIDANCE_SIG = "5e11e40b5e11e40b";

/** Remove every read-only `data-aw-target` annotation. Value-free; safe on a page with none. */
const IN_PAGE_CLEAR_TAG = `(function () {
  /* coupang-renewal-cleartag */
  var slice = Function.prototype.call.bind(Array.prototype.slice);
  var els = slice(document.querySelectorAll('[data-aw-target]'));
  for (var i = 0; i < els.length; i++) { els[i].removeAttribute('data-aw-target'); }
  return true;
})()`;

export class CoupangWingRenewalDriver implements CoupangRenewalProbeDriver {
  private readonly page: Page;
  private readonly opts: CoupangWingRenewalDriverOptions;
  private readonly closed: Promise<void>;

  constructor(page: Page, opts: CoupangWingRenewalDriverOptions = {}) {
    this.page = page;
    this.opts = opts;
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

  private activePage(): Page {
    const pages = this.opts.context?.pages() ?? [];
    return pages.length > 0 ? pages[pages.length - 1]! : this.page;
  }

  private evalStr<R>(page: Page, script: string): Promise<R> {
    return (page as unknown as { evaluate<T>(s: string): Promise<T> }).evaluate<R>(script);
  }

  private async settle(page: Page): Promise<void> {
    const p = page as unknown as { waitForLoadState?: (s: string, o?: { timeout?: number }) => Promise<void> };
    if (typeof p.waitForLoadState !== "function") return;
    try {
      await p.waitForLoadState("networkidle", { timeout: SETTLE_TIMEOUT_MS });
    } catch {
      /* timeout is fine — the classifier fails closed on thin signals */
    }
  }

  async settleSurface(): Promise<void> {
    await this.settle(this.activePage());
  }

  async probeSurface(): Promise<WingSurfaceProbe> {
    await this.settle(this.activePage());
    return this.readSurface();
  }

  private async readSurface(): Promise<WingSurfaceProbe> {
    const page = this.activePage();
    const census = await this.evalStr<WingStructuralCensus>(page, EXTRACT_WING_CENSUS);
    const urlCategory = classifyWingUrlCategory(page.url());
    const { pageCategory, signals } = wingPageCategoryFromCensus(urlCategory, census);
    if (pageCategory === "login") {
      log("aw_coupang_renewal_probe", { pageCategory, ok: false });
      return { ok: false, pageCategory: "login", blockerCode: "LOGIN_REQUIRED" };
    }
    log("aw_coupang_renewal_probe", { pageCategory, ok: true });
    return { ok: true, pageCategory, signals };
  }

  async probeSurfaceSettled(): Promise<WingSurfaceProbe> {
    const pollMs = this.opts.verifyPollMs ?? VERIFY_POLL_MS;
    let last = await this.probeSurface();
    for (let i = 1; i < VERIFY_MAX_POLLS && !isVerifyResolved(last.pageCategory); i++) {
      if (pollMs > 0) await sleep(pollMs);
      last = await this.readSurface();
    }
    return last;
  }

  /**
   * **ALLOWLISTED READ — the ONLY value this driver ever reads.** Delegates entirely to the audited
   * `coupang-renewal/wing-validity-reader`: the in-page {@link buildValidityDateExtractScript} returns only a
   * date-shaped token adjacent to the fixed `유효기간` label, and {@link sanitizeValidityDate} re-validates it to
   * an ISO date (`YYYY-MM-DD`) or `null`. It NEVER reads the Access Key / Secret Key / 업체코드. This driver's own
   * source reads no text/attribute/value directly — the single allowlisted read lives in the imported script.
   */
  async readValidityDate(): Promise<string | null> {
    const page = this.activePage();
    const res = await this.evalStr<ValidityDateExtractResult>(page, buildValidityDateExtractScript());
    const iso = sanitizeValidityDate(res?.raw ?? null);
    log("aw_coupang_renewal_validity_read", { found: iso !== null });
    return iso;
  }

  /**
   * Resolve a fixed-label highlight target read-only, and (when `tag`) move the `data-aw-target` annotation onto
   * the unique match. Delegates ALL text reading to the audited value-free {@link buildFixedLabelLocateScript}.
   */
  private async resolveFixedLabelTarget(target: WingRenewalHighlightTarget, tag: boolean): Promise<LocateResult> {
    const spec = WING_RENEWAL_HIGHLIGHT_LABELS[target];
    const script = buildFixedLabelLocateScript({
      candidateQuery: spec.candidateQuery,
      exactText: spec.exactText,
      tag,
      ...(spec.tagAncestor ? { tagAncestor: spec.tagAncestor } : {}),
    });
    const page = this.activePage();
    const res = await this.evalStr<LocateResult>(page, script);
    if (res.count !== 1 || !res.sig) return { count: res.count };
    return { count: 1, sig: res.sig };
  }

  /** READ-ONLY: the full sanitized {@link WingObservation} of the CURRENT surface. */
  async observeSurface(): Promise<WingObservation> {
    const page = this.activePage();
    await this.settle(page);
    const census = await this.evalStr<WingStructuralCensus>(page, EXTRACT_WING_CENSUS);
    const urlCategory = classifyWingUrlCategory(page.url());
    return observeFrom(urlCategory, census);
  }

  /** READ-ONLY selector-recorder seam — measure how many candidates a target's fixed-label locator matches. */
  async probeTargetMatch(target: WingRenewalHighlightTarget): Promise<{ matchCount: number; canHighlight: boolean; sig?: string }> {
    const res = await this.resolveFixedLabelTarget(target, false);
    const matchCount = typeof res?.count === "number" && res.count >= 0 ? res.count : 0;
    const canHighlight = matchCount === 1;
    return canHighlight && res.sig ? { matchCount, canHighlight, sig: res.sig } : { matchCount, canHighlight };
  }

  async locateTarget(target: CoupangRenewalTarget): Promise<LocateResult> {
    if (target === "reach_open_api") return { count: 1, sig: REACH_OPEN_API_GUIDANCE_SIG };
    if (target === "return") return { count: 1, sig: RETURN_GUIDANCE_SIG };
    if (!isWingRenewalHighlightTarget(target)) return { count: 0 };
    return this.resolveFixedLabelTarget(target, false);
  }

  async highlightTarget(target: CoupangRenewalTarget): Promise<LocateResult> {
    const page = this.activePage();
    if (target === "reach_open_api") {
      await this.mountStepOverlay(page, "reach_open_api");
      return { count: 1, sig: REACH_OPEN_API_GUIDANCE_SIG };
    }
    if (target === "return") {
      await this.mountStepOverlay(page, "return");
      return { count: 1, sig: RETURN_GUIDANCE_SIG };
    }
    if (!isWingRenewalHighlightTarget(target)) return { count: 0 };
    const res = await this.resolveFixedLabelTarget(target, true);
    if (res.count !== 1 || !res.sig) return { count: res.count };
    await sleep(LOCATOR_SETTLE_MS);
    await this.mountStepOverlay(page, target);
    if (!(await overlayMounted(page))) return { count: 0 };
    return { count: 1, sig: res.sig };
  }

  private async mountStepOverlay(page: Page, target: CoupangRenewalTarget): Promise<void> {
    await mountOverlay(page, {
      stepNumber: OVERLAY_STEP[target],
      totalSteps: COUPANG_RENEWAL_TOTAL_STEPS,
      copyKey: `actionWindow.coupangRenewal.step.${target}`,
      label: OPERATOR_STEP_LABELS[target],
      guidanceEnabled: this.opts.guidanceEnabled ?? true,
    });
  }

  async clearHighlight(): Promise<void> {
    const page = this.activePage();
    await unmountOverlay(page).catch(() => undefined);
    await this.evalStr(page, IN_PAGE_CLEAR_TAG).catch(() => undefined);
  }

  async armObserve(_target: CoupangRenewalTarget): Promise<void> {
    // No click observer is EVER armed for renewal. The only observed target — reach_open_api — is watched as a
    // page CATEGORY transition; the same-page viewport checkpoints advance on the operator's own `다음`.
    return;
  }

  async observeUserAction(target: CoupangRenewalTarget): Promise<boolean> {
    if (target === "reach_open_api") return this.observeLeftWingHome();
    return true;
  }

  private async observeLeftWingHome(): Promise<boolean> {
    const timeoutMs = this.opts.observeTimeoutMs ?? DEFAULT_WING_OBSERVE_TIMEOUT_MS;
    const maxPolls = Math.max(1, Math.ceil(timeoutMs / OPEN_NAV_POLL_MS));
    for (let i = 0; i < maxPolls; i++) {
      const category = await this.readPageCategory(this.activePage()).catch(() => "wing_home" as WingPageCategory);
      if (category !== "wing_home") return true;
      if (i < maxPolls - 1) await sleep(OPEN_NAV_POLL_MS);
    }
    return false;
  }

  private async readPageCategory(page: Page): Promise<WingPageCategory> {
    const census = await this.evalStr<WingStructuralCensus>(page, EXTRACT_WING_CENSUS);
    const urlCategory = classifyWingUrlCategory(page.url());
    return wingPageCategoryFromCensus(urlCategory, census).pageCategory;
  }

  async cleanup(): Promise<void> {
    const page = this.activePage();
    await unmountOverlay(page).catch(() => undefined);
    await this.evalStr(page, IN_PAGE_CLEAR_TAG).catch(() => undefined);
  }

  whenSurfaceClosed(): Promise<void> {
    return this.closed;
  }
}
