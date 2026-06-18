/**
 * Pure normalizer: a raw (synthetic) ESM Plus order/shipping row → the common
 * `SellerOpsOrderEvent`. No network, no fs, no browser, no env — a data transform,
 * fully offline-testable against synthetic fixtures.
 *
 * PII discipline: the raw order may carry buyer/recipient name, phone, email, and
 * address. Those are DROPPED here and never copied into the normalized event. The
 * event keeps only operational reference codes (order/product/shipment), the
 * product title, quantity, status, channel, and timestamps. No seller identity.
 */

import { createHash } from "node:crypto";
import type {
  EsmChannel,
  OrderStatus,
  SanitizedOrderSummary,
  SellerOpsOrderEvent,
} from "./types";

/**
 * Raw synthetic ESM order shape (loose — optional, possibly wrong-typed). Stand-in
 * for an official API row; NOT real data. Buyer/recipient identity fields are
 * accepted but intentionally NOT mapped into the normalized event.
 */
export interface RawEsmOrder {
  orderNo?: string | number | null;
  siteGubun?: string | null;
  orderStatus?: string | null;
  orderDt?: string | null;
  updateDt?: string | null;
  itemNo?: string | number | null;
  shipmentNo?: string | number | null;
  itemName?: string | null;
  quantity?: string | number | null;
  // Buyer/recipient identity — accepted in the raw shape but DROPPED.
  buyerName?: string | null;
  buyerId?: string | null;
  buyerPhone?: string | null;
  buyerEmail?: string | null;
  receiverName?: string | null;
  receiverPhone?: string | null;
  receiverAddress?: string | null;
}

function trimOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
}

function refOrNull(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return trimOrNull(v);
}

function quantityOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const t = v.trim();
    if (/^-?\d+$/.test(t)) {
      const n = Number(t);
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

function channelOf(siteGubun: unknown): EsmChannel {
  const s = typeof siteGubun === "string" ? siteGubun.trim().toLowerCase() : "";
  if (s === "gmarket" || s === "gmkt") return "gmarket";
  if (s === "auction" || s === "ac") return "auction";
  if (s === "esmplus" || s === "esm") return "esmplus";
  return "unknown";
}

/**
 * Conservative status mapping from a free-form order-status label. Defaults to
 * `unknown` (absent or unmapped) — never guesses a specific lifecycle state.
 */
function statusOf(raw: unknown): OrderStatus {
  const t = trimOrNull(raw);
  if (t === null) return "unknown";
  const lower = t.toLowerCase();
  if (/배송완료|delivered/.test(lower)) return "delivered";
  if (/배송중|배송|shipped|in_?transit|배송시작/.test(lower)) return "shipped";
  if (/취소|cancel/.test(lower)) return "cancelled";
  if (/준비|preparing|발송준비|상품준비/.test(lower)) return "preparing";
  if (/신규|new|주문접수|결제완료/.test(lower)) return "new_order";
  return "unknown";
}

/** Stable id: prefer the order number; else a content hash from non-PII fields. */
function eventIdFor(channel: EsmChannel, orderNo: unknown, raw: RawEsmOrder): string {
  const no = refOrNull(orderNo);
  if (no !== null) return `esmplus:${channel}:order:${no}`;
  const basis = JSON.stringify([
    refOrNull(raw.itemNo) ?? "",
    refOrNull(raw.shipmentNo) ?? "",
    trimOrNull(raw.itemName) ?? "",
    trimOrNull(raw.orderDt) ?? "",
  ]);
  const hash = createHash("sha256").update(basis, "utf8").digest("hex").slice(0, 16);
  return `esmplus:${channel}:order:h:${hash}`;
}

/** Normalize one raw ESM order into a `SellerOpsOrderEvent`. Buyer/recipient PII is dropped. */
export function normalizeEsmOrder(raw: RawEsmOrder): SellerOpsOrderEvent {
  const channel = channelOf(raw.siteGubun);
  return {
    eventId: eventIdFor(channel, raw.orderNo, raw),
    platform: "ESM_PLUS",
    kind: "order_shipping",
    channel,
    status: statusOf(raw.orderStatus),
    orderedAt: trimOrNull(raw.orderDt),
    updatedAt: trimOrNull(raw.updateDt),
    productRef: refOrNull(raw.itemNo),
    orderRef: refOrNull(raw.orderNo),
    shipmentRef: refOrNull(raw.shipmentNo),
    title: trimOrNull(raw.itemName),
    quantity: quantityOrNull(raw.quantity),
  };
}

/** Log-safe summary — categories/booleans only; never refs, ids, content, or PII. */
export function sanitizedOrderSummary(event: SellerOpsOrderEvent): SanitizedOrderSummary {
  return {
    platform: event.platform,
    kind: event.kind,
    channel: event.channel,
    status: event.status,
    hasOrderRef: event.orderRef !== null,
    hasProductRef: event.productRef !== null,
    hasShipmentRef: event.shipmentRef !== null,
    hasTitle: event.title !== null,
    hasQuantity: event.quantity !== null,
    hasOrderedAt: event.orderedAt !== null,
    hasUpdatedAt: event.updatedAt !== null,
  };
}
