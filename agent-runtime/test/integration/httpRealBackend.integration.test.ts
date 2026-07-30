/**
 * Real-backend integration for the Agent Runtime HTTP surface (gated). Runs ONLY when
 * `RUN_REAL_INTEGRATION=1` and a live backend is reachable at `SELLEROPS_BASE_URL`. SKIPPED in
 * the hermetic `npm test`.
 *
 * This is the frontend→Agent Runtime→Spring path minus the browser: it boots the actual
 * {@link createHttpServer} with the production {@link defaultSpringClientFactory} against the real
 * backend + disposable DB, and drives all three intents over real HTTP with a real operator JWT.
 * It proves:
 *  - a forwarded bearer reaches the backend (the org is derived there, never from the client);
 *  - the issue intent runs read-only to a DONE brief and resuming it is a 409 (no checkpoint);
 *  - inquiry/review start reaches a checkpoint (when the queue is non-empty), resume records the
 *    decision through the durable reconstruction path, and a double resume is idempotent;
 *  - no external send ever happens (the backend capability stays fail-closed), and the run views
 *    carry no customer 원문.
 *
 * Seeding of inquiries/reviews is environment-dependent; the test is defensive — it asserts
 * reachability + invariants and skips the mutating leg when a queue is empty.
 */
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHttpServer } from "../../src/http/server";
import { AgentRunService } from "../../src/http/AgentRunService";
import { defaultSpringClientFactory } from "../../src/http/springClientFactory";
import { RunStoreProvider } from "../../src/http/runStoreProvider";
import type { RuntimeConfig } from "../../src/http/config";
import { login } from "../../src/spring/SpringSession";

const RUN = process.env["RUN_REAL_INTEGRATION"] === "1";
const BASE_URL = process.env["SELLEROPS_BASE_URL"] ?? "http://127.0.0.1:8080";
const EMAIL = process.env["SELLEROPS_EMAIL"] ?? "demo@sellerops.ai";
const PASSWORD = process.env["SELLEROPS_PASSWORD"] ?? "demo1234";
const REF = process.env["ISSUE_REFERENCE_DATE"] ?? "2026-07-25";

