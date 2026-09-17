/**
 * **The helper's side of the unattended MARKETPLACE lane: read one page of the seller's own WING 리뷰 목록.**
 *
 * The loopback sibling (`fixture-observe-runner.ts`) states what an unattended loop must not be able to do. This
 * file inherits every one of those properties and changes exactly one thing — the surface is the seller's own
 * store instead of a page we serve ourselves — so it is worth being precise about what did NOT change:
 *
 *  - **it cannot be told where to go.** The backend hands back a recipe NAME. This file resolves that name to
 *    `COUPANG_REVIEW_READ_WORKFLOW`, whose entry URL is screened by the product's own WING classifier
 *    (`validateCoupangReviewWorkflow`) before a tab opens — the same shape as the fixture screening for
 *    loopback. A non-WING host is unreachable because nothing in the exchange can name one.
 *  - **it cannot be told what to do.** No prompt, script or step list is on the wire; the program is built here
 *    from the frozen runtime, which clicks nothing, types nothing, downloads nothing, submits nothing, turns no
 *    page, and calls no model.
 *  - **it cannot read a store it cannot prove is the right one.** `assertWingStore` runs between the read and
 *    the rows, against a digest the backend derived from this account's own vendor code. Anything but `MATCH`
 *    drops the rows unread — they arrive in the same answer as the identity and are discarded here.
 *  - **it cannot report prose.** One of four closed tokens, a count, and a digest of the collector's own
 *    boundary keys. No review text, no customer, no store code, no URL leaves this machine through this path.
 *  - **it cannot invent an empty store.** Every failure path returns a failure token, never `OBSERVED 0`.
 *
 * **What the two extra wire fields are for.** A marketplace claim carries `accountSlot` (the opaque per-account
 * id the existing review handoff is keyed by) and `expectedStoreFingerprint` (a digest, never the code). Both
 * already travel to this same helper on the seller-pressed lane. Neither can name a target.
 *
 * **One honest limitation, recorded rather than hidden.** The closed outcome vocabulary has no token for «the
 * page was read but the reading could not be delivered». When the handoff fails, this reports
 * `EXECUTOR_UNAVAILABLE` — a statement about our own transport, which the backend maps to
 * `NONE · DEVICE_OFFLINE`, counts null. That is the correct product meaning (nothing was established durably,
 * and the next window must not treat this as a baseline) even though the token is coarser than the event.
 */
import { createHash } from "node:crypto";
import {
  COUPANG_REVIEW_READ_WORKFLOW,
  validateCoupangReviewWorkflow,
} from "./coupang-review-workflow";
import { AsideCoupangReviewExecutor } from "./coupang-review-executor";
import {
  canonicalizeReviewRows,
  localBoundaryKey,
  sanitizeReviewPageReading,
  type CoupangAcquiredReview,
} from "../action-window/coupang-review/review-rows";
import { sanitizeWingIdentityReading } from "../action-window/coupang-review/wing-identity-inpage";
import { assertWingStore } from "../action-window/coupang-review/wing-store-identity";
import type {
  ReviewHandoffRequest,
  ReviewHandoffResponse,
} from "../action-window/coupang-review/review-handoff-client";
import { log } from "../log";

/** The recipe name this runner answers to. A claim naming anything else is not ours and is not run. */
export const COUPANG_REVIEW_OBSERVE_RECIPE_ID = "COUPANG_REVIEW_OBSERVE_V1" as const;

/** The same closed set the loopback runner reports. No token was added for this lane. */
export type MarketplaceJobOutcome = "OBSERVED" | "SURFACE_UNREADABLE" | "EXECUTOR_UNAVAILABLE" | "REFUSED";

export interface CoupangObserveResult {
  readonly outcome: MarketplaceJobOutcome;
  readonly observedCount: number | null;
  readonly contentDigest: string | null;
}

export interface CoupangObserveDeps {
  /** What the claim said this store is. `null` ⇒ no expectation ⇒ the identity assertion stops the read. */
  readonly expectedStoreFingerprint: string | null;
  /** Where the reading is handed back. Absent ⇒ there is no route home, and we do not read without one. */
  readonly accountSlot: string | null;
  readonly handoff: (request: ReviewHandoffRequest) => Promise<ReviewHandoffResponse>;
  /** Injected for tests; production builds the frozen deterministic executor. */
  readonly executor?: Pick<AsideCoupangReviewExecutor, "execute" | "workflowRef">;
  readonly asideCli?: string;
  readonly asideAccount?: string;
}

/**
 * SHA-256 of the collector's own boundary keys, sorted.
 *
 * <p>The boundary key already exists for the pager walk and is deliberately not review text: it is ids, a date,
 * a rating and the body's FINGERPRINT. Digesting it gives the backend the one thing it needs — «is this the same
 * set as last window» — while this machine remains the only place the reviews themselves were ever assembled.
 */
export function digestOfReviews(reviews: readonly CoupangAcquiredReview[]): string {
  return createHash("sha256").update(reviews.map(localBoundaryKey).sort().join("\n"), "utf8").digest("hex");
}

/**
 * Run one unattended Coupang review observation. Never throws: an unattended loop that can throw is one that
 * stops.
 */
