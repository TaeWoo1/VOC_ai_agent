/**
 * Deterministic attention-signal extractor over the unified SellerOps event.
 *
 * This is the first concrete consumer of the event envelope. It answers "why might
 * this event need seller attention?" with typed, rule-based reasons — NOT a numeric
 * score, NOT AI classification, NOT a ranking. It reads ONLY the sanitized summary
 * (`sanitizedSummaryFor`), never raw event content, so it cannot leak review/inquiry/
 * claim text, reference codes, exact amounts/counts, or identity.
 *
 * No I/O, no network, no fs, no browser, no env, no AI, no model prompt.
 */

import type { SanitizedReviewSummary } from "../review/types";
import type {
  SanitizedClaimSummary,
  SanitizedInquirySummary,
  SanitizedOrderSummary,
  SanitizedSalesContextSummary,
} from "../esmplus/types";
import { sanitizedSummaryFor } from "./sanitized-summary";
import type { SellerOpsEvent } from "./types";

/** Rule-based reasons an event may warrant attention. `unknown_attention_signal` is reserved for forward-compat. */
export type AttentionSignalCode =
  | "low_rating_review"
  | "not_replied_review"
  | "unanswered_inquiry"
  | "active_claim"
  | "sales_context_available"
  | "high_sales_context"
  | "unknown_attention_signal";

export type AttentionSignalSeverity = "low" | "medium" | "high";

/**
 * One attention reason. `reason` is a fixed, generic, sanitized phrase — it carries
 * no review/inquiry/claim content, no reference codes, no amounts, and no identity.
 */
export interface AttentionSignal {
  code: AttentionSignalCode;
  severity: AttentionSignalSeverity;
  reason: string;
}

/** Compile-time exhaustiveness guard — unreachable at runtime if the switch is total. */
function assertNever(x: never): never {
  throw new Error(`Unhandled sanitized summary kind: ${JSON.stringify(x)}`);
}

/** Reviews surface product/customer pain. */
function reviewSignals(s: SanitizedReviewSummary): AttentionSignal[] {
  const out: AttentionSignal[] = [];
  if (s.ratingBucket === "low") {
    out.push({ code: "low_rating_review", severity: "high", reason: "리뷰 평점이 낮은 구간입니다." });
  }
  if (s.replyStatus === "not_replied") {
    out.push({ code: "not_replied_review", severity: "medium", reason: "아직 답변하지 않은 리뷰입니다." });
  }
  return out;
}

/** Inquiries surface immediate work. Derived only from the sanitized `status` field. */
function inquirySignals(s: SanitizedInquirySummary): AttentionSignal[] {
  const out: AttentionSignal[] = [];
  if (s.status === "open") {
    out.push({ code: "unanswered_inquiry", severity: "medium", reason: "미답변 문의입니다." });
  }
  return out;
}

/** Orders carry no attention signal in this layer yet (see attention-signal-model.md). */
function orderSignals(_s: SanitizedOrderSummary): AttentionSignal[] {
  return [];
}

/** Claims surface operational risk. Derived only from the sanitized `status` field. */
function claimSignals(s: SanitizedClaimSummary): AttentionSignal[] {
  const out: AttentionSignal[] = [];
  if (s.status === "open" || s.status === "in_progress") {
    out.push({ code: "active_claim", severity: "high", reason: "진행 중인 클레임입니다." });
  }
  return out;
}

/** Sales context surfaces business importance. Uses the coarse `amountBucket` only. */
function salesContextSignals(s: SanitizedSalesContextSummary): AttentionSignal[] {
  const out: AttentionSignal[] = [];
  if (s.amountBucket === "10m_to_100m" || s.amountBucket === "100m_plus") {
    out.push({ code: "high_sales_context", severity: "high", reason: "매출 규모가 큰 상품 컨텍스트입니다." });
  }
  if (s.hasGrossSalesAmount || s.hasOrderCount || s.hasClaimCount) {
    out.push({ code: "sales_context_available", severity: "low", reason: "매출/주문/클레임 컨텍스트가 있습니다." });
  }
  return out;
}

/**
 * Derive the deterministic attention signals for one event. Reads only the sanitized
 * summary; output order is fixed per kind. Returns `[]` when nothing warrants
 * attention. The switch is exhaustive (a new kind is a compile-time error).
 */
export function attentionSignalsFor(event: SellerOpsEvent): AttentionSignal[] {
  const summary = sanitizedSummaryFor(event);
  switch (summary.kind) {
    case "review":
      return reviewSignals(summary);
    case "cs_inquiry":
      return inquirySignals(summary);
    case "order_shipping":
      return orderSignals(summary);
    case "claim":
      return claimSignals(summary);
    case "sales_context":
      return salesContextSignals(summary);
    default:
      return assertNever(summary);
  }
}
