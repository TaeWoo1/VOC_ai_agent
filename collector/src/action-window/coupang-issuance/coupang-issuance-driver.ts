/**
 * **What the DOM side must provide for one guided Coupang WING API-issuance walk.**
 *
 * The engine owns the choreography and every decision; this interface owns nothing but observation and
 * annotation. The invariants it exists to make structural:
 *
 *  1. **There is no login, click, type, submit, issue, or credential-read method here.** The seller performs
 *     every real step in their own window. A driver that could press the 발급 (issue) control, or read the
 *     Access Key / Secret Key / 업체코드, would make the guidance pattern a matter of remembering not to call it.
 *  2. **Nothing carries a field VALUE.** `probeSurface` returns a sanitized page category plus counts/booleans.
 *     `locateTarget` returns an opaque signature, never a selector. The Access/Secret keys are never read.
 *
 * The targets are parameterized (not one method per control) because the sequence is data
 * ({@link CoupangIssuanceTarget}); a per-control method set would drift from it by hand.
 */
import type { WingPageCategory, WingSignals } from "../../cli/coupang-wing-classifier";
import type { LocateResult } from "../engine";
import type { CoupangIssuanceStage } from "./coupang-issuance-stages";

/**
 * A control the runtime may highlight and then watch. Never a selector — a semantic role.
 *  - `reach_open_api` — the transition the runtime observes (WING home → open-API issuance page); text guidance,
 *    not a highlighted DOM control.
 *  - `self_dev` / `vendor_info` / `call_ip` — the issuance-form sections the seller confirms in turn.
 *  - `issue` — the 발급 button (a CHECKPOINT: highlight it, the seller presses it themselves; never clicked here).
 *  - `credentials` — the region where the Access Key / Secret Key / 업체코드 appear (NEVER read any value).
 *  - `return` — guidance-only ("return to SellerOps").
 */
export type CoupangIssuanceTarget =
  | "reach_open_api"
  | "self_dev"
  | "vendor_info"
  | "call_ip"
  | "issue"
  | "credentials"
  | "return";

export const COUPANG_ISSUANCE_TARGETS: readonly CoupangIssuanceTarget[] = [
  "reach_open_api",
  "self_dev",
  "vendor_info",
  "call_ip",
  "issue",
  "credentials",
  "return",
];

/**
 * The ONE target for which SellerOps observes a real WING page TRANSITION: reaching the open-API issuance page
 * from the WING home is a genuine `wing_home → open_api_issuance` navigation the runtime watches
 * (`OBSERVE_USER_TRANSITION`, reach_open_api only). Everything after it lives on that SAME issuance page.
 */
export const COUPANG_ISSUANCE_TRANSITION_OBSERVE_TARGET: CoupangIssuanceTarget = "reach_open_api";

/**
 * **Same-page VIEWPORT CHECKPOINTS.** Once the seller has reached the issuance page, 자체개발 / 업체명 / 호출 IP /
 * 발급 / 키 복사 / return are SECTIONS on the one page the seller is already looking at. A checkpoint STABILIZES
 * the page, LOCATES its section, SCROLLS it into view, and OVERLAYS a WING-resident guidance panel with the
 * step copy and a "다음" advance button. The seller reads/acts on the section, then presses that on-page button;
 * the driver OBSERVES the value-free press and the checkpoint advances — the seller never bounces back to the
 * SellerOps tab. (A FE `REQUEST_STEP_RECHECK` stays valid as a fallback/recovery path — e.g. at a park.) `issue`
 * is here too — the 발급 button is highlighted and the seller presses it themselves, then the on-page "다음";
 * `return` hands focus back to SellerOps (its panel button is "돌아가기", no WING section to locate).
 */
export const COUPANG_ISSUANCE_CHECKPOINT_TARGETS: readonly CoupangIssuanceTarget[] = [
  "self_dev",
  "vendor_info",
  "call_ip",
  "issue",
  "credentials",
  "return",
];

