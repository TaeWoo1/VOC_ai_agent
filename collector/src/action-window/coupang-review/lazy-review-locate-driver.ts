/**
 * **The review-locate driver, with the window opened LAZILY — the product-path host.**
 *
 * The locate sibling of `../coupang-issuance/lazy-coupang-issuance-driver.ts` and
 * `../coupang-renewal/lazy-coupang-renewal-driver.ts`, and it exists for the same reason: the resident
 * SellerOps 도우미 is long-lived, so a driver that launched Chrome in its constructor would open the seller's
 * marketplace window at agent boot, before anyone pressed anything.
 *
 * A locate is the NARROWEST of the carriers — it reads the page the seller brought up and draws a ring around
 * one row — so the lazy wrapper is correspondingly small. Two properties carry over unchanged from the twins:
 *
 *  - **concurrent first calls share ONE launch**, so two presses racing at run start cannot each open a window;
 *  - **a closed window is FORGOTTEN**, so the seller closing their own window does not leave a cached driver
 *    bound to a dead page; the next press re-opens in the same persistent profile.
 *
 * It adds no capability. Every method delegates to {@link CoupangWingReviewLocateDriver}, which reads rows and
 * annotates one of them read-only. It clicks nothing, types nothing, submits nothing, and — the property that
 * matters most on this surface — **never presses the pager**: the seller turns every page themselves.
 */
import type { BrowserContext, Page } from "playwright";
import { CoupangWingReviewLocateDriver } from "./coupang-wing-review-locate-driver";
import { CoupangWingReviewReaderDriver, type ReviewLocateResult } from "./coupang-wing-review-reader-driver";
import type { ReviewLocateProbeDriver } from "./review-locate-driver";
import type { ReviewLocateTarget } from "./review-locate";

export interface LazyReviewLocateDriverDeps {
  /** Bring up the dedicated window. Called at most once per open cycle. */
  open(): Promise<{ context: BrowserContext; page: Page }>;
  /** Raise the walk's EXISTING window ("쿠팡 창 앞으로"). Never opens one — see {@link focusSurface}. */
  raiseSurface?: () => Promise<boolean>;
}

export class LazyReviewLocateDriver implements ReviewLocateProbeDriver {
  private readonly deps: LazyReviewLocateDriverDeps;
  private opening: Promise<CoupangWingReviewLocateDriver> | null = null;
  private opened: CoupangWingReviewLocateDriver | null = null;
  /** Resolves when the seller closes the window this run was reading. Re-armed on every open. */
  private closed: Promise<void> | null = null;
  private retired = false;

  constructor(deps: LazyReviewLocateDriverDeps) {
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
    this.closed = null;
  }

  /** Forget a closed window so the next press re-opens it in the same persistent profile. */
  markClosed(): void {
    this.opened = null;
    this.opening = null;
    this.closed = null;
  }

  private async driver(): Promise<CoupangWingReviewLocateDriver> {
    if (this.retired) throw new Error("review locate driver: retired (the carrier was released)");
    if (this.opened) return this.opened;
    if (!this.opening) {
      this.opening = this.deps.open().then(({ context, page }) => {
        const reader = new CoupangWingReviewReaderDriver(page, {
          context,
          // A locate never reads the pager, and the diagnostic fields are the only place page text reaches a log.
          pagerDiagnostics: false,
        });
        // The seller's window is "gone" when the CONTEXT has no page left — WING opening a second tab must not
        // read as a close, and the session's "never re-read a window the seller CLOSED" latch depends on this
        // resolving exactly once, when it really is gone.
        const closed = new Promise<void>((resolveClosed) => {
          const check = (): void => {
            if (context.pages().length === 0) resolveClosed();
          };
          const watch = (p: Page): void => {
            p.on("close", check);
          };
          for (const p of context.pages()) watch(p);
          context.on("page", watch);
          context.on("close", () => resolveClosed());
        });
        this.closed = closed;
        const d = new CoupangWingReviewLocateDriver(reader, {
          ...(this.deps.raiseSurface ? { raiseSurface: this.deps.raiseSurface } : {}),
          closed,
        });
        this.opened = d;
        return d;
      });
      // A failed launch must NOT be cached: the seller can clear the cause and press again.
      this.opening.catch(() => {
        this.opening = null;
      });
    }
    return this.opening;
  }

  async locate(target: ReviewLocateTarget): Promise<ReviewLocateResult> {
    return (await this.driver()).locate(target);
  }

  /** No window ⇒ nothing is ringed. Opening one to clear a ring that cannot exist is the side effect this prevents. */
  async clearHighlight(): Promise<number> {
    if (!this.opened) return 0;
    return this.opened.clearHighlight();
  }

  /** Same rule: cleanup on a carrier that never opened a window has nothing to clean. */
  async cleanup(): Promise<void> {
    if (!this.opened) return;
    await this.opened.cleanup();
  }

  /** Raise the EXISTING window. Refuses (false) when none is open — it never launches one. */
  async focusSurface(): Promise<boolean> {
    if (!this.opened) return false;
    return (await this.opened.focusSurface?.()) ?? false;
  }

  /**
   * Resolves when the seller closes the window the run was reading. Before the first open there is no window
   * to close, so this stays pending — the honest answer, and the one the session's latch expects (it re-arms
   * this after each open, and the host's own release path tears an unopened carrier down).
   */
  whenSurfaceClosed(): Promise<void> {
    return this.closed ?? new Promise<void>(() => undefined);
  }
}
