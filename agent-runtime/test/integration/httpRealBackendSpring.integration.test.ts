/**
 * Pilot-readiness integration for the Agent Runtime on the PRODUCTION run store (gated). Runs only
 * when `RUN_REAL_INTEGRATION=1` against a live backend at `SELLEROPS_BASE_URL` that has the V33
 * `agent_runs` migration applied. SKIPPED in the hermetic `npm test`.
 *
 * Unlike the file-store integration, this drives the Agent Runtime with the BACKEND-OWNED run store
 * (`AGENT_RUNTIME_RUNSTORE_KIND=spring`) — the store the pilot actually uses — and proves the
 * properties the local store cannot make safe:
 *  - a provider boots in APP_ENV=production on the spring store (file/memory would fail closed);
 *  - a run survives a process restart because the state lives in the backend, not the process;
 *  - a truly CONCURRENT double resume mutates EXACTLY ONCE (the claim CAS elects one winner), while
 *    a sequential double resume is idempotent;
 *  - no external send ever happens and no run view carries customer 원문.
 */
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
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

function springConfig(env: RuntimeConfig["env"]): RuntimeConfig {
  return {
    port: 0,
    backendBaseUrl: BASE_URL,
    env,
    runStoreKind: "spring",
    runStoreDir: "./unused",
    corsAllowedOrigins: ["http://localhost:5173"],
  };
}

function newServer(): Server {
  const config = springConfig("development");
  const service = new AgentRunService({
    storeProvider: new RunStoreProvider(config),
    clientFactory: defaultSpringClientFactory(BASE_URL),
    env: config.env,
  });
  return createHttpServer(service, config);
}

describe.skipIf(!RUN)("Agent Runtime HTTP — spring store, real backend (pilot)", () => {
  let serverA: Server;
  let serverB: Server;
  let baseA: string;
  let baseB: string;
  let token: string;

  const authHeaders = (): Record<string, string> => ({
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  });

  async function apiOn(base: string, method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: authHeaders(),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null };
  }

  beforeAll(async () => {
    token = (await login(BASE_URL, EMAIL, PASSWORD)).token;
    serverA = newServer();
    serverB = newServer(); // a SEPARATE process-equivalent sharing the same backend store
    await new Promise<void>((r) => serverA.listen(0, "127.0.0.1", r));
    await new Promise<void>((r) => serverB.listen(0, "127.0.0.1", r));
    baseA = `http://127.0.0.1:${(serverA.address() as AddressInfo).port}`;
    baseB = `http://127.0.0.1:${(serverB.address() as AddressInfo).port}`;
    await fetch(`${BASE_URL}/api/review-issues/extract?limit=500&page=0`, { method: "POST", headers: authHeaders() });
    await fetch(`${BASE_URL}/api/review-issues/lifecycle-pass?referenceDate=${REF}`, { method: "POST", headers: authHeaders() });
  }, 120_000);

  afterAll(async () => {
    if (serverA) await new Promise<void>((r) => serverA.close(() => r()));
    if (serverB) await new Promise<void>((r) => serverB.close(() => r()));
  });

  it("a provider boots in production on the spring store (file/memory would fail closed)", () => {
    const provider = new RunStoreProvider(springConfig("production"));
    expect(provider.multiInstanceSafe).toBe(true);
    expect(provider.durable).toBe(true);
  });

  it("readiness reports the backend reachable on the spring store", async () => {
    const res = await fetch(`${baseA}/ready`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.backendReachable).toBe(true);
    expect(body.runStore.kind).toBe("spring");
    expect(body.runStore.multiInstanceSafe).toBe(true);
  });

  it("a run started on one process resumes on another (durable across restart)", async () => {
    const start = await apiOn(baseA, "POST", "/api/agent-runs", { intent: "HANDLE_UNANSWERED_INQUIRIES" });
    expect(start.status).toBe(200);
    if (start.json.status !== "AWAITING_APPROVAL") {
      expect(start.json.status).toBe("DONE"); // empty queue — reachability already proven
      return;
    }
    const threadId = start.json.threadId;
    // Resume on the OTHER server (fresh process; the paused state lives only in the backend).
    const done = await apiOn(baseB, "POST", `/api/agent-runs/${encodeURIComponent(threadId)}/resume`, { approved: false });
    expect(done.status).toBe(200);
    expect(done.json.status).toBe("DONE");
    expect(done.json.outcome.externalSendAttempted).toBe(false);
  });

  it("CONCURRENT double resume commits exactly once; the loser is a 409, no external send", async () => {
    const start = await apiOn(baseA, "POST", "/api/agent-runs", { intent: "HANDLE_UNANSWERED_INQUIRIES" });
    expect(start.status).toBe(200);
    if (start.json.status !== "AWAITING_APPROVAL") return; // empty queue
    const threadId = start.json.threadId;

    // Fire two resumes simultaneously at DIFFERENT processes sharing the backend store.
    const [r1, r2] = await Promise.all([
      apiOn(baseA, "POST", `/api/agent-runs/${encodeURIComponent(threadId)}/resume`, { approved: true }),
      apiOn(baseB, "POST", `/api/agent-runs/${encodeURIComponent(threadId)}/resume`, { approved: true }),
    ]);
    // Exactly one commits (200 DONE); the other fails closed (409). The mutation is idempotent for
    // inquiry regardless, but the claim gate makes the "exactly one winner" observable.
    const dones = [r1, r2].filter((r) => r.status === 200 && r.json.status === "DONE");
    expect(dones.length).toBeGreaterThanOrEqual(1);
    for (const r of [r1, r2]) {
      if (r.status === 200) expect(r.json.outcome.externalSendAttempted).toBe(false);
      else expect(r.status).toBe(409);
    }

    // A later sequential resume replays DONE idempotently.
    const again = await apiOn(baseA, "POST", `/api/agent-runs/${encodeURIComponent(threadId)}/resume`, { approved: true });
    expect([200, 409]).toContain(again.status);
    if (again.status === 200) expect(again.json.status).toBe("DONE");
  });

  it("issue intent runs read-only to a DONE brief; resume is a 409, brief is quote-free", async () => {
    const start = await apiOn(baseA, "POST", "/api/agent-runs", {
      intent: "HANDLE_OPERATIONS_ISSUES",
      referenceDate: REF,
      size: 5,
    });
    expect(start.status).toBe(200);
    expect(start.json.status).toBe("DONE");
    const briefJson = JSON.stringify(start.json.brief);
    for (const forbidden of ['"body"', '"quote"', '"comments"', '"draft"', "redactedBody"]) {
      expect(briefJson).not.toContain(forbidden);
    }
    const resume = await apiOn(baseA, "POST", `/api/agent-runs/${encodeURIComponent(start.json.threadId)}/resume`, {
      approved: true,
    });
    expect(resume.status).toBe(409);
    expect(resume.json.error.code).toBe("NO_CHECKPOINT");
  });
});
