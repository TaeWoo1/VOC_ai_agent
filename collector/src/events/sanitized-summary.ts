/**
 * Sanitized-summary dispatcher for the unified SellerOps event union.
 *
 * Given any `SellerOpsEvent`, return its existing per-kind sanitized summary. This is
 * pure dispatch — it adds NO new exposure: every branch delegates to the normalizer's
 * own `sanitized*Summary`, which already strips content, reference codes, exact
 * amounts/counts, and identity. The dispatcher never reads raw event content itself.
 *
 * No I/O, no network, no fs, no browser, no env, no AI. The switch is exhaustive: a
 * new event kind that is not handled becomes a compile-time error via `assertNever`.
 */

import { sanitizedClaimSummary } from "../esmplus/claim-normalizer";
import { sanitizedInquirySummary } from "../esmplus/inquiry-normalizer";
import { sanitizedOrderSummary } from "../esmplus/order-normalizer";
import { sanitizedSalesContextSummary } from "../esmplus/sales-context-normalizer";
import { sanitizedReviewSummary } from "../review/review-normalizer";
import type { SanitizedSummaryOptions } from "./recency-bucket";
import type { SellerOpsEvent, SellerOpsSanitizedSummary } from "./types";

/** Compile-time exhaustiveness guard — unreachable at runtime if the switch is total. */
function assertNever(x: never): never {
  throw new Error(`Unhandled SellerOpsEvent kind: ${JSON.stringify(x)}`);
}

/**
 * Map any unified event to its log-safe sanitized summary. The returned shape is
 * exactly the normalizer's own sanitized summary — no content, refs, ids, exact
 * amounts/counts, or identity are ever added here.
 *
 * `opts.referenceTimeMs` (explicit, never the wall clock) is forwarded to the review,
 * cs_inquiry, and claim summaries' coarse `recencyBucket`; without it, their recency is
 * `"unknown"`. The remaining kinds do not yet carry recency.
 */
export function sanitizedSummaryFor(
  event: SellerOpsEvent,
  opts: SanitizedSummaryOptions = {},
): SellerOpsSanitizedSummary {
  switch (event.kind) {
    case "review":
      return sanitizedReviewSummary(event, opts);
    case "cs_inquiry":
      return sanitizedInquirySummary(event, opts);
    case "order_shipping":
      return sanitizedOrderSummary(event);
    case "claim":
      return sanitizedClaimSummary(event, opts);
    case "sales_context":
      return sanitizedSalesContextSummary(event);
    default:
      return assertNever(event);
  }
}
