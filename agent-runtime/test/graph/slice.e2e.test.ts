import { describe, expect, it } from "vitest";
import { InquiryAgentRuntime } from "../../src/runtime";
import { FakeSpringClient } from "../support/FakeSpringClient";
import { twoInquiries, OLDER_WORK_ITEM } from "../support/fixtures";

describe("inquiry vertical slice (end to end)", () => {
  it("runs goal -> search -> prioritize -> detail -> propose -> draft -> checkpoint -> record(approve)", async () => {
    const fake = new FakeSpringClient(twoInquiries());
    const runtime = new InquiryAgentRuntime({ client: fake });

    const started = await runtime.start("t-e2e", { intent: "HANDLE_UNANSWERED_INQUIRIES" });

    // Pauses at the human checkpoint, on the oldest-waiting inquiry.
    expect(started.status).toBe("AWAITING_APPROVAL");
    if (started.status !== "AWAITING_APPROVAL") return;
    expect(started.checkpoint.kind).toBe("INQUIRY_REPLY_APPROVAL");
    expect(started.checkpoint.workItemId).toBe(OLDER_WORK_ITEM);
    expect(started.checkpoint.priorityBucket).toBe("top");
    expect(started.checkpoint.candidate.provenance.providerKind).toBe("RULE_BASED");
    expect(started.trail).toEqual(["searched", "prioritized", "detailed", "drafted"]);

    // Before approval: NOTHING is written to the backend — the item is still OPEN, no
    // proposal, no draft, no approval bound, nothing sent.
    expect(fake.phaseOf(OLDER_WORK_ITEM)).toBe("OPEN");
    expect(fake.calls.propose).toBe(0);
    expect(fake.calls.saveDraft).toBe(0);
    expect(fake.calls.confirmPublish).toBe(0);
    expect(fake.externalSendAttempts).toBe(0);

    const done = await runtime.resume("t-e2e", { approved: true, approvedBy: "user-1" });

    expect(done.status).toBe("DONE");
    if (done.status !== "DONE") return;
    expect(done.outcome?.decision).toBe("APPROVED");
    expect(done.outcome?.recorded).toBe(true);
    expect(done.outcome?.phase).toBe("ACTION_PENDING");
    expect(done.outcome?.executionStatus).toBe("ACTION_PENDING"); // fail closed: nothing dispatched
    expect(done.outcome?.externalSendAttempted).toBe(false);
    expect(done.trail).toContain("checkpoint_resumed");
    expect(done.trail).toContain("recorded_approved");

    // Backend spine (only on approve): OPEN -> proposed -> draft v1 -> approval bound +
    // audited -> ACTION_PENDING, nothing sent.
    expect(fake.phaseOf(OLDER_WORK_ITEM)).toBe("ACTION_PENDING");
    expect(fake.calls.propose).toBe(1);
    expect(fake.calls.saveDraft).toBe(1);
    expect(fake.calls.confirmPublish).toBe(1);
    expect(fake.auditEvents(OLDER_WORK_ITEM)).toContain("APPROVAL_GRANTED");
    expect(fake.externalSendAttempts).toBe(0);
  });

  it("handles an empty queue by finishing with decision NONE, touching nothing", async () => {
    const fake = new FakeSpringClient([]);
    const runtime = new InquiryAgentRuntime({ client: fake });

    const res = await runtime.start("t-empty", { intent: "HANDLE_UNANSWERED_INQUIRIES" });

    expect(res.status).toBe("DONE");
    if (res.status !== "DONE") return;
    expect(res.outcome?.decision).toBe("NONE");
    expect(res.outcome?.recorded).toBe(false);
    expect(fake.calls.detail).toBe(0);
    expect(fake.calls.propose).toBe(0);
    expect(fake.calls.confirmPublish).toBe(0);
  });

  it("lets the human edit the draft before approving", async () => {
    const fake = new FakeSpringClient(twoInquiries());
    const runtime = new InquiryAgentRuntime({ client: fake });

    await runtime.start("t-edit", { intent: "HANDLE_UNANSWERED_INQUIRIES" });
    const done = await runtime.resume("t-edit", {
      approved: true,
      approvedBy: "user-1",
      editedTitle: "[답변] 환불 안내",
      editedComments: "환불은 영업일 기준 3일 내 처리됩니다.",
    });

    expect(done.status).toBe("DONE");
    if (done.status !== "DONE") return;
    expect(done.outcome?.decision).toBe("APPROVED");
    // The approved fingerprint binds the edited content (a non-null fingerprint present).
    expect(done.outcome?.approvedFingerprint).toBeTruthy();
    expect(fake.externalSendAttempts).toBe(0);
  });
});
