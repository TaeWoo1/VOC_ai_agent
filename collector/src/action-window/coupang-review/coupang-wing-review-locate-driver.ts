/**
 * **The live locate driver** — a thin adapter from {@link ReviewLocateProbeDriver} onto the reader that the
 * acquisition walk already uses.
 *
 * It is deliberately an adapter and not a second reader. The row a run STORED and the row it later RINGS have
 * to be read by the same code, or the two could disagree about what a row is — different header-role
 * resolution, a different expander strip — and a locate that failed for that reason would look exactly like a
 * review that is not on the page.
 *
 * Everything it can do to the marketplace is: read the visible page, draw a ring, take the ring off, and
 * raise a window that is already open. There is no method here that navigates, pages, clicks, or types,
 * because the interface has none.
 */
import type { CoupangWingReviewReaderDriver, ReviewLocateResult } from "./coupang-wing-review-reader-driver";
import type { ReviewLocateProbeDriver } from "./review-locate-driver";
import type { ReviewLocateTarget } from "./review-locate";

export interface CoupangWingReviewLocateDriverDeps {
  /**
   * Bring the seller's already-open marketplace window to the front. It may NOT open one: "show me where I
   * am" opening a window is the side effect the issuance lazy driver refuses for the same reason.
   */
  raiseSurface?: () => Promise<boolean>;
  /** Resolves when the seller closes the window this run is reading. Absent ⇒ the run never hears about it. */
  closed?: Promise<void>;
}

export class CoupangWingReviewLocateDriver implements ReviewLocateProbeDriver {
  private readonly reader: CoupangWingReviewReaderDriver;
  private readonly deps: CoupangWingReviewLocateDriverDeps;

  constructor(reader: CoupangWingReviewReaderDriver, deps: CoupangWingReviewLocateDriverDeps = {}) {
    this.reader = reader;
    this.deps = deps;
  }

  locate(target: ReviewLocateTarget): Promise<ReviewLocateResult> {
    return this.reader.locate(target);
  }

  clearHighlight(): Promise<number> {
    return this.reader.clearHighlight();
  }

  /**
   * End of run. The ring comes OFF — a mark left on a seller's screen after the run that drew it is gone is
   * a mark nothing will ever explain. Best-effort: a page that is closing may never answer.
   */
  async cleanup(): Promise<void> {
    await this.reader.clearHighlight().catch(() => 0);
  }

  async focusSurface(): Promise<boolean> {
    return this.deps.raiseSurface ? this.deps.raiseSurface() : false;
  }

  whenSurfaceClosed(): Promise<void> {
    // A promise that never settles is the honest answer when nobody told us how to know: the session simply
    // never hears a close, rather than being told the window closed when it did not.
    return this.deps.closed ?? new Promise<void>(() => undefined);
  }
}
