import { describe, expect, it } from "vitest";
import { ReviewAgentRuntime } from "../../src/reviewRuntime";
import { REVIEW_CHECKPOINT_KIND } from "../../src/checkpoint/ReviewCheckpointContract";
import { FakeReviewSpringClient } from "../support/FakeReviewSpringClient";
import { twoReviews, OLDER_REVIEW_REF, PHONE_TOKEN, EMAIL_TOKEN } from "../support/reviewFixtures";

describe("review reply slice — end to end (fake backend)", () => {
  it("parks at a body-free checkpoint after saving the rule-based draft, oldest review first", async () => {
    const fake = new FakeReviewSpringClient(twoReviews());
    const runtime = new ReviewAgentRuntime({ client: fake });

    const started = await runtime.start("t-e2e", { intent: "HANDLE_REVIEW_REPLIES", accountId: "acct" });

    expect(started.status).toBe("AWAITING_APPROVAL");
    if (started.status !== "AWAITING_APPROVAL") return;
    const cp = started.checkpoint;
    // Oldest (2★, 2026-07-18) is selected and its draft saved as v1 before the checkpoint.
    expect(cp.actionRef).toBe(OLDER_REVIEW_REF);
    expect(cp.kind).toBe(REVIEW_CHECKPOINT_KIND);
    expect(cp.phase).toBe("DRAFT_SAVED");
    expect(cp.draftVersion).toBe(1);
    expect(typeof cp.draftFingerprint).toBe("string");
    expect(fake.draftVersionsOf(OLDER_REVIEW_REF)).toEqual([1]);

    // Nothing committed: no approval, no guided-session mint.
    expect(fake.approvalStateOf(OLDER_REVIEW_REF)).toBeNull();
    expect(fake.mintCount).toBe(0);
    expect(fake.externalSendAttempts).toBe(0);

    // The checkpoint carries NO review body and NO reply/draft text.
    const serialized = JSON.stringify(cp);
    expect(serialized).not.toContain(PHONE_TOKEN);
    expect(serialized).not.toContain(EMAIL_TOKEN);
    expect(serialized).not.toContain("죄송"); // apology draft body
    expect(serialized).not.toContain("body");
  });

  it("on approve: records the approval and prepares the guided reply session (no send)", async () => {
    const fake = new FakeReviewSpringClient(twoReviews());
    const runtime = new ReviewAgentRuntime({ client: fake });

    await runtime.start("t-e2e-approve", { intent: "HANDLE_REVIEW_REPLIES", accountId: "acct" });
    const done = await runtime.resume("t-e2e-approve", { approved: true, approvedBy: "op-1" });

    expect(done.status).toBe("DONE");
    if (done.status !== "DONE") return;
    expect(done.outcome?.decision).toBe("APPROVED");
    expect(done.outcome?.approvalState).toBe("APPROVED");
    expect(done.outcome?.draftVersion).toBe(1);
    expect(done.outcome?.guidedSessionPrepared).toBe(true);
    expect(done.outcome?.submissionRef).toMatch(/^[0-9a-f]{16}$/);
    expect(done.outcome?.submissionApprovedVersion).toBe(1);
    expect(done.outcome?.targetHint?.rating).toBe(2);
    expect(done.outcome?.externalSendAttempted).toBe(false);

    // Backend state: approved, exactly one guided ref minted, nothing sent.
    expect(fake.approvalStateOf(OLDER_REVIEW_REF)).toBe("APPROVED");
    expect(fake.mintCount).toBe(1);
    expect(fake.externalSendAttempts).toBe(0);
  });
});
