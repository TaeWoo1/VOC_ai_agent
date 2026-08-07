/**
 * **Coupang WING API-issuance guided-walk driver — LIVE surface core (SCAFFOLD, NEVER run this unit).**
 *
 * The live sibling of `./coupang-issuance/coupang-issuance-fixture-driver.ts`: a
 * {@link CoupangIssuanceProbeDriver} that drives the guided WING open-API issuance walk over a REAL Playwright
 * `Page` the seller navigated to, instead of a data fixture. It composes the SAME sanitized classifiers the
 * fixture path uses (`coupang-wing-classifier`'s census + `wingPageCategoryFromCensus`, so the two can never
 * disagree) and the SAME generic real-page seams the export/reply/NAVER-issuance drivers already use
 * (`overlay`), differing only in how it obtains the surface: it reads `page.url()` (reduced to a host CATEGORY,
 * never logged raw) and runs the value-free census in-page.
 *
 * LOCATION IS DELIBERATELY OUTSIDE `coupang-issuance/` (like `naver-issuance-driver.ts`) because it legitimately
 * uses `.evaluate` for the census / overlay / read-only tagging. The pure `coupang-issuance/` runtime carries a
 * strict source guard that forbids `.evaluate` entirely; keeping this driver out of that directory keeps that
 * guard intact. This module has its OWN guard (`coupang-wing-issuance-driver-guard.test.ts`) that allows
 * `.evaluate` / `setAttribute` but still forbids every click/type/submit/issue and every field-VALUE read.
 *
 * HARD BOUNDARIES (enforced by that source guard):
 *   - **No login, click, type, submit, issue, or select.** The SELLER performs every real step in their own
 *     window — including pressing the 발급 (issue) button themselves. This driver only reads a sanitized page
 *     category, resolves + annotates a fixed-label section read-only, and reacts to a reported action.
 *   - **No credential read — region PRESENCE only.** For the `credentials` target it detects that a
 *     credential region/control exists (a count + a STRUCTURAL signature); it NEVER reads the Access Key /
 *     Secret Key / 업체코드 value. No `.inputValue`, no value read, no clipboard, no screenshot, no
 *     `page.content()`. The structural signature is computed IN-PAGE from an element's tag + position + child
 *     count only — never from any value/attribute content.
 *   - **Sanitized outputs only.** Counts, booleans, fixed category enums, and an opaque 16-hex signature.
 *
 * ⚠ **CALIBRATION PENDING (LIVE_DOM_CALIBRATION_PENDING) — NOT calibrated.** {@link WING_HIGHLIGHT_LABELS} are
 * PROPOSED fixed-label candidates derived from WING's Korean UI (자체개발 / 업체명 / 호출 IP / 발급 / Access Key).
 * They are NOT proven against the real WING DOM. This driver is a scaffold gated behind the live-run approval
 * and is NEVER run in this unit; a live WING walk must confirm each label resolves uniquely before it is trusted.
 */
import type { Page } from "playwright";
import { log } from "../log";
import { mountOverlay, unmountOverlay, overlayMounted, resetOverlayAdvance, readOverlayAdvancePressed } from "./overlay";
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
import { COUPANG_ISSUANCE_TOTAL_STEPS } from "./coupang-issuance/coupang-issuance-stages";
import type {
  CoupangIssuanceProbeDriver,
  CoupangIssuanceTarget,
  WingSurfaceProbe,
} from "./coupang-issuance/coupang-issuance-driver";
import { isCoupangCheckpointTarget } from "./coupang-issuance/coupang-issuance-driver";
import type { LocateResult } from "./engine";

/** The highlightable fixed-label targets (everything except the guidance-only `reach_open_api` / `return`). */
export type WingHighlightTarget = "self_dev" | "vendor_info" | "call_ip" | "issue" | "credentials";

/**
 * **CANDIDATE / LIVE_DOM_CALIBRATION_PENDING.** Proposed fixed WING labels for each highlightable target. WING's
 * issuance controls expose no stable aria-label/id, so a fixed Korean label is the only value-free anchor. These
 * are PROPOSALS from the visible WING UI — a live walk must confirm each resolves to exactly one element.
 */
