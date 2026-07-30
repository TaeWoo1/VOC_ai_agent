import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ReviewAgentRuntime } from "../../src/reviewRuntime";
import { FileReviewRunStore, InMemoryReviewRunStore } from "../../src/checkpoint/ReviewRunStore";
import { clearLogSink } from "../../src/log";
import { FakeReviewSpringClient } from "../support/FakeReviewSpringClient";
import { twoReviews, OLDER_REVIEW_REF, PHONE_TOKEN, EMAIL_TOKEN } from "../support/reviewFixtures";

afterEach(() => clearLogSink());

function freshStoreDir(): string {
  return mkdtempSync(join(tmpdir(), "review-runstore-"));
}

describe("review durable restart-resume", () => {
  it("persists ONLY a sanitized snapshot at the checkpoint (no body, no draft text, no PII)", async () => {
    const dir = freshStoreDir();
    const store = new FileReviewRunStore(dir);
    const fake = new FakeReviewSpringClient(twoReviews());
    const r1 = new ReviewAgentRuntime({ client: fake, runStore: store });

    await r1.start("t-snap", { intent: "HANDLE_REVIEW_REPLIES", accountId: "acct" });

    const raw = readFileSync(join(dir, "t-snap.json"), "utf8");
    const snap = JSON.parse(raw);
    // The four required identity fields (+ scoping account) are present...
    expect(snap.reviewRef).toBe(OLDER_REVIEW_REF);
    expect(snap.draftVersion).toBe(1);
    expect(typeof snap.draftFingerprint).toBe("string");
    expect(snap.phase).toBe("DRAFT_SAVED");
    expect(snap.sellerAccountId).toBe("acct");
    expect(snap.status).toBe("AWAITING_APPROVAL");
    // ...and NO review body, draft/reply text, or PII anywhere in the file.
    expect(raw).not.toContain(PHONE_TOKEN);
    expect(raw).not.toContain(EMAIL_TOKEN);
    expect(raw).not.toContain("죄송");
    expect(raw).not.toContain("body");
    expect(raw).not.toContain("redacted");
  });

  it("resumes an approve across a restart, binding the SAME draft version and minting once", async () => {
    const store = new FileReviewRunStore(freshStoreDir());
    const fake = new FakeReviewSpringClient(twoReviews()); // backend survives; only the runtime restarts

    const before = new ReviewAgentRuntime({ client: fake, runStore: store });
    const started = await before.start("t-restart", { intent: "HANDLE_REVIEW_REPLIES", accountId: "acct" });
    expect(started.status).toBe("AWAITING_APPROVAL");
    if (started.status !== "AWAITING_APPROVAL") return;
    const versionAtCheckpoint = started.checkpoint.draftVersion;
    expect(fake.approvalStateOf(OLDER_REVIEW_REF)).toBeNull(); // nothing committed yet

    // Restart: brand-new runtime (empty checkpointer + liveThreads), same store + backend.
    const after = new ReviewAgentRuntime({ client: fake, runStore: store });
    const done = await after.resume("t-restart", { approved: true, approvedBy: "op" });

    expect(done.status).toBe("DONE");
    if (done.status !== "DONE") return;
    expect(done.outcome?.decision).toBe("APPROVED");
    expect(done.outcome?.draftVersion).toBe(versionAtCheckpoint); // SAME draft version
    expect(done.outcome?.guidedSessionPrepared).toBe(true);
    expect(done.trail).toContain("resumed_after_restart");

    // Approved exactly once, one guided ref, no duplicate draft, nothing sent.
    expect(fake.approvalStateOf(OLDER_REVIEW_REF)).toBe("APPROVED");
    expect(fake.mintCount).toBe(1);
    expect(fake.draftVersionsOf(OLDER_REVIEW_REF)).toEqual([1]);
    expect(fake.externalSendAttempts).toBe(0);
  });

  it("resumes a reject across a restart, leaving the review RESPONSE_NEEDED and uncommitted", async () => {
    const store = new FileReviewRunStore(freshStoreDir());
    const fake = new FakeReviewSpringClient(twoReviews());

    await new ReviewAgentRuntime({ client: fake, runStore: store }).start("t-rj", {
      intent: "HANDLE_REVIEW_REPLIES",
      accountId: "acct",
    });
    const done = await new ReviewAgentRuntime({ client: fake, runStore: store }).resume("t-rj", {
      approved: false,
      approvedBy: "op",
    });

    expect(done.status).toBe("DONE");
    if (done.status !== "DONE") return;
    expect(done.outcome?.decision).toBe("REJECTED");
    expect(fake.approvalStateOf(OLDER_REVIEW_REF)).toBeNull();
    expect(fake.mintCount).toBe(0);
    expect(fake.dispositionOf(OLDER_REVIEW_REF)).toBe("RESPONSE_NEEDED");
  });

  it("double-resume after restart is idempotent (second resume replays; still one guided ref)", async () => {
    const store = new FileReviewRunStore(freshStoreDir());
    const fake = new FakeReviewSpringClient(twoReviews());

    await new ReviewAgentRuntime({ client: fake, runStore: store }).start("t-dbl", {
      intent: "HANDLE_REVIEW_REPLIES",
      accountId: "acct",
    });
    const first = await new ReviewAgentRuntime({ client: fake, runStore: store }).resume("t-dbl", { approved: true, approvedBy: "u" });
    const second = await new ReviewAgentRuntime({ client: fake, runStore: store }).resume("t-dbl", { approved: true, approvedBy: "u" });

    expect(first.status).toBe("DONE");
    expect(second.status).toBe("DONE");
    if (first.status !== "DONE" || second.status !== "DONE") return;
    expect(second.outcome?.submissionRef).toBe(first.outcome?.submissionRef);
    expect(fake.mintCount).toBe(1);
    expect(fake.draftVersionsOf(OLDER_REVIEW_REF)).toEqual([1]);
  });
});

