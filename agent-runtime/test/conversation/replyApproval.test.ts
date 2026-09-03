import { describe, expect, it } from "vitest";
import { replyApprovalStateOf } from "../../src/conversation/replyApproval";
import type { ReviewReplyPrepView } from "../../src/spring/types";

/**
 * Guided Reply UX Smoothing v1 §1 — which card the conversation draws for a review turns on ONE
 * question, and the whole safety story of this package is that the answer is a binding to an exact
 * version rather than a flag on a review.
 *
 * The stale case is the one worth a test of its own: reusing an approval whose draft has moved would
 * put a sentence nobody currently approved into a marketplace composer.
 */
function prep(over: Partial<ReviewReplyPrepView>): ReviewReplyPrepView {
  return {
    actionRef: "ref-1",
    redactedBody: "포장이 찌그러져 왔어요",
    bodyRedacted: false,
    triageDisposition: "RESPONSE_NEEDED",
    suggestion: { body: "", category: "general_reply", providerKind: "RULE_BASED", providerName: "rule", providerVersion: "v1" },
    draft: null,
    approval: null,
    capabilities: { canSave: true, canApprove: true, canWithdraw: false, canCopy: false, canStartSubmissionRun: false },
    channelReviewIdFingerprint: "idfp",
    rating: 4,
    channelReplyState: "PENDING",
    productName: "전선몰딩",
    reviewDate: "2026-08-28",
    ...over,
  } as ReviewReplyPrepView;
}

const HEAD = { version: 3, body: "감사합니다", contentFingerprint: "fp-3", fingerprintAlgorithm: "sha256", createdAt: "2026-09-03T00:00:00Z" };

describe("does an approval stand for the draft the seller would send right now", () => {
  it("no saved draft is nothing to approve — not an approval question at all", () => {
    expect(replyApprovalStateOf(prep({ draft: null }))).toEqual({ kind: "NO_DRAFT" });
  });

  it("a head with no approval object needs the seller's press", () => {
    const state = replyApprovalStateOf(prep({ draft: HEAD, approval: null }));
    expect(state).toEqual({ kind: "NEEDS_APPROVAL", head: { version: 3, contentFingerprint: "fp-3" } });
  });

  it("a withdrawn approval is an absent one — the seller took it back so they could edit", () => {
    const state = replyApprovalStateOf(
      prep({ draft: HEAD, approval: { state: "WITHDRAWN", approvedVersion: 3, approvedFingerprint: "fp-3", body: null, decidedAt: "x" } }),
    );
    expect(state.kind).toBe("NEEDS_APPROVAL");
  });

  it("STALE: approved on an older version — the guided run must not be offered", () => {
    const state = replyApprovalStateOf(
      prep({ draft: HEAD, approval: { state: "APPROVED", approvedVersion: 2, approvedFingerprint: "fp-2", body: "옛 문장", decidedAt: "x" } }),
    );
    expect(state).toEqual({ kind: "NEEDS_APPROVAL", head: { version: 3, contentFingerprint: "fp-3" } });
  });

  it("STALE: the version number matches but the sentence does not — a number equal by coincidence is not the same text", () => {
    const state = replyApprovalStateOf(
      prep({ draft: HEAD, approval: { state: "APPROVED", approvedVersion: 3, approvedFingerprint: "fp-other", body: "다른 문장", decidedAt: "x" } }),
    );
    expect(state.kind).toBe("NEEDS_APPROVAL");
  });

  it("APPROVED only when version AND fingerprint bind to the head on screen", () => {
    const state = replyApprovalStateOf(
      prep({ draft: HEAD, approval: { state: "APPROVED", approvedVersion: 3, approvedFingerprint: "fp-3", body: "감사합니다", decidedAt: "x" } }),
    );
    expect(state).toEqual({ kind: "APPROVED", head: { version: 3, contentFingerprint: "fp-3" } });
  });
});
