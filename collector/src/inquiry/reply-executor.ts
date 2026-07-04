/**
 * **Injected inquiry reply executor** (seam only — no implementation).
 *
 * The seam that performs the approved Seller-channel inquiry reply. There is deliberately NO implementation
 * here — no NAVER/ESM write, no connector, no browser, no HTTP. Production wires a real executor behind this
 * interface; tests inject a fake.
 *
 * Contract:
 *  - the raw approved reply text is passed ONLY inside the clearly seller-private `sellerPrivate` field; the
 *    rest of the input is sanitized (references + hashes). The executor never logs, echoes, or returns the
 *    raw text — it returns only a sanitized {@link InquiryReplyExecutionOutcome};
 *  - it is keyed by `actionIdempotencyKey` (the ActionIntent id) AND bound to `approvedReplyHash`: replaying
 *    the SAME key + hash must NOT create a second side effect, and reusing the same key with a DIFFERENT
 *    reply hash must be rejected/surfaced as `CONFLICT` — the production executor enforces this exactly-once;
 *  - `UNKNOWN` means "could not confirm whether the write landed" — the caller must verify, and must NEVER
 *    blindly auto-retry the write.
 */

import type { CommerceChannel } from "../connection/sync-state";

export interface InquiryReplyExecutionInput {
  connectionId: string;
  channel: CommerceChannel;
  /** The channel-side inquiry reference to reply to (from the signal's seller-private `channelSourceRef`). */
  channelInquiryRef: string;
  /** The ActionIntent id — the executor dedups side effects on this key. */
  actionIdempotencyKey: string;
  /** Hash of the normalized approved reply — bound to the idempotency key for exactly-once enforcement. */
  approvedReplyHash: string;
  /** Clearly seller-private: the raw approved reply the executor posts; never logged or returned. */
  sellerPrivate: { replyPayload: string };
}

/**
 * Sanitized execution status. `CONFLICT` = the idempotency key was reused with a different reply hash (a
 * safety rejection); never a raw-text carrier.
 */
export type InquiryExecutionStatus = "EXECUTED" | "NOT_EXECUTED" | "UNKNOWN" | "CONFLICT";

/** Sanitized execution outcome — coarse category only, never the raw reply text. */
export interface InquiryReplyExecutionOutcome {
  status: InquiryExecutionStatus;
  outcomeCategory: string;
}

export interface InquiryReplyExecutor {
  execute(input: InquiryReplyExecutionInput): Promise<InquiryReplyExecutionOutcome>;
}
