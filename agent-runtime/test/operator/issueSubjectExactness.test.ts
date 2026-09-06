/**
 * <b>A question about ONE repeated problem is answered about that problem — or not at all.</b>
 *
 * Pilot QA, 2026-09-06: 「접착 부족 문제 근거 보여줘」 came back as 접착 파손 · 배송 파손 · 표면 누락. The
 * plan was correct and is recorded here unchanged — it names `search_review_issues`, marks the mention
 * as an `ISSUE`, and sets `reviewIntent: "ISSUES"`. The tool simply had no way to be told WHICH problem,
 * so it returned the head of the org's list, and the answer read exactly like an answer.
 *
 * Three outcomes are pinned, because they are three different truths:
 *   · the name matches one problem  → that problem, and nothing beside it;
 *   · the name matches several      → the seller is ASKED, never chosen for;
 *   · the name matches none         → said as such, and the list is not offered as a substitute.
 *
 * The recorded plans are live (2026-09-07); what changed is what the runtime does with them.
 */
import { describe, expect, it } from "vitest";
import { OperatorAgentRuntime } from "../../src/operator/operatorRuntime";
import type { OperatorRunResult } from "../../src/operator/operatorRuntime";
import type { OperatorAnswer } from "../../src/operator/state/OperatorState";
import { FakeOperatorSpringClient } from "../support/FakeOperatorSpringClient";
import { FakeSpringClient } from "../support/FakeSpringClient";
import { FakeIssueSpringClient } from "../support/FakeIssueSpringClient";
import { makeIssue } from "../support/issueFixtures";
import { twoInquiries } from "../support/fixtures";
import { INBOX, MOLDING, KNOWLEDGE, coveredSignals } from "../support/operatorFixtures";
import { RECORDED_PLANS } from "../support/recordedPlans";

/** The 접착 family the demo org actually holds, plus one problem from another aspect. */
const ISSUES = [
  makeIssue("11111111-0000-0000-0000-000000000001", { severity: "NORMAL", aspect: "접착", problem: "부족", evidenceCount: 18 }),
  makeIssue("11111111-0000-0000-0000-000000000002", { severity: "NORMAL", aspect: "접착", problem: "탈락", evidenceCount: 7 }),
  makeIssue("11111111-0000-0000-0000-000000000003", { severity: "HIGH", aspect: "접착", problem: "파손", evidenceCount: 1 }),
  makeIssue("11111111-0000-0000-0000-000000000004", { severity: "HIGH", aspect: "표면", problem: "누락", evidenceCount: 1 }),
];

function build() {
  return new OperatorAgentRuntime({
    operator: new FakeOperatorSpringClient({
      inbox: INBOX,
      products: [MOLDING],
      signals: { [MOLDING.id]: coveredSignals() },
      knowledge: KNOWLEDGE,
      plansByGoal: RECORDED_PLANS,
    }),
    inquiry: new FakeSpringClient(twoInquiries()),
    issue: new FakeIssueSpringClient(ISSUES),
  });
}

function done(result: OperatorRunResult): OperatorAnswer {
  if (result.status !== "DONE") throw new Error(`expected DONE, got ${result.status}`);
  return result.answer;
}

/** Everything the seller can see from this answer. */
function visible(a: OperatorAnswer): string {
  return [a.note ?? "", ...a.findings.map((f) => f.statement)].join("\n");
}

describe("a named repeated problem", () => {
  it("is the only one answered about", async () => {
    const answer = done(await build().run("t-exact", { text: "접착 부족 문제 근거 보여줘" }));
    const text = visible(answer);

    expect(text).toContain("접착 부족");
    // The three the old answer offered instead. Their absence IS the fix.
    expect(text).not.toContain("접착 파손");
    expect(text).not.toContain("접착 탈락");
    expect(text).not.toContain("표면 누락");
    expect(answer.findings.filter((f) => f.statement.includes("근거가"))).toHaveLength(1);
  });

  it("that names several is a question back, not a choice made for the seller", async () => {
    const answer = done(await build().run("t-ambiguous", { text: "접착 문제 근거 보여줘" }));

    expect(answer.note ?? "").toContain("어느 것을 보시겠습니까");
    // Every candidate is named, so the seller can pick — and the biggest is not silently taken.
    for (const title of ["접착 부족", "접착 탈락", "접착 파손"]) {
      expect(answer.note ?? "").toContain(title);
    }
    expect(answer.note ?? "").not.toContain("표면 누락");
    // And NOTHING is answered: three of the four with the fourth past the brief's cap is the same
    // substitution one step later (measured live, 2026-09-07).
    expect(answer.findings.filter((f) => f.statement.includes("근거가"))).toHaveLength(0);
  });

  it("that this shop does not have is said, and the list is not offered instead", async () => {
    const answer = done(await build().run("t-unknown", { text: "색상 불량 문제 근거 보여줘" }));
    const text = visible(answer);

    expect(answer.note ?? "").toContain("색상 불량");
    expect(answer.note ?? "").toContain("기록에 없습니다");
    // Not the biggest problem, not any problem: answering with one would be the original defect.
    for (const title of ["접착 부족", "접착 탈락", "접착 파손", "표면 누락"]) {
      expect(text).not.toContain(title);
    }
    // And it is NOT the sentence for a shop with no repeated problems — this shop has four.
    expect(text).not.toContain("반복 리뷰 문제는 없습니다");
  });
});