export async function runCoupangReviewObservation(deps: CoupangObserveDeps): Promise<CoupangObserveResult> {
  const workflow = COUPANG_REVIEW_READ_WORKFLOW;
  const errors = validateCoupangReviewWorkflow(workflow);
  if (errors.length > 0) {
    // Our own bound route did not pass our own screen. Refuse rather than open something unscreened.
    log("aside_coupang_observe_refused", { reason: errors.join(",") }, "warn");
    return { outcome: "REFUSED", observedCount: null, contentDigest: null };
  }
  if (!deps.accountSlot) {
    // No route home. Reading a seller's store to then discard the reading is a marketplace request nobody
    // asked for, so it is not made.
    log("aside_coupang_observe_refused", { reason: "NO_ACCOUNT_SLOT" }, "warn");
    return { outcome: "REFUSED", observedCount: null, contentDigest: null };
  }

  let executor: Pick<AsideCoupangReviewExecutor, "execute" | "workflowRef">;
  try {
    executor = deps.executor
      ?? new AsideCoupangReviewExecutor({
        cli: {
          ...(deps.asideCli ? { command: deps.asideCli } : {}),
          ...(deps.asideAccount ? { account: deps.asideAccount } : {}),
        },
      });
  } catch {
    return { outcome: "REFUSED", observedCount: null, contentDigest: null };
  }

  let result;
  try {
    result = await executor.execute();
  } catch {
    return { outcome: "EXECUTOR_UNAVAILABLE", observedCount: null, contentDigest: null };
  }

  if (!result.ok) {
    // `AUTH_REQUIRED` lands here, and this is the case the whole «nothing is not zero» rule exists for: a
    // signed-out browser has told us nothing about how many reviews the store has.
    const outcome: MarketplaceJobOutcome = result.failure.code === "RUNTIME_FAULT"
      ? "SURFACE_UNREADABLE"
      : "EXECUTOR_UNAVAILABLE";
    log("aside_coupang_observe_read", {
      ok: false,
      code: result.failure.code,
      stage: result.failure.stage,
      recoverable: result.failure.recoverable,
      llmCalls: result.observed.llmCalls,
      outcome,
    });
    return { outcome, observedCount: null, contentDigest: null };
  }

  const identity = sanitizeWingIdentityReading(result.identity);
  const assertion = assertWingStore(deps.expectedStoreFingerprint, identity);
  if (assertion.verdict !== "MATCH") {
    // The rows came back in the same answer and are dropped here, unread. Nothing was established about any
    // store — including this one — so this is not a reading of an empty list.
    log("aside_coupang_observe_identity", {
      verdict: assertion.verdict,
      reason: assertion.reason,
      observedCount: assertion.observedCount,
      labelHits: identity.labelHits,
    });
    return { outcome: "SURFACE_UNREADABLE", observedCount: null, contentDigest: null };
  }

  const reading = sanitizeReviewPageReading(result.rows);
  // <b>Only two readings may become a number, and «no rows» is the one that may become a zero.</b>
  // `NO_ROWS` is the reader having read the list and found it empty — a fact about the store. Every other
  // non-OK reason (headers unresolved, ambiguous table, width mismatch, unreadable) is a fact about our read,
  // and reporting it as a count would be the exact claim this lane exists to never make.
  if (reading.reason !== "OK" && reading.reason !== "NO_ROWS") {
    log("aside_coupang_observe_read", { ok: false, readReason: reading.reason, rows: reading.rows.length });
    return { outcome: "SURFACE_UNREADABLE", observedCount: null, contentDigest: null };
  }
  const canonical = canonicalizeReviewRows(reading);
  if (reading.rows.length > 0 && canonical.reviews.length === 0) {
    // The page printed rows and not one of them survived canonicalization. That is not an empty store either —
    // it is a shape we no longer understand, which is precisely when a confident zero would do the most damage.
    log("aside_coupang_observe_read", {
      ok: false,
      readReason: reading.reason,
      rows: reading.rows.length,
      droppedDate: canonical.dropped.unparseableDate,
      droppedRating: canonical.dropped.unreadableRating,
      droppedProduct: canonical.dropped.noProductId,
    });
    return { outcome: "SURFACE_UNREADABLE", observedCount: null, contentDigest: null };
  }
  // The coverage CLAIM, never inferred: true only when the list's own pager showed there is no next page.
  const complete = reading.pager.resolved && !reading.pager.hasNext;
  let handed: ReviewHandoffResponse;
  try {
    handed = await deps.handoff({
      accountSlot: deps.accountSlot,
      channelCode: "COUPANG",
      complete,
      stopReason: complete ? "LAST_PAGE_REACHED" : "PAGE_LIMIT_REACHED",
      reviews: canonical.reviews,
    });
  } catch {
    log("aside_coupang_observe_handoff", { ok: false, reason: "TRANSPORT" }, "warn");
    return { outcome: "EXECUTOR_UNAVAILABLE", observedCount: null, contentDigest: null };
  }
  if (!handed.ok) {
    log("aside_coupang_observe_handoff", { ok: false, reason: handed.reason ?? "REFUSED" }, "warn");
    return { outcome: "EXECUTOR_UNAVAILABLE", observedCount: null, contentDigest: null };
  }

  log("aside_coupang_observe_read", {
    ok: true,
    verdict: assertion.verdict,
    readReason: reading.reason,
    rows: reading.rows.length,
    canonical: canonical.reviews.length,
    droppedDate: canonical.dropped.unparseableDate,
    droppedRating: canonical.dropped.unreadableRating,
    droppedProduct: canonical.dropped.noProductId,
    textless: canonical.textlessCount,
    pagerResolved: reading.pager.resolved,
    pagerHasNext: reading.pager.hasNext,
    complete,
    received: handed.received,
    stored: handed.stored,
    skipped: handed.skipped,
    failed: handed.failed,
    unlinked: handed.unlinked,
    llmCalls: result.observed.llmCalls,
    durationMs: result.observed.durationMs,
  });
  return {
    outcome: "OBSERVED",
    observedCount: canonical.reviews.length,
    contentDigest: digestOfReviews(canonical.reviews),
  };
}
