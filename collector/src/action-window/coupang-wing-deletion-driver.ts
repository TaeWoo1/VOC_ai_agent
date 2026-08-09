/**
 * **Coupang WING open-API key-DELETION guided driver — LIVE surface core.**
 *
 * **INTERNAL DIAGNOSTIC TOOLING — NOT A PRODUCT FEATURE, AND FEATURE-FROZEN** (product-owner decision,
 * 2026-08-08; `docs/product-scope-v1.md` §7.19). Ran once on real WING (2026-08-08,
 * `docs/coupang_wing_key_deletion_live_v1.md`) for one purpose: to put an operator-owned test account into a real
 * no-key state so the new-seller issuance form could be calibrated live. Seller onboarding never deletes a key —
 * its four states are key 없음 ⇒ guided issuance · key 있음 ⇒ connect · expiry ⇒ guided renewal · invalid ⇒
 * re-auth/reissue recovery. Do not import this from a seller-facing tree (a fence test fails the build), do not
 * label it a capability, and do not extend it; regression protection only.
 *
 * The destructive sibling of `./coupang-wing-issuance-driver.ts` / `./coupang-wing-renewal-driver.ts`: it guides
 * an operator to DELETE their existing WING self-developed Open API key, on a REAL Playwright `Page` the seller
 * navigated to. Like those drivers it composes the SAME sanitized classifier (`coupang-wing-classifier`'s census +
 * `wingPageCategoryFromCensus`) and the SAME value-free primitives (`overlay`, the audited
 * `buildFixedLabelLocateScript`), differing only in its single destructive-adjacent target: the 삭제 control.
 *
 * **The AGENT never deletes.** This driver classifies the already-issued page, locates + highlights the 삭제
 * control read-only, mounts an IRREVERSIBLE-WARNING checkpoint, and RESTS. The operator reads the warning and
 * presses 삭제 THEMSELVES; the driver only later reads a sanitized page CATEGORY to confirm the page changed. It
 * NEVER clicks/types/submits/deletes and NEVER reads a field value (Access Key / Secret Key / 업체코드) — only
 * counts, booleans, fixed category enums, and an opaque structural signature leave the page.
 *
 * HARD BOUNDARIES (enforced by `coupang-wing-deletion-driver-guard.test.ts`, which allows `.evaluate` /
 * `setAttribute` but forbids every click/type/submit/delete and every field-VALUE read):
 *   - No login, click, type, submit, delete, or select — the SELLER performs the deletion.
 *   - No value/text/clipboard/screenshot/`page.content()` read — the structural signature is computed IN-PAGE
 *     from tag + position + child count only.
 *
 * **DELETE selector calibration is WITHDRAWN** (`WING_DELETION_CALIBRATION_EVIDENCE` in
 * `./coupang-wing-issuance-driver` carries the withdrawn provenance and the two reasons). A live read-only probe
 * did measure {@link WING_DELETION_LABELS}`.delete` resolving to exactly one element — but with the locator
 * version that could not reject a non-painting match, which is the same version that produced an invisible
 * highlight on the 발급 target. So {@link WING_DELETION_SELECTORS_CALIBRATED} is `false` and this driver refuses
 * to highlight at all. That refusal was always here as defense-in-depth; it is now the operative one.
 *
 * Restoring the flag needs a fresh read-only probe, and even then would be SELECTOR READINESS ONLY — it
 * authorizes nothing. The driver still refuses a non-unique match at runtime, still enforces
 * classify-then-checkpoint-then-operator-action, and its gated CLI still requires a PREPARED destructive
 * manifest. The 삭제 press remains the operator's in every state of the flag.
 */
import type { Page } from "playwright";
import { log } from "../log";
import { advancePanelMounted, mountOverlay, unmountOverlay } from "./overlay";
import {
  EXTRACT_WING_CENSUS,
  classifyWingUrlCategory,
  observeFrom,
  wingPageCategoryFromCensus,
  type WingObservation,
  type WingPageCategory,
  type WingStructuralCensus,
} from "../cli/coupang-wing-classifier";
import { buildFixedLabelLocateScript } from "./api-issuance-calibration/visual-recon-inpage";
import { WING_DELETION_LABELS, WING_DELETION_SELECTORS_CALIBRATED } from "./coupang-wing-issuance-driver";
import type { LocateResult } from "./engine";

/** The ordered walk phase — enforces "checkpoint before the operator-action step" (a value-free state guard). */
export type WingDeletionPhase = "init" | "classified" | "highlighted" | "done";

