import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { InquiryAgentRuntime } from "../../src/runtime";
import { FileRunStore, InMemoryRunStore } from "../../src/checkpoint/RunStore";
import { performRecord } from "../../src/graph/performRecord";
import { buildInquiryToolRegistry } from "../../src/tools/ToolRegistry";
import { clearLogSink } from "../../src/log";
import { FakeSpringClient } from "../support/FakeSpringClient";
import { twoInquiries, OLDER_WORK_ITEM, PHONE_TOKEN, EMAIL_TOKEN } from "../support/fixtures";

afterEach(() => clearLogSink());

function freshStoreDir(): string {
  return mkdtempSync(join(tmpdir(), "agent-runtime-runstore-"));
}

describe("durable restart-resume", () => {
  it("persists ONLY a sanitized snapshot at the checkpoint (no raw content)", async () => {
    const dir = freshStoreDir();
    const store = new FileRunStore(dir);
    const fake = new FakeSpringClient(twoInquiries());
    const r1 = new InquiryAgentRuntime({ client: fake, runStore: store });

    await r1.start("t-snap", { intent: "HANDLE_UNANSWERED_INQUIRIES" });

    const raw = readFileSync(join(dir, "t-snap.json"), "utf8");
    const snap = JSON.parse(raw);
    // Sanitized fields present...
    expect(snap.workItemId).toBe(OLDER_WORK_ITEM);
    expect(snap.status).toBe("AWAITING_APPROVAL");
    expect(snap.phase).toBe("OPEN");
    expect(typeof snap.category).toBe("string");
    // ...and NO raw content, PII, or draft text anywhere in the file.
    expect(raw).not.toContain(PHONE_TOKEN);
    expect(raw).not.toContain(EMAIL_TOKEN);
    expect(raw).not.toContain("환불 요청");
    expect(raw).not.toContain("안녕하세요");
    expect(raw).not.toContain("candidate");
    expect(raw).not.toContain("comments");
  });

  it("resumes an approve across a process restart (new runtime + shared durable store)", async () => {
    const store = new FileRunStore(freshStoreDir());
    const fake = new FakeSpringClient(twoInquiries()); // the backend survives; only the runtime restarts

    const before = new InquiryAgentRuntime({ client: fake, runStore: store });
    const started = await before.start("t-restart", { intent: "HANDLE_UNANSWERED_INQUIRIES" });
    expect(started.status).toBe("AWAITING_APPROVAL");
    // Nothing mutated before the checkpoint.
    expect(fake.phaseOf(OLDER_WORK_ITEM)).toBe("OPEN");

    // Simulate restart: a brand-new runtime (empty in-memory checkpointer + liveThreads),
    // same durable store, same backend.
    const after = new InquiryAgentRuntime({ client: fake, runStore: store });
    const done = await after.resume("t-restart", { approved: true, approvedBy: "user-1" });

    expect(done.status).toBe("DONE");
    if (done.status !== "DONE") return;
    expect(done.outcome?.decision).toBe("APPROVED");
    expect(done.outcome?.phase).toBe("ACTION_PENDING");
    expect(done.trail).toContain("resumed_after_restart");
    // Backend recorded exactly once, nothing sent.
    expect(fake.phaseOf(OLDER_WORK_ITEM)).toBe("ACTION_PENDING");
    expect(fake.calls.saveDraft).toBe(1);
    expect(fake.calls.confirmPublish).toBe(1);
    expect(fake.auditEvents(OLDER_WORK_ITEM).filter((e) => e === "APPROVAL_GRANTED").length).toBe(1);
    expect(fake.externalSendAttempts).toBe(0);
  });

  it("resumes a reject across a restart, leaving the item OPEN and untouched", async () => {
    const store = new FileRunStore(freshStoreDir());
    const fake = new FakeSpringClient(twoInquiries());

    await new InquiryAgentRuntime({ client: fake, runStore: store }).start("t-rj", { intent: "HANDLE_UNANSWERED_INQUIRIES" });
    const done = await new InquiryAgentRuntime({ client: fake, runStore: store }).resume("t-rj", {
      approved: false,
      approvedBy: "user-1",
    });

    expect(done.status).toBe("DONE");
    if (done.status !== "DONE") return;
    expect(done.outcome?.decision).toBe("REJECTED");
    expect(fake.phaseOf(OLDER_WORK_ITEM)).toBe("OPEN");
    expect(fake.calls.propose).toBe(0);
    expect(fake.calls.saveDraft).toBe(0);
    expect(fake.calls.confirmPublish).toBe(0);
  });

  it("double-resume after restart is idempotent (second resume replays the stored outcome)", async () => {
    const store = new FileRunStore(freshStoreDir());
    const fake = new FakeSpringClient(twoInquiries());

    await new InquiryAgentRuntime({ client: fake, runStore: store }).start("t-dbl", { intent: "HANDLE_UNANSWERED_INQUIRIES" });
    const first = await new InquiryAgentRuntime({ client: fake, runStore: store }).resume("t-dbl", { approved: true, approvedBy: "u" });
    const second = await new InquiryAgentRuntime({ client: fake, runStore: store }).resume("t-dbl", { approved: true, approvedBy: "u" });

    expect(first.status).toBe("DONE");
    expect(second.status).toBe("DONE");
    if (first.status !== "DONE" || second.status !== "DONE") return;
    expect(second.outcome?.approvedFingerprint).toBe(first.outcome?.approvedFingerprint);
    // The backend was touched exactly once; the second resume short-circuited on the DONE snapshot.
    expect(fake.calls.saveDraft).toBe(1);
    expect(fake.calls.confirmPublish).toBe(1);
    expect(fake.auditEvents(OLDER_WORK_ITEM).filter((e) => e === "APPROVAL_GRANTED").length).toBe(1);
  });

  it("performRecord itself is idempotent when re-run against the same backend", async () => {
    const fake = new FakeSpringClient(twoInquiries());
    const registry = buildInquiryToolRegistry(fake);
    const args = {
      threadId: "t-pr",
      workItemId: OLDER_WORK_ITEM,
      approved: true,
      title: "[답변] 환불 안내",
      comments: "환불은 3일 내 처리됩니다.",
      rejectPhase: null,
    };
    const a = await performRecord(registry, args);
    const b = await performRecord(registry, args); // re-run: reuse head draft + replay confirm

    expect(a.approvedFingerprint).toBe(b.approvedFingerprint);
    expect(fake.calls.saveDraft).toBe(1); // second run reused the identical head, saved nothing new
    expect(fake.calls.confirmPublish).toBe(2); // called twice, but backend replayed (idempotent)
    expect(fake.auditEvents(OLDER_WORK_ITEM).filter((e) => e === "APPROVAL_GRANTED").length).toBe(1);
    expect(fake.externalSendAttempts).toBe(0);
  });
});

