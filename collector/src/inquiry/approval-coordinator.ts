/**
 * **Inquiry approval coordinator** (pure, offline application layer).
 *
 * Turns an approved PROPOSED inquiry into a ready-to-execute slice, BOUND to the exact approved reply:
 *
 *   PROPOSED → Seller Approval → ActionIntent (POST_INQUIRY_REPLY, fingerprinted by the approved-reply hash)
 *
 * It requires the OWNING seller as actor (approval by another seller or a manufacturer → `APPROVAL_DENIED`),
 * approves the proposal through the work-domain `approve` transition, and creates EXACTLY ONE
 * `POST_INQUIRY_REPLY` action intent whose `paramsFingerprint` is the hash of the normalized approved reply.
 * The raw reply text NEVER enters the work-domain aggregate/audit — only the hash does.
 *
 * Binding rules:
 *  - same command/action id + same reply hash → idempotent (the existing intent is returned unchanged);
 *  - same command/action id + a DIFFERENT reply hash → `PAYLOAD_CONFLICT` — a duplicate approval can never
 *    replace the payload already bound to an existing ActionIntent.
 *
 * Never auto-approves. No live call, connector, HTTP, or LLM here.
 */

import { approve as approveProposal, createActionIntent } from "../work/work-item";
import type { Party } from "../work/types";
import type { InquirySlice } from "./coordinator";
import { approvedReplyHash, canonicalizeApprovedReply } from "./reply-hash";
import { dispatchBindingHash } from "./dispatch-binding";
import { executionSliceFrom, lifecycleIds, type InquiryExecutionSlice } from "./execution-coordinator";

const POST_INQUIRY_REPLY = "POST_INQUIRY_REPLY" as const;

export interface ApproveInquiryReplyInput {
  /** The PROPOSED intake slice for the inquiry. */
  slice: InquirySlice;
  /** The actor approving — must be the owning seller. */
  actor: Party;
  /** The connection to execute against later (not present on the sanitized signal). */
  connectionId: string;
  /** The seller-approved reply text (seller-private; hashed for binding, carried raw for the executor). */
  approvedReplyPayload: string;
  atMs: number;
}

/**
 * The approval outcome:
 *  - `APPROVAL_DENIED`  → the actor is not the owning seller (another seller or a manufacturer);
 *  - `NOT_PROPOSED`     → the slice is not in a PROPOSED state ready to approve;
 *  - `PAYLOAD_CONFLICT` → a duplicate approval carried a DIFFERENT reply than the one already bound.
 */
export type ApproveInquiryReplyOutcome =
  | { ok: true; slice: InquiryExecutionSlice; idempotent: boolean }
  | { ok: false; reason: "APPROVAL_DENIED" | "NOT_PROPOSED" | "PAYLOAD_CONFLICT" };

export class InquiryApprovalCoordinator {
  /**
   * First approval: approve the PROPOSED proposal and create the single fingerprinted POST_INQUIRY_REPLY
   * intent, as the owning seller. The reply is CANONICALIZED, and the canonical form is bound as both the
   * intent's `paramsFingerprint` (its hash) and the execution slice's private payload — one canonical value
   * drives the fingerprint, private payload, executor hash, and verifier expected hash. Duplicate approvals
   * go through {@link reaffirm}, which never rebuilds the slice from a new raw payload.
   */
  approve(input: ApproveInquiryReplyInput): ApproveInquiryReplyOutcome {
    const { slice, actor, atMs } = input;
    const ids = lifecycleIds(slice.ids.sourceKey);
    const canonicalReply = canonicalizeApprovedReply(input.approvedReplyPayload);
    const replyHash = approvedReplyHash(canonicalReply);
    const channelInquiryRef = slice.signal.sellerPrivate.channelSourceRef ?? "";
    // The intent fingerprint is the COMPLETE dispatch binding (envelope), not just the reply hash.
    const bindingHash = dispatchBindingHash({
      actionIntentId: ids.actionIntentId,
      actionKind: POST_INQUIRY_REPLY,
      connectionId: input.connectionId,
      channel: slice.signal.channel,
      channelInquiryRef,
      approvedReplyHash: replyHash,
    });

    const approved = approveProposal(slice.aggregate, { commandId: ids.approveCommandId, actor, atMs });
    if (!approved.ok) {
      return approved.error.code === "NOT_OWNER" ? { ok: false, reason: "APPROVAL_DENIED" } : { ok: false, reason: "NOT_PROPOSED" };
    }
    const intent = createActionIntent(approved.aggregate, { commandId: ids.intentCommandId, actionIntentId: ids.actionIntentId, actor, paramsCategory: "inquiry_reply", paramsFingerprint: bindingHash, atMs });
    if (!intent.ok) {
      // A reused intent id with a different fingerprint (different envelope) surfaces as a payload conflict.
      return intent.error.code === "CONFLICT" ? { ok: false, reason: "PAYLOAD_CONFLICT" } : { ok: false, reason: "NOT_PROPOSED" };
    }

    const executionSlice = executionSliceFrom(
      { ids: slice.ids, signal: slice.signal, aggregate: intent.aggregate },
      { connectionId: input.connectionId, channelInquiryRef, approvedReplyPayload: canonicalReply, approvedReplyHash: replyHash, actionIdempotencyKey: ids.actionIntentId },
    );
    return { ok: true, slice: executionSlice, idempotent: approved.idempotent && intent.idempotent };
  }

  /**
   * Duplicate approval on an already-bound execution slice. The attempted reply is canonicalized and hashed;
   * if it matches the bound `approvedReplyHash` the ORIGINAL slice (with its original private payload) is
   * returned unchanged — the private payload is never rebuilt from the new raw text. Any different canonical
   * payload is `PAYLOAD_CONFLICT`; the bound payload can never be replaced.
   */
  reaffirm(bound: InquiryExecutionSlice, attemptedReplyPayload: string): ApproveInquiryReplyOutcome {
    return approvedReplyHash(attemptedReplyPayload) === bound.approvedReplyHash
      ? { ok: true, slice: bound, idempotent: true }
      : { ok: false, reason: "PAYLOAD_CONFLICT" };
  }
}
