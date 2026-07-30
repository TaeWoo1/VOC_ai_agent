import { describe, expect, it } from "vitest";
import { ReviewAgentRuntime } from "../../src/reviewRuntime";
import { buildReviewToolRegistry } from "../../src/tools/ReviewToolRegistry";
import { performReviewRecord } from "../../src/graph/performReviewRecord";
import { FakeReviewSpringClient } from "../support/FakeReviewSpringClient";
import { twoReviews, OLDER_REVIEW_REF } from "../support/reviewFixtures";

describe("review reply idempotency", () => {
  it("in-process double-resume is idempotent: one approval, ONE guided ref, same result", async () => {
    const fake = new FakeReviewSpringClient(twoReviews());
    const runtime = new ReviewAgentRuntime({ client: fake });

    await runtime.start("t-dbl", { intent: "HANDLE_REVIEW_REPLIES", accountId: "acct" });
    const first = await runtime.resume("t-dbl", { approved: true, approvedBy: "op" });
    const second = await runtime.resume("t-dbl", { approved: true, approvedBy: "op" });

    expect(first.status).toBe("DONE");
    expect(second.status).toBe("DONE");
    if (first.status !== "DONE" || second.status !== "DONE") return;
    expect(second.outcome?.submissionRef).toBe(first.outcome?.submissionRef);
    expect(second.outcome?.approvedFingerprint).toBe(first.outcome?.approvedFingerprint);

    // The second resume short-circuited on the DONE snapshot — mint-once holds.
    expect(fake.mintCount).toBe(1);
    expect(fake.draftVersionsOf(OLDER_REVIEW_REF)).toEqual([1]); // no duplicate draft
    expect(fake.externalSendAttempts).toBe(0);
  });

  it("the approval is idempotent by commandId: a re-run of performReviewRecord replays it", async () => {
    // performReviewRecord itself is called once per completed run; re-running it directly shows
    // the approval replays (commandId dedup). The guided-mint is NOT idempotent at this level —
    // mint-once is guaranteed one layer up by the runtime's DONE guard (proven above).
    const fake = new FakeReviewSpringClient(twoReviews());
    const registry = buildReviewToolRegistry(fake);
    // Save a draft first so there is a version to bind.
    const saved = await fake.saveReviewDraft("acct", OLDER_REVIEW_REF, { body: "감사합니다.", baseVersion: 0 });
    const args = {
      threadId: "t-pr",
      accountId: "acct",
      actionRef: OLDER_REVIEW_REF,
      approved: true,
      draftVersion: saved.version,
      draftFingerprint: saved.contentFingerprint,
    };

    const a = await performReviewRecord(registry, args);
    const b = await performReviewRecord(registry, args);

    expect(a.approvedFingerprint).toBe(b.approvedFingerprint);
    // The approval was applied once and replayed on the re-run (no second bind, no 409).
    expect(fake.approvalStateOf(OLDER_REVIEW_REF)).toBe("APPROVED");
    expect(fake.externalSendAttempts).toBe(0);
  });
});
