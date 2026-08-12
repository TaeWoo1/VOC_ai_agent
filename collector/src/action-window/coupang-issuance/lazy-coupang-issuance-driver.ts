/**
 * **The guided WING walk's driver, with the window opened LAZILY — the product-path host.**
 *
 * The Local Agent is long-lived: it boots when SellerOps starts and sits there. A driver that launched Chrome in
 * its constructor would open the seller's marketplace window at agent boot, before any run exists and without
 * anyone asking — which is a marketplace-facing side effect of merely being installed.
 *
 * So the window comes up on the FIRST call the session makes, and not before. Same shape as
 * `LazyImportDriver`, for the same reason and with the same two properties worth stating:
 *
 *  - **concurrent first calls share ONE launch.** The in-flight promise is held, so two calls racing at run
 *    start cannot each open a window;
 *  - **a closed window is FORGOTTEN.** The seller closing their own window must not leave a cached driver bound
 *    to a dead page; the next call re-opens in the same persistent profile, so the session survives.
 *
 * It adds no capability. Every method delegates to {@link CoupangWingIssuanceDriver}, which navigates nothing,
 * clicks nothing, types nothing, and reads no value.
 */
import type { BrowserContext, Page } from "playwright";
import { CoupangWingIssuanceDriver } from "../coupang-wing-issuance-driver";
import type { LocateResult } from "../engine";
import type {
  CoupangIssuanceProbeDriver,
  CoupangIssuanceTarget,
  WingSurfaceProbe,
} from "./coupang-issuance-driver";

export interface LazyCoupangIssuanceDriverDeps {
  /**
   * Bring up the dedicated window. Called at most once per open cycle. It must NOT navigate: on the product
   * path the seller reaches WING themselves, which is the boundary the whole phase rests on.
   */
  open(): Promise<{ context: BrowserContext; page: Page }>;
  /**
   * The walk's LAST step, made real: open the SellerOps connect screen in the seller's OWN default browser,
   * where their session is. Never in THIS window — it is a dedicated profile that has never been signed in, so
   * opening the connect screen here delivers a login page, which is what happened on 2026-08-12.
   *
   * Passed straight through to {@link CoupangWingIssuanceDriver}, which calls it only when the seller presses
   * `SellerOps로 돌아가기` — see that option's own doc for why the navigation lives out here and not in the
   * driver. Absent ⇒ the step is what it was: a completion with no move, logged as such.
   */
  returnToSellerOps?: () => Promise<void>;
  /**
   * Raise the walk's EXISTING window. Called only when the seller asks ("현재 단계 다시 찾기"), and only when a
   * window is already open — {@link LazyCoupangIssuanceDriver.focusSurface} refuses to open one, because a
   * lazy driver whose "show me where I am" opened a marketplace window would be the side effect this class
   * exists to prevent.
   */
  raiseSurface?: () => Promise<boolean>;
}

export class LazyCoupangIssuanceDriver implements CoupangIssuanceProbeDriver {
  private readonly deps: LazyCoupangIssuanceDriverDeps;
  /** The in-flight or settled launch. Held so concurrent first calls share ONE window, not one each. */
  private opening: Promise<CoupangWingIssuanceDriver> | null = null;
  private opened: CoupangWingIssuanceDriver | null = null;
  private context: BrowserContext | null = null;

  constructor(deps: LazyCoupangIssuanceDriverDeps) {
    this.deps = deps;
  }

  /** Whether the window has been brought up — a sanitized boolean, for the boot's teardown and for tests. */
  isOpen(): boolean {
    return this.opened !== null;
  }

  /** Forget a closed window so the next call re-opens it in the same persistent profile. */
  markClosed(): void {
    this.opened = null;
    this.opening = null;
    this.context = null;
  }

  private async driver(): Promise<CoupangWingIssuanceDriver> {
    if (this.opened) return this.opened;
    if (!this.opening) {
      this.opening = this.deps.open().then(({ context, page }) => {
        const d = new CoupangWingIssuanceDriver(page, {
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

  async probeSurface(): Promise<WingSurfaceProbe> {
    return (await this.driver()).probeSurface();
  }

  async probeSurfaceSettled(): Promise<WingSurfaceProbe> {
    const d = await this.driver();
    return d.probeSurfaceSettled?.() ?? d.probeSurface();
  }

  async settleSurface(): Promise<void> {
    const d = await this.driver();
    await d.settleSurface?.();
  }

  /**
   * Raise the window if — and ONLY if — one is already open. `isOpen()` rather than `driver()`: going through
   * the lazy accessor would LAUNCH Chrome, so "show me where I am" would open a marketplace window for a seller
   * who has not started the walk. That is precisely the side effect this class exists to prevent.
   */
  async focusSurface(): Promise<boolean> {
    if (!this.isOpen() || !this.deps.raiseSurface) return false;
    return this.deps.raiseSurface();
  }

  async locateTarget(target: CoupangIssuanceTarget): Promise<LocateResult> {
    return (await this.driver()).locateTarget(target);
  }

  async highlightTarget(target: CoupangIssuanceTarget): Promise<LocateResult> {
    return (await this.driver()).highlightTarget(target);
  }

  async clearHighlight(): Promise<void> {
    // Not via `driver()`: clearing on a run that never opened a window would OPEN one to clear nothing.
    if (this.opened) await this.opened.clearHighlight();
  }

  async armObserve(target: CoupangIssuanceTarget): Promise<void> {
    await (await this.driver()).armObserve(target);
  }

  async observeUserAction(target: CoupangIssuanceTarget): Promise<boolean> {
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
    return this.opened.whenSurfaceClosed?.() ?? new Promise<void>(() => {});
  }

  /** Close the window if one was opened. Safe on a driver that never launched. */
  async close(): Promise<void> {
    const ctx = this.context;
    this.markClosed();
    await ctx?.close().catch(() => undefined);
  }
}
