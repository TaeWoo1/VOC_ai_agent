/**
 * **What the DOM side must provide for one guided API-issuance walk.**
 *
 * The engine owns the choreography and every decision; this interface owns nothing but observation and
 * annotation. The invariants it exists to make structural:
 *
 *  1. **There is no login, click, type, submit, create, or credential-read method here.** The seller
 *     performs every real step in their own window. A driver that could press the "create application"
 *     control, or read the Application ID / Secret, would make the guidance pattern a matter of remembering
 *     not to call it.
 *  2. **Nothing carries a field VALUE.** `probeSurface`/`readApplications` return a sanitized page category
 *     plus counts/booleans (mirroring `observe-api-center`'s structural census). `locateTarget` returns an
 *     opaque signature, never a selector. The Client ID / Secret are never read at all.
 *
 * The targets are parameterized (not one method per control) because the sequence is data
 * ({@link IssuanceTarget}); a per-control method set would drift from it by hand.
 */
import type { ApiCenterPageCategory, ApiCenterSignals, ApiCenterStructuralCensus } from "../../cli/observe-api-center";
import type { LocateResult } from "../engine";
import type { IssuanceStage } from "./issuance-stages";

/** A control the runtime may highlight and then watch. Never a selector — a semantic role. */
export type IssuanceTarget = "create_app" | "open_app" | "api_group" | "credentials" | "return";

export const ISSUANCE_TARGETS: readonly IssuanceTarget[] = ["create_app", "open_app", "api_group", "credentials", "return"];

/**
 * The ONE target for which SellerOps observes a real NAVER click / page TRANSITION: opening (or creating and
 * thereby reaching) the app detail page is a genuine `app_list → app_detail` navigation the runtime watches
 * (`OBSERVE_USER_CLICK_TRANSITION`, open_app only). Everything after it lives on that SAME detail page.
 */
export const ISSUANCE_TRANSITION_OBSERVE_TARGET: IssuanceTarget = "open_app";

/**
 * **Same-page VIEWPORT CHECKPOINTS.** Once the seller has reached the app detail page, the API group and the
 * Application ID are NOT controls the runtime waits for a NAVER click on — they are SECTIONS on the one page the
 * seller is already looking at. A checkpoint STABILIZES the page, LOCATES its section, SCROLLS it into view, and
 * OVERLAYS a "여기입니다" pointer; it never arms a click observer and never waits for a NAVER interaction. The
 * seller reads the section, then advances with SellerOps's own "다음" (a `REQUEST_STEP_RECHECK` at the
 * checkpoint stage). `create_app` is here too: SellerOps points at the register control and the seller creates
 * the app themselves, then presses "다음" — the following `api_group` checkpoint's own locate gates that they
 * actually reached the detail page. `return` is a guidance-only checkpoint (no NAVER section to locate).
 */
export const ISSUANCE_CHECKPOINT_TARGETS: readonly IssuanceTarget[] = ["create_app", "api_group", "credentials", "return"];

/** True for a same-page viewport checkpoint (advance on operator "다음"); false only for {@link ISSUANCE_TRANSITION_OBSERVE_TARGET}. */
export function isCheckpointTarget(target: IssuanceTarget): boolean {
  return ISSUANCE_CHECKPOINT_TARGETS.includes(target);
}

/**
 * The seller-barrier stage each control rests on. Shared (rather than kept private in the engine) so the
 * session can ask "is this barrier still open for this target" without reaching into engine internals.
 */
export const TARGET_BARRIER_STAGE: Readonly<Record<IssuanceTarget, IssuanceStage>> = {
  create_app: "guiding_create",
  open_app: "guiding_app_detail",
  api_group: "guiding_api_group",
  credentials: "guiding_credentials",
  return: "return_to_sellerops",
};

/**
 * A sanitized probe of the current API-center page. `pageCategory` is the coarse enum from
 * `observe-api-center` (login / app_list / app_detail / credential_issuance / unknown); `ok` is false only
 * when the surface is unusable for a reason the seller can clear (currently login), carried as `blockerCode`.
 */
