/**
 * Real-backend integration harness (item 10). Gated: runs ONLY when
 * `RUN_REAL_INTEGRATION=1` and a live backend is reachable at `SELLEROPS_BASE_URL`
 * (default http://127.0.0.1:8080). It is SKIPPED in the hermetic `npm test`.
 *
 * It drives the actual `HttpSpringClient` against the Spring backend + disposable DB:
 * verifies the fail-closed execution boundary, the OPEN pagination/detail/proposal/draft/
 * approval contract, the reject and approve paths, double-resume idempotency, and durable
 * restart-resume (a second runtime instance + shared FileRunStore). No LLM, no external
 * reply, no channel API — fixtures come from the offline MockApiConnector sync.
 *
 * Assertions are API-only (no DB reads): phase transitions, draft version, publish status,
 * and idempotent replay. Precise audit-row counts are verified separately in the live
 * proof run.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { InquiryAgentRuntime } from "../../src/runtime";
import { HttpSpringClient } from "../../src/spring/SpringClient";
import { login } from "../../src/spring/SpringSession";
import { FileRunStore } from "../../src/checkpoint/RunStore";
import type { InquiryDetail } from "../../src/spring/types";

const RUN = process.env["RUN_REAL_INTEGRATION"] === "1";
const BASE_URL = process.env["SELLEROPS_BASE_URL"] ?? "http://127.0.0.1:8080";
const EMAIL = process.env["SELLEROPS_EMAIL"] ?? "demo@sellerops.ai";
const PASSWORD = process.env["SELLEROPS_PASSWORD"] ?? "demo1234";

describe.skipIf(!RUN)("real backend integration", () => {
  let token: string;
  let client: HttpSpringClient;

  async function authed(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  }

  beforeAll(async () => {
    token = (await login(BASE_URL, EMAIL, PASSWORD)).token;
    client = new HttpSpringClient({ baseUrl: BASE_URL, token });
    // Seed OPEN inquiry work items via the offline MockApiConnector (no channel/external call).
    const accounts = (await (await authed("/api/seller-accounts")).json()) as Array<{ id: string }>;
    expect(accounts.length).toBeGreaterThan(0);
    await authed(`/api/seller-accounts/${accounts[0]!.id}/sync`, {
      method: "POST",
      body: JSON.stringify({ dataType: "INQUIRY" }),
    });
    const open = (await client.listInquiries({ phase: "OPEN", size: 100 })).totalElements;
    expect(open).toBeGreaterThan(3); // need several distinct items for the scenarios
  }, 60_000);

  it("fail-closed: the backend reports the reply-send path disabled", async () => {
    const cap = await client.getPublishCapability();
    expect(cap.executionEnabled).toBe(false);
    expect(cap.replyAdapterChannelCodes).toEqual([]);
  });

  it("approve path: OPEN pages/detail/proposal/draft/approval contract, draft saved once, no send", async () => {
    const runtime = new InquiryAgentRuntime({ client });
    const started = await runtime.start("it-approve", { intent: "HANDLE_UNANSWERED_INQUIRIES" });
    expect(started.status).toBe("AWAITING_APPROVAL");
    if (started.status !== "AWAITING_APPROVAL") return;
    const wi = started.checkpoint.workItemId;
    expect(started.checkpoint.phase).toBe("OPEN");

    const done = await runtime.resume("it-approve", { approved: true, approvedBy: "demo" });
    expect(done.status).toBe("DONE");
    if (done.status !== "DONE") return;
    expect(done.outcome?.decision).toBe("APPROVED");
    expect(done.outcome?.phase).toBe("ACTION_PENDING");
    expect(done.outcome?.executionStatus).toBe("ACTION_PENDING"); // fail closed: nothing dispatched
    expect(done.outcome?.externalSendAttempted).toBe(false);

    const detail = (await client.getInquiryDetail(wi)) as InquiryDetail;
    expect(detail.phase).toBe("ACTION_PENDING");
    expect(detail.draft?.version).toBe(1); // exactly one draft version
  });

  it("reject path: no draft/approval mutation, item stays OPEN", async () => {
    const runtime = new InquiryAgentRuntime({ client });
    const started = await runtime.start("it-reject", { intent: "HANDLE_UNANSWERED_INQUIRIES" });
    if (started.status !== "AWAITING_APPROVAL") throw new Error("expected AWAITING_APPROVAL");
    const wi = started.checkpoint.workItemId;

    const done = await runtime.resume("it-reject", { approved: false, approvedBy: "demo" });
    expect(done.status).toBe("DONE");
    if (done.status !== "DONE") return;
    expect(done.outcome?.decision).toBe("REJECTED");

    const detail = await client.getInquiryDetail(wi);
    expect(detail.phase).toBe("OPEN"); // unchanged
    expect(detail.draft).toBeNull(); // no draft written
  });

  it("double-resume is idempotent: same result, one draft version", async () => {
    const runtime = new InquiryAgentRuntime({ client });
    const started = await runtime.start("it-dbl", { intent: "HANDLE_UNANSWERED_INQUIRIES" });
    if (started.status !== "AWAITING_APPROVAL") throw new Error("expected AWAITING_APPROVAL");
    const wi = started.checkpoint.workItemId;

    const first = await runtime.resume("it-dbl", { approved: true, approvedBy: "demo" });
    const second = await runtime.resume("it-dbl", { approved: true, approvedBy: "demo" });
    if (first.status !== "DONE" || second.status !== "DONE") throw new Error("expected DONE");
    expect(second.outcome?.approvedFingerprint).toBe(first.outcome?.approvedFingerprint);

    const detail = await client.getInquiryDetail(wi);
    expect(detail.draft?.version).toBe(1); // NOT 2 — no duplicate draft
  });

  it("durable restart-resume: a new runtime + shared FileRunStore finishes the run", async () => {
    const store = new FileRunStore(mkdtempSync(join(tmpdir(), "it-runstore-")));
    const before = new InquiryAgentRuntime({ client, runStore: store });
    const started = await before.start("it-restart", { intent: "HANDLE_UNANSWERED_INQUIRIES" });
    if (started.status !== "AWAITING_APPROVAL") throw new Error("expected AWAITING_APPROVAL");
    const wi = started.checkpoint.workItemId;

    // New runtime = simulated restart (empty in-memory checkpointer), same durable store + backend.
    const after = new InquiryAgentRuntime({ client, runStore: store });
    const done = await after.resume("it-restart", { approved: true, approvedBy: "demo" });
    expect(done.status).toBe("DONE");
    if (done.status !== "DONE") return;
    expect(done.outcome?.decision).toBe("APPROVED");
    expect(done.outcome?.phase).toBe("ACTION_PENDING");

    const detail = await client.getInquiryDetail(wi);
    expect(detail.phase).toBe("ACTION_PENDING");
    expect(detail.draft?.version).toBe(1);
  });
});
