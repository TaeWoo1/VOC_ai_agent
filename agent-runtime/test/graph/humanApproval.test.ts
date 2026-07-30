import { describe, expect, it } from "vitest";
import { InquiryAgentRuntime } from "../../src/runtime";
import { FakeSpringClient } from "../support/FakeSpringClient";
import { twoInquiries, OLDER_WORK_ITEM } from "../support/fixtures";

describe("human checkpoint gate", () => {
  it("cannot reach the record step without a human resume — start alone binds nothing", async () => {
    const fake = new FakeSpringClient(twoInquiries());
    const runtime = new InquiryAgentRuntime({ client: fake });

    const started = await runtime.start("t-gate", { intent: "HANDLE_UNANSWERED_INQUIRIES" });

    expect(started.status).toBe("AWAITING_APPROVAL");
    // The graph is parked at the checkpoint: no approval, no draft, no send.
    expect(fake.calls.saveDraft).toBe(0);
    expect(fake.calls.confirmPublish).toBe(0);
    expect(fake.auditEvents(OLDER_WORK_ITEM)).not.toContain("APPROVAL_GRANTED");
    expect(fake.externalSendAttempts).toBe(0);
  });

  it("on reject: records the declined decision, writes nothing to the backend, sends nothing", async () => {
    const fake = new FakeSpringClient(twoInquiries());
    const runtime = new InquiryAgentRuntime({ client: fake });

    await runtime.start("t-reject", { intent: "HANDLE_UNANSWERED_INQUIRIES" });
    const done = await runtime.resume("t-reject", { approved: false, approvedBy: "user-1" });

    expect(done.status).toBe("DONE");
    if (done.status !== "DONE") return;
    expect(done.outcome?.decision).toBe("REJECTED");
    expect(done.outcome?.recorded).toBe(true);
    expect(done.outcome?.externalSendAttempted).toBe(false);

    // Item stays OPEN (nothing was written before the checkpoint), so it resurfaces next
    // run: no proposal, no draft, no approval, no audit-of-approval, no send.
    expect(fake.phaseOf(OLDER_WORK_ITEM)).toBe("OPEN");
    expect(fake.calls.propose).toBe(0);
    expect(fake.calls.saveDraft).toBe(0);
    expect(fake.calls.confirmPublish).toBe(0);
    expect(fake.auditEvents(OLDER_WORK_ITEM)).not.toContain("APPROVAL_GRANTED");
    expect(fake.externalSendAttempts).toBe(0);
  });

  it("on approve: records the approval through the backend audit trail, still sends nothing", async () => {
    const fake = new FakeSpringClient(twoInquiries());
    const runtime = new InquiryAgentRuntime({ client: fake });

    await runtime.start("t-approve", { intent: "HANDLE_UNANSWERED_INQUIRIES" });
    const done = await runtime.resume("t-approve", { approved: true, approvedBy: "user-1" });

    expect(done.status).toBe("DONE");
    expect(fake.auditEvents(OLDER_WORK_ITEM)).toContain("APPROVAL_GRANTED");
    expect(fake.phaseOf(OLDER_WORK_ITEM)).toBe("ACTION_PENDING");
    expect(fake.externalSendAttempts).toBe(0);
  });

  it("the no-send guarantee is a real fail-closed decision (send only when a backend adapter exists)", async () => {
    // Runtime path against the fail-closed default: approve, and still nothing sends.
    const failClosed = new FakeSpringClient(twoInquiries());
    const runtime = new InquiryAgentRuntime({ client: failClosed });
    await runtime.start("t-fc", { intent: "HANDLE_UNANSWERED_INQUIRIES" });
    await runtime.resume("t-fc", { approved: true, approvedBy: "user-1" });
    expect(failClosed.externalSendAttempts).toBe(0);
    expect(failClosed.phaseOf(OLDER_WORK_ITEM)).toBe("ACTION_PENDING");

    // Proof the counter is NOT inert: with a channel adapter present (execution enabled),
    // the SAME confirm-publish endpoint DOES dispatch — the send-safety is a backend
    // configuration property, which the runtime never enables (documents M3).
    const enabled = new FakeSpringClient(twoInquiries(), { dispatchAdapterEnabled: true });
    const enabledRuntime = new InquiryAgentRuntime({ client: enabled });
    await enabledRuntime.start("t-en", { intent: "HANDLE_UNANSWERED_INQUIRIES" });
    await enabledRuntime.resume("t-en", { approved: true, approvedBy: "user-1" });
    expect(enabled.externalSendAttempts).toBe(1);
    expect(enabled.phaseOf(OLDER_WORK_ITEM)).toBe("EXECUTED");
  });
});
