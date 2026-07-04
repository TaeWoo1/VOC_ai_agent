/**
 * **Injected inquiry reply verifier** (seam only — no implementation).
 *
 * The seam that INDEPENDENTLY checks whether the approved reply is actually visible on the channel — a
 * separate confirmation from the executor's own return value, so execution success alone never completes the
 * work item. No implementation here (no NAVER/ESM read, no connector, no browser, no HTTP); production wires
 * a real verifier, tests inject a fake.
 *
 * It takes only references + the EXPECTED approved-reply hash (never the raw reply text) and returns a
 * sanitized verdict:
 *  - `VERIFIED`       — the reply observed on the channel MATCHES `expectedReplyHash` (not merely that some
 *                       reply exists);
 *  - `NOT_VERIFIED`   — confirmed absent or a different reply is visible (hash mismatch);
 *  - `INDETERMINATE`  — could not determine (do not treat as either success or failure).
 */

import type { CommerceChannel } from "../connection/sync-state";

export interface InquiryReplyVerificationInput {
  connectionId: string;
  channel: CommerceChannel;
  channelInquiryRef: string;
  actionIdempotencyKey: string;
  /** The expected hash of the approved reply — a match is what `VERIFIED` means. Never the raw text. */
  expectedReplyHash: string;
}

export type InquiryVerificationStatus = "VERIFIED" | "NOT_VERIFIED" | "INDETERMINATE";

export interface InquiryReplyVerificationOutcome {
  status: InquiryVerificationStatus;
  checkCategory: string;
}

export interface InquiryReplyVerifier {
  verify(input: InquiryReplyVerificationInput): Promise<InquiryReplyVerificationOutcome>;
}
