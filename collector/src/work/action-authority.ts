/**
 * **Action authority** (pure, offline) — WHO may drive an action, kept separate from data VISIBILITY.
 *
 * A {@link DataGrant} governs read visibility only (`data-grant.ts` / `access.ts`). Authority is a distinct
 * axis: even a manufacturer with a valid read grant may NOT directly create an executable seller-channel
 * action. The rules, by the action's side-effect class:
 *
 *  - **INTERNAL** (`CLASSIFY_SIGNAL`, `CREATE_INTERNAL_TASK`) — no external side effect; the work-item owner
 *    (seller or manufacturer) may drive it.
 *  - **SELLER_ACTION_REQUEST** (`REQUEST_SELLER_ACTION`) — a manufacturer asking a seller to act. Only a
 *    manufacturer, on their own work item, may create it. It is NOT a seller-channel side effect; the seller
 *    still acts separately on their own work item (delegated manufacturer execution is deliberately NOT
 *    implemented).
 *  - **SELLER_CHANNEL_WRITE** (inquiry/review reply, order/shipment change, cancellation/refund/claim, any
 *    external channel write) — an external write on the seller's channel. Requires a SELLER-owned work item
 *    and the owning seller as actor. A manufacturer can never create one.
 */

import type { ActionKind, Party, WorkItem } from "./types";
import { samePartyAs } from "./types";

/** The side-effect class of an action — the axis authority is decided on. */
export type ActionEffectClass = "INTERNAL" | "SELLER_ACTION_REQUEST" | "SELLER_CHANNEL_WRITE";

const EFFECT_CLASS: Readonly<Record<ActionKind, ActionEffectClass>> = {
  CLASSIFY_SIGNAL: "INTERNAL",
  CREATE_INTERNAL_TASK: "INTERNAL",
  REQUEST_SELLER_ACTION: "SELLER_ACTION_REQUEST",
  POST_INQUIRY_REPLY: "SELLER_CHANNEL_WRITE",
  POST_REVIEW_REPLY: "SELLER_CHANNEL_WRITE",
  CHANGE_ORDER_OR_SHIPMENT: "SELLER_CHANNEL_WRITE",
  ISSUE_CANCELLATION_REFUND_OR_CLAIM: "SELLER_CHANNEL_WRITE",
  EXTERNAL_CHANNEL_WRITE: "SELLER_CHANNEL_WRITE",
};

export function effectClassOf(kind: ActionKind): ActionEffectClass {
  return EFFECT_CLASS[kind];
}

/** Why action authority was denied. */
export type AuthorityDenyReason =
  | "NOT_OWNER"
  | "MANUFACTURER_CANNOT_WRITE_SELLER_CHANNEL"
  | "SELLER_CHANNEL_REQUIRES_SELLER_OWNER"
  | "ONLY_MANUFACTURER_MAY_REQUEST_SELLER_ACTION";

export type AuthorityDecision = { authorized: true } | { authorized: false; reason: AuthorityDenyReason };

/**
 * Decide whether `actor` may drive an action of `kind` on `workItem`. Enforces the ownership + role rules
 * above; a manufacturer is structurally barred from a seller-channel write (they must `REQUEST_SELLER_ACTION`
 * instead).
 */
export function authorizeAction(actor: Party, workItem: WorkItem, kind: ActionKind): AuthorityDecision {
  const owns = samePartyAs(actor, workItem.owner);
  const cls = effectClassOf(kind);
  switch (cls) {
    case "INTERNAL":
      return owns ? { authorized: true } : { authorized: false, reason: "NOT_OWNER" };
    case "SELLER_ACTION_REQUEST":
      if (actor.role !== "MANUFACTURER") return { authorized: false, reason: "ONLY_MANUFACTURER_MAY_REQUEST_SELLER_ACTION" };
      return owns ? { authorized: true } : { authorized: false, reason: "NOT_OWNER" };
    case "SELLER_CHANNEL_WRITE":
      if (workItem.owner.role !== "SELLER") return { authorized: false, reason: "SELLER_CHANNEL_REQUIRES_SELLER_OWNER" };
      if (actor.role === "MANUFACTURER") return { authorized: false, reason: "MANUFACTURER_CANNOT_WRITE_SELLER_CHANNEL" };
      return owns ? { authorized: true } : { authorized: false, reason: "NOT_OWNER" };
    default: {
      const _exhaustive: never = cls;
      return _exhaustive;
    }
  }
}
