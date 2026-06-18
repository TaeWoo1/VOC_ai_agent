/**
 * ESM Plus capability map + integration assumptions (feasibility, offline).
 *
 * Honest defaults: areas we expect to integrate via official APIs are `planned`;
 * review support is `unknown` until verified against official docs (never claimed
 * as supported). The first product milestone targets CS/inquiry, not reviews.
 * No secrets, seller IDs, or API keys live here — only doc-level notes.
 */

import type { EsmCapability, EsmCapabilityArea } from "./types";

/**
 * Capability map. `support` is a feasibility estimate, NOT a verified claim.
 * `cs_inquiry` is the single first-milestone target; `review` is `unknown`.
 */
export const ESM_CAPABILITIES: readonly EsmCapability[] = [
  {
    area: "cs_inquiry",
    support: "planned",
    isFirstMilestoneTarget: true,
    note: "First milestone: seller CS inquiries prioritized over reviews; API-first.",
  },
  {
    area: "product",
    support: "planned",
    isFirstMilestoneTarget: false,
    note: "Expected via official product API.",
  },
  {
    area: "order_shipping",
    support: "planned",
    isFirstMilestoneTarget: false,
    note: "Expected via official order/shipping API.",
  },
  {
    area: "claim",
    support: "planned",
    isFirstMilestoneTarget: false,
    note: "Cancel/return/exchange claims expected via official API.",
  },
  {
    area: "settlement",
    support: "planned",
    isFirstMilestoneTarget: false,
    note: "Settlement/payout data expected via official API.",
  },
  {
    area: "service",
    support: "planned",
    isFirstMilestoneTarget: false,
    note: "Seller 'service' area visible in the ESM Trading API guide; scope TBD.",
  },
  {
    area: "star_delivery",
    support: "planned",
    isFirstMilestoneTarget: false,
    note: "Star-delivery (스타배송) area visible in the ESM Trading API guide; scope TBD.",
  },
  {
    area: "review",
    support: "unknown",
    isFirstMilestoneTarget: false,
    note: "Not in the ESM Trading API guide's confirmed areas — review API support UNCONFIRMED; do not model collection until verified.",
  },
];

/** Look up a capability by area. */
export function capabilityFor(area: EsmCapabilityArea): EsmCapability | undefined {
  return ESM_CAPABILITIES.find((c) => c.area === area);
}

/** The single area this milestone targets first (CS/inquiry). */
export function firstMilestoneTarget(): EsmCapability {
  const target = ESM_CAPABILITIES.find((c) => c.isFirstMilestoneTarget);
  // The map is a constant with exactly one first target; this is total.
  if (target === undefined) throw new Error("esmplus: no first-milestone target configured");
  return target;
}

/**
 * Primary documentation reference for ESM Plus integration (docs context only —
 * never called live from this layer).
 */
export const ESM_TRADING_API_GUIDE_URL = "https://etapi.gmarket.com/pages/API-가이드";

/**
 * Integration assumptions — doc-level, sanitized, derived from the ESM Trading API
 * guide. ESM Plus is API-first; live use will require seller membership, an ESM+
 * Master ID, API permission/approval, and key/JWT-based auth. NONE of that is
 * present, approved, or modeled yet; no credentials or secrets live in the repo.
 */
export const ESM_INTEGRATION_ASSUMPTIONS: readonly string[] = [
  "Primary reference: the official ESM Trading API guide (ESM_TRADING_API_GUIDE_URL) — docs context only, not called live.",
  "API-first: model ESM Plus / Gmarket / Auction via official seller APIs, not browser collection.",
  "Live API access appears to require: Gmarket/Auction seller membership, an ESM+ Master ID, API permission/application approval, and key/JWT-based authentication.",
  "Allowed-IP / key-permission registration is likely required; treat it as a setup prerequisite, not something already in place.",
  "Store no raw seller identity, Master ID, or API key/JWT in logs or the repo; no credentials are present here.",
  "Review API support is unconfirmed (not among the guide's confirmed areas); do not implement review collection until verified.",
  "First milestone is CS/inquiry normalization, validated offline with synthetic fixtures.",
];