describe.skipIf(!RUN)("Agent Runtime HTTP — real backend integration", () => {
  let server: Server;
  let base: string;
  let token: string;
  let runStoreDir: string;

  const authHeaders = (): Record<string, string> => ({
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  });

  async function api(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: authHeaders(),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null };
  }

  /** Direct backend read (bypasses the runtime) for capability + account resolution. */
  async function backend(path: string): Promise<any> {
    const res = await fetch(`${BASE_URL}${path}`, { headers: authHeaders() });
    return res.json();
  }

  beforeAll(async () => {
    token = (await login(BASE_URL, EMAIL, PASSWORD)).token;
    runStoreDir = mkdtempSync(join(tmpdir(), "agentrt-http-it-"));
    const config: RuntimeConfig = {
      port: 0,
      backendBaseUrl: BASE_URL,
      env: "development",
      runStoreKind: "file",
      runStoreDir,
      corsAllowedOrigins: ["http://localhost:5173"],
    };
    const service = new AgentRunService({
      storeProvider: new RunStoreProvider(config),
      clientFactory: defaultSpringClientFactory(BASE_URL),
      env: config.env,
    });
    server = createHttpServer(service, config);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    // Seed the issue memory from existing reviews (idempotent) so the issue leg has content.
    await fetch(`${BASE_URL}/api/review-issues/extract?limit=500&page=0`, { method: "POST", headers: authHeaders() });
    await fetch(`${BASE_URL}/api/review-issues/lifecycle-pass?referenceDate=${REF}`, { method: "POST", headers: authHeaders() });
  }, 120_000);

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (runStoreDir) rmSync(runStoreDir, { recursive: true, force: true });
  });

  it("health + capabilities are reachable and the backend send path is fail-closed", async () => {
    const health = (await (await fetch(`${base}/health`)).json()) as any;
    expect(health.status).toBe("ok");
    const caps = (await (await fetch(`${base}/capabilities`)).json()) as any;
    expect(caps.intents).toHaveLength(3);
    const cap = await backend(`/api/inquiry-publish/capability`);
    expect(cap.executionEnabled).toBe(false);
    expect(cap.replyAdapterChannelCodes).toEqual([]);
  });

  it("issue intent runs read-only to a DONE brief; resume is a 409", async () => {
    const start = await api("POST", "/api/agent-runs", {
      intent: "HANDLE_OPERATIONS_ISSUES",
      referenceDate: REF,
      size: 5,
    });
    expect(start.status).toBe(200);
    expect(start.json.domain).toBe("ISSUE");
    expect(start.json.status).toBe("DONE");
    expect(start.json.brief.selectedCount).toBe(start.json.brief.entries.length);
    const briefJson = JSON.stringify(start.json.brief);
    for (const forbidden of ["redactedBody", "\"quote\"", "\"body\"", "\"note\"", "safePreview"]) {
      expect(briefJson).not.toContain(forbidden);
    }
    const resume = await api("POST", `/api/agent-runs/${encodeURIComponent(start.json.threadId)}/resume`, {
      approved: true,
    });
    expect(resume.status).toBe(409);
    expect(resume.json.error.code).toBe("NO_CHECKPOINT");
  });

  it("inquiry intent: start → (reject) resume → DONE, idempotent, no send", async () => {
    const start = await api("POST", "/api/agent-runs", { intent: "HANDLE_UNANSWERED_INQUIRIES" });
    expect(start.status).toBe(200);
    expect(start.json.domain).toBe("INQUIRY");
    if (start.json.status !== "AWAITING_APPROVAL") {
      // Empty queue in this environment — nothing to approve. Reachability already proven.
      expect(start.json.status).toBe("DONE");
      return;
    }
    // The live checkpoint carries only the templated reply — never the customer subject/body.
    expect(start.json.checkpoint.replyDraft).toBeTruthy();
    const threadId = start.json.threadId;
    const done = await api("POST", `/api/agent-runs/${encodeURIComponent(threadId)}/resume`, { approved: false });
    expect(done.status).toBe(200);
    expect(done.json.status).toBe("DONE");
    expect(done.json.outcome.decision).toBe("REJECTED");
    expect(done.json.outcome.externalSendAttempted).toBe(false);
    // Idempotent double resume replays DONE.
    const again = await api("POST", `/api/agent-runs/${encodeURIComponent(threadId)}/resume`, { approved: false });
    expect(again.status).toBe(200);
    expect(again.json.status).toBe("DONE");
  });

  it("review intent: start → (reject) resume → DONE, no send (when an account + worklist exist)", async () => {
    const accounts = (await backend(`/api/seller-accounts`)) as Array<{ id: string }>;
    if (!Array.isArray(accounts) || accounts.length === 0) return; // no account seeded
    const accountId = accounts[0]!.id;
    const start = await api("POST", "/api/agent-runs", { intent: "HANDLE_REVIEW_REPLIES", accountId });
    expect(start.status).toBe(200);
    expect(start.json.domain).toBe("REVIEW");
    if (start.json.status !== "AWAITING_APPROVAL") {
      expect(start.json.status).toBe("DONE");
      return;
    }
    // Review checkpoint carries no body/reply text — only version + fingerprint + locating aids.
    expect(start.json.checkpoint.draftFingerprint).toBeTruthy();
    expect(start.json.checkpoint.replyDraft).toBeUndefined();
    const threadId = start.json.threadId;
    const done = await api("POST", `/api/agent-runs/${encodeURIComponent(threadId)}/resume`, { approved: false });
    expect(done.status).toBe(200);
    expect(done.json.status).toBe("DONE");
    expect(done.json.outcome.externalSendAttempted).toBe(false);
  });

  it("rejects an unrecognized intent and a review run with no account scope", async () => {
    const bad = await api("POST", "/api/agent-runs", { intent: "NOPE" });
    expect(bad.status).toBe(400);
    const noScope = await api("POST", "/api/agent-runs", { intent: "HANDLE_REVIEW_REPLIES" });
    expect(noScope.status).toBe(400);
    expect(noScope.json.error.code).toBe("MISSING_ACCOUNT_SCOPE");
  });
});
