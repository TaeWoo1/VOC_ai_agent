/**
 * ESM Plus (Gmarket + Auction, by eBay Korea) feasibility/spec types.
 *
 * ESM Plus is the unified seller console for Gmarket and Auction. Unlike NAVER
 * (no official review API → export-based collection), ESM Plus is treated as
 * **API-first**: product / order / claim / settlement / CS-inquiry data is
 * expected to come from official seller APIs, not browser automation. Review
 * support is UNCONFIRMED until verified against official docs.
 *
 * This module is pure types only — no I/O, no network, no secrets. No raw seller
 * identity, API key, master/seller ID, or customer PII belongs in this layer.
 */

/** Platform tag for normalized SellerOps events from ESM Plus. */
export type EsmPlatform = "ESM_PLUS";

/** ESM unifies two marketplaces; an event may originate from either (or be unknown offline). */
export type EsmChannel = "gmarket" | "auction" | "esmplus" | "unknown";

/**
 * Coarse capability areas of the ESM Plus seller surface. Mirrors the areas
 * visible in the official ESM Trading API guide
 * (https://etapi.gmarket.com/pages/API-가이드): product, order/shipping, claim,
 * settlement, CS, service, star-delivery — plus `review`, which the guide does
 * NOT confirm and is therefore tracked as unknown.
 */
export type EsmCapabilityArea =
  | "product"
  | "order_shipping"
  | "claim"
  | "settlement"
  | "cs_inquiry"
  | "service"
  | "star_delivery"
  | "review";

/**
 * How confident we are that an area is integrable. `unknown` is the honest default
 * until verified against official API docs — never claim `supported` speculatively.
 */
export type EsmCapabilitySupport = "planned" | "unknown" | "unsupported";

export interface EsmCapability {
  area: EsmCapabilityArea;
  support: EsmCapabilitySupport;
  /** True for the area this milestone targets first (CS/inquiry). */
  isFirstMilestoneTarget: boolean;
  /** Sanitized, doc-level note — never secrets or raw identity. */
  note: string;
}

// --- Normalized SellerOps inquiry event -----------------------------------

/** Normalized status of a seller CS inquiry. */
export type InquiryStatus = "open" | "answered" | "unknown";

/** Conservative, normalized inquiry category — defaults to `unknown` when unmapped. */
export type InquiryCategory =
  | "product"
  | "delivery"
  | "cancel_refund_exchange"
  | "other"
  | "unknown";

/**
 * The common SellerOps event a CS inquiry normalizes into — platform-agnostic in
 * shape so other platforms can map onto it later. It carries the inquiry CONTENT
 * (title/body) and reference CODES (product/order), which are the VOC value; it
 * deliberately carries NO buyer/customer name, contact, or seller identity — that
 * PII is dropped at normalization, never stored.
 */
export interface SellerOpsInquiryEvent {
  /** Deterministic id: `esmplus:<channel>:<inquiryNo>` or a content hash when absent. */
  eventId: string;
  platform: EsmPlatform;
  kind: "cs_inquiry";
  channel: EsmChannel;
  category: InquiryCategory;
  status: InquiryStatus;
  /** Inquiry title (content), trimmed; null when absent. */
  title: string | null;
  /** Inquiry body (content), trimmed; null when absent. */
  body: string | null;
  /** ISO-ish creation timestamp as provided; null when absent. */
  createdAt: string | null;
  /** Product reference code (not PII); null when absent. */
  productRef: string | null;
  /** Order reference code (not PII); null when absent. */
  orderRef: string | null;
}

/** Log-safe summary of an inquiry event — categories/booleans only, never content/refs/ids. */
export interface SanitizedInquirySummary {
  platform: EsmPlatform;
  kind: "cs_inquiry";
  channel: EsmChannel;
  category: InquiryCategory;
  status: InquiryStatus;
  hasTitle: boolean;
  hasBody: boolean;
  hasProductRef: boolean;
  hasOrderRef: boolean;
  hasCreatedAt: boolean;
}

// --- Normalized SellerOps order/shipping event ----------------------------

/** Normalized lifecycle status of an order/shipment. */
export type OrderStatus =
  | "new_order"
  | "preparing"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "unknown";

/**
 * The common SellerOps event an ESM order/shipping row normalizes into. It carries
 * operational reference CODES (order/product/shipment) and the product title, but
 * NO buyer/recipient identity (name, phone, email, address) and NO seller identity.
 */
export interface SellerOpsOrderEvent {
  eventId: string;
  platform: EsmPlatform;
  kind: "order_shipping";
  channel: EsmChannel;
  status: OrderStatus;
  /** ISO-ish order timestamp as provided; null when absent. */
  orderedAt: string | null;
  /** ISO-ish last-update timestamp as provided; null when absent. */
  updatedAt: string | null;
  productRef: string | null;
  orderRef: string | null;
  shipmentRef: string | null;
  /** Product title (content, not PII); null when absent. */
  title: string | null;
  /** Ordered quantity; null when absent/unparseable. */
  quantity: number | null;
}

