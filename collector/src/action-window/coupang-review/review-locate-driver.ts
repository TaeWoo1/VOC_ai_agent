/**
 * **What a `REVIEW_LOCATE` run needs from a browser** — four methods, of which exactly one reads the page.
 *
 * The interface is written narrow on purpose. A driver behind it cannot navigate, cannot click, cannot type,
 * and cannot turn a page, because there is no method here that would let it: what a locate run is allowed to
 * do on the marketplace is *look at what is on the screen and draw on it*, and the type says so.
 *
 * `CoupangWingReviewReaderDriver` already implements the one that matters, which is why the live
 * implementation next door is a pass-through rather than a second reader — one reader for the acquisition
 * walk and for the locate, so the row a run stores and the row it later rings are read by the same code.
 */
import type { ReviewLocateResult } from "./coupang-wing-review-reader-driver";
import type { ReviewLocateTarget } from "./review-locate";

export interface ReviewLocateProbeDriver {
  /**
   * Read the page in front of the seller, compare every row against `target`, and ring the one that matches.
   *
   * <p>One call, not three, because the read and the ring must be about the SAME reading of the page: a
   * matcher that returned a row index for a caller to annotate later would ring row 3 of a page that had
   * since re-rendered. The result says both what was decided and whether the ring actually landed.
   */
  locate(target: ReviewLocateTarget): Promise<ReviewLocateResult>;

  /** Take the ring back off. Safe on a page that never had one. */
  clearHighlight(): Promise<number>;

  /** Release whatever the driver is holding at the end of the run. */
  cleanup(): Promise<void>;

  /** Bring the seller's marketplace window back in front of them. Optional; never opens a new one. */
  focusSurface?(): Promise<boolean>;

  /** Resolves when the seller closes the window the run was reading. Optional. */
  whenSurfaceClosed?(): Promise<void>;
}
