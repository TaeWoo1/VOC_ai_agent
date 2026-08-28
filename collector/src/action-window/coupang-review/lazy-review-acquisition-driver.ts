/**
 * **Lazy acquisition driver** — the WING window comes up on the seller's FIRST read, never at activation.
 *
 * The acquisition sibling of `lazy-review-locate-driver.ts`: the resident helper must hold no browser for a
 * carrier nobody has used, and a seller who opens the screen and leaves must open no window. Wraps the
 * live-proven {@link CoupangWingReviewReaderDriver} (the same reader the seated CLI uses; nothing about how a
 * page is read moves here) behind the narrow {@link ReviewAcquisitionProbeDriver} seam.
 *
 * Nothing marketplace-facing is added: the reader reads rows; it clicks nothing, types nothing, submits
 * nothing, and never presses the pager — the seller turns every page.
 */
import type { BrowserContext, Page } from "playwright";
import { CoupangWingReviewReaderDriver } from "./coupang-wing-review-reader-driver";
import type { ReviewAcquisitionProbeDriver } from "./review-acquisition-driver";
import type { CoupangReviewPageReading } from "./review-rows";

export interface LazyReviewAcquisitionDriverDeps {
  open(): Promise<{ context: BrowserContext; page: Page }>;
  raiseSurface?: () => Promise<boolean>;
}

export class LazyReviewAcquisitionDriver implements ReviewAcquisitionProbeDriver {
  private readonly deps: LazyReviewAcquisitionDriverDeps;
  private opening: Promise<CoupangWingReviewReaderDriver> | null = null;
  private opened: CoupangWingReviewReaderDriver | null = null;
  private closed: Promise<void> | null = null;
  private retired = false;

  constructor(deps: LazyReviewAcquisitionDriverDeps) {
    this.deps = deps;
  }

  isOpen(): boolean {
    return this.opened !== null;
  }

  /** No call may open a window again (the carrier was released). */
  retire(): void {
    this.retired = true;
    this.opened = null;
    this.opening = null;
    this.closed = null;
  }

  markClosed(): void {
    this.opened = null;
    this.opening = null;
    this.closed = null;
  }

  private async driver(): Promise<CoupangWingReviewReaderDriver> {
    if (this.retired) throw new Error("review acquisition driver: retired (the carrier was released)");
    if (this.opened) return this.opened;
    if (!this.opening) {
      this.opening = this.deps.open().then(({ context, page }) => {
        // Pager diagnostics ON, as on the seated acquisition: the completion claim depends on reading a pager
        // it may have to be told about.
        const reader = new CoupangWingReviewReaderDriver(page, { context });
        this.closed = new Promise<void>((resolveClosed) => {
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
        this.opened = reader;
        return reader;
      });
      this.opening.catch(() => {
        this.opening = null;
      });
    }
    return this.opening;
  }

  async readCurrentPage(): Promise<CoupangReviewPageReading> {
    return (await this.driver()).readCurrentPage();
  }

  async cleanup(): Promise<void> {
    if (!this.opened) return;
    await this.opened.clearHighlight().catch(() => 0);
  }

  async focusSurface(): Promise<boolean> {
    if (!this.opened || !this.deps.raiseSurface) return false;
    return this.deps.raiseSurface();
  }

  whenSurfaceClosed(): Promise<void> {
    return this.closed ?? new Promise<void>(() => undefined);
  }
}
