import { describe, expect, it } from "vitest";
import { IssueAgentRuntime } from "../../src/issueRuntime";
import { FakeIssueSpringClient } from "../support/FakeIssueSpringClient";
import {
  EXPECTED_PRIORITY_ORDER,
  fourIssues,
  ISSUE_HIGH_QUIET,
} from "../support/issueFixtures";

const REF = "2026-07-25";

describe("issue-memory subgraph — end to end", () => {
  it("runs straight to a DONE brief with NO human checkpoint", async () => {
    const runtime = new IssueAgentRuntime({ client: new FakeIssueSpringClient(fourIssues()) });
    const res = await runtime.run("t1", { intent: "HANDLE_OPERATIONS_ISSUES", referenceDate: REF, size: 3 });

    expect(res.status).toBe("DONE"); // there is no AWAITING_APPROVAL state on this path
    expect(res.trail).toEqual(["searched", "prioritized", "assembled", "composed"]);
    expect(res.brief.referenceDate).toBe(REF);
    expect(res.brief.totalActiveIssues).toBe(4);
    expect(res.brief.selectedCount).toBe(3);
  });

  it("selects and orders the worst issues, worst-first, capped at the requested size", async () => {
    const runtime = new IssueAgentRuntime({ client: new FakeIssueSpringClient(fourIssues()) });
    const res = await runtime.run("t2", { intent: "HANDLE_OPERATIONS_ISSUES", referenceDate: REF, size: 3 });
    expect(res.brief.entries.map((e) => e.issueId)).toEqual(EXPECTED_PRIORITY_ORDER.slice(0, 3));
    expect(res.brief.entries.map((e) => e.rank)).toEqual([1, 2, 3]);

    const top = res.brief.entries[0]!;
    expect(top.issueId).toBe(ISSUE_HIGH_QUIET);
    expect(top.severity).toBe("HIGH");
    expect(top.priorityBucket).toBe("top");
    expect(top.title).toBe("포장 파손");
    // The brief carries a sanitized evidence summary, not evidence rows.
    expect(top.evidenceSummary.totalEvidence).toBeGreaterThanOrEqual(0);
    expect(top.evidenceSummary.ratingDistribution).toBeDefined();
    expect(top.lifecycleHistoryDepth).toBe(2);
  });

  it("makes exactly one detail/evidence/trend read per selected issue and never more", async () => {
    const client = new FakeIssueSpringClient(fourIssues());
    const runtime = new IssueAgentRuntime({ client });
    await runtime.run("t3", { intent: "HANDLE_OPERATIONS_ISSUES", referenceDate: REF, size: 2 });
    expect(client.reads.search).toBe(1);
    expect(client.reads.context).toBe(2);
    expect(client.reads.evidenceSummary).toBe(2);
    expect(client.reads.trend).toBe(2);
  });

  it("produces an empty brief (DONE) when there are no active issues", async () => {
    const runtime = new IssueAgentRuntime({ client: new FakeIssueSpringClient([]) });
    const res = await runtime.run("t4", { intent: "HANDLE_OPERATIONS_ISSUES", referenceDate: REF });
    expect(res.status).toBe("DONE");
    expect(res.brief.totalActiveIssues).toBe(0);
    expect(res.brief.selectedCount).toBe(0);
    expect(res.brief.entries).toHaveLength(0);
    expect(res.brief.note).toBe("no active operations issues");
    expect(res.trail).toEqual(["searched", "prioritized_empty"]);
  });

  it("rejects a non-issue intent", async () => {
    const runtime = new IssueAgentRuntime({ client: new FakeIssueSpringClient(fourIssues()) });
    await expect(
      runtime.run("t5", { intent: "HANDLE_REVIEW_REPLIES", accountId: "acct" }),
    ).rejects.toThrow(/cannot handle intent/);
  });
});
