/**
 * **The guided API-center walk's driver, with the window opened LAZILY — the resident-helper host.**
 *
 * The exact sibling of `LazyCoupangIssuanceDriver`, for the exact same reason. The SellerOps 도우미 the seller
 * keeps resident is long-lived: a driver that launched Chrome in its constructor would open the seller's NAVER
 * window at agent boot, before any run exists and without anyone asking. So the window comes up on the FIRST
 * call the session makes — which is after the seller's own 시작 press — and not before.
 *
 * Two properties worth stating, both inherited from that sibling:
 *
 *  - **concurrent first calls share ONE launch.** The in-flight promise is held, so two calls racing at run
 *    start cannot each open a window;
 *  - **a closed window is FORGOTTEN.** The seller closing their own window must not leave a cached driver bound
 *    to a dead page; the next call re-opens in the same persistent profile, so the session survives. A
 *    RELEASED walk is different — see {@link retire}.
 *
 * It adds no capability. Every method delegates to {@link NaverIssuanceDriver}, which never logs in, clicks,
 * types, submits, creates an application, selects a group, or reads a credential value.
 */
import type { BrowserContext, Page } from "playwright";
import { NaverIssuanceDriver } from "../naver-issuance-driver";
import type { LocateResult } from "../engine";
import type {
  ApplicationsRead,
  IssuanceProbeDriver,
  IssuanceSurfaceProbe,
  IssuanceTarget,
} from "./issuance-driver";

export interface LazyNaverIssuanceDriverDeps {
  /** Bring up the dedicated window. Called at most once per open cycle. */
  open(): Promise<{ context: BrowserContext; page: Page }>;
}

export class LazyNaverIssuanceDriver implements IssuanceProbeDriver {
  private readonly deps: LazyNaverIssuanceDriverDeps;
  /** The in-flight or settled launch. Held so concurrent first calls share ONE window, not one each. */
  private opening: Promise<NaverIssuanceDriver> | null = null;
  private opened: NaverIssuanceDriver | null = null;
  private context: BrowserContext | null = null;
  /**
   * **Retired for good** — the host tore this walk down (the resident helper released it, or the agent is
   * shutting down). Distinct from {@link markClosed}, which means "the seller closed their window; re-open it
   * on their next command". After this, every call refuses rather than launching.
   */
  private retired = false;

  constructor(deps: LazyNaverIssuanceDriverDeps) {
    this.deps = deps;
  }

  /** Whether the window has been brought up — a sanitized boolean, for the host's release decision and tests. */
  isOpen(): boolean {
    return this.opened !== null;
  }

  /** Retire the driver: no call may open a window again. Idempotent, and it opens/closes nothing itself. */
  retire(): void {
    this.retired = true;
    this.opened = null;
    this.opening = null;
    this.context = null;
  }

  /** Forget a closed window so the next call re-opens it in the same persistent profile. */
  markClosed(): void {
    this.opened = null;
    this.opening = null;
    this.context = null;
  }

  private async driver(): Promise<NaverIssuanceDriver> {
    if (this.retired) throw new Error("naver issuance driver: retired (the walk was released)");
    if (this.opened) return this.opened;
    if (!this.opening) {
      this.opening = this.deps.open().then(({ context, page }) => {
        const d = new NaverIssuanceDriver(page, { context });
        this.opened = d;
        this.context = context;
        return d;
      });
      // A failed launch must NOT be cached: the seller can clear the cause (a closed profile, a busy port) and
      // the next call has to try again rather than replay the rejection forever.
      this.opening.catch(() => {
        this.opening = null;
      });
    }
    return this.opening;
  }

  async probeSurface(): Promise<IssuanceSurfaceProbe> {
    return (await this.driver()).probeSurface();
  }

  async probeSurfaceSettled(): Promise<IssuanceSurfaceProbe> {
    const d = await this.driver();
    return d.probeSurfaceSettled?.() ?? d.probeSurface();
  }

  async settleSurface(): Promise<void> {
    const d = await this.driver();
    await d.settleSurface?.();
  }

  async readApplications(): Promise<ApplicationsRead> {
    return (await this.driver()).readApplications();
  }

  async locateTarget(target: IssuanceTarget): Promise<LocateResult> {
    return (await this.driver()).locateTarget(target);
  }

  async highlightTarget(target: IssuanceTarget): Promise<LocateResult> {
    return (await this.driver()).highlightTarget(target);
  }

  async clearHighlight(): Promise<void> {
    // Not via `driver()`: clearing on a run that never opened a window would OPEN one to clear nothing.
    if (this.opened) await this.opened.clearHighlight();
  }

  async armObserve(target: IssuanceTarget): Promise<void> {
    await (await this.driver()).armObserve(target);
  }

  async observeUserAction(target: IssuanceTarget): Promise<boolean> {
    return (await this.driver()).observeUserAction(target);
  }

  async cleanup(): Promise<void> {
    // Same reasoning as `clearHighlight`: cleanup on an unopened driver is a no-op, never a launch.
    if (this.opened) await this.opened.cleanup();
  }

  async whenSurfaceClosed(): Promise<void> {
    // Before anything opened there is no window to close, so this never resolves — the session must not park a
    // run on the closure of a window that was never brought up.
    if (!this.opened) return new Promise<void>(() => {});
    return this.opened.whenSurfaceClosed();
  }

  /** Close the window if one was opened. Safe on a driver that never launched. */
  async close(): Promise<void> {
    const ctx = this.context;
    this.markClosed();
    await ctx?.close().catch(() => undefined);
  }
}