/**
 * Whether {@link WING_HIGHLIGHT_LABELS} are calibrated against the REAL WING DOM — `LIVE_DOM_CALIBRATION_PENDING`
 * (i.e. NOT calibrated). A code-level marker (not just prose) so the source guard can assert this scaffold never
 * claims a proven detector; a live WING walk must confirm each label resolves uniquely before this flips.
 */
export const WING_HIGHLIGHT_CALIBRATION = LIVE_DOM_CALIBRATION_PENDING;

export const WING_HIGHLIGHT_LABELS: Readonly<Record<WingHighlightTarget, { candidateQuery: string; exactText: string; tagAncestor?: string }>> = {
  self_dev: { candidateQuery: "label,button,span,div,a,legend", exactText: "자체개발" },
  vendor_info: { candidateQuery: "label,span,div,dt,th,strong", exactText: "업체명" },
  call_ip: { candidateQuery: "label,span,div,dt,th,strong", exactText: "호출 IP" },
  issue: { candidateQuery: "button,a,span,div", exactText: "발급" },
  credentials: { candidateQuery: "label,span,div,dt,th,strong", exactText: "Access Key", tagAncestor: "tr" },
};

function isWingHighlightTarget(target: CoupangIssuanceTarget): target is WingHighlightTarget {
  return target === "self_dev" || target === "vendor_info" || target === "call_ip" || target === "issue" || target === "credentials";
}

/**
 * The key-DELETION fixed-label target, kept DELIBERATELY SEPARATE from {@link WingHighlightTarget} /
 * `CoupangIssuanceTarget`: deleting is NOT a step in the issuance walk, so it must not leak into the issuance
 * target union (which drives the guided sequence). It is a highlightable WING label the read-only selector
 * recorder can COUNT on the already-issued page, so a later live run can calibrate the 삭제 control before any
 * highlight-delete phase is ever allowed to reach a PREPARED manifest.
 */
export type WingDeletionTarget = "delete";

/**
 * **CANDIDATE / LIVE_DOM_CALIBRATION_PENDING.** Proposed fixed WING label for the 삭제 (delete) control on the
 * already-issued open-API page. Like {@link WING_HIGHLIGHT_LABELS} this is a PROPOSAL from the visible WING UI —
 * a live read-only probe must confirm it resolves to exactly one element before it is ever trusted/highlighted.
 */
export const WING_DELETION_CALIBRATION = LIVE_DOM_CALIBRATION_PENDING;
export const WING_DELETION_LABELS: Readonly<Record<WingDeletionTarget, { candidateQuery: string; exactText: string; tagAncestor?: string }>> = {
  delete: { candidateQuery: "button,a,span,div", exactText: "삭제" },
};

/** Default seated-operator observe window (the seller works in the WING window). Tests override to instant. */
export const DEFAULT_WING_OBSERVE_TIMEOUT_MS = 10 * 60_000;
const SETTLE_TIMEOUT_MS = 15_000;
const LOCATOR_SETTLE_MS = 400;
const VERIFY_MAX_POLLS = 12;
const VERIFY_POLL_MS = 500;
const OPEN_NAV_POLL_MS = 1_000;
const OVERLAY_ADVANCE_POLL_MS = 500;

/**
 * The opaque per-step latch token for a checkpoint's WING-resident advance button. Value-free — a fixed derived
 * string, compared only for equality, never a page value. Distinct per target so a stale press from a prior step
 * can never satisfy the next one's poll.
 */
function advanceToken(target: CoupangIssuanceTarget): string {
  return `coupang-issuance-advance:${target}`;
}

/**
 * The WING-resident advance button caption per checkpoint — the button the seller presses ON THE WING PAGE to
 * advance the guided walk (so they never bounce back to the SellerOps tab to press "다음"). `reach_open_api` has
 * NO button: it is the one step that auto-advances on the observed `wing_home → open_api_issuance` navigation.
 * `issue` and `credentials` deliberately confirm the seller's own manual act (press 발급 / copy the keys) — the
 * driver still presses nothing and reads no value.
 */
