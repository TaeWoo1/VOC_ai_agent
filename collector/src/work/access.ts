/**
 * **Signal visibility / projection** (pure, offline).
 *
 * The read-side enforcement of ownership + grants. A seller sees their OWN signals in full (including the
 * seller-private order/customer references). Any other seller sees nothing. A manufacturer sees a seller's
 * signal ONLY through an active scoped {@link DataGrant}, and the seller-private references are stripped
 * unless the grant explicitly includes them. A revoked or expired grant projects to "not visible".
 *
 * This module never mutates and never reads a wall clock — grant time bounds are checked against the
 * caller-supplied `referenceTimeMs`.
 */

import type { CommerceSignal, Party, PartyRole, ProductRef, SignalKind, SignalSellerPrivate, SignalShareable, WorkItem, WorkItemPhase } from "./types";
import { samePartyAs } from "./types";
import { evaluateGrant, type DataGrant, type GrantAccessRequest, type GrantDenyReason } from "./data-grant";
import type { CommerceChannel } from "../connection/sync-state";

/** A signal as a specific viewer is allowed to see it. `sellerPrivate` is null when withheld. */
export interface VisibleSignal {
  signalId: string;
  channel: CommerceChannel;
  kind: SignalKind;
  productRef: ProductRef | null;
  shareable: SignalShareable;
  /** Present only for the owning seller, or a manufacturer with a seller-private field grant. */
  sellerPrivate: SignalSellerPrivate | null;
}

/** Why a signal is not visible to a viewer. */
export type SignalDenyReason = "NOT_OWNER" | GrantDenyReason;

/** The projection outcome for one viewer. */
export type SignalView =
  | { visible: true; signal: VisibleSignal }
  | { visible: false; reason: SignalDenyReason };

function fullView(signal: CommerceSignal, sellerPrivate: SignalSellerPrivate | null): SignalView {
  return {
    visible: true,
    signal: {
      signalId: signal.signalId,
      channel: signal.channel,
      kind: signal.kind,
      productRef: signal.productRef,
      shareable: signal.shareable,
      sellerPrivate,
    },
  };
}

/** Build the grant access request for reading a signal (optionally needing seller-private fields). */
function readRequestFor(signal: CommerceSignal, manufacturerId: string, needsSellerPrivateFields: boolean): GrantAccessRequest {
  return {
    sellerId: signal.sellerId,
    manufacturerId,
    channel: signal.channel,
    productId: signal.productRef?.productId ?? null,
    signalKind: signal.kind,
    needsSellerPrivateFields,
  };
}

/**
 * Project a signal for a viewer at `referenceTimeMs`:
 *  - the owning seller → full signal (seller-private included);
 *  - any other seller → not visible (`NOT_OWNER`);
 *  - a manufacturer → visible only if an active grant covers the base read; the seller-private references
 *    are included only if the grant ALSO covers seller-private fields, else stripped to null.
 */
export function projectSignalForViewer(
  signal: CommerceSignal,
  viewer: Party,
  grant: DataGrant | null,
  referenceTimeMs: number,
): SignalView {
  if (viewer.role === "SELLER") {
    return samePartyAs(viewer, { role: "SELLER", partyId: signal.sellerId })
      ? fullView(signal, signal.sellerPrivate)
      : { visible: false, reason: "NOT_OWNER" };
  }

  // Manufacturer: needs an active grant covering the base (non-private) read.
  const base = evaluateGrant(grant, readRequestFor(signal, viewer.partyId, false), referenceTimeMs);
  if (!base.allowed) return { visible: false, reason: base.reason };

  // Seller-private references are included only when the grant also covers them.
  const withPrivate = evaluateGrant(grant, readRequestFor(signal, viewer.partyId, true), referenceTimeMs);
  return fullView(signal, withPrivate.allowed ? signal.sellerPrivate : null);
}

// ── Manufacturer work-item projection ────────────────────────────────────────────────────────────────

/** A work item as a viewer is allowed to see it — sanitized, coarse fields only. */
export interface VisibleWorkItem {
  workItemId: string;
  ownerRole: PartyRole;
  channel: CommerceChannel;
  productRef: ProductRef | null;
  kind: SignalKind;
  phase: WorkItemPhase;
}

export type WorkItemView = { visible: true; workItem: VisibleWorkItem } | { visible: false; reason: SignalDenyReason };

function redactWorkItem(workItem: WorkItem): VisibleWorkItem {
  return { workItemId: workItem.workItemId, ownerRole: workItem.owner.role, channel: workItem.channel, productRef: workItem.productRef, kind: workItem.kind, phase: workItem.phase };
}

/**
 * Project a manufacturer-derived work item for a viewer at `referenceTimeMs`. The source seller always sees
 * work derived from their own data. A manufacturer sees a work item ONLY through an active scoped grant on
 * the underlying seller data (re-evaluated here, so a revoked / expired grant redacts to not-visible), and
 * only for a work item it owns.
 */
export function projectWorkItemForViewer(
  workItem: WorkItem,
  viewer: Party,
  grant: DataGrant | null,
  referenceTimeMs: number,
): WorkItemView {
  if (viewer.role === "SELLER") {
    return viewer.partyId === workItem.sourceSellerId ? { visible: true, workItem: redactWorkItem(workItem) } : { visible: false, reason: "NOT_OWNER" };
  }
  const decision = evaluateGrant(
    grant,
    { sellerId: workItem.sourceSellerId, manufacturerId: viewer.partyId, channel: workItem.channel, productId: workItem.productRef?.productId ?? null, signalKind: workItem.kind, needsSellerPrivateFields: false },
    referenceTimeMs,
  );
  if (!decision.allowed) return { visible: false, reason: decision.reason };
  if (!samePartyAs(viewer, workItem.owner)) return { visible: false, reason: "NOT_OWNER" };
  return { visible: true, workItem: redactWorkItem(workItem) };
}