/** The single destructive-adjacent guided step (highlight + irreversible checkpoint). */
export const WING_DELETION_TOTAL_STEPS = 1 as const;

/**
 * The IRREVERSIBLE-WARNING checkpoint copy shown ON the WING page. It states the two facts the operator must
 * understand BEFORE pressing 삭제: the deletion cannot be undone, and the existing Access/Secret Key stop working
 * immediately. The driver never presses 삭제 — the operator does. (Dev-overlay copy, not the product FE string.)
 */
export const WING_DELETION_WARNING_LABEL =
  "⚠ 이 '삭제' 버튼을 누르면 기존 오픈API 키가 영구 삭제됩니다. 되돌릴 수 없고, 기존 Access Key/Secret Key가 즉시 무효화됩니다. " +
  "직접 확인한 뒤 삭제를 누르세요 — SellerOps는 대신 누르지 않습니다.";

const SETTLE_TIMEOUT_MS = 15_000;
const DEFAULT_LOCATOR_SETTLE_MS = 400;
const DEFAULT_VERIFY_POLL_MS = 500;
const VERIFY_MAX_POLLS = 12;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** A browser context whose newest tab may hold the page the seller opened. Structural subset of Playwright's. */
export interface WingContextLike {
  pages(): Page[];
  on?(event: "close", handler: () => void): void;
}

export interface CoupangWingDeletionDriverOptions {
  context?: WingContextLike;
  guidanceEnabled?: boolean;
  /**
   * Whether the delete selector is calibrated. Defaults to the code-level {@link WING_DELETION_SELECTORS_CALIBRATED};
   * a test may pass `false` to prove the highlight path still fails closed when calibration is withdrawn.
   */
  calibrated?: boolean;
  locatorSettleMs?: number;
  verifyPollMs?: number;
  /** Overlay-mount seam (defaults to the real {@link mountOverlay}); tests inject a stub to stay overlay-agnostic. */
  mountOverlayFn?: typeof mountOverlay;
  /** Paint-VERIFY seam (defaults to {@link advancePanelMounted}); tests inject a stub that reports no paint. */
  checkpointPaintedFn?: typeof advancePanelMounted;
}

/**
 * A DEFINITIVE (non-transient) category stops the verify poll; `unknown` is transient mid-hydration, so the poll
 * keeps going (mirrors the issuance driver's `isVerifyResolved` — never treat `unknown` as a resolved state).
 */
function isDefinitiveCategory(category: WingPageCategory): boolean {
  return category !== "unknown";
}

/**
 * The issued open-API surface is DEFINITIVELY gone (deletion confirmed) — value-free and CONSERVATIVE: only a
 * clear navigation away to `wing_home` counts. An ambiguous/transient `unknown`, or a page still classifying as
 * the open-API surface, is reported as NOT-confirmed (`deleted:false`) rather than over-claiming a deletion.
 */
function isKeyGoneCategory(category: WingPageCategory): boolean {
  return category === "wing_home";
}

/** Remove every read-only `data-aw-target` annotation. Value-free; safe on a page with none. */
const IN_PAGE_CLEAR_TAG = `(function () {
  /* coupang-deletion-cleartag */
  var slice = Function.prototype.call.bind(Array.prototype.slice);
  var els = slice(document.querySelectorAll('[data-aw-target]'));
  for (var i = 0; i < els.length; i++) { els[i].removeAttribute('data-aw-target'); }
  return true;
})()`;

export class CoupangWingDeletionDriver {
  private readonly page: Page;
  private readonly opts: CoupangWingDeletionDriverOptions;
  private readonly closed: Promise<void>;
  private phase: WingDeletionPhase = "init";
  /**
   * Whether the last highlight attempt located the 삭제 control uniquely but the checkpoint failed to PAINT.
   * Both outcomes return `{count: 0}` and both fail closed, but they are different faults and the operator
   * should not be told "삭제 not found" when the control was found and the warning simply did not render.
   */
  private checkpointPaintFailed = false;

