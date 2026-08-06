/**
 * **What the DOM side must provide for one guided Coupang WING credential-RENEWAL walk.**
 *
 * The engine owns the choreography and every decision; this interface owns nothing but observation and
 * annotation. It is the renewal sibling of `../coupang-issuance/coupang-issuance-driver.ts` and makes the same
 * invariants structural:
 *
 *  1. **There is no login, click, type, submit, re-issue, or credential-read method here.** The seller performs
 *     every real step — including pressing `재발급` (re-issue). A driver that could press it, or read the new
 *     Access Key / Secret Key / 업체코드, would make the guidance pattern a matter of remembering not to call it.
 *  2. **Nothing carries a field VALUE.** `probeSurface` returns a sanitized page category plus counts/booleans.
 *     `locateTarget` returns an opaque signature, never a selector. The new Secret Key is never read.
 *  3. **The ONE allowed value read is the `유효기간` DATE**, and only through the OPTIONAL, allowlisted
 *     {@link readValidityDate} seam — which returns a sanitized ISO date (`YYYY-MM-DD`) or `null`, never a key.
 */
import type { LocateResult } from "../engine";
import type { CoupangRenewalStage } from "./coupang-renewal-stages";

// Reuse the issuance surface-probe shape verbatim — the two runtimes read the SAME sanitized WING page category.
export type { WingSurfaceProbe } from "../coupang-issuance/coupang-issuance-driver";
import type { WingSurfaceProbe } from "../coupang-issuance/coupang-issuance-driver";

/**
 * A section the runtime may highlight and then rest on. Never a selector — a semantic role.
 *  - `reach_open_api` — the transition the runtime observes (WING home → open-API page); text guidance.
 *  - `check_expiry` — the `유효기간` (validity period) region the seller reads (SellerOps reads no value here).
 *  - `reissue` — the `재발급` button (a CHECKPOINT: highlight it, the seller presses it themselves; never clicked).
 *  - `credentials` — the region where the NEW Access Key / Secret Key / 업체코드 appear (NEVER read any value).
 *  - `return` — guidance-only ("return to SellerOps").
 */
export type CoupangRenewalTarget = "reach_open_api" | "check_expiry" | "reissue" | "credentials" | "return";

export const COUPANG_RENEWAL_TARGETS: readonly CoupangRenewalTarget[] = ["reach_open_api", "check_expiry", "reissue", "credentials", "return"];

/** The ONE target for which SellerOps observes a real WING page TRANSITION (reaching the open-API page). */
export const COUPANG_RENEWAL_TRANSITION_OBSERVE_TARGET: CoupangRenewalTarget = "reach_open_api";

/**
 * **Same-page VIEWPORT CHECKPOINTS.** Once on the open-API page, `유효기간` / `재발급` / 키 복사 / return are NOT
 * controls the runtime waits for a WING click on — they are SECTIONS on the one page the seller is already
 * looking at. A checkpoint STABILIZES the page, LOCATES the section, SCROLLS it into view, and OVERLAYS a pointer;
 * it never arms a click observer. The seller reads/acts, then advances with SellerOps's own `다음`. `reissue` is
 * here too — the `재발급` button is highlighted and the seller presses it themselves, then `다음`.
 */
export const COUPANG_RENEWAL_CHECKPOINT_TARGETS: readonly CoupangRenewalTarget[] = ["check_expiry", "reissue", "credentials", "return"];

/** True for a same-page viewport checkpoint (advance on operator `다음`); false only for the transition-observe. */
export function isCoupangRenewalCheckpointTarget(target: CoupangRenewalTarget): boolean {
  return COUPANG_RENEWAL_CHECKPOINT_TARGETS.includes(target);
}

/** The seller-barrier stage each control rests on. */
export const COUPANG_RENEWAL_TARGET_BARRIER_STAGE: Readonly<Record<CoupangRenewalTarget, CoupangRenewalStage>> = {
  reach_open_api: "reaching_open_api",
  check_expiry: "guiding_check_expiry",
  reissue: "checkpoint_before_reissue",
  credentials: "guiding_copy_keys",
  return: "return_to_sellerops",
};

export interface CoupangRenewalProbeDriver {
  /**
   * Read the CURRENT WING page as a sanitized category + signals. Never navigates for the seller. A login page is
   * reported `ok:false` with `blockerCode:"LOGIN_REQUIRED"`; everything else is `ok:true` with its page category.
   */
  probeSurface(): Promise<WingSurfaceProbe>;

  /** Optional bounded-polling probe for the reach-open-API verification (ride out mid-hydration `unknown`). */
  probeSurfaceSettled?(): Promise<WingSurfaceProbe>;

  /** Optional best-effort SETTLE of the current surface before the engine's next locate. */
  settleSurface?(): Promise<void>;

  /** How many candidates match {@code target}, and the opaque signature of the one (if exactly one). */
  locateTarget(target: CoupangRenewalTarget): Promise<LocateResult>;

  /** Annotate the target read-only and RE-VALIDATE the match while doing it (anti-drift). */
  highlightTarget(target: CoupangRenewalTarget): Promise<LocateResult>;

  /** Take the annotation off whatever is currently highlighted. Safe on a half-built run. */
  clearHighlight(): Promise<void>;

  /** Arm observation of the seller's own action on {@code target}. Never performs it. */
  armObserve(target: CoupangRenewalTarget): Promise<void>;

  /** Resolve true when the seller acted on {@code target} themselves (their navigation, never ours). */
  observeUserAction(target: CoupangRenewalTarget): Promise<boolean>;

  /** Remove every annotation. Must be safe to call twice and on a half-built run. */
  cleanup(): Promise<void>;

  /** Optional: resolve when the seller closes the WING window, so the session can park instead of re-arming. */
  whenSurfaceClosed?(): Promise<void>;

  /**
   * **OPTIONAL, ALLOWLISTED READ.** Read ONLY the sanitized `유효기간` (validity-period) date next to the fixed
   * label and return it as an ISO date (`YYYY-MM-DD`) or `null` — the ONE non-secret value this runtime ever
   * reads. It NEVER reads the Access Key / Secret Key / 업체코드. Used by the completion / recorder surfaces (to
   * show the expiry, or offer the operator-confirm path when unreadable); it is NOT part of the highlight walk,
   * so the engine never calls it.
   */
  readValidityDate?(): Promise<string | null>;
}