/** Log-safe summary of an order event — categories/booleans only, never refs/ids/PII. */
export interface SanitizedOrderSummary {
  platform: EsmPlatform;
  kind: "order_shipping";
  channel: EsmChannel;
  status: OrderStatus;
  hasOrderRef: boolean;
  hasProductRef: boolean;
  hasShipmentRef: boolean;
  hasTitle: boolean;
  hasQuantity: boolean;
  hasOrderedAt: boolean;
  hasUpdatedAt: boolean;
}

// --- Normalized SellerOps claim event -------------------------------------

/** Normalized claim type. */
export type ClaimType = "cancel" | "return" | "exchange" | "refund" | "unknown";

/** Normalized claim lifecycle status. */
export type ClaimStatus = "open" | "in_progress" | "resolved" | "rejected" | "unknown";

/** Conservative, normalized claim-reason category — defaults to `unknown` when unmapped. */
export type ClaimReasonCategory =
  | "delivery"
  | "product"
  | "customer_change"
  | "payment"
  | "other"
  | "unknown";

/**
 * The common SellerOps event an ESM claim row normalizes into. Carries operational
 * reference CODES (order/product/claim) and the claim reason text (content), but NO
 * buyer/recipient identity and NO seller identity.
 */
export interface SellerOpsClaimEvent {
  eventId: string;
  platform: EsmPlatform;
  kind: "claim";
  channel: EsmChannel;
  claimType: ClaimType;
  status: ClaimStatus;
  createdAt: string | null;
  updatedAt: string | null;
  productRef: string | null;
  orderRef: string | null;
  claimRef: string | null;
  reasonCategory: ClaimReasonCategory;
  /** Free-form claim reason (content, not PII); null when absent. */
  reasonText: string | null;
}

/** Log-safe summary of a claim event — categories/booleans only, never content/refs/ids/PII. */
export interface SanitizedClaimSummary {
  platform: EsmPlatform;
  kind: "claim";
  channel: EsmChannel;
  claimType: ClaimType;
  status: ClaimStatus;
  reasonCategory: ClaimReasonCategory;
  hasReasonText: boolean;
  hasOrderRef: boolean;
  hasProductRef: boolean;
  hasClaimRef: boolean;
  hasCreatedAt: boolean;
  hasUpdatedAt: boolean;
}

// --- Normalized SellerOps sales/settlement context event ------------------

/** Normalized currency tag for a sales-context event — `unknown` until confirmed. */
export type SalesCurrency = "KRW" | "unknown";

/**
 * Coarse magnitude bucket for a monetary field. This is the ONLY amount-derived
 * value that may appear in a sanitized summary — it deliberately loses precision
 * so exact, business-sensitive amounts never leak into logs. `unknown` means the
 * amount was absent/unparseable; `zero` means a parsed 0.
 */
export type SalesAmountBucket =
  | "zero"
  | "under_100k"
  | "100k_to_1m"
  | "1m_to_10m"
  | "10m_to_100m"
  | "100m_plus"
  | "unknown";

/**
 * Lightweight operational CONTEXT — not accounting, not a sales dashboard. It exists
 * only to help prioritize reviews / inquiries / claims / product issues (e.g. "this
 * product has high sales and rising claims"). Amounts are normalized straight from
 * source rows; no aggregation, no financial-accuracy claim beyond the source data.
 *
 * Carries a product reference CODE and coarse counts/amounts, but NO buyer PII and
 * NO seller identity (seller id / master id / account id are dropped at
 * normalization, never mapped here).
 */
export interface SellerOpsSalesContextEvent {
  /** Deterministic id: `esmplus:<channel>:sales:<rowId>` or a content hash when absent. */
  eventId: string;
  platform: EsmPlatform;
  kind: "sales_context";
  channel: EsmChannel;
  /** ISO-ish period bounds as provided; null when absent. */
  periodStart: string | null;
  periodEnd: string | null;
  /** Product reference code (not PII); null when absent. */
  productRef: string | null;
  /** Non-negative order count; null when absent/unparseable. */
  orderCount: number | null;
  /** Non-negative claim count; null when absent/unparseable. */
  claimCount: number | null;
  /** Non-negative gross sales amount (source units); null when absent/unparseable. */
  grossSalesAmount: number | null;
  /** Non-negative settlement/payout amount (source units); null when absent/unparseable. */
  settlementAmount: number | null;
  currency: SalesCurrency;
}

/**
 * Log-safe summary of a sales-context event. Monetary fields are business-sensitive,
 * so exact amounts NEVER appear here — only presence booleans and a single coarse
 * `amountBucket` (derived from gross sales). No product/order/seller/buyer identity.
 */
export interface SanitizedSalesContextSummary {
  platform: EsmPlatform;
  kind: "sales_context";
  channel: EsmChannel;
  currency: SalesCurrency;
  hasProductRef: boolean;
  hasPeriod: boolean;
  hasOrderCount: boolean;
  hasClaimCount: boolean;
  hasGrossSalesAmount: boolean;
  hasSettlementAmount: boolean;
  /** Coarse magnitude of gross sales — never the exact amount. */
  amountBucket: SalesAmountBucket;
}
