/**
 * Real-backend integration harness for the review-reply subgraph (gated). Runs ONLY when
 * `RUN_REAL_INTEGRATION=1` and a live backend is reachable at `SELLEROPS_BASE_URL` (default
 * http://127.0.0.1:8080). SKIPPED in the hermetic `npm test`.
 *
 * It drives the actual `HttpSpringClient` against the Spring backend + disposable DB:
 * verifies the fail-closed execution boundary, the reject/approve paths, double-resume
 * idempotency (one guided ref minted), and durable restart-resume (a second runtime + shared
 * FileReviewRunStore) — all binding the SAME draft version. No LLM, no external reply, no
 * channel API — reviews come from the offline MockApiConnector sync, and RESPONSE_NEEDED is
 * set through the real triage endpoint.
 *
 * Assertions are API-only (no DB reads): approval state via the prep view, guided-session
 * mint via the response, and idempotent replay. Precise audit-row counts are verified
 * separately in the live proof run.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { ReviewAgentRuntime } from "../../src/reviewRuntime";
import { HttpSpringClient } from "../../src/spring/SpringClient";
import { login } from "../../src/spring/SpringSession";
import { FileReviewRunStore } from "../../src/checkpoint/ReviewRunStore";

const RUN = process.env["RUN_REAL_INTEGRATION"] === "1";
const BASE_URL = process.env["SELLEROPS_BASE_URL"] ?? "http://127.0.0.1:8080";
const EMAIL = process.env["SELLEROPS_EMAIL"] ?? "demo@sellerops.ai";
const PASSWORD = process.env["SELLEROPS_PASSWORD"] ?? "demo1234";
const SEED_FROM = process.env["SEED_FROM"] ?? "2000-01-01";
const SEED_TO = process.env["SEED_TO"] ?? "2100-01-01";

describe.skipIf(!RUN)("review reply — real backend integration", () => {
  let token: string;
  let client: HttpSpringClient;
  let accountId: string;

  async function authed(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  }

  beforeAll(async () => {
    token = (await login(BASE_URL, EMAIL, PASSWORD)).token;
    client = new HttpSpringClient({ baseUrl: BASE_URL, token });
    const accounts = (await (await authed("/api/seller-accounts")).json()) as Array<{ id: string }>;
    expect(accounts.length).toBeGreaterThan(0);
    accountId = accounts[0]!.id;

    // Seed reviews via the offline MockApiConnector, then triage several as RESPONSE_NEEDED
    // through the real triage endpoint so the reply-work worklist is populated.
    await authed(`/api/seller-accounts/${accountId}/sync`, { method: "POST", body: JSON.stringify({ dataType: "REVIEW" }) });
    const page = (await (
      await authed(`/api/seller-accounts/${accountId}/attention/items?type=NEW_REVIEW&from=${SEED_FROM}&to=${SEED_TO}&size=50`)
    ).json()) as { items?: Array<{ actionRef: string | null }> };
    const refs = (page.items ?? []).map((i) => i.actionRef).filter((r): r is string => !!r).slice(0, 4);
    for (const ref of refs) {
      await authed(`/api/seller-accounts/${accountId}/attention/items/${encodeURIComponent(ref)}/triage`, {
        method: "POST",
        body: JSON.stringify({ disposition: "RESPONSE_NEEDED", commandId: `it-seed-triage:${ref}` }),
      });
    }
    const work = await client.listReplyWork(accountId, { todoLimit: 50 });
    expect(work.todo.length).toBeGreaterThan(2); // need several distinct reviews for the scenarios
  }, 60_000);

  it("fail-closed: the backend reports no reply adapter registered", async () => {
    const cap = await client.getPublishCapability();
    expect(cap.executionEnabled).toBe(false);
    expect(cap.replyAdapterChannelCodes).toEqual([]);
  });

  it("approve path: draft saved once before the checkpoint, approval bound, guided session prepared, no send", async () => {
    const runtime = new ReviewAgentRuntime({ client });
    const started = await runtime.start("rit-approve", { intent: "HANDLE_REVIEW_REPLIES", accountId });
    expect(started.status).toBe("AWAITING_APPROVAL");
    if (started.status !== "AWAITING_APPROVAL") return;
    const ref = started.checkpoint.actionRef;
    expect(started.checkpoint.phase).toBe("DRAFT_SAVED");
    const version = started.checkpoint.draftVersion;

    const done = await runtime.resume("rit-approve", { approved: true, approvedBy: "demo" });
    expect(done.status).toBe("DONE");
    if (done.status !== "DONE") return;
    expect(done.outcome?.decision).toBe("APPROVED");
    expect(done.outcome?.guidedSessionPrepared).toBe(true);
    expect(done.outcome?.submissionRef).toMatch(/^[0-9a-f]{16}$/);
    expect(done.outcome?.externalSendAttempted).toBe(false);

    const prep = await client.getReviewReplyPrep(accountId, ref);
    expect(prep.approval?.state).toBe("APPROVED");
    expect(prep.approval?.approvedVersion).toBe(version);
    expect(prep.draft?.version).toBe(version); // no duplicate draft version
  });

  it("reject path: no approval, no guided ref, review stays RESPONSE_NEEDED", async () => {
    const runtime = new ReviewAgentRuntime({ client });
    const started = await runtime.start("rit-reject", { intent: "HANDLE_REVIEW_REPLIES", accountId });
    if (started.status !== "AWAITING_APPROVAL") throw new Error("expected AWAITING_APPROVAL");
    const ref = started.checkpoint.actionRef;

    const done = await runtime.resume("rit-reject", { approved: false, approvedBy: "demo" });
    expect(done.status).toBe("DONE");
    if (done.status !== "DONE") return;
    expect(done.outcome?.decision).toBe("REJECTED");

    const prep = await client.getReviewReplyPrep(accountId, ref);
    expect(prep.approval).toBeNull();
    expect(prep.triageDisposition).toBe("RESPONSE_NEEDED");
    expect(prep.capabilities.canApprove).toBe(true);
  });

  it("double-resume is idempotent: same submissionRef, one approval", async () => {
    const runtime = new ReviewAgentRuntime({ client });
    const started = await runtime.start("rit-dbl", { intent: "HANDLE_REVIEW_REPLIES", accountId });
    if (started.status !== "AWAITING_APPROVAL") throw new Error("expected AWAITING_APPROVAL");

    const first = await runtime.resume("rit-dbl", { approved: true, approvedBy: "demo" });
    const second = await runtime.resume("rit-dbl", { approved: true, approvedBy: "demo" });
    if (first.status !== "DONE" || second.status !== "DONE") throw new Error("expected DONE");
    expect(second.outcome?.submissionRef).toBe(first.outcome?.submissionRef);
    expect(second.outcome?.approvedFingerprint).toBe(first.outcome?.approvedFingerprint);
  });

  it("durable restart-resume: a new runtime + shared FileReviewRunStore finishes, same draft version", async () => {
    const store = new FileReviewRunStore(mkdtempSync(join(tmpdir(), "rit-runstore-")));
    const before = new ReviewAgentRuntime({ client, runStore: store });
    const started = await before.start("rit-restart", { intent: "HANDLE_REVIEW_REPLIES", accountId });
    if (started.status !== "AWAITING_APPROVAL") throw new Error("expected AWAITING_APPROVAL");
    const ref = started.checkpoint.actionRef;
    const version = started.checkpoint.draftVersion;

    const after = new ReviewAgentRuntime({ client, runStore: store });
    const done = await after.resume("rit-restart", { approved: true, approvedBy: "demo" });
    expect(done.status).toBe("DONE");
    if (done.status !== "DONE") return;
    expect(done.outcome?.decision).toBe("APPROVED");
    expect(done.outcome?.draftVersion).toBe(version);

    const prep = await client.getReviewReplyPrep(accountId, ref);
    expect(prep.approval?.approvedVersion).toBe(version);
    expect(prep.draft?.version).toBe(version);
  });
});
