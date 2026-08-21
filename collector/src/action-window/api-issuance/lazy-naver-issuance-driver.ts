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
  NaverIssuanceParkNotice,
} from "./issuance-driver";

export interface LazyNaverIssuanceDriverDeps {
  /** Bring up the dedicated window. Called at most once per open cycle. */
  open(): Promise<{ context: BrowserContext; page: Page }>;
  /**
   * The last step's `SellerOps에서 연결 마무리하기`: open the SellerOps connect screen in the seller's OWN default
   * browser, where their session is. Never in THIS window — it is a dedicated profile that has never signed in,
   * so opening the connect screen here delivers a login page.
   *
   * Passed straight through to {@link NaverIssuanceDriver}, which calls it only when the seller presses that
   * button. Absent ⇒ the step behaves as it did, and says so in the log.
   */
  returnToSellerOps?: () => Promise<void>;
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
        const d = new NaverIssuanceDriver(page, {
          context,
          ...(this.deps.returnToSellerOps ? { returnToSellerOps: this.deps.returnToSellerOps } : {}),
        });
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

  /**
   * The panel's own latch, armed and read ONLY on a window that already exists — `isOpen()`, never `driver()`.
   * A poll for a press that could open a marketplace window is the resurrection the whole lazy layer exists to
   * prevent, and a press cannot exist on a window that does not.
   */
  async armPanelAdvance(target: IssuanceTarget): Promise<void> {
    if (!this.isOpen()) return;
    await (await this.driver()).armPanelAdvance(target);
  }

  async readPanelAdvance(target: IssuanceTarget): Promise<boolean> {
    if (!this.isOpen()) return false;
    return (await this.driver()).readPanelAdvance(target);
  }

  /** Drawn only on a surface that already exists — a "we stopped" panel is of no use on a closed window. */
  async showParkNotice(code: NaverIssuanceParkNotice): Promise<boolean> {
    if (!this.isOpen()) return false;
    return (await this.driver()).showParkNotice(code);
  }

  /** Same rule for the completion notice: a finished walk opens nothing to announce itself. */
  async showCompletionNotice(): Promise<boolean> {
    if (!this.isOpen()) return false;
    return (await this.driver()).showCompletionNotice();
  }

  /** Step 3's advisory, and its press. Both only on a window that already exists. */
  async showAppUsageNotice(branch: "existing" | "new"): Promise<boolean> {
    if (!this.isOpen()) return false;
    return (await this.driver()).showAppUsageNotice(branch);
  }

  async readAppUsageAdvance(): Promise<boolean> {
    if (!this.isOpen()) return false;
    return (await this.driver()).readAppUsageAdvance();
  }

  /** The last step's CTA. A walk with no window has nobody to return, so it does nothing. */
  async returnToSellerOpsNow(): Promise<void> {
    if (!this.isOpen()) return;
    await (await this.driver()).returnToSellerOpsNow();
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