const ADVANCE_BUTTON_LABEL: Readonly<Partial<Record<CoupangIssuanceTarget, string>>> = {
  self_dev: "다음",
  vendor_info: "다음",
  call_ip: "다음",
  issue: "발급 완료 · 다음",
  credentials: "복사했어요 · 다음",
  // The return step hands focus back to SellerOps; the SellerOps tab then owns the "enter keys" CTA, so this
  // on-page button is purely "go back" (avoids two near-identical "enter keys" buttons across the two windows).
  return: "SellerOps로 돌아가기",
};

/** Bounded sleep between navigation-observe polls (no wall-clock read; timer only). */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * A DEFINITIVE reach landing category for VERIFY_REACH polling — the categories that STOP the poll because they
 * will not change under further hydration: `open_api_issuance` (success), `credential_shown` (already past issue),
 * or `login` (session lost, recoverable). Transient hydration states (`unknown`, still-`wing_home`) keep polling.
 */
function isVerifyResolved(category: WingPageCategory): boolean {
  return category === "open_api_issuance" || category === "credential_shown" || category === "login";
}

/** The overlay step number per barrier (dev diagnostic badge only — cosmetic, mirrors the engine's plan). */
const OVERLAY_STEP: Readonly<Record<CoupangIssuanceTarget, number>> = {
  reach_open_api: 1,
  self_dev: 2,
  vendor_info: 3,
  call_ip: 4,
  issue: 5,
  credentials: 6,
  return: 7,
};

/**
 * The WING-RESIDENT guidance copy shown in the on-page panel for each step — this IS the seller-facing guidance
 * during the walk, rendered ON the WING page next to the advance button, so the seller's primary screen stays
 * WING (no bounce back to the SellerOps tab per step). Every step is the SELLER's own act: SellerOps never
 * presses 발급 and never reads the Access Key / Secret Key / 업체코드. `reach_open_api` auto-advances on the
 * observed navigation (no button); every other step advances on the seller pressing THIS panel's button.
 */
const OPERATOR_STEP_LABELS: Readonly<Record<CoupangIssuanceTarget, string>> = {
  reach_open_api: "WING 홈에서 '오픈API 키 발급' 페이지로 직접 이동하세요. 이동을 감지하면 자동으로 다음 단계로 넘어갑니다.",
  self_dev: "표시된 '자체개발' 옵션을 직접 선택하세요. 완료하면 아래 '다음'을 누르세요.",
  vendor_info: "표시된 '업체명' 정보를 확인하세요. 완료하면 아래 '다음'을 누르세요.",
  call_ip: "표시된 '호출 IP' 위치에 직접 입력하세요. 완료하면 아래 '다음'을 누르세요.",
  issue: "표시된 '발급' 버튼을 직접 누르세요. SellerOps는 대신 누르지 않습니다. 발급이 끝나면 아래 버튼을 누르세요.",
  credentials: "표시된 Access Key / Secret Key / 업체코드를 직접 복사하세요. SellerOps는 값을 읽지 않습니다. 복사했으면 아래 버튼을 누르세요.",
  return: "이제 아래 버튼을 눌러 SellerOps로 돌아가세요. 돌아가면 복사한 키를 입력해 연결을 마칠 수 있어요.",
};

/** A browser context whose newest tab may hold the step the seller opened. Structural subset of Playwright's. */
export interface WingContextLike {
  pages(): Page[];
  on?(event: "close", handler: () => void): void;
}

export interface CoupangWingIssuanceDriverOptions {
  /** Bounded window for the seller to act on a highlighted control. Defaults to {@link DEFAULT_WING_OBSERVE_TIMEOUT_MS}. */
  observeTimeoutMs?: number;
  guidanceEnabled?: boolean;
  /** Optional context so the driver reads the NEWEST tab (the seller may open a step in a new tab). */
  context?: WingContextLike;
  /** Pause between VERIFY_REACH settle-polls. Defaults to {@link VERIFY_POLL_MS}; tests set 0. */
  verifyPollMs?: number;
}

/**
 * FIXED, synthetic guidance signatures for the two guidance-only targets (`reach_open_api`, `return`). Neither is
 * a WING control — they are text guidance — so these are NOT derived from any page element. Stable opaque 16-hex
 * constants so the engine's locate↔highlight anti-drift check (which requires the two sigs to match) still passes.
 */
