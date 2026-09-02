import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { reviewReplyTaskLink } from "../../src/conversation/ConversationService";

const SOURCE = readFileSync(new URL("../../src/conversation/ConversationService.ts", import.meta.url), "utf8");

/**
 * Approval Path v1 §5 — a review action in the conversation points at THAT review's reply work.
 *
 * <b>Why a source scan and not only a behavioural test.</b> The defect being fenced is a constant:
 * every review action artifact shipped `to: "/reviews"`, the channel's whole record — 4,455 rows on the
 * live NAVER account, with the approve button six screens below the fold and nothing on the page
 * saying which row the conversation meant. A regression here is one edited string literal, and the
 * cheapest way to make that impossible is to read the two literals.
 *
 * <b>What is NOT changed by this, and is asserted so:</b> the link is a link. The write fence stands —
 * approving still happens on the seller's own screen, and this conversation gains no approve path.
 */
describe("review action artifacts deep-link to the exact review", () => {
  it("names the review and asks the screen to offer a way back to this conversation", () => {
    expect(reviewReplyTaskLink("rev-1")).toBe("/reviews/reply/rev-1?from=chat");
    // Not the record. That was the bug.
    expect(reviewReplyTaskLink("rev-1")).not.toBe("/reviews");
    // An id is put in a path segment, so it is encoded rather than trusted to be path-safe.
    expect(reviewReplyTaskLink("a/b?c")).toBe("/reviews/reply/a%2Fb%3Fc?from=chat");
  });

  it("both review action artifacts use it — neither ships the bare record link", () => {
    for (const marker of ['artifactId: `a-guided-${t.reviewId}`', 'artifactId: `a-approval-${t.reviewId}`']) {
      const start = SOURCE.indexOf(marker);
      expect(start, `${marker} not found — the artifact was renamed, so this fence is not reading it`).toBeGreaterThan(-1);
      // The object literal that starts at the marker, to its closing brace.
      const block = SOURCE.slice(start, SOURCE.indexOf("};", start));
      expect(block).toContain("to: reviewReplyTaskLink(t.reviewId)");
      expect(block).not.toContain('to: "/reviews"');
    }
  });

  it("carries no approve or send path of its own — the link is the whole handoff", () => {
    const start = SOURCE.indexOf("private async routeSend(");
    const block = SOURCE.slice(start, SOURCE.indexOf("\n  private ", start + 10));
    for (const forbidden of ["decideReviewReplyApproval", "publishReviewReply", "executeReviewReply", "recordReviewReplyOutcome"]) {
      expect(block, `routeSend must not reach ${forbidden}`).not.toContain(forbidden);
    }
  });
});
