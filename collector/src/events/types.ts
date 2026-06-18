/**
 * Unified SellerOps event model (offline).
 *
 * The platform-specific normalizers each produce their own `SellerOps*Event`. This
 * module unifies them into ONE discriminated union (`SellerOpsEvent`, keyed on
 * `kind`) plus a matching union of their sanitized summaries. It is the bridge from
 * platform-specific normalization to the product layer that will answer "what should
 * the seller pay attention to today?".
 *
 * Types only — no I/O, no network, no secrets, no AI, no scoring. This layer defines
 * the input boundary; it does not compute priority and does not collect anything.
 */

import type {
  SanitizedReviewSummary,
  SellerOpsReviewEvent,
} from "../review/types";
import type {
  SanitizedClaimSummary,
  SanitizedInquirySummary,
  SanitizedOrderSummary,
  SanitizedSalesContextSummary,
  SellerOpsClaimEvent,
  SellerOpsInquiryEvent,
  SellerOpsOrderEvent,
  SellerOpsSalesContextEvent,
} from "../esmplus/types";

/** The discriminant shared by every normalized event — matches each event's `kind`. */
export type SellerOpsEventKind =
  | "review"
  | "cs_inquiry"
  | "order_shipping"
  | "claim"
  | "sales_context";

/**
 * One normalized operational signal from any platform/area. Discriminated on `kind`,
 * so a `switch (event.kind)` narrows to the concrete event type.
 */
export type SellerOpsEvent =
  | SellerOpsReviewEvent
  | SellerOpsInquiryEvent
  | SellerOpsOrderEvent
  | SellerOpsClaimEvent
  | SellerOpsSalesContextEvent;

/** The log-safe summary union — one sanitized shape per event kind. */
export type SellerOpsSanitizedSummary =
  | SanitizedReviewSummary
  | SanitizedInquirySummary
  | SanitizedOrderSummary
  | SanitizedClaimSummary
  | SanitizedSalesContextSummary;