const REACH_OPEN_API_GUIDANCE_SIG = "c0a9b17ec0a9b17e";
const RETURN_GUIDANCE_SIG = "5e11e40b5e11e40b";

/** Remove every read-only `data-aw-target` annotation. Value-free; safe on a page with none. */
const IN_PAGE_CLEAR_TAG = `(function () {
  /* coupang-issuance-cleartag */
  var slice = Function.prototype.call.bind(Array.prototype.slice);
  var els = slice(document.querySelectorAll('[data-aw-target]'));
  for (var i = 0; i < els.length; i++) { els[i].removeAttribute('data-aw-target'); }
  return true;
})()`;

export class CoupangWingIssuanceDriver implements CoupangIssuanceProbeDriver {
  private readonly page: Page;
  private readonly opts: CoupangWingIssuanceDriverOptions;
  private readonly closed: Promise<void>;

  constructor(page: Page, opts: CoupangWingIssuanceDriverOptions = {}) {
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

  async settleSurface(): Promise<void> {
    await this.settle(this.activePage());
  }

  async probeSurface(): Promise<WingSurfaceProbe> {
    await this.settle(this.activePage());
    return this.readSurface();
  }

  /** Classify the CURRENT surface WITHOUT settling — the value-free census + host-category read. */
  private async readSurface(): Promise<WingSurfaceProbe> {
    const page = this.activePage();
    const census = await this.evalStr<WingStructuralCensus>(page, EXTRACT_WING_CENSUS);
    // The raw URL is reduced to a host CATEGORY and never logged/emitted; only the enum is used.
    const urlCategory = classifyWingUrlCategory(page.url());
    const { pageCategory, signals } = wingPageCategoryFromCensus(urlCategory, census);
    if (pageCategory === "login") {
      log("aw_coupang_issuance_probe", { pageCategory, ok: false });
      return { ok: false, pageCategory: "login", blockerCode: "LOGIN_REQUIRED" };
    }
    log("aw_coupang_issuance_probe", { pageCategory, ok: true });
    return { ok: true, pageCategory, signals };
  }

  /** VERIFY_REACH's bounded-polling probe: ride out a transient mid-hydration `unknown` before it settles. */
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
   * Resolve a fixed-label highlight target read-only, and (when `tag`) move the `data-aw-target` annotation onto
   * the unique match. Delegates ALL text reading to the audited value-free {@link buildFixedLabelLocateScript}
   * (returns only `{ count, sig? }`) — this driver's own source reads no text/attribute/value. `count !== 1`
   * parks upstream (`target_not_found` recoverable).
   */
  private async resolveFixedLabelTarget(target: WingHighlightTarget, tag: boolean): Promise<LocateResult> {
    return this.resolveFixedLabelSpec(WING_HIGHLIGHT_LABELS[target], tag);
  }

  /**
   * The generic value-free fixed-label locate: run the audited {@link buildFixedLabelLocateScript} for ANY fixed
   * WING label spec (issuance target OR the deletion target), returning only `{ count, sig? }`. Shared by
   * {@link resolveFixedLabelTarget} and {@link probeFixedLabelMatch} so the deletion probe uses the exact same
   * value-free path as the issuance probe — no new text/attribute/value read is introduced.
   */
  private async resolveFixedLabelSpec(
    spec: { candidateQuery: string; exactText: string; tagAncestor?: string },
    tag: boolean,
  ): Promise<LocateResult> {
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

  /**
   * READ-ONLY: the full sanitized {@link WingObservation} of the CURRENT surface — page category + bucketized
   * signals + calibration blockers (always carries `LIVE_DOM_CALIBRATION_PENDING`). Built from the value-free
   * census + host-category read, exactly like {@link readSurface}, so nothing here reads a value/URL/text. This
   * is what the read-only selector recorder prints alongside each target's matchCount so the later live run
   * yields a machine-checkable calibration record.
   */
  async observeSurface(): Promise<WingObservation> {
    const page = this.activePage();
    await this.settle(page);
    const census = await this.evalStr<WingStructuralCensus>(page, EXTRACT_WING_CENSUS);
    // Raw URL reduced to a host CATEGORY (never logged/emitted); only the enum feeds the classifier.
    const urlCategory = classifyWingUrlCategory(page.url());
    return observeFrom(urlCategory, census);
  }

  /**
   * READ-ONLY selector-recorder seam (mirrors {@link NaverIssuanceDriver.probeTargetMatch}): measure how many
   * candidates a highlight target's fixed-label locator matches on the CURRENT page, whether it resolves uniquely
   * (`matchCount === 1`), and — for a unique match — its opaque 16-hex structural signature. It runs the SAME
   * value-free {@link resolveFixedLabelTarget} locate WITHOUT tagging (no `data-aw-target` write) and mounts NO
   * overlay, so it never mutates the page, clicks, types, or reads a field value (incl. Access Key / Secret Key /
   * 업체코드). The `sig` is computed in-page from tag + position + child count only — never any value/attribute.
   */
  async probeTargetMatch(target: WingHighlightTarget): Promise<{ matchCount: number; canHighlight: boolean; sig?: string }> {
    return this.probeFixedLabelMatch(WING_HIGHLIGHT_LABELS[target]);
  }

  /**
   * READ-ONLY selector-recorder seam for ANY fixed WING label spec (issuance targets AND the deletion 삭제
   * target): measure how many candidates the fixed-label locator matches on the CURRENT page, whether it resolves
   * uniquely (`matchCount === 1`), and — for a unique match — its opaque 16-hex structural signature. Runs the same
   * value-free {@link resolveFixedLabelSpec} locate WITHOUT tagging and mounts NO overlay, so it never mutates the
   * page, clicks, types, or reads a field value (incl. Access Key / Secret Key / 업체코드). Lets the recorder
   * calibrate the 삭제 control on the already-issued page without ever pressing or highlighting it.
   */
  async probeFixedLabelMatch(spec: {
    candidateQuery: string;
    exactText: string;
    tagAncestor?: string;
  }): Promise<{ matchCount: number; canHighlight: boolean; sig?: string }> {
    const res = await this.resolveFixedLabelSpec(spec, false);
    const matchCount = typeof res?.count === "number" && res.count >= 0 ? res.count : 0;
    const canHighlight = matchCount === 1;
    return canHighlight && res.sig ? { matchCount, canHighlight, sig: res.sig } : { matchCount, canHighlight };
  }

  async locateTarget(target: CoupangIssuanceTarget): Promise<LocateResult> {
    // `reach_open_api` and `return` are GUIDANCE, not queried WING controls — each resolves to a fixed synthetic
    // signature (reach = "go to the open-API page yourself"; return = "go back to SellerOps").
    if (target === "reach_open_api") return { count: 1, sig: REACH_OPEN_API_GUIDANCE_SIG };
    if (target === "return") return { count: 1, sig: RETURN_GUIDANCE_SIG };
    if (!isWingHighlightTarget(target)) return { count: 0 };
    return this.resolveFixedLabelTarget(target, false);
  }

  async highlightTarget(target: CoupangIssuanceTarget): Promise<LocateResult> {
    const page = this.activePage();
    if (target === "reach_open_api") {
      await this.mountStepOverlay(page, "reach_open_api");
      return { count: 1, sig: REACH_OPEN_API_GUIDANCE_SIG };
    }
    if (target === "return") {
      await this.mountStepOverlay(page, "return");
      return { count: 1, sig: RETURN_GUIDANCE_SIG };
    }
    if (!isWingHighlightTarget(target)) return { count: 0 };
    const res = await this.resolveFixedLabelTarget(target, true);
    if (res.count !== 1 || !res.sig) return { count: res.count };
    // Give the just-set tag a beat to land, then mount the reused read-only overlay on it (scroll into view +
    // "여기입니다" pointer). Never a WING click awaited.
    await sleep(LOCATOR_SETTLE_MS);
    await this.mountStepOverlay(page, target);
    if (!(await overlayMounted(page))) return { count: 0 };
    return { count: 1, sig: res.sig };
  }

  /**
   * Mount the WING-resident step overlay for one target: the read-only spotlight ring + the guidance panel
   * (product copy) and, for a checkpoint, its advance button. `reach_open_api` gets NO button (it auto-advances
   * on the observed navigation). The button only records the seller's press into an in-page value-free latch;
   * the driver never clicks/types and reads no field value.
   */
  private async mountStepOverlay(page: Page, target: CoupangIssuanceTarget): Promise<void> {
    const buttonLabel = ADVANCE_BUTTON_LABEL[target];
    await mountOverlay(page, {
      stepNumber: OVERLAY_STEP[target],
      totalSteps: COUPANG_ISSUANCE_TOTAL_STEPS,
      copyKey: `actionWindow.coupangIssuance.step.${target}`,
      label: OPERATOR_STEP_LABELS[target],
      guidanceEnabled: this.opts.guidanceEnabled ?? true,
      // Opt in to the WING-resident guidance panel (this driver is the only one that does); the button is
      // added only for a checkpoint (a target with an advance label). The reach step gets a copy-only panel.
      residentPanel: true,
      ...(buttonLabel ? { advance: { buttonLabel, token: advanceToken(target) } } : {}),
    });
  }

  async clearHighlight(): Promise<void> {
    const page = this.activePage();
    await unmountOverlay(page).catch(() => undefined);
    await this.evalStr(page, IN_PAGE_CLEAR_TAG).catch(() => undefined);
  }

  async armObserve(target: CoupangIssuanceTarget): Promise<void> {
    // A same-page checkpoint is advanced by the seller pressing THIS step's WING-resident overlay button. Re-arm
    // the value-free latch (set this step's opaque token, drop any prior press) so a stale press from an earlier
    // step or arm window can never be misread as this step's advance. `reach_open_api` arms nothing here — it is
    // watched as a page-CATEGORY transition in `observeUserAction`, not a button press.
    if (isCoupangCheckpointTarget(target)) {
      await resetOverlayAdvance(this.activePage(), advanceToken(target)).catch(() => undefined);
    }
  }

  async observeUserAction(target: CoupangIssuanceTarget): Promise<boolean> {
    // `reach_open_api` is watched as a NAVIGATION: it completes when the seller moves from the WING home to the
    // open-API issuance page — an OBSERVED page-category transition. The engine then re-probes (VERIFY_REACH).
    if (target === "reach_open_api") return this.observeLeftWingHome();
    // Every same-page checkpoint advances WING-resident: poll this step's value-free advance latch until the
    // seller presses the on-page button (or the observe window elapses, so the session re-arms). No value read.
    if (isCoupangCheckpointTarget(target)) return this.observeOverlayAdvance(target);
    return true;
  }

  /**
   * Await the seller's press of this checkpoint's WING-resident advance button, value-free: poll the in-page
   * advance latch for THIS step's opaque token and resolve `true` the moment it matches. NEVER clicks, types, or
   * reads a field value — only compares an opaque token. On timeout it returns `false` so the session re-arms.
   */
  private async observeOverlayAdvance(target: CoupangIssuanceTarget): Promise<boolean> {
    const timeoutMs = this.opts.observeTimeoutMs ?? DEFAULT_WING_OBSERVE_TIMEOUT_MS;
    const maxPolls = Math.max(1, Math.ceil(timeoutMs / OVERLAY_ADVANCE_POLL_MS));
    const token = advanceToken(target);
    for (let i = 0; i < maxPolls; i++) {
      const pressed = await readOverlayAdvancePressed(this.activePage(), token).catch(() => false);
      if (pressed) return true;
      if (i < maxPolls - 1) await sleep(OVERLAY_ADVANCE_POLL_MS);
    }
    return false;
  }

  /**
   * Observe the seller's own `wing_home → open_api_issuance` navigation for `reach_open_api`, value-free: poll the
   * sanitized page CATEGORY and resolve `true` the moment the page is no longer the WING home. NEVER clicks,
   * tags, or reads a value; only a coarse category enum is inspected. On timeout (still on the home) it returns
   * `false` so the session re-arms; the engine's VERIFY_REACH decides whether the landing is correct.
   */
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

  /** The sanitized page CATEGORY of a page (census + host-category only — never a URL or DOM value). */
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
