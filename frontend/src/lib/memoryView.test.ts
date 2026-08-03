import { describe, expect, it } from "vitest";
import {
  evidenceCountLabel,
  evidenceInboxRef,
  groupIssues,
  lastSeenLabel,
  resolveIssueSelection,
} from "./memoryView";
import type { IssueChangeKind, ReviewIssueView } from "./types";

function issue(over: Partial<ReviewIssueView> & Pick<ReviewIssueView, "id">): ReviewIssueView {
  const kinds = (over.change?.kinds ?? []) as IssueChangeKind[];
  return {
    title: "제목",
    aspect: "측면",
    problem: "문제",
    severity: "NORMAL",
    lifecycleState: "NEEDS_REVIEW",
    lifecycleLabelKo: "확인 필요",
    evidenceCount: 3,
    firstEvidenceOn: "2026-07-01",
    lastEvidenceOn: "2026-08-01",
    dominantProductId: null,
    dominantProductName: null,
    dismissed: false,
    extractorKind: "RULE_BASED",
    ...over,
    change: {
      kinds,
      labelsKo: kinds.map((k) => k),
      highSurge: false,
      surgeWindowCount: 0,
      surgeBaselineWeekly: 0,
      ...over.change,
    },
  } as ReviewIssueView;
}

describe("issue grouping", () => {
  it("puts anything with a warning judgement under 확인 필요", () => {
    const groups = groupIssues([
      issue({ id: "a", change: { kinds: ["SURGING"] } as ReviewIssueView["change"] }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["changed"]);
    expect(groups[0].heading).toBe("확인 필요");
  });

  it("files an issue that both warns and improved under 확인 필요, not under good news", () => {
    // Burying a still-warning issue under 개선됨 is how an operations surface loses a reader.
    const both = issue({
      id: "both",
      change: { kinds: ["PERSISTENT", "IMPROVED"] } as ReviewIssueView["change"],
    });
    const groups = groupIssues([both]);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("changed");
  });

  it("separates purely improved issues so outcomes are reported too", () => {
    const groups = groupIssues([
      issue({ id: "warn", change: { kinds: ["NEW"] } as ReviewIssueView["change"] }),
      issue({ id: "good", change: { kinds: ["IMPROVED"] } as ReviewIssueView["change"] }),
      issue({ id: "quiet" }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["changed", "steady", "improved"]);
    expect(groups[2].issues.map((i) => i.id)).toEqual(["good"]);
  });

  it("omits empty groups rather than rendering them blank", () => {
    expect(groupIssues([issue({ id: "quiet" })]).map((g) => g.key)).toEqual(["steady"]);
    expect(groupIssues([])).toEqual([]);
  });
});

describe("deep-link selection", () => {
  const all = [issue({ id: "a" }), issue({ id: "b" })];

  it("reports nothing selected when no issue is requested", () => {
    expect(resolveIssueSelection(all, undefined)).toEqual({ kind: "NONE" });
  });

  it("resolves a requested issue", () => {
    expect(resolveIssueSelection(all, "b").kind).toBe("FOUND");
  });

  it("reports an unknown issue instead of silently showing nothing", () => {
    expect(resolveIssueSelection(all, "zzz")).toEqual({ kind: "MISSING", issueId: "zzz" });
  });

  it("resolves against every loaded issue, not one visible group", () => {
    const improved = issue({
      id: "good",
      change: { kinds: ["IMPROVED"] } as ReviewIssueView["change"],
    });
    expect(resolveIssueSelection([...all, improved], "good").kind).toBe("FOUND");
  });
});

describe("evidence → inbox linking", () => {
  it("links only when the row is actually loaded in the inbox", () => {
    expect(evidenceInboxRef("rev-1", new Set(["rev-1"]))).toBe("/inbox/rev-1");
  });

  it("returns null rather than a link that would land on 'not found'", () => {
    // A link that reliably fails is worse than no link.
    expect(evidenceInboxRef("rev-9", new Set(["rev-1"]))).toBeNull();
    expect(evidenceInboxRef("rev-1", new Set())).toBeNull();
  });
});

describe("row labels", () => {
  it("states the evidence count the server sent", () => {
    expect(evidenceCountLabel(issue({ id: "a", evidenceCount: 6 }))).toBe("근거 6건");
  });

  it("omits the last-seen line when nothing has been seen", () => {
    expect(lastSeenLabel(issue({ id: "a", lastEvidenceOn: "2026-08-02" }))).toBe(
      "마지막 확인 2026-08-02",
    );
    expect(lastSeenLabel(issue({ id: "a", lastEvidenceOn: null }))).toBeNull();
  });
});
