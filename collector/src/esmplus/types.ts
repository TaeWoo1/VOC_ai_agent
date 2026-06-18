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
