import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { IssueAgentRuntime } from "../../src/issueRuntime";
import { FileIssueRunStore } from "../../src/checkpoint/IssueRunStore";
import { FakeIssueSpringClient } from "../support/FakeIssueSpringClient";
import { fourIssues } from "../support/issueFixtures";

const REF = "2026-07-25";

describe("issue-memory determinism and restart", () => {
  it("re-running the same request in the same process yields an identical brief", async () => {
    const runtime = new IssueAgentRuntime({ client: new FakeIssueSpringClient(fourIssues()) });
    const a = await runtime.run("d1", { intent: "HANDLE_OPERATIONS_ISSUES", referenceDate: REF, size: 3 });
    const b = await runtime.run("d1", { intent: "HANDLE_OPERATIONS_ISSUES", referenceDate: REF, size: 3 });
    expect(JSON.stringify(b.brief)).toBe(JSON.stringify(a.brief));
  });

  it("a fresh runtime (simulated restart) sharing a durable store reproduces the same brief", async () => {
    const dir = mkdtempSync(join(tmpdir(), "issue-runstore-"));
    const req = { intent: "HANDLE_OPERATIONS_ISSUES", referenceDate: REF, size: 3 } as const;

    // Process 1: run and persist the brief.
    const before = new IssueAgentRuntime({
      client: new FakeIssueSpringClient(fourIssues()),
      runStore: new FileIssueRunStore(dir),
    });
    const first = await before.run("restart-1", req);

    // Process 2: a brand-new runtime + a fresh client, same durable dir. Re-run the same request.
    const store2 = new FileIssueRunStore(dir);
    const persisted = await store2.load("restart-1");
    expect(persisted).not.toBeNull();

    const after = new IssueAgentRuntime({ client: new FakeIssueSpringClient(fourIssues()), runStore: store2 });
    const second = await after.run("restart-1", req);

    // The recomputed brief matches both the first run and the durable snapshot, byte for byte.
    expect(JSON.stringify(second.brief)).toBe(JSON.stringify(first.brief));
    expect(JSON.stringify(second.brief)).toBe(JSON.stringify(persisted!.brief));
  });

  it("pins the reference date into the brief so the result is clock-independent", async () => {
    const runtime = new IssueAgentRuntime({ client: new FakeIssueSpringClient(fourIssues()) });
    const res = await runtime.run("d2", { intent: "HANDLE_OPERATIONS_ISSUES", referenceDate: REF });
    expect(res.brief.referenceDate).toBe(REF);
  });
});
