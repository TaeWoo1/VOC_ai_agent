/**
 * Real-backend integration harness for the issue-memory subgraph (gated). Runs ONLY when
 * `RUN_REAL_INTEGRATION=1` and a live backend is reachable at `SELLEROPS_BASE_URL` (default
 * http://127.0.0.1:8080). SKIPPED in the hermetic `npm test`.
 *
 * It drives the actual `HttpSpringClient` against the Spring backend + disposable DB and proves:
 *  - the run finishes at a DONE brief with NO human checkpoint;
 *  - the brief is deterministic — a second runtime (fresh) + shared FileIssueRunStore reproduces
 *    it byte-for-byte (the restart-determinism property);
 *  - the subgraph causes ZERO backend mutation — the issue list (ids, lifecycle states, counts)
 *    is identical before and after the run;
 *  - the brief carries no review text (only ids, vocabulary labels, enums, counts, dates).
 *
 * Setup uses the human endpoints (/extract, /lifecycle-pass) to build the issue memory from
 * whatever reviews the org has; those are the seed, not the subgraph. The subgraph itself only
 * reads /api/review-issues, /{id}/context, /{id}/evidence-summary, /{id}/trend.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { IssueAgentRuntime } from "../../src/issueRuntime";
import { HttpSpringClient } from "../../src/spring/SpringClient";
import { login } from "../../src/spring/SpringSession";
import { FileIssueRunStore } from "../../src/checkpoint/IssueRunStore";
import { routeIntent } from "../../src/goal/parseGoal";

const RUN = process.env["RUN_REAL_INTEGRATION"] === "1";
const BASE_URL = process.env["SELLEROPS_BASE_URL"] ?? "http://127.0.0.1:8080";
const EMAIL = process.env["SELLEROPS_EMAIL"] ?? "demo@sellerops.ai";
const PASSWORD = process.env["SELLEROPS_PASSWORD"] ?? "demo1234";
const REF = process.env["ISSUE_REFERENCE_DATE"] ?? "2026-07-25";

describe.skipIf(!RUN)("issue-memory — real backend integration", () => {
  let token: string;
  let client: HttpSpringClient;

  async function authed(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  }

  /** A stable fingerprint of the issue list that a read must not change. */
  async function issueListFingerprint(): Promise<string> {
    const rows = (await (await authed(`/api/review-issues?referenceDate=${REF}`)).json()) as Array<{
      id: string;
      lifecycleState: string;
      evidenceCount: number;
      dismissed: boolean;
    }>;
    return JSON.stringify(
      rows
        .map((r) => ({ id: r.id, lifecycleState: r.lifecycleState, evidenceCount: r.evidenceCount, dismissed: r.dismissed }))
        .sort((a, b) => (a.id < b.id ? -1 : 1)),
    );
  }

  beforeAll(async () => {
    token = (await login(BASE_URL, EMAIL, PASSWORD)).token;
    client = new HttpSpringClient({ baseUrl: BASE_URL, token });
    // Seed the issue memory from existing reviews (idempotent), then fire the automatic pass.
    await authed(`/api/review-issues/extract?limit=500&page=0`, { method: "POST" });
    await authed(`/api/review-issues/lifecycle-pass?referenceDate=${REF}`, { method: "POST" });
  }, 120_000);

  it("routes the three intents to three distinct domains", () => {
    expect(routeIntent("HANDLE_UNANSWERED_INQUIRIES")).toBe("INQUIRY");
    expect(routeIntent("HANDLE_REVIEW_REPLIES")).toBe("REVIEW");
    expect(routeIntent("HANDLE_OPERATIONS_ISSUES")).toBe("ISSUE");
  });

  it("runs to a DONE brief with no checkpoint and mutates nothing", async () => {
    const before = await issueListFingerprint();

    const runtime = new IssueAgentRuntime({ client });
    const res = await runtime.run("iit-run", { intent: "HANDLE_OPERATIONS_ISSUES", referenceDate: REF, size: 5 });

    expect(res.status).toBe("DONE");
    expect(res.brief.referenceDate).toBe(REF);
    expect(res.brief.selectedCount).toBe(res.brief.entries.length);

    // Zero mutation: the issue list is byte-identical after the read-only run.
    const after = await issueListFingerprint();
    expect(after).toBe(before);

    // Whatever entries exist carry no review text.
    const briefJson = JSON.stringify(res.brief);
    for (const forbidden of ["redactedBody", "\"quote\"", "\"body\"", "\"note\"", "safePreview"]) {
      expect(briefJson).not.toContain(forbidden);
    }
    for (const e of res.brief.entries) {
      expect(e.issueId).toBeTruthy();
      expect(["HIGH", "NORMAL", "LOW"]).toContain(e.severity);
      expect(e.evidenceSummary.totalEvidence).toBeGreaterThanOrEqual(0);
    }
  });

  it("is deterministic across a simulated restart (fresh runtime + shared durable store)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "iit-runstore-"));
    const req = { intent: "HANDLE_OPERATIONS_ISSUES", referenceDate: REF, size: 5 } as const;

    const first = await new IssueAgentRuntime({ client, runStore: new FileIssueRunStore(dir) }).run("iit-restart", req);

    const store2 = new FileIssueRunStore(dir);
    const persisted = await store2.load("iit-restart");
    expect(persisted).not.toBeNull();

    const second = await new IssueAgentRuntime({ client, runStore: store2 }).run("iit-restart", req);
    expect(JSON.stringify(second.brief)).toBe(JSON.stringify(first.brief));
    expect(JSON.stringify(second.brief)).toBe(JSON.stringify(persisted!.brief));
  });
});
