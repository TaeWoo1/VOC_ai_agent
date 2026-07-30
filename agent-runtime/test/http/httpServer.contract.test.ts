/**
 * Contract tests for the HTTP transport ({@link createHttpServer}) over a real socket.
 *
 * These prove the wire behaviour the frontend depends on: routing, bearer enforcement, CORS
 * preflight + allow-origin, body validation, the sanitized error envelope (never a raw message),
 * and the production-store fail-closed. The backend is faked, so no real backend is needed.
 */
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHttpServer } from "../../src/http/server";
import { AgentRunService } from "../../src/http/AgentRunService";
import type { SpringClientFactory } from "../../src/http/AgentRunService";
import { RunStoreProvider, ProductionStoreNotConfiguredError } from "../../src/http/runStoreProvider";
import type { RuntimeConfig } from "../../src/http/config";
import { FakeSpringClient } from "../support/FakeSpringClient";
import { FakeReviewSpringClient } from "../support/FakeReviewSpringClient";
import { FakeIssueSpringClient } from "../support/FakeIssueSpringClient";
import { twoInquiries, PHONE_TOKEN } from "../support/fixtures";
import { twoReviews } from "../support/reviewFixtures";
import { fourIssues } from "../support/issueFixtures";

const ORIGIN = "http://localhost:5173";

const CONFIG: RuntimeConfig = {
  port: 0,
  backendBaseUrl: "http://unused",
  env: "development",
  runStoreKind: "memory",
  runStoreDir: "./unused",
  corsAllowedOrigins: [ORIGIN],
};

/** fetch's Response.json() is typed `unknown` under @types/node; this narrows it for assertions. */
async function json(res: Response): Promise<any> {
  return res.json();
}

function buildService(): AgentRunService {
  const inquiry = new FakeSpringClient(twoInquiries());
  const review = new FakeReviewSpringClient(twoReviews());
  const issue = new FakeIssueSpringClient(fourIssues());
  const clientFactory: SpringClientFactory = () => ({
    inquiry,
    review,
    issue,
    identity: { whoami: async () => ({ userId: "u-1", orgId: "org-http-test" }) },
  });
  return new AgentRunService({ storeProvider: new RunStoreProvider(CONFIG), clientFactory, env: "development" });
}

describe("HTTP server contract", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = createHttpServer(buildService(), CONFIG);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as AddressInfo;
    base = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const auth = { Authorization: "Bearer test-token", "Content-Type": "application/json" };

  it("GET /health is public and reports liveness", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toMatchObject({ status: "ok", service: "sellerops-agent-runtime" });
  });

  it("GET /capabilities is public and lists intents", async () => {
    const res = await fetch(`${base}/capabilities`);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.intents).toHaveLength(3);
    expect(body.externalSend).toBe("disabled");
  });

  it("POST /api/agent-runs without a bearer is 401", async () => {
    const res = await fetch(`${base}/api/agent-runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent: "HANDLE_UNANSWERED_INQUIRIES" }),
    });
    expect(res.status).toBe(401);
    expect((await json(res)).error.code).toBe("MISSING_TOKEN");
  });

  it("OPTIONS preflight from an allowed origin returns 204 with CORS headers", async () => {
    const res = await fetch(`${base}/api/agent-runs`, { method: "OPTIONS", headers: { Origin: ORIGIN } });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(res.headers.get("access-control-allow-headers")).toContain("authorization");
  });

  it("does not echo CORS allow-origin for a foreign origin", async () => {
    const res = await fetch(`${base}/health`, { headers: { Origin: "http://evil.example" } });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("start → resume → get an inquiry run over HTTP", async () => {
    const startRes = await fetch(`${base}/api/agent-runs`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ intent: "HANDLE_UNANSWERED_INQUIRIES" }),
    });
    expect(startRes.status).toBe(200);
    const start = await json(startRes);
    expect(start.status).toBe("AWAITING_APPROVAL");
    expect(JSON.stringify(start)).not.toContain(PHONE_TOKEN);
    const threadId: string = start.threadId;

    const getRes = await fetch(`${base}/api/agent-runs/${encodeURIComponent(threadId)}`, { headers: auth });
    expect(getRes.status).toBe(200);
    expect((await json(getRes)).status).toBe("AWAITING_APPROVAL");

    const resumeRes = await fetch(`${base}/api/agent-runs/${encodeURIComponent(threadId)}/resume`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ approved: true, approvedBy: "SELLER:test" }),
    });
    expect(resumeRes.status).toBe(200);
    expect((await json(resumeRes)).status).toBe("DONE");
  });

  it("malformed JSON body is a 400, not a 500", async () => {
    const res = await fetch(`${base}/api/agent-runs`, { method: "POST", headers: auth, body: "{not json" });
    expect(res.status).toBe(400);
    expect((await json(res)).error.code).toBe("INVALID_JSON");
  });

  it("a request with neither goalText nor intent is a 400", async () => {
    const res = await fetch(`${base}/api/agent-runs`, { method: "POST", headers: auth, body: JSON.stringify({}) });
    expect(res.status).toBe(400);
    expect((await json(res)).error.code).toBe("INVALID_REQUEST");
  });

  it("unknown route is a 404 with a coarse envelope", async () => {
    const res = await fetch(`${base}/api/nope`, { headers: auth });
    expect(res.status).toBe(404);
    expect((await json(res)).error.code).toBe("NOT_FOUND");
  });

  it("GET /ready is 503 when the backend dependency is unreachable", async () => {
    // The default probe pings http://unused/health, which never resolves ok → not ready.
    const res = await fetch(`${base}/ready`);
    expect(res.status).toBe(503);
    const body = await json(res);
    expect(body.status).toBe("unavailable");
    expect(body.backendReachable).toBe(false);
  });
});

describe("readiness with a reachable backend", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = createHttpServer(buildService(), CONFIG, { readinessProbe: async () => ({ backendReachable: true }) });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("GET /ready is 200 and reports the run store when dependencies are up", async () => {
    const res = await fetch(`${base}/ready`);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.status).toBe("ready");
    expect(body.backendReachable).toBe(true);
    expect(body.runStore.kind).toBe("memory");
  });
});

describe("production run-store fail-closed", () => {
  it("refuses to construct a provider on a file store when APP_ENV=production", () => {
    expect(() => new RunStoreProvider({ ...CONFIG, env: "production", runStoreKind: "file" })).toThrow(
      ProductionStoreNotConfiguredError,
    );
  });

  it("refuses to construct a provider on an in-memory store when APP_ENV=production", () => {
    expect(() => new RunStoreProvider({ ...CONFIG, env: "production", runStoreKind: "memory" })).toThrow(
      ProductionStoreNotConfiguredError,
    );
  });

  it("allows the spring store in production and reports it multi-instance safe", () => {
    const provider = new RunStoreProvider({ ...CONFIG, env: "production", runStoreKind: "spring" });
    expect(provider.kind).toBe("spring");
    expect(provider.durable).toBe(true);
    expect(provider.multiInstanceSafe).toBe(true);
  });
});
