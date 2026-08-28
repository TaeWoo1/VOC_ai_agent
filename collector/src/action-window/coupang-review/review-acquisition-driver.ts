/**
 * **The acquisition run's probe seam.** What the session needs from a page, and nothing more.
 *
 * Deliberately narrower than the reader driver behind it: ONE read of the page the seller has up. There is
 * no `nextPage`, no `click`, no `navigate` — the pager is the seller's, and a seam that cannot express a page
 * turn is the structural form of that rule.
 */
import type { CoupangReviewPageReading } from "./review-rows";

export interface ReviewAcquisitionProbeDriver {
  /** Read the 상품평 list page in front of the seller, sanitized. Never turns a page. */
  readCurrentPage(): Promise<CoupangReviewPageReading>;
  /** Tear down anything the run left on the page. Idempotent. */
  cleanup(): Promise<void>;
  /** OPTIONAL: bring the marketplace window in front of the seller. Raises only; never navigates. */
  focusSurface?(): Promise<boolean>;
  /** OPTIONAL: resolves once the seller closed the window the run was reading. */
  whenSurfaceClosed?(): Promise<void>;
}
