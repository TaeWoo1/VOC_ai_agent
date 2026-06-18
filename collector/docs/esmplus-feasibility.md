# ESM Plus — feasibility & spec (offline)

> **Offline feasibility layer — no live API calls.** No ESM credentials, seller/
> master IDs, or store data exist or are modeled here. Secrets never live in the
> repo. This documents the intended shape before any integration work.

## Primary reference

The official **ESM Trading API guide** is the primary reference going forward:
<https://etapi.gmarket.com/pages/API-가이드> (in code:
`ESM_TRADING_API_GUIDE_URL`). It is used as **documentation context only** — no
live API calls are made from this layer.

For *how access is obtained* (seller-owned pilot vs. approved selling-tool
provider vs. browser/export fallback), the recommended SellerOps path, and the
open questions for ESM support, see **`esmplus-access-model.md`**.

## Platform

ESM Plus is the unified seller console for **Gmarket** and **Auction** (eBay
Korea). Unlike NAVER (no official review API → export-based collection), ESM Plus
is treated as **API-first**: seller data is expected from official APIs, not
browser automation. No browser collection is modeled for ESM Plus.

## Capability map

API areas visible in the ESM Trading API guide: **product, order/shipping, claim,
settlement, CS, service, star-delivery**. `review` is not among the guide's
confirmed areas. Support levels below are feasibility estimates, not verified
claims; `unknown` is the honest default until confirmed.

| Area | Support | First milestone | Note |
|------|---------|-----------------|------|
| `cs_inquiry` | planned | **yes** | First milestone — seller CS inquiries prioritized over reviews. |
| `product` | planned | no | Visible in the guide; via official product API. |
| `order_shipping` | planned | no | Visible in the guide; order/shipping API. |
| `claim` | planned | no | Cancel/return/exchange claims; via official API. |
| `settlement` | planned | no | Settlement/payout; via official API. |
| `service` | planned | no | Seller "service" area visible in the guide; scope TBD. |
| `star_delivery` | planned | no | Star-delivery (스타배송) area visible in the guide; scope TBD. |
| `review` | **unknown** | no | Not among the guide's confirmed areas — support **UNCONFIRMED**; do not model collection until verified. |

Source of truth in code: `src/esmplus/capabilities.ts` (`ESM_CAPABILITIES`,
`capabilityFor`, `firstMilestoneTarget`).

## Integration assumptions (from the guide)

- **API-first**: model ESM Plus / Gmarket / Auction via official seller APIs, not browser collection.
- Live API access appears to require: **Gmarket/Auction seller membership**, an **ESM+ Master ID**, **API permission / application approval**, and **key/JWT-based authentication**.
- **Allowed-IP / key-permission** registration is likely a setup prerequisite — not something already in place.
- Store **no** raw seller identity, Master ID, or API key/JWT in logs or the repo; **no credentials are present here**.
- Review API support is unconfirmed; no review collection until verified.
- First milestone is **CS/inquiry** normalization, validated offline with synthetic fixtures.

## First milestone — CS inquiry normalization

A pure normalizer maps a raw (synthetic) ESM inquiry to the common
`SellerOpsInquiryEvent` (`src/esmplus/types.ts`,
`src/esmplus/inquiry-normalizer.ts`):

- **Carries** (VOC-relevant, non-PII): `eventId`, `platform`, `kind`, `channel`
  (gmarket/auction/esmplus/unknown), `category`
  (product / delivery / cancel_refund_exchange / other / unknown), `status`
  (open / answered / unknown), `title`, `body`, `createdAt`, `productRef`,
  `orderRef`.
- **Drops** (PII): buyer name / id / contact — never copied into the event.
- **Optional-safe**: missing fields → `null`/`unknown`; a stable id is derived
  from the inquiry number, or a content hash when absent.
- `sanitizedInquirySummary` is the log-safe view — categories/booleans only,
  never content, refs, ids, or PII.

## Normalized event shapes (offline)

CS/inquiry remains the **first milestone**. Additional normalized shapes + pure
normalizers now exist, all fixture-only:

- **Order/shipping** — `SellerOpsOrderEvent` (`src/esmplus/order-normalizer.ts`,
  `normalizeEsmOrder` / `sanitizedOrderSummary`): status
  (new_order/preparing/shipped/delivered/cancelled/unknown), order/product/shipment
  refs, title, quantity.
- **Claim** — `SellerOpsClaimEvent` (`src/esmplus/claim-normalizer.ts`,
  `normalizeEsmClaim` / `sanitizedClaimSummary`): claim type
  (cancel/return/exchange/refund/unknown), status, reason category, order/product/
  claim refs, reason text.

All normalizers drop buyer/recipient PII (name, id, phone, email, address) and
carry only operational reference codes; sanitized summaries expose categories/
booleans only. Deterministic `eventId` (row id, or a `JSON.stringify`-based content
hash when absent). The **live ESM API client / auth / JWT remains deferred** — no
credentials, no live calls.

## Out of scope (now)

Live ESM API calls · credentials/seller IDs · backend · DB · upload · browser
automation · RUN_INTEGRATION · review collection. NAVER live work is separately
**paused** (see `connection-onboarding.md`).
