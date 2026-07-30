import { describe, expect, it } from "vitest";
import { ReviewAgentRuntime } from "../../src/reviewRuntime";
import { FakeReviewSpringClient } from "../support/FakeReviewSpringClient";
import { twoReviews, OLDER_REVIEW_REF } from "../support/reviewFixtures";

describe("review human checkpoint gate", () => {
  it("start parks at the checkpoint: draft prepared, but NOTHING committed (no approval, no guided session)", async () => {
    const fake = new FakeReviewSpringClient(twoReviews());
    const runtime = new ReviewAgentRuntime({ client: fake });

    const started = await runtime.start("t-gate", { intent: "HANDLE_REVIEW_REPLIES", accountId: "acct" });

    expect(started.status).toBe("AWAITING_APPROVAL");
    // The draft IS saved before the checkpoint (the version-bound reference the checkpoint carries) —
    // this is the review semantic. But nothing is committed: no approval, no mint, no send.
    expect(fake.calls.saveDraft).toBe(1);
    expect(fake.calls.approve).toBe(0);
    expect(fake.calls.submissionRun).toBe(0);
    expect(fake.approvalStateOf(OLDER_REVIEW_REF)).toBeNull();
    expect(fake.mintCount).toBe(0);
    expect(fake.externalSendAttempts).toBe(0);
  });

  it("on reject: 무변경 — no approval, no guided session, review stays RESPONSE_NEEDED and approvable", async () => {
    const fake = new FakeReviewSpringClient(twoReviews());
    const runtime = new ReviewAgentRuntime({ client: fake });

    await runtime.start("t-reject", { intent: "HANDLE_REVIEW_REPLIES", accountId: "acct" });
    const done = await runtime.resume("t-reject", { approved: false, approvedBy: "op-1" });

    expect(done.status).toBe("DONE");
    if (done.status !== "DONE") return;
    expect(done.outcome?.decision).toBe("REJECTED");
    expect(done.outcome?.recorded).toBe(true);
    expect(done.outcome?.guidedSessionPrepared).toBe(false);
    expect(done.outcome?.submissionRef).toBeNull();
    expect(done.outcome?.externalSendAttempted).toBe(false);

    // No approval was recorded, no guided ref minted; the review is untouched and still approvable.
    expect(fake.approvalStateOf(OLDER_REVIEW_REF)).toBeNull();
    expect(fake.mintCount).toBe(0);
    expect(fake.dispositionOf(OLDER_REVIEW_REF)).toBe("RESPONSE_NEEDED");
    expect(fake.calls.approve).toBe(0);
    expect(fake.calls.submissionRun).toBe(0);
    const prep = await fake.getReviewReplyPrep("acct", OLDER_REVIEW_REF);
    expect(prep.capabilities.canApprove).toBe(true); // still approvable next run
    expect(prep.approval).toBeNull();
  });

  it("on approve: records the approval through the backend audit trail and prepares one guided session", async () => {
    const fake = new FakeReviewSpringClient(twoReviews());
    const runtime = new ReviewAgentRuntime({ client: fake });

    await runtime.start("t-approve", { intent: "HANDLE_REVIEW_REPLIES", accountId: "acct" });
    const done = await runtime.resume("t-approve", { approved: true, approvedBy: "op-1" });

    expect(done.status).toBe("DONE");
    expect(fake.approvalStateOf(OLDER_REVIEW_REF)).toBe("APPROVED");
    expect(fake.mintCount).toBe(1);
    expect(fake.externalSendAttempts).toBe(0);
  });

  it("no-send is STRUCTURAL: the strongest capability is minting a guided ref, and the counter never moves", async () => {
    const fake = new FakeReviewSpringClient(twoReviews());
    // There is no send endpoint to type a call against; the review client's most powerful
    // method mints a single-use guided ref (proven elsewhere), never a dispatch. Even after
    // a full approve, nothing ever attempts an external send. (The absence of a send/publish
    // tool is pinned in the review tool-registry test.)
    const runtime = new ReviewAgentRuntime({ client: fake });
    await runtime.start("t-ns", { intent: "HANDLE_REVIEW_REPLIES", accountId: "acct" });
    await runtime.resume("t-ns", { approved: true, approvedBy: "op-1" });
    expect(fake.externalSendAttempts).toBe(0);
    // Approving prepared a guided session (a ref), and that is the ceiling — nothing sent.
    expect(fake.mintCount).toBe(1);
  });

  it("start() fails closed against an execution-enabled backend (never runs, never saves a draft)", async () => {
    const enabled = new FakeReviewSpringClient(twoReviews(), { dispatchAdapterEnabled: true });
    const runtime = new ReviewAgentRuntime({ client: enabled });
    await expect(
      runtime.start("t-guard", { intent: "HANDLE_REVIEW_REPLIES", accountId: "acct" }),
    ).rejects.toThrow(/reply-send is ENABLED/);
    expect(enabled.calls.saveDraft).toBe(0);
    expect(enabled.calls.approve).toBe(0);
    expect(enabled.externalSendAttempts).toBe(0);
  });
});
