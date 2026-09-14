/**
 * **The Aside-backed `ReviewAcquisitionProbeDriver`** — the whole of what changes when the Coupang WING read
 * is carried by a deterministic executor instead of a seated seller.
 *
 * Everything downstream is untouched and that is the design: the pure `ReviewAcquisitionEngine`, the walk
 * rule and its bounds (`ReviewAcquisitionSession`), the canonicalizer, the one bounded handoff, the backend,
 * the dedup formula, the v2 view the frontend renders. This class fills a four-method seam.
 *
 * **It cannot turn a page, and not because it was told not to.** `ReviewAcquisitionProbeDriver` has no verb
 * for a page turn — "a seam that cannot express a page turn is the structural form of that rule". An Aside
 * run inherits it whole. With the PoC bound (`maxPages: 1`) the walk stops on `PAGE_LIMIT_REACHED` after the
 * first reading, so the run performs **zero marketplace clicks**: one navigation to an official route WING
 * itself published, three reads, done.
 *
 * **Order: authentication, then identity, then rows.** The identity gate is PD-4 and it is not advisory —
 * a page whose store cannot be matched is never offered to the walk, so no review is canonicalized, no
 * handoff is built, and nothing is stored. The three non-MATCH outcomes are told apart on the wire
 * (`LOGIN_REQUIRED` / `STORE_MISMATCH` / `STORE_UNRESOLVED`) because their repairs differ.
 *
 * What it never holds: the expected store digest arrives per run and is compared, never logged. The raw
 * vendor code lives for the length of one comparison. Reviews pass straight to the caller; nothing here logs
 * a row, and the log line's alphabet is counts and closed words.
 */
import type { BlockerCode } from "../../../contracts/action-window/v2/index";
import type { ReviewAcquisitionProbeDriver } from "../action-window/coupang-review/review-acquisition-driver";
import { bodyEvidenceOf, sanitizeReviewPageReading, type CoupangReviewPageReading } from "../action-window/coupang-review/review-rows";
import { sanitizeWingIdentityReading } from "../action-window/coupang-review/wing-identity-inpage";
import { assertWingStore, type WingStoreVerdict } from "../action-window/coupang-review/wing-store-identity";
import { bootstrapOf, type StoreIdentityBootstrap } from "../action-window/coupang-review/store-identity-bootstrap";
import { log } from "../log";
import { AsideCoupangReviewExecutor } from "./coupang-review-executor";

/** The empty reading the walk is given when a read may not be offered. Shape via the canonical sanitizer. */
const UNREADABLE: CoupangReviewPageReading = sanitizeReviewPageReading(null);

/** Executor failure code → the word the seller's screen shows. Every one of them stops the run before rows. */
const BLOCKER_OF: Record<string, BlockerCode> = {
  AUTH_REQUIRED: "LOGIN_REQUIRED",
  STORE_UNRESOLVED: "STORE_UNRESOLVED",
  STORE_MISMATCH: "STORE_MISMATCH",
  PROVIDER_UNAVAILABLE: "EXECUTOR_UNAVAILABLE",
  PROVIDER_TIMEOUT: "EXECUTOR_UNAVAILABLE",
  PROVIDER_REFUSED: "EXECUTOR_UNAVAILABLE",
  UNSUPPORTED_STATE: "UNSUPPORTED_STATE",
  RUNTIME_FAULT: "RUNTIME_FAULT",
};

export interface AsideReviewAcquisitionDriverDeps {
  executor: Pick<AsideCoupangReviewExecutor, "execute" | "workflowRef">;
  /**
   * The digest of the vendor code this run's binding belongs to, as the backend derived it from the sealed
   * credential. `null` ⇒ the server could not say, and the run stops at `STORE_UNRESOLVED` — an unproven
   * store is never read.
   */
  expectedStoreFingerprint: () => string | null;
  /**
   * Where a bootstrap outcome goes when the backend had NO expectation to compare against — the one
   * situation in which this run may report which store it saw. Absent ⇒ nothing is reported, which is the
   * behaviour every other caller has always had.
   *
   * The value is handed to the helper's own in-memory bootstrap store and read back by the paired seller
   * browser over loopback. It is never put on the run view, never logged, and never written to disk
   * (`store-identity-bootstrap.ts`).
   */
  onBootstrap?: (outcome: StoreIdentityBootstrap) => void;
}

