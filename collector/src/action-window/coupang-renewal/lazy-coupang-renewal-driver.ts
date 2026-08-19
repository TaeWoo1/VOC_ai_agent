/**
 * **The guided WING RENEWAL walk's driver, with the window opened LAZILY — the product-path host.**
 *
 * The renewal sibling of `../coupang-issuance/lazy-coupang-issuance-driver.ts`, and it exists for exactly the
 * same reason: the resident SellerOps 도우미 is long-lived, so a driver that launched Chrome in its constructor
 * would open the seller's marketplace window at agent boot, before any run exists and without anyone asking.
 *
 * The two properties that matter are the ones the issuance twin documents, and they carry over unchanged:
 *
 *  - **concurrent first calls share ONE launch.** The in-flight promise is held, so two calls racing at run
 *    start cannot each open a window;
 *  - **a closed window is FORGOTTEN.** The seller closing their own window must not leave a cached driver bound
 *    to a dead page; the next call re-opens in the same persistent profile, so the session survives.
 *
 * It adds no capability. Every method delegates to {@link CoupangWingRenewalDriver}, which never logs in,
 * clicks, types, submits, selects, or re-issues, and reads no credential VALUE — the seller presses `재발급`
 * themselves. The one value it may read is the `유효기간` DATE, through that driver's own allowlisted seam.
 */
import type { BrowserContext, Page } from "playwright";
import { CoupangWingRenewalDriver } from "../coupang-wing-renewal-driver";
import type { LocateResult } from "../engine";
import type {
  CoupangRenewalProbeDriver,
  CoupangRenewalTarget,
  WingSurfaceProbe,
} from "./coupang-renewal-driver";

export interface LazyCoupangRenewalDriverDeps {
  /**
   * Bring up the dedicated window. Called at most once per open cycle. Whether it navigates is the OPENER's
   * decision, not this class's — the resident host lands it once on the seller's own WING open-API page and
   * never again, exactly as the issuance walk does.
   */
  open(): Promise<{ context: BrowserContext; page: Page }>;
  /**
   * Raise the walk's EXISTING window ("현재 단계 다시 찾기"). Only ever called when a window is already open:
   * a lazy driver whose "show me where I am" opened a marketplace window would be the side effect this class
   * exists to prevent.
   */
  raiseSurface?: () => Promise<boolean>;
}

export class LazyCoupangRenewalDriver implements CoupangRenewalProbeDriver {
  private readonly deps: LazyCoupangRenewalDriverDeps;
  /** The in-flight or settled launch. Held so concurrent first calls share ONE window, not one each. */
  private opening: Promise<CoupangWingRenewalDriver> | null = null;
  private opened: CoupangWingRenewalDriver | null = null;
  /**
   * **Retired for good** — the host tore this walk down (the resident helper released it, or the agent is
   * shutting down). Distinct from {@link markClosed}, which means "the seller closed their window; re-open it
   * on their next command". After this, every call refuses rather than launching: a released walk whose loops
   * are still unwinding must not be able to bring the marketplace window back (observed 2026-08-19 on the
   * issuance twin, which is why this one has the latch from the start).
   */
  private retired = false;

  constructor(deps: LazyCoupangRenewalDriverDeps) {
    this.deps = deps;
  }

  /** Whether the window has been brought up — a sanitized boolean, for the host's teardown and for tests. */
  isOpen(): boolean {
    return this.opened !== null;
  }

  /** Retire the driver: no call may open a window again. Idempotent, and it opens/closes nothing itself. */
  retire(): void {
    this.retired = true;
    this.opened = null;
    this.opening = null;
  }

  /** Forget a closed window so the next call re-opens it in the same persistent profile. */
  markClosed(): void {
    this.opened = null;
    this.opening = null;
  }

  private async driver(): Promise<CoupangWingRenewalDriver> {
    if (this.retired) throw new Error("coupang renewal driver: retired (the walk was released)");
    if (this.opened) return this.opened;
    if (!this.opening) {
      this.opening = this.deps.open().then(({ context, page }) => {
        const d = new CoupangWingRenewalDriver(page, { context });
        this.opened = d;
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

  async locateTarget(target: CoupangRenewalTarget): Promise<LocateResult> {
    return (await this.driver()).locateTarget(target);
  }

  async highlightTarget(target: CoupangRenewalTarget): Promise<LocateResult> {
    return (await this.driver()).highlightTarget(target);
  }

  async clearHighlight(): Promise<void> {
    // No window ⇒ nothing is annotated. Opening one to clear a highlight that cannot exist would be the exact
    // unasked-for marketplace window this class prevents.
    if (!this.opened) return;
    await this.opened.clearHighlight();
  }

  async armObserve(target: CoupangRenewalTarget): Promise<void> {
    await (await this.driver()).armObserve(target);
  }

  async observeUserAction(target: CoupangRenewalTarget): Promise<boolean> {
    return (await this.driver()).observeUserAction(target);
  }

  async cleanup(): Promise<void> {
    // Same rule as `clearHighlight`: cleanup on a walk that never opened a window has nothing to clean.
    if (!this.opened) return;
    await this.opened.cleanup();
  }

  /**
   * Resolve when the seller closes the WING window. Only meaningful once one is open — before that there is no
   * window to close, and a promise that never settles is the honest answer (the session re-arms this after
   * each open, and the host's own release path is what tears an unopened walk down).
   */
  async whenSurfaceClosed(): Promise<void> {
    const d = await this.driver();
    await d.whenSurfaceClosed?.();
  }

  /** The ONE allowlisted value read — the `유효기간` date. Never opens a window to answer. */
  async readValidityDate(): Promise<string | null> {
    if (!this.opened) return null;
    return (await this.opened.readValidityDate?.()) ?? null;
  }

  /** Raise the EXISTING window. Refuses (false) when none is open — it never launches one. */
  async focusSurface(): Promise<boolean> {
    if (!this.opened || !this.deps.raiseSurface) return false;
    return this.deps.raiseSurface();
  }
}
