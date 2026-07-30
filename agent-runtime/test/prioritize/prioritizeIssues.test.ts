import { describe, expect, it } from "vitest";
import { prioritizeIssues, selectTopIssues } from "../../src/prioritize/prioritizeIssues";
import {
  EXPECTED_PRIORITY_ORDER,
  fourIssues,
  ISSUE_HIGH_QUIET,
  ISSUE_NORMAL_SURGING,
  makeIssue,
} from "../support/issueFixtures";

describe("prioritizeIssues", () => {
  it("orders severity first, then fired-vs-quiet, then high-surge (worst-first)", () => {
    const ranked = prioritizeIssues(fourIssues());
    expect(ranked.map((r) => r.item.id)).toEqual(EXPECTED_PRIORITY_ORDER);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
  });

  it("a HIGH quiet issue outranks a LOW surging one (severity beats trend)", () => {
    const ranked = prioritizeIssues(fourIssues());
    expect(ranked[0]!.item.id).toBe(ISSUE_HIGH_QUIET); // HIGH, no change fired
    expect(ranked[ranked.length - 1]!.item.change.highSurge).toBe(true); // LOW surging last
  });

  it("is a stable total order — the same input yields the same order every time", () => {
    const a = prioritizeIssues(fourIssues()).map((r) => r.item.id);
    const b = prioritizeIssues([...fourIssues()].reverse()).map((r) => r.item.id);
    expect(a).toEqual(EXPECTED_PRIORITY_ORDER);
    expect(b).toEqual(EXPECTED_PRIORITY_ORDER); // input order does not affect the result
  });

  it("breaks exact ties deterministically by issue id", () => {
    const twin = (id: string) =>
      makeIssue(id, { severity: "NORMAL", lastEvidenceOn: "2026-07-01", evidenceCount: 2 });
    const ranked = prioritizeIssues([twin("bbbb0000-0000-0000-0000-000000000000"), twin("aaaa0000-0000-0000-0000-000000000000")]);
    expect(ranked.map((r) => r.item.id)).toEqual([
      "aaaa0000-0000-0000-0000-000000000000",
      "bbbb0000-0000-0000-0000-000000000000",
    ]);
  });

  it("assigns coarse buckets and does not mutate the input", () => {
    const input = fourIssues();
    const snapshot = JSON.stringify(input);
    const ranked = prioritizeIssues(input);
    expect(ranked[0]!.priorityBucket).toBe("top");
    expect(ranked[3]!.priorityBucket).toBe("normal");
    expect(JSON.stringify(input)).toBe(snapshot); // pure
  });

  it("selectTopIssues slices worst-first; n<=0 selects none; n>size returns all", () => {
    const ranked = prioritizeIssues(fourIssues());
    expect(selectTopIssues(ranked, 2).map((r) => r.item.id)).toEqual([
      ISSUE_HIGH_QUIET,
      ISSUE_NORMAL_SURGING,
    ]);
    expect(selectTopIssues(ranked, 0)).toHaveLength(0);
    expect(selectTopIssues(ranked, 99)).toHaveLength(4);
  });
});
