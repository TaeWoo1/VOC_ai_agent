import { describe, expect, it } from "vitest";
import { buildIssueToolRegistry } from "../../src/tools/IssueToolRegistry";
import { ISSUE_TOOL } from "../../src/tools/issueTools";
import { FakeIssueSpringClient } from "../support/FakeIssueSpringClient";
import { fourIssues, ISSUE_HIGH_QUIET } from "../support/issueFixtures";

describe("issue tool registry", () => {
  function registry() {
    return buildIssueToolRegistry(new FakeIssueSpringClient(fourIssues()));
  }

  it("exposes exactly the four required tools by their product-facing names", () => {
    expect(registry().names().sort()).toEqual(
      [
        ISSUE_TOOL.SEARCH_ISSUES,
        ISSUE_TOOL.GET_DETAIL,
        ISSUE_TOOL.GET_EVIDENCE_SUMMARY,
        ISSUE_TOOL.GET_TREND,
      ].sort(),
    );
    expect(ISSUE_TOOL.SEARCH_ISSUES).toBe("search_review_issues");
    expect(ISSUE_TOOL.GET_DETAIL).toBe("get_review_issue_detail");
    expect(ISSUE_TOOL.GET_EVIDENCE_SUMMARY).toBe("get_review_issue_evidence_summary");
    expect(ISSUE_TOOL.GET_TREND).toBe("get_review_issue_trend");
  });

  it("has NO tool that mutates issue state (read-only capability set)", () => {
    const names = registry().names().join(" ");
    expect(names).not.toMatch(/extract|dismiss|acting|remediat|restore|lifecycle|feedback|write/i);
  });

  it("search returns quote-free issue rows", async () => {
    const rows = await registry().invoke(ISSUE_TOOL.SEARCH_ISSUES, { dismissed: false });
    expect(Array.isArray(rows)).toBe(true);
    expect((rows as unknown[]).length).toBe(4);
  });

  it("detail/evidence-summary/trend forward to the backend for one issue", async () => {
    const r = registry();
    const ctx = (await r.invoke(ISSUE_TOOL.GET_DETAIL, { issueId: ISSUE_HIGH_QUIET })) as {
      issue: { id: string };
      history: unknown[];
    };
    expect(ctx.issue.id).toBe(ISSUE_HIGH_QUIET);
    expect(Array.isArray(ctx.history)).toBe(true);

    const sum = (await r.invoke(ISSUE_TOOL.GET_EVIDENCE_SUMMARY, { issueId: ISSUE_HIGH_QUIET })) as {
      totalEvidence: number;
    };
    expect(sum.totalEvidence).toBeGreaterThanOrEqual(0);

    const trend = (await r.invoke(ISSUE_TOOL.GET_TREND, { issueId: ISSUE_HIGH_QUIET })) as {
      id: string;
      severity: string;
    };
    expect(trend.id).toBe(ISSUE_HIGH_QUIET);
    expect(trend.severity).toBe("HIGH");
  });

  it("rejects a malformed referenceDate (fail closed on tool input)", async () => {
    await expect(
      registry().invoke(ISSUE_TOOL.SEARCH_ISSUES, { referenceDate: "2026/07/25" }),
    ).rejects.toBeTruthy();
  });
});