  constructor(page: Page, opts: CoupangWingDeletionDriverOptions = {}) {
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

  /** The delete selector calibration flag in effect for this driver (option override → code constant). */
  private isCalibrated(): boolean {
    return this.opts.calibrated ?? WING_DELETION_SELECTORS_CALIBRATED;
  }

  currentPhase(): WingDeletionPhase {
    return this.phase;
  }

  /** Value-free fault discriminator for the CLI's sanitized outcome (see {@link checkpointPaintFailed}). */
  didCheckpointFailToPaint(): boolean {
    return this.checkpointPaintFailed;
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

  private async readPageCategory(page: Page): Promise<WingPageCategory> {
    const census = await this.evalStr<WingStructuralCensus>(page, EXTRACT_WING_CENSUS);
    const urlCategory = classifyWingUrlCategory(page.url());
    return wingPageCategoryFromCensus(urlCategory, census).pageCategory;
  }

  /** READ-ONLY: the full sanitized {@link WingObservation} of the CURRENT surface. */
  async observeSurface(): Promise<WingObservation> {
    const page = this.activePage();
    await this.settle(page);
    const census = await this.evalStr<WingStructuralCensus>(page, EXTRACT_WING_CENSUS);
    const urlCategory = classifyWingUrlCategory(page.url());
    return observeFrom(urlCategory, census);
  }

  /**
   * Confirm the operator is on the ALREADY-ISSUED open-API page (where a 삭제 control can exist). `ok` only when
   * the page classifies as `open_api_issuance` or `credential_shown`; anything else (login / wing_home / unknown)
   * is a wrong page and the walk must NOT proceed. Advances the phase to `classified` on success.
   */
  async classifyAlreadyIssued(): Promise<{ ok: boolean; pageCategory: WingPageCategory }> {
    const page = this.activePage();
    await this.settle(page);
    const pageCategory = await this.readPageCategory(page);
    const ok = pageCategory === "open_api_issuance" || pageCategory === "credential_shown";
    if (ok) this.phase = "classified";
    log("aw_coupang_deletion_classify", { pageCategory, ok });
    return { ok, pageCategory };
  }

  /** The value-free fixed-label locate for the 삭제 control (returns only `{ count, sig? }`). */
  private async resolveDelete(tag: boolean): Promise<LocateResult> {
    const spec = WING_DELETION_LABELS.delete;
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
   * READ-ONLY selector-recorder seam: how many candidates the 삭제 fixed label matches, whether it resolves
   * uniquely, and (only then) its opaque 16-hex signature. Never tags/highlights/clicks/reads a value.
   */
  async probeDeleteMatch(): Promise<{ matchCount: number; canHighlight: boolean; sig?: string }> {
    const res = await this.resolveDelete(false);
    const matchCount = typeof res?.count === "number" && res.count >= 0 ? res.count : 0;
    const canHighlight = matchCount === 1;
    return canHighlight && res.sig ? { matchCount, canHighlight, sig: res.sig } : { matchCount, canHighlight };
  }

  /**
   * Highlight the 삭제 control read-only and mount the IRREVERSIBLE-WARNING checkpoint, then REST. FAILS CLOSED:
   * refuses unless the delete selector is calibrated (defense-in-depth over the gate) AND the page was classified
   * as the already-issued page first. On a non-unique match it stays un-highlighted (`count !== 1`). Never clicks
   * 삭제 — it only annotates the located element and draws the warning; the operator presses 삭제 themselves.
   */
  async highlightDeleteCheckpoint(): Promise<LocateResult> {
    if (!this.isCalibrated()) {
      throw new Error("refusing to highlight the 삭제 control: the delete selector is not calibrated (WING_DELETION_SELECTORS_CALIBRATED is false)");
    }
    if (this.phase !== "classified") {
      throw new Error("classify the already-issued page before highlighting the 삭제 control");
    }
    const res = await this.resolveDelete(true);
    if (res.count !== 1 || !res.sig) return { count: res.count };
    await sleep(this.opts.locatorSettleMs ?? DEFAULT_LOCATOR_SETTLE_MS);
    const page = this.activePage();
    await (this.opts.mountOverlayFn ?? mountOverlay)(page, {
      stepNumber: 1,
      totalSteps: WING_DELETION_TOTAL_STEPS,
      copyKey: "actionWindow.coupangDeletion.checkpoint",
      label: WING_DELETION_WARNING_LABEL,
      guidanceEnabled: this.opts.guidanceEnabled ?? true,
      // The WING-RESIDENT panel is REQUIRED here, not cosmetic. Without it the warning renders in the spotlight
      // ring's small single-line `nowrap` badge, where ~130 characters of Korean run off the viewport — the
      // operator would press an irreversible 삭제 having never read the checkpoint the destructive manifest
      // promises (`explicitCheckpointRequired: true`). NO advance button: this walk advances on the operator's
      // sentinel file, so the panel is copy-only and adds no interactive element to the marketplace page.
      residentPanel: true,
    });
    // VERIFY the checkpoint actually painted before advancing. `mountOverlay` returns silently when the tagged
    // element is gone (the SPA re-rendered during the settle sleep, or `activePage()` now resolves to a tab the
    // tag was never applied to), so awaiting it proves nothing. Without this the phase would reach `highlighted`
    // — the ONLY precondition `verifyDeletion` checks — with no ring and no warning on screen, and the operator
    // would face an irreversible 삭제 while the manifest asserts `explicitCheckpointRequired: true`. Mirrors the
    // issuance driver's guard. Fail closed: report a non-unique/absent target rather than a phantom checkpoint.
    // Check the RESIDENT PANEL, not just the spotlight ring. The ring box is appended even when guidance is
    // disabled (it only differs by `display:none`), so `overlayMounted` alone would report a painted checkpoint
    // for a run showing nothing legible — the very failure this guard exists to catch, one option away. The
    // panel is the element that carries the irreversible warning, so it is the thing that must exist.
    if (!(await (this.opts.checkpointPaintedFn ?? advancePanelMounted)(page))) {
      this.checkpointPaintFailed = true;
      log("aw_coupang_deletion_checkpoint_unmounted", { highlighted: false });
      return { count: 0 };
    }
    this.phase = "highlighted";
    log("aw_coupang_deletion_highlight", { highlighted: true });
    return { count: 1, sig: res.sig };
  }

  /**
   * The OPERATOR-ACTION step: confirm (value-free) that the deletion happened. Enforces the CHECKPOINT-FIRST
   * invariant — throws unless {@link highlightDeleteCheckpoint} has run (phase `highlighted`) — so the walk can
   * never reach the operator-action step without first showing the irreversible warning. It reads only a
   * sanitized page CATEGORY (never a value), polling through transient `unknown`, and CONSERVATIVELY reports the
   * key gone only on a clear navigation to `wing_home` — an ambiguous state is `deleted:false`, never over-claimed.
   * It NEVER presses 삭제.
   */
  async verifyDeletion(): Promise<{ deleted: boolean; pageCategory: WingPageCategory }> {
    if (this.phase !== "highlighted") {
      throw new Error("checkpoint required: highlight the 삭제 control + present the irreversible warning before the operator-action step");
    }
    const pollMs = this.opts.verifyPollMs ?? DEFAULT_VERIFY_POLL_MS;
    let pageCategory = await this.readPageCategory(this.activePage());
    for (let i = 1; i < VERIFY_MAX_POLLS && !isDefinitiveCategory(pageCategory); i++) {
      if (pollMs > 0) await sleep(pollMs);
      pageCategory = await this.readPageCategory(this.activePage());
    }
    const deleted = isKeyGoneCategory(pageCategory);
    this.phase = "done";
    log("aw_coupang_deletion_verify", { deleted, pageCategory });
    return { deleted, pageCategory };
  }

  /**
   * Remove the ring + the resident warning panel, and REPORT whether the WARNING PANEL is gone.
   *
   * Scope, stated precisely rather than rounded up: the returned boolean verifies the **panel** — the element
   * carrying the irreversible warning, and the thing whose survival would tell the operator to press 삭제
   * again. The ring is removed by the same `unmountOverlay` call and is not separately confirmed; checking it
   * through the driver's one injected seam would conflate two different questions (mount = "is the panel
   * painted", clear = "is it gone"), and this file's own lesson is that a claim should not outrun what is
   * actually checked.
   *
   * The failure this closes: both removals used to swallow their errors, so a caller could only ever be told
   * the clear "succeeded". If the SPA re-rendered the overlay host away, `unmountOverlay` fails, the
   * irreversible-warning panel stays on screen, and the run still printed `checkpointCleared: true` — a false
   * assurance on a destructive surface. Errors are still swallowed (a failed clear must never throw into the
   * outcome path), but the result is now VERIFIED the same way the mount is: by asking the page.
   */
  async clearHighlight(): Promise<boolean> {
    const page = this.activePage();
    await unmountOverlay(page).catch(() => undefined);
    await this.evalStr(page, IN_PAGE_CLEAR_TAG).catch(() => undefined);
    // Verified, not assumed. An unreadable page cannot confirm the clear, so it reports NOT cleared.
    const panelUp = await (this.opts.checkpointPaintedFn ?? advancePanelMounted)(page).catch(() => true);
    return !panelUp;
  }

  async cleanup(): Promise<void> {
    await this.clearHighlight();
  }

  whenSurfaceClosed(): Promise<void> {
    return this.closed;
  }
}
