import { describe, expect, it } from "vitest";
import { issueSubjectOf } from "../../src/conversation/issueSubject";
import { narrowIssuesBySubject } from "../../src/tools/issueSubjectMatch";
import type { ReviewIssueSummary } from "../../src/spring/types";

/**
 * <b>Which repeated problem the seller named, and which of the org's problems that is.</b>
 *
 * Pilot QA (2026-09-06): 「접착 부족 문제 근거 보여줘」 was answered with 접착 파손 · 배송 파손 ·
 * 표면 누락 — the head of the org's list, delivered as if it were the answer. The two halves are tested
 * apart because they fail differently: reading the wrong span turns an exact question into an ambiguous
 * one, and matching too loosely turns it into a confident wrong answer.
 */
describe("the problem name in the sentence", () => {
  it("keeps the WHOLE name, not its head noun", () => {
    // 「부족」 alone would match 설명 부족 just as well, which is how an exact question becomes ambiguous.
    expect(issueSubjectOf("접착 부족 문제 근거 보여줘")).toBe("접착 부족");
    expect(issueSubjectOf("배송 파손 이슈 자세히 알려줘")).toBe("배송 파손");
  });

  it("reads the half a sentence names, and no more", () => {
    expect(issueSubjectOf("접착 문제 근거 보여줘")).toBe("접착");
    expect(issueSubjectOf("접착 부족 관련 리뷰 있어?")).toBe("접착 부족");
    expect(issueSubjectOf("포장 파손에 대한 근거 보여줘")).toBe("포장 파손");
  });

  it("drops leading words that name nothing", () => {
    expect(issueSubjectOf("가장 접착 부족 문제")).toBe("접착 부족");
  });

  it("names nothing when the sentence is about the LIST", () => {
    // These mark a grammatical subject and name no problem — the whole list is the right answer, and a
    // lane that narrowed here would refuse an ordinary question.
    expect(issueSubjectOf("반복되는 문제 뭐야?")).toBeNull();
    expect(issueSubjectOf("가장 많은 문제 알려줘")).toBeNull();
    expect(issueSubjectOf("어떤 문제가 있어?")).toBeNull();
    expect(issueSubjectOf("리뷰 문제 정리해줘")).toBeNull();
    // Words that already have their own axis are not names either — the shared table says so
    // (`subjectTerm.ts`), and this one was measured: 「상품별 최근 문제」 read as the name 「상품별 최근」.
    expect(issueSubjectOf("상품별 최근 문제를 알려줘")).toBeNull();
    expect(issueSubjectOf("반복 이슈가 있는지 알려줘")).toBeNull();
    expect(issueSubjectOf("고객 불만이나 반복 이슈 알려줘")).toBeNull();
    expect(issueSubjectOf("")).toBeNull();
  });
});

function issue(id: string, title: string): ReviewIssueSummary {
  return {
    id, title, aspect: "", problem: "", severity: "NORMAL", lifecycleState: "OBSERVING",
    lifecycleLabelKo: "관찰 중", evidenceCount: 1, firstEvidenceOn: null, lastEvidenceOn: null,
    dominantProductId: null, dominantProductName: null, dismissed: false, extractorKind: "RULE_BASED",
    change: { kinds: [], labelsKo: [], highSurge: false, surgeWindowCount: 0, surgeBaselineWeekly: 0 },
  } as ReviewIssueSummary;
}

const ORG = [
  issue("a", "접착 부족"),
  issue("b", "접착 탈락"),
  issue("c", "접착 파손"),
  issue("d", "배송 파손"),
];

describe("matching a name to the problems this org has", () => {
  it("an exact name selects exactly one", () => {
    expect(narrowIssuesBySubject(ORG, "접착 부족").map((i) => i.id)).toEqual(["a"]);
  });

  it("half a name selects every problem that carries it — the seller is asked which", () => {
    expect(narrowIssuesBySubject(ORG, "접착").map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("a name this org does not have selects NOTHING — never the rest of the list", () => {
    expect(narrowIssuesBySubject(ORG, "색상 불량")).toEqual([]);
  });

  it("no name reads the list whole, exactly as before", () => {
    expect(narrowIssuesBySubject(ORG, null)).toHaveLength(4);
    expect(narrowIssuesBySubject(ORG, "")).toHaveLength(4);
  });

  it("spacing is not a different question", () => {
    expect(narrowIssuesBySubject(ORG, "접착부족").map((i) => i.id)).toEqual(["a"]);
  });

  it("the longer name wins over the shorter one it contains", () => {
    // An org holding both 접착 and 접착 부족: a seller who said the long one already chose.
    const both = [issue("x", "접착"), ...ORG];
    expect(narrowIssuesBySubject(both, "접착 부족").map((i) => i.id)).toEqual(["a"]);
  });
});