export interface IssuanceSurfaceProbe {
  ok: boolean;
  pageCategory: ApiCenterPageCategory;
  /** The sanitized structural signals behind the category (counts/booleans/buckets only), for the adapter. */
  signals?: ApiCenterSignals;
  /** Present only when `ok` is false and the seller can clear it themselves. */
  blockerCode?: "LOGIN_REQUIRED";
}

/**
 * A sanitized read of the applications list. Carries the structural census PLUS a CANDIDATE
 * application-entry row count (see `api-center-adapter`) — counts only, never any application name/id/value.
 */
export interface ApplicationsRead {
  census: ApiCenterStructuralCensus;
  /** CANDIDATE / LIVE_DOM_CALIBRATION_PENDING: how many application-entry rows the list appears to hold. */
  applicationEntryRowCount: number;
}

export interface IssuanceProbeDriver {
  /**
   * Read the CURRENT API-center page as a sanitized category + signals. Never navigates for the seller.
   * A login page is reported `ok:false` with `blockerCode:"LOGIN_REQUIRED"` (recoverable — the seller logs
   * in on their own screen); everything else is `ok:true` with its page category.
   */
  probeSurface(): Promise<IssuanceSurfaceProbe>;

  /**
   * Optional: the BOUNDED-POLLING probe VERIFY_OPEN uses. After the seller opens their existing app the detail
   * SPA hydrates for a beat and can classify as a transient `unknown` before it settles to `app_detail`; this
   * polls the sanitized page category until a DEFINITIVE landing (`app_detail` / `login`) or a bounded number of
   * attempts, so a mid-hydration read no longer parks the run on the first transient. Returns the same sanitized
   * probe shape as {@link probeSurface}. A driver with no real page (every scripted test driver) may omit it —
   * the session then falls back to {@link probeSurface}, so it changes no engine decision, only the read timing.
   */
  probeSurfaceSettled?(): Promise<IssuanceSurfaceProbe>;

  /**
   * Read the applications list structurally: the census plus a CANDIDATE entry-row count, so the engine can
   * branch existing-vs-empty. Reads counts only — never an application name, id, or any value.
   */
  readApplications(): Promise<ApplicationsRead>;

  /**
   * Optional: best-effort SETTLE of the current surface (wait for it to stop navigating) before the engine's
   * next locate. The session calls this at the top of a `guide` so a fixed-label locate/highlight never fires on
   * a still-settling post-navigation page (which would destroy the execution context and throw). A driver with no
   * real page (every scripted test driver) may omit it or make it a no-op — it changes no engine decision, only
   * the timing of the in-page read.
   */
  settleSurface?(): Promise<void>;

  /** How many candidates match {@code target}, and the opaque signature of the one (if exactly one). */
  locateTarget(target: IssuanceTarget): Promise<LocateResult>;

  /**
   * Annotate the target read-only and RE-VALIDATE the match while doing it. Returning the locate result
   * again is the anti-drift check: if the unique match changed between locate and highlight, the engine
   * parks on `page_mismatch` rather than highlighting the wrong control.
   */
  highlightTarget(target: IssuanceTarget): Promise<LocateResult>;

  /** Take the annotation off whatever is currently highlighted. Safe to call on a half-built run. */
  clearHighlight(): Promise<void>;

  /** Arm observation of the seller's own action on {@code target}. Never performs it. */
  armObserve(target: IssuanceTarget): Promise<void>;

  /** Resolve true when the seller acted on {@code target} themselves (their click, never ours). */
  observeUserAction(target: IssuanceTarget): Promise<boolean>;

  /** Remove every annotation. Must be safe to call twice and on a half-built run. */
  cleanup(): Promise<void>;

  /**
   * Optional: resolve when the seller closes the API-center window, so the session can park instead of
   * re-arming an observation on a dead page. A driver with no window (every scripted test driver) omits it.
   */
  whenSurfaceClosed?(): Promise<void>;
}
