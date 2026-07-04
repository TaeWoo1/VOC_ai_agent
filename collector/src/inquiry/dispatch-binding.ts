/**
 * **Deterministic dispatch binding** (pure, offline).
 *
 * Derives one `dispatchBindingHash` over the immutable approved-action envelope — action intent id, action
 * kind, connection id, channel, channel inquiry reference, and the approved-reply HASH. The raw reply never
 * enters this hash (only `approvedReplyHash` does). Fields are canonically **length-delimited** (netstring)
 * before hashing, so no field-boundary ambiguity can let two different envelopes collide. `node:crypto` only.
 */

import { createHash } from "node:crypto";

/** The immutable envelope a dispatch is bound to. `approvedReplyHash` stands in for the raw reply. */
export interface DispatchEnvelope {
  actionIntentId: string;
  actionKind: string;
  connectionId: string;
  channel: string;
  channelInquiryRef: string;
  approvedReplyHash: string;
}

/** Netstring encoding (`<len>:<value>,`) — injective, so distinct field sets never encode the same string. */
function netstring(value: string): string {
  return `${value.length}:${value},`;
}

/** SHA-256 hex over the canonically length-delimited dispatch envelope. */
export function dispatchBindingHash(env: DispatchEnvelope): string {
  const encoded = [env.actionIntentId, env.actionKind, env.connectionId, env.channel, env.channelInquiryRef, env.approvedReplyHash].map(netstring).join("");
  return createHash("sha256").update(encoded, "utf8").digest("hex");
}
