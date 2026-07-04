/**
 * **Inquiry intake adapter** (pure, offline).
 *
 * Converts a channel-neutral {@link InquiryObservation} into a **seller-owned** {@link CommerceSignal} and
 * opens exactly one seller {@link WorkItem} for it. The privacy split is the whole point:
 *  - raw inquiry text / order reference stay SELLER-PRIVATE — the raw values live only in the seller-visible
 *    {@link SellerInquiryContext} (fed to the drafting provider); the signal carries only a ONE-WAY hash of
 *    the order reference (never the raw order id, never the inquiry text, never customer identity);
 *  - only safe product/VOC metadata (product ref, coarse topic + severity) goes into the shareable
 *    projection a granted manufacturer could ever see.
 *
 * **Deterministic ids from the channel source identity.** Every id — signal, work item, and the open/propose
 * command ids — is a pure SHA-256 function of `(channel, connectionId, channelInquiryId)`, so re-ingesting
 * the same observation yields identical ids and the coordinator's dedup/idempotency becomes trivial. A
 * different connection ⇒ a different source key ⇒ an isolated work item, even for the same channel inquiry id.
 *
 * Recency for `cs_inquiry` is deferred per the collector recency rules, so the shareable `recencyBucket` is
 * `unknown` (the raw `observedAt` never becomes a coarse bucket here). No network, fs, connector, or clock —
 * `node:crypto` hashing only.
 */

import { createHash } from "node:crypto";

import type { CommerceSignal, TransitionOutcome } from "../work/types";
import { openSellerWorkItem } from "../work/work-item";
import { projectSignalForViewer } from "../work/access";
import type { InquiryObservation } from "./observation";
import type { SellerInquiryContext } from "./proposal-provider";

/** Deterministic 16-hex id from a field array (array form avoids separator ambiguity). */
function hash16(parts: readonly unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16);
}

/** The deterministic id set derived from an observation's channel source identity. */
export interface InquirySourceIds {
  /** Hash of `(channel, connectionId, channelInquiryId)` — the isolation/dedup key. */
  sourceKey: string;
  signalId: string;
  workItemId: string;
  openCommandId: string;
  proposalId: string;
  proposeCommandId: string;
}

/** Derive all ids from the channel source identity — pure and stable across re-ingestion. */
export function deriveSourceIds(obs: InquiryObservation): InquirySourceIds {
  const sourceKey = hash16([obs.channel, obs.connectionId, obs.channelInquiryId]);
  return {
    sourceKey,
    signalId: `sig-${sourceKey}`,
    workItemId: `wi-${sourceKey}`,
    openCommandId: `cmd-open-${sourceKey}`,
    proposalId: `prop-${sourceKey}`,
    proposeCommandId: `cmd-propose-${sourceKey}`,
  };
}

/**
 * A content fingerprint over the WHOLE observation. Two observations that share a source identity but differ
 * in content produce different fingerprints — the coordinator uses this to reject conflicting reuse of a
 * source identity while treating an identical re-ingestion as an idempotent replay.
 */
export function observationFingerprint(obs: InquiryObservation): string {
  return hash16([
    obs.sellerId,
    obs.connectionId,
    obs.channel,
    obs.channelInquiryId,
    obs.productId,
    obs.orderRef,
    obs.inquiryText,
    obs.observedAt,
    obs.responseDeadlineAt,
    obs.category.topicCategory,
    obs.category.severityBucket,
  ]);
}

/**
 * Build the seller-owned signal. The shareable projection keeps ONLY safe product/VOC metadata; the raw
 * operational values (inquiry text, order ref, channel inquiry ref, deadline) are PRESERVED in
 * `sellerPrivate` — visible only to the seller (or a field-granted manufacturer) — with an order-ref hash
 * retained additionally for matching (never as the sole value).
 */
export function toInquirySignal(obs: InquiryObservation, ids: InquirySourceIds): CommerceSignal {
  return {
    signalId: ids.signalId,
    channel: obs.channel,
    kind: "cs_inquiry",
    sellerId: obs.sellerId,
    productRef: { productId: obs.productId },
    // Shareable = safe product/VOC metadata only; recency for cs_inquiry is deferred → unknown.
    shareable: { severityBucket: obs.category.severityBucket, topicCategory: obs.category.topicCategory, recencyBucket: "unknown" },
    // Seller-private = raw operational values (for later drafting/execution) + an additional order-ref hash.
    sellerPrivate: {
      sourceText: obs.inquiryText,
      orderRef: obs.orderRef,
      channelSourceRef: obs.channelInquiryId,
      responseDeadlineAt: obs.responseDeadlineAt,
      orderRefHash: obs.orderRef !== null ? hash16(["order", obs.channel, obs.connectionId, obs.orderRef]) : null,
      customerRefHash: null,
    },
  };
}

/**
 * Reconstruct the seller-visible provider context from the created signal — via its SELLER projection, not
 * the original observation. `projectSignalForViewer` returns the owning seller the full view (including the
 * raw `sellerPrivate`), so the provider input is derivable solely from the `CommerceSignal`. Returns null if
 * the signal is not a reconstructable inquiry (no product ref / stripped seller-private / missing text).
 */
export function sellerContextFromSignal(signal: CommerceSignal): SellerInquiryContext | null {
  const view = projectSignalForViewer(signal, { role: "SELLER", partyId: signal.sellerId }, null, 0);
  if (!view.visible || view.signal.sellerPrivate === null) return null;
  const productId = view.signal.productRef?.productId;
  const sp = view.signal.sellerPrivate;
  if (productId === undefined || sp.sourceText === null) return null;
  return {
    sellerId: signal.sellerId,
    channel: view.signal.channel,
    productId,
    orderRef: sp.orderRef,
    inquiryText: sp.sourceText,
    category: { topicCategory: view.signal.shareable.topicCategory, severityBucket: view.signal.shareable.severityBucket },
    responseDeadlineAt: sp.responseDeadlineAt,
  };
}

/** Open exactly one seller work item for this inquiry signal, with deterministic ids and caller-supplied `atMs`. */
export function openInquiryWorkItem(signal: CommerceSignal, ids: InquirySourceIds, sellerId: string, atMs: number): TransitionOutcome {
  return openSellerWorkItem(signal, { commandId: ids.openCommandId, workItemId: ids.workItemId, actor: { role: "SELLER", partyId: sellerId }, atMs });
}