/** True for a same-page viewport checkpoint (advance on operator "다음"); false only for the transition-observe. */
export function isCoupangCheckpointTarget(target: CoupangIssuanceTarget): boolean {
  return COUPANG_ISSUANCE_CHECKPOINT_TARGETS.includes(target);
}

/**
 * The seller-barrier stage each control rests on. Shared (rather than kept private in the engine) so the session
 * can ask "is this barrier still open for this target" without reaching into engine internals.
 */
export const COUPANG_TARGET_BARRIER_STAGE: Readonly<Record<CoupangIssuanceTarget, CoupangIssuanceStage>> = {
  reach_open_api: "reaching_open_api",
  self_dev: "guiding_self_dev",
  vendor_info: "guiding_vendor_info",
  call_ip: "guiding_call_ip",
  issue: "checkpoint_before_issue",
  credentials: "guiding_copy_keys",
  return: "return_to_sellerops",
};

/**
 * A sanitized probe of the current WING page. `pageCategory` is the coarse enum from `coupang-wing-classifier`
 * (login / wing_home / open_api_issuance / credential_shown / unknown); `ok` is false only when the surface is
 * unusable for a reason the seller can clear (currently login), carried as `blockerCode`.
 */
export interface WingSurfaceProbe {
  ok: boolean;
  pageCategory: WingPageCategory;
  /** The sanitized structural signals behind the category (counts/booleans/buckets only). */
  signals?: WingSignals;
  /** Present only when `ok` is false and the seller can clear it themselves. */
  blockerCode?: "LOGIN_REQUIRED";
}

export interface CoupangIssuanceProbeDriver {
  /**
   * Read the CURRENT WING page as a sanitized category + signals. Never navigates for the seller. A login page
   * is reported `ok:false` with `blockerCode:"LOGIN_REQUIRED"` (recoverable — the seller logs in on their own
   * screen); everything else is `ok:true` with its page category.
   */
  probeSurface(): Promise<WingSurfaceProbe>;

  /**
   * Optional: the BOUNDED-POLLING probe the reach-open-API verification uses. After the seller navigates to the
   * issuance page the SPA hydrates for a beat and can classify as a transient `unknown` before it settles; this
   * polls the sanitized page category until a DEFINITIVE landing or a bounded number of attempts. A driver with
   * no real page may omit it — the session then falls back to {@link probeSurface}.
   */
  probeSurfaceSettled?(): Promise<WingSurfaceProbe>;

  /**
   * Optional: best-effort SETTLE of the current surface before the engine's next locate, so a fixed-label
   * locate/highlight never fires on a still-settling post-navigation page. A driver with no real page may omit
   * it or make it a no-op.
   */
  settleSurface?(): Promise<void>;

  /** How many candidates match {@code target}, and the opaque signature of the one (if exactly one). */
  locateTarget(target: CoupangIssuanceTarget): Promise<LocateResult>;

  /**
   * Annotate the target read-only and RE-VALIDATE the match while doing it. Returning the locate result again is
   * the anti-drift check: if the unique match changed between locate and highlight, the engine parks on
   * `page_mismatch` rather than highlighting the wrong control.
   */
  highlightTarget(target: CoupangIssuanceTarget): Promise<LocateResult>;

  /** Take the annotation off whatever is currently highlighted. Safe to call on a half-built run. */
  clearHighlight(): Promise<void>;

  /** Arm observation of the seller's own action on {@code target}. Never performs it. */
  armObserve(target: CoupangIssuanceTarget): Promise<void>;

  /** Resolve true when the seller acted on {@code target} themselves (their navigation, never ours). */
  observeUserAction(target: CoupangIssuanceTarget): Promise<boolean>;

  /** Remove every annotation. Must be safe to call twice and on a half-built run. */
  cleanup(): Promise<void>;

  /**
   * Optional: resolve when the seller closes the WING window, so the session can park instead of re-arming an
   * observation on a dead page. A driver with no window (every scripted test driver) omits it.
   */
  whenSurfaceClosed?(): Promise<void>;
}
