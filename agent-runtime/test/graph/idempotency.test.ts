import { describe, expect, it } from "vitest";
import { InquiryAgentRuntime } from "../../src/runtime";
import { approvalCommandId } from "../../src/graph/inquiryGraph";
import { SpringApiError } from "../../src/spring/SpringClient";
import { FakeSpringClient } from "../support/FakeSpringClient";
import { twoInquiries, OLDER_WORK_ITEM } from "../support/fixtures";

describe("approval idempotency (deterministic commandId)", () => {
  it("derives a stable commandId per (thread, workItem)", () => {
    expect(approvalCommandId("t-1", "wi-9")).toBe("agent:t-1:approve:wi-9");
    expect(approvalCommandId("t-1", "wi-9")).toBe(approvalCommandId("t-1", "wi-9"));
  });

  it("replaying the approval with the same commandId+fingerprint is a no-op (one bind, one audit)", async () => {
    const fake = new FakeSpringClient(twoInquiries());
    const runtime = new InquiryAgentRuntime({ client: fake });

    await runtime.start("t-idem", { intent: "HANDLE_UNANSWERED_INQUIRIES" });
    const done = await runtime.resume("t-idem", { approved: true, approvedBy: "user-1" });
    expect(done.status).toBe("DONE");
    if (done.status !== "DONE") return;

    const fingerprint = done.outcome!.approvedFingerprint!;
    const commandId = approvalCommandId("t-idem", OLDER_WORK_ITEM);
    const auditBefore = fake.auditEvents(OLDER_WORK_ITEM).filter((e) => e === "APPROVAL_GRANTED").length;

    // Replay the exact confirm the record step issued.
    const replay = await fake.confirmPublish(OLDER_WORK_ITEM, { commandId, expectedFingerprint: fingerprint });

    expect(replay.phase).toBe("ACTION_PENDING");
    expect(fake.auditEvents(OLDER_WORK_ITEM).filter((e) => e === "APPROVAL_GRANTED").length).toBe(auditBefore);
    expect(auditBefore).toBe(1);
    expect(fake.externalSendAttempts).toBe(0);
  });

  it("a different commandId for an already-approved item is rejected (no double approval)", async () => {
    const fake = new FakeSpringClient(twoInquiries());
    const runtime = new InquiryAgentRuntime({ client: fake });

    await runtime.start("t-conf", { intent: "HANDLE_UNANSWERED_INQUIRIES" });
    const done = await runtime.resume("t-conf", { approved: true, approvedBy: "user-1" });
    if (done.status !== "DONE") throw new Error("expected DONE");
    const fingerprint = done.outcome!.approvedFingerprint!;

    await expect(
      fake.confirmPublish(OLDER_WORK_ITEM, { commandId: "some-other-command", expectedFingerprint: fingerprint }),
    ).rejects.toBeInstanceOf(SpringApiError);
  });
});