describe("resume fails closed against an execution-enabled backend", () => {
  it("throws before mutating, even on the durable restart path", async () => {
    // Pre-seed an AWAITING snapshot as if a prior process parked here, then resume with
    // an execution-ENABLED backend: the guard must fire before any propose/draft/confirm.
    const store = new InMemoryRunStore();
    await store.save({
      threadId: "t-guard-resume",
      status: "AWAITING_APPROVAL",
      inquiryId: "i",
      workItemId: OLDER_WORK_ITEM,
      phase: "OPEN",
      priorityBucket: "top",
      category: "general_reply",
      trail: ["searched", "prioritized", "detailed", "drafted"],
    });
    const enabled = new FakeSpringClient(twoInquiries(), { dispatchAdapterEnabled: true });
    const runtime = new InquiryAgentRuntime({ client: enabled, runStore: store });

    await expect(runtime.resume("t-guard-resume", { approved: true, approvedBy: "u" })).rejects.toThrow(
      /reply-send is ENABLED/,
    );
    expect(enabled.calls.propose).toBe(0);
    expect(enabled.calls.saveDraft).toBe(0);
    expect(enabled.calls.confirmPublish).toBe(0);
    expect(enabled.externalSendAttempts).toBe(0);
  });
});

describe("RunStore implementations", () => {
  it("InMemoryRunStore round-trips and deletes", async () => {
    const s = new InMemoryRunStore();
    expect(await s.load("x")).toBeNull();
    await s.save({ threadId: "x", status: "AWAITING_APPROVAL", inquiryId: "i", workItemId: "w", phase: "OPEN", priorityBucket: "top", category: "c", trail: [] });
    expect((await s.load("x"))?.workItemId).toBe("w");
    await s.delete("x");
    expect(await s.load("x")).toBeNull();
  });
});
