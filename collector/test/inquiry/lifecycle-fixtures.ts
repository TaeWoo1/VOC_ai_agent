/**
 * Shared builders for the inquiry approval/execution tests (not a test file — no `.test.` suffix, so vitest
 * does not collect it). Fakes for the executor/verifier seams + a helper to produce a PROPOSED intake slice.
 */

import { InquiryIntakeCoordinator, type InquirySlice } from "../../src/inquiry/coordinator";
import type { InquiryObservation } from "../../src/inquiry/observation";
import type { InquiryProposalProvider } from "../../src/inquiry/proposal-provider";
import type { InquiryReplyExecutor, InquiryReplyExecutionInput, InquiryReplyExecutionOutcome, InquiryExecutionStatus } from "../../src/inquiry/reply-executor";
import type { InquiryReplyVerifier, InquiryReplyVerificationInput, InquiryReplyVerificationOutcome, InquiryVerificationStatus } from "../../src/inquiry/reply-verifier";
import type { Party } from "../../src/work/types";

export const seller = (partyId = "seller-1"): Party => ({ role: "SELLER", partyId });
export const manufacturer = (partyId = "maker-1"): Party => ({ role: "MANUFACTURER", partyId });

/** The raw seller-approved reply used across tests — must never appear in a sanitized outcome. */
export const APPROVED_REPLY = "네, 재고 있습니다. 주문해 주시면 바로 발송드리겠습니다.";

export function observation(over: Partial<InquiryObservation> = {}): InquiryObservation {
  return {
    sellerId: "seller-1",
    connectionId: "conn-1",
    channel: "NAVER",
    channelInquiryId: "INQ-1",
    productId: "prod-1",
    orderRef: "ORDER-9",
    inquiryText: "이 상품 재고 있나요?",
    observedAt: 5,
    responseDeadlineAt: null,
    category: { topicCategory: "stock", severityBucket: "mid" },
    ...over,
  };
}

/** Produce a PROPOSED intake slice via the real intake coordinator + a trivial fake drafting provider. */
export async function proposedSlice(over: Partial<InquiryObservation> = {}): Promise<InquirySlice> {
  const provider: InquiryProposalProvider = { propose: async () => ({ summaryCategory: "stock_reply_draft" }) };
  const out = await new InquiryIntakeCoordinator(provider).ingest(observation(over), 100);
  if (!out.ok) throw new Error(`intake failed: ${out.reason}`);
  return out.slice;
}

/**
 * A fake executor — records inputs and returns a scripted status (default EXECUTED). Enforces the seam
 * contract: reusing the same idempotency key with a DIFFERENT reply hash surfaces `CONFLICT`.
 */
export class FakeExecutor implements InquiryReplyExecutor {
  readonly calls: InquiryReplyExecutionInput[] = [];
  private readonly seen = new Map<string, string>();
  status: InquiryExecutionStatus = "EXECUTED";
  outcomeCategory = "posted";
  async execute(input: InquiryReplyExecutionInput): Promise<InquiryReplyExecutionOutcome> {
    this.calls.push(input);
    const prior = this.seen.get(input.actionIdempotencyKey);
    if (prior !== undefined && prior !== input.approvedReplyHash) return { status: "CONFLICT", outcomeCategory: "idempotency_conflict" };
    this.seen.set(input.actionIdempotencyKey, input.approvedReplyHash);
    return { status: this.status, outcomeCategory: this.outcomeCategory };
  }
}

/**
 * A fake verifier — records inputs. If `observedReplyHash` is set it decides VERIFIED/NOT_VERIFIED by
 * MATCHING the observed hash against the input's `expectedReplyHash` (null → INDETERMINATE); otherwise it
 * returns from the `statuses` queue if set, else the default `status`.
 */
export class FakeVerifier implements InquiryReplyVerifier {
  readonly calls: InquiryReplyVerificationInput[] = [];
  status: InquiryVerificationStatus = "VERIFIED";
  statuses: InquiryVerificationStatus[] = [];
  observedReplyHash: string | null | undefined = undefined;
  checkCategory = "reply_hash_match";
  async verify(input: InquiryReplyVerificationInput): Promise<InquiryReplyVerificationOutcome> {
    this.calls.push(input);
    if (this.observedReplyHash !== undefined) {
      const status: InquiryVerificationStatus = this.observedReplyHash === null ? "INDETERMINATE" : this.observedReplyHash === input.expectedReplyHash ? "VERIFIED" : "NOT_VERIFIED";
      return { status, checkCategory: this.checkCategory };
    }
    const status = this.statuses.length > 0 ? this.statuses.shift()! : this.status;
    return { status, checkCategory: this.checkCategory };
  }
}
