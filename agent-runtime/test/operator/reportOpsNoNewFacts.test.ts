/**
 * ReportOps is a viewpoint, not a source.
 *
 * <b>The rule exists because it was broken once, on real data.</b> v1's ReportOps called its own tools
 * and minted its own evidence, so a live run reported the same 3,208 unanswered inquiries twice — once
 * from InquiryOps, once from here — under two evidence ids, reading as two facts. Two parts of one
 * answer printing different-looking versions of one number is the same defect the home/report parity
 * work had to fix on the frontend.
 *
 * Two independent checks, because either alone could be satisfied while the property was false: the
 * FUNCTION registers no evidence, and the GRAPH gives it no tools to register any with.
 */
import { describe, expect, it } from "vitest";
import { runReportOps } from "../../src/operator/graph/reportOpsNode";
import { TOOL_CAPABILITIES, toolsFor } from "../../src/operator/tools/ToolReachability";
import type { Finding } from "../../src/operator/state/OperatorState";

const UPSTREAM: Finding[] = [
  {
    findingId: "f-e1", specialist: "INQUIRY_OPS", statement: "답변이 필요한 문의가 3208건 있습니다.",
    evidenceIds: ["e1"], confidence: "SUPPORTED", verdict: null,
    surfaceLink: "/inquiries?state=NEEDS_REPLY",
  },
  {
    findingId: "f-e2", specialist: "REVIEW_OPS", statement: "\"접착 탈락\" 근거 12건.",
    evidenceIds: ["e2"], confidence: "SUPPORTED", verdict: null, surfaceLink: "/memory/issue-1",
  },
];

describe("ReportOps composes without sourcing", () => {
  it("registers no evidence of its own", () => {
    const result = runReportOps({ findings: UPSTREAM, needs: [{ id: "n1" }] });
    expect(result.evidence).toEqual([]);
  });

  it("cites only evidence ids the other specialists produced", () => {
    const result = runReportOps({ findings: UPSTREAM, needs: [{ id: "n1" }] });
    const upstreamIds = new Set(UPSTREAM.flatMap((f) => f.evidenceIds));
    for (const finding of result.findings) {
      expect(finding.evidenceIds.length).toBeGreaterThan(0);
      for (const id of finding.evidenceIds) {
        expect(upstreamIds.has(id), `report cited ${id}, which no specialist registered`).toBe(true);
      }
    }
  });

  it("ignores any finding that claims to be its own", () => {
    // Defensive: a REPORT_OPS finding fed back in must not become its own input on a second pass, or a
    // re-plan would compound the same sentence into itself.
    const withOwn: Finding[] = [
      ...UPSTREAM,
      { findingId: "f-r", specialist: "REPORT_OPS", statement: "요약", evidenceIds: ["e1"],
        confidence: "SUPPORTED", verdict: null, surfaceLink: null },
    ];
    const result = runReportOps({ findings: withOwn, needs: [{ id: "n1" }] });
    expect(result.findings.every((f) => !f.statement.includes("요약"))).toBe(true);
  });

  it("says so honestly when the other specialists found nothing", () => {
    const result = runReportOps({ findings: [], needs: [{ id: "n1" }] });
    expect(result.findings).toEqual([]);
    expect(result.note).toContain("확인된 항목이 없습니다");
    expect(result.needStates[0]!.status).toBe("UNSATISFIABLE");
  });

  it("REPORT_OPS has no tool capability at all", () => {
    // The structural half, now read off the capability matrix rather than off a literal in the graph:
    // even if the function above were changed to call a tool, no row authorizes REPORT_OPS to use one
    // and the registry refuses anything outside the allow-list.
    expect(toolsFor("REPORT_OPS")).toEqual([]);
    expect(TOOL_CAPABILITIES.filter((c) => c.specialist === "REPORT_OPS")).toEqual([]);
  });
});