describe("review resume fails closed against an execution-enabled backend", () => {
  it("throws before any approval/mint, even on the durable restart path", async () => {
    const store = new InMemoryReviewRunStore();
    await store.save({
      threadId: "t-guard-resume",
      status: "AWAITING_APPROVAL",
      sellerAccountId: "acct",
      reviewRef: OLDER_REVIEW_REF,
      draftVersion: 1,
      draftFingerprint: "fp-x",
      phase: "DRAFT_SAVED",
      priorityBucket: "top",
      trail: ["searched", "prioritized", "draft_prepared"],
    });
    const enabled = new FakeReviewSpringClient(twoReviews(), { dispatchAdapterEnabled: true });
    const runtime = new ReviewAgentRuntime({ client: enabled, runStore: store });

    await expect(runtime.resume("t-guard-resume", { approved: true, approvedBy: "u" })).rejects.toThrow(
      /reply-send is ENABLED/,
    );
    expect(enabled.calls.approve).toBe(0);
    expect(enabled.mintCount).toBe(0);
    expect(enabled.externalSendAttempts).toBe(0);
  });
});

describe("ReviewRunStore implementations", () => {
  it("InMemoryReviewRunStore round-trips and deletes", async () => {
    const s = new InMemoryReviewRunStore();
    expect(await s.load("x")).toBeNull();
    await s.save({
      threadId: "x",
      status: "AWAITING_APPROVAL",
      sellerAccountId: "acct",
      reviewRef: OLDER_REVIEW_REF,
      draftVersion: 1,
      draftFingerprint: "fp",
      phase: "DRAFT_SAVED",
      priorityBucket: "top",
      trail: [],
    });
    expect((await s.load("x"))?.reviewRef).toBe(OLDER_REVIEW_REF);
    await s.delete("x");
    expect(await s.load("x")).toBeNull();
  });
});