export class AsideReviewAcquisitionDriver implements ReviewAcquisitionProbeDriver {
  private readonly deps: AsideReviewAcquisitionDriverDeps;
  private blocker: BlockerCode | null = null;
  private lastVerdict: WingStoreVerdict | null = null;

  constructor(deps: AsideReviewAcquisitionDriverDeps) {
    this.deps = deps;
  }

  /** The last identity verdict, for the run's evidence line. Never the code, never the digest. */
  storeVerdict(): WingStoreVerdict | null {
    return this.lastVerdict;
  }

  lastBlocker(): BlockerCode | null {
    return this.blocker;
  }

  async readCurrentPage(): Promise<CoupangReviewPageReading> {
    this.blocker = null;
    const result = await this.deps.executor.execute();
    const workflow = result.workflow;
    if (!result.ok) {
      this.blocker = BLOCKER_OF[result.failure.code] ?? "UNSUPPORTED_STATE";
      log("aw_coupang_review_aside_read", {
        workflow: `${workflow.id}/${workflow.version}`,
        ok: false,
        code: result.failure.code,
        stage: result.failure.stage,
        recoverable: result.failure.recoverable,
        llmCalls: result.observed.llmCalls,
      });
      return UNREADABLE;
    }

    const identity = sanitizeWingIdentityReading(result.identity);
    const assertion = assertWingStore(this.deps.expectedStoreFingerprint(), identity);
    this.lastVerdict = assertion.verdict;
    if (assertion.verdict !== "MATCH") {
      this.blocker = assertion.verdict === "MISMATCH" ? "STORE_MISMATCH" : "STORE_UNRESOLVED";
      // Bootstrap: only when there was nothing to compare against. The STATE is logged, never the value.
      const bootstrap = bootstrapOf(assertion, identity);
      if (bootstrap) {
        this.deps.onBootstrap?.(bootstrap);
      }
      log("aw_coupang_review_aside_identity", {
        workflow: `${workflow.id}/${workflow.version}`,
        verdict: assertion.verdict,
        reason: assertion.reason,
        observedCount: assertion.observedCount,
        labelHits: identity.labelHits,
        ...(bootstrap ? { bootstrap: bootstrap.state } : {}),
      });
      // The rows came back in the same answer and are dropped here, unread: an unproven store is not read.
      return UNREADABLE;
    }

    const reading = sanitizeReviewPageReading(result.rows);
    // Counts only, and one of them is load-bearing: `textlessExpandable` above zero is the list hiding a body
    // from the reader, which is the difference between a quiet store and a broken read.
    const bodies = bodyEvidenceOf(reading.rows);
    log("aw_coupang_review_aside_read", {
      workflow: `${workflow.id}/${workflow.version}`,
      ok: true,
      verdict: assertion.verdict,
      readReason: reading.reason,
      rows: reading.rows.length,
      excludedColumns: reading.excludedColumns,
      rolesResolved: reading.rolesResolved.length,
      pagerResolved: reading.pager.resolved,
      // What the list says about its own size. Read on every page already; reported so the question
      // "is one page enough for this seller" is answered by measurement instead of by argument.
      pagerPages: reading.pager.pageNumbers.length,
      // The highest number the pager prints is the one that says how much sits behind page 1; the COUNT of
      // printed numbers is a fact about the control's width, which is not the same question.
      pagerHighest: reading.pager.pageNumbers.length > 0 ? Math.max(...reading.pager.pageNumbers) : 0,
      pagerCurrent: reading.pager.currentPage,
      pagerHasNext: reading.pager.hasNext,
      textless: bodies.textless,
      bodyExpandable: bodies.expandable,
      bodyTruncated: bodies.truncated,
      textlessExpandable: bodies.textlessExpandable,
      llmCalls: result.observed.llmCalls,
      durationMs: result.observed.durationMs,
    });
    return reading;
  }

  /** Nothing to tear down: this driver mounts no overlay, tags nothing, and closes its own tab. */
  async cleanup(): Promise<void> {
    this.blocker = null;
  }
}
