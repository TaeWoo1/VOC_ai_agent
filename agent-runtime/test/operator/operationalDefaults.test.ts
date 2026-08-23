/**
 * Operational defaults — the question the system already knew the answer to.
 *
 * <b>The red cases are three of the six baseline runs.</b> Q2, Q3 and Q6 each came back as a question
 * about a period, and each had a period available: `list_repeated_inquiries` declares a 28-day window,
 * and `/api/review-issues` declares that it has none at all and returns the open list. Zero tools ran in
 * all three (`docs/agent_real_validation_v1.md` §3, defect A4).
 *
 * <b>What is NOT being added.</b> No global "최근 = 28일". The 28 comes from the capability that owns it
 * and is read back from the rows it returns; where no capability declares anything — `ORDER_HISTORY` has
 * no reachable tool — the clarification survives, which the last describe block holds.
 *
 * <b>And the line to `EvidenceTime`.</b> A default query window is a retrieval scope, not a date on a
 * row. The last block asserts that applying one changes no evidence's `asOf` and mints no `events`.
 */
import { describe, expect, it } from "vitest";
import { OperatorAgentRuntime } from "../../src/operator/operatorRuntime";
import type { OperatorRunResult } from "../../src/operator/operatorRuntime";
import { FakeOperatorSpringClient } from "../support/FakeOperatorSpringClient";
import type { FakeOperatorSeed } from "../support/FakeOperatorSpringClient";
import { FakeSpringClient } from "../support/FakeSpringClient";
import { FakeIssueSpringClient } from "../support/FakeIssueSpringClient";
import { twoInquiries } from "../support/fixtures";
import { fourIssues } from "../support/issueFixtures";
import {
  ANALYSES, CABLE, INBOX, KNOWLEDGE, MEMORY, MOLDING, REPEATS, coveredSignals, unlinkedSignals,
} from "../support/operatorFixtures";
import { RECORDED_PLANS } from "../support/recordedPlans";
import type { OperatorAnswer } from "../../src/operator/state/OperatorState";
import type { InformationNeed, InvestigationPlan, NeedKind } from "../../src/operator/plan/InvestigationPlan";
import {
  REPEAT_WINDOW_DAYS, basisSentence, clarificationStands, isServable, resolveScope,
  scopeToken, withOperationalDefaults,
} from "../../src/operator/defaults/OperationalDefaults";

const Q2 = "최근 부정적인 리뷰가 있는 상품을 알려줘.";
const Q3 = "반복해서 비슷한 문의가 들어오는 상품이 있어?";
const Q6 = "최근 판매 운영에서 내가 놓치고 있는 위험이나 개선 포인트가 있어?";
const ORDERS = "지난 주문에서 무슨 일이 있었어?";
const PRODUCT_UNNAMED = "상품에 문제 있어?";

function build(seed: Partial<FakeOperatorSeed> = {}) {
  return new OperatorAgentRuntime({
    operator: new FakeOperatorSpringClient({
      inbox: INBOX,
      products: [MOLDING, CABLE],
      signals: { [MOLDING.id]: coveredSignals(), [CABLE.id]: unlinkedSignals() },
      knowledge: KNOWLEDGE,
      customerMemory: MEMORY,
      repeats: REPEATS,
      itemAnalyses: ANALYSES,
      plansByGoal: RECORDED_PLANS,
      ...seed,
    }),
    inquiry: new FakeSpringClient(twoInquiries()),
    issue: new FakeIssueSpringClient(fourIssues()),
  });
}

function done(result: OperatorRunResult): OperatorAnswer {
  if (result.status !== "DONE") {
    throw new Error(`expected DONE, got FAILED: ${result.failureCode} — ${result.reason}`);
  }
  return result.answer;
}

// --------------------------------------------------------------------------- the canonical red tests

describe("Q3 — the window was declared all along", () => {
  it("runs instead of asking", async () => {
    const answer = done(await build().run("t-q3", { text: Q3 }));
    // Before: clarification, zero specialists, zero tools, zero evidence.
    expect(answer.clarification, "the system held the answer to its own question").toBeNull();
    expect(answer.evidence.length).toBeGreaterThan(0);
  });

  it("says which window it answered on", async () => {
    const answer = done(await build().run("t-q3-basis", { text: Q3 }));
    expect(answer.note ?? "").toContain(`최근 ${REPEAT_WINDOW_DAYS}일`);
  });

  it("names the capability that declared it, not a policy of ours", () => {
    const plan = withOperationalDefaults(planOf([need("n1", "REPEAT_PATTERN")]));
    expect(plan.appliedDefaults[0]).toMatchObject({
      source: "CAPABILITY",
      contract: "customer-memory/repeats:windowDays",
      scope: { kind: "TRAILING_DAYS", days: REPEAT_WINDOW_DAYS },
    });
  });

  it("prefers the window the rows echo over our mirror of the constant", async () => {
    // The backend owns the number. If it moves, the sentence moves with it — a mirror that could win
    // would let the answer describe a window nobody applied.
    const answer = done(await build({
      repeats: REPEATS.map((r) => ({ ...r, windowDays: 14 })),
    }).run("t-q3-echo", { text: Q3 }));
    expect(answer.findings.some((f) => f.statement.includes("14일"))).toBe(true);
  });
});

describe("Q2 — the review list declares that it has no period, which is also a default", () => {
  it("runs instead of asking", async () => {
    const answer = done(await build().run("t-q2", { text: Q2 }));
    expect(answer.clarification).toBeNull();
    expect(answer.findings.length).toBeGreaterThan(0);
  });

  it("discloses that '최근' could not be applied, rather than implying it was", async () => {
    const answer = done(await build().run("t-q2-basis", { text: Q2 }));
    expect(answer.note ?? "").toContain("최근");
    expect(answer.note ?? "").toContain("기간과 무관한 현재 시점 값");
  });

  it("answers the recency question the only way it can — with the rows' own dates", async () => {
    const answer = done(await build().run("t-q2-dates", { text: Q2 }));
    const issues = answer.findings.filter((f) => f.statement.includes("리뷰 근거"));
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((f) => f.statement.includes("최근 근거"))).toBe(true);
  });
});

describe("Q6 — one period is not forced onto every need", () => {
  it("runs instead of asking", async () => {
    const answer = done(await build().run("t-q6", { text: Q6 }));
    expect(answer.clarification).toBeNull();
    expect(answer.evidence.length).toBeGreaterThan(0);
  });

  it("scopes each need by its own capability, not by one global window", () => {
    const plan = withOperationalDefaults(planOf([
      need("n1", "INQUIRY_VOLUME"), need("n2", "REVIEW_SIGNAL"), need("n3", "REPEAT_PATTERN"),
    ]));
    expect(plan.appliedDefaults.map((d) => scopeToken(d.scope)))
      .toEqual(["SNAPSHOT_NOW", "SNAPSHOT_NOW", `TRAILING_${REPEAT_WINDOW_DAYS}D`]);
  });
});

// --------------------------------------------------------------------------- the negative controls

describe("a clarification the contracts cannot answer still reaches the seller", () => {
  it("no capability reaches an order read, so the question stands", async () => {
    const answer = done(await build().run("t-orders", { text: ORDERS }));
    expect(answer.clarification).not.toBeNull();
  });

  it("an unnamed product is still asked about — a missing anchor is not a missing default", async () => {
    const answer = done(await build().run("t-product", { text: PRODUCT_UNNAMED }));
    expect(answer.clarification).not.toBeNull();
  });

  it("a need with no declared scope is not servable", () => {
    const plan = planOf([need("n1", "ORDER_HISTORY")]);
    expect(isServable(plan, plan.informationNeeds[0]!)).toBe(false);
    expect(resolveScope(plan, plan.informationNeeds[0]!).source).toBe("NONE");
  });

  it("a product need with no product mention is not servable", () => {
    const plan = planOf([need("n1", "PRODUCT_FACT")]);
    expect(isServable(plan, plan.informationNeeds[0]!)).toBe(false);
  });

  it("the same product need IS servable once the seller named one", () => {
    const plan = planOf([need("n1", "PRODUCT_FACT")], [{ kind: "PRODUCT", mention: "전선몰딩" }]);
    expect(isServable(plan, plan.informationNeeds[0]!)).toBe(true);
  });

  it("clarification stands only when nothing required can be pursued", () => {
    const mixed = { ...planOf([need("n1", "ORDER_HISTORY"), need("n2", "REPEAT_PATTERN")]),
      clarificationNeeded: true };
    expect(clarificationStands(mixed), "some work is possible, so do it and say what was missed")
      .toBe(false);
    const hopeless = { ...planOf([need("n1", "ORDER_HISTORY")]), clarificationNeeded: true };
    expect(clarificationStands(hopeless)).toBe(true);
  });

  it("a plan that never asked is never made to ask", () => {
    expect(clarificationStands(planOf([need("n1", "REPEAT_PATTERN")]))).toBe(false);
  });
});

// --------------------------------------------------------------------------- the line to EvidenceTime

describe("a default query window is a retrieval scope, never an evidence date", () => {
  it("applying it mints no event range and moves no observation time", async () => {
    const answer = done(await build().run("t-line", { text: Q3 }));
    const repeats = answer.evidence.filter((e) => e.kind === "REPEATED_INQUIRY");
    expect(repeats.length).toBeGreaterThan(0);
    for (const ref of repeats) {
      // The events are the ROWS' first/last seen dates. Nothing here equals "28 days before today".
      expect(ref.events, "a repeat row knows when it was seen").not.toBeNull();
      expect(ref.asOf, "the read still happened when it happened").toBeTruthy();
    }
  });

  it("a snapshot need's evidence gains no event range from being scoped", async () => {
    const answer = done(await build().run("t-line-2", { text: Q6 }));
    for (const ref of answer.evidence.filter((e) => e.kind === "INBOX_COUNT")) {
      expect(ref.events).toBeNull();
    }
  });

  it("a period the seller never wrote is not quoted back at them", () => {
    // Live 2026-08-23: a planner emitted the PERIOD mention "분석 기간 미지정" — its own note about a
    // gap — and the answer attributed the phrase to the seller.
    const plan = planOf([need("n1", "REPEAT_PATTERN")], [{ kind: "PERIOD", mention: "분석 기간 미지정" }]);
    const invented = withOperationalDefaults(plan, "반복해서 비슷한 문의가 들어오는 상품이 있어?");
    expect(invented.appliedDefaults[0]!.userNamed).toBeNull();
    expect(basisSentence(invented.appliedDefaults[0]!)).toBe(
      `반복 문의는 최근 ${REPEAT_WINDOW_DAYS}일 기준으로 확인했습니다.`);

    const theirs = withOperationalDefaults(
      planOf([need("n1", "REPEAT_PATTERN")], [{ kind: "PERIOD", mention: "최근" }]),
      "최근 반복 문의 알려줘");
    expect(theirs.appliedDefaults[0]!.userNamed).toBe("최근");
    expect(basisSentence(theirs.appliedDefaults[0]!)).toContain("「최근」");
  });

  it("no basis sentence is emitted for a scope that says nothing", () => {
    const plan = withOperationalDefaults(planOf([need("n1", "INQUIRY_VOLUME")]));
    expect(basisSentence(plan.appliedDefaults[0]!)).toBeNull();
  });
});

// --------------------------------------------------------------------------- helpers

function need(id: string, kind: NeedKind): InformationNeed {
  return { id, question: "q", kind, why: "w", required: true };
}

function planOf(
  needs: InformationNeed[],
  unresolved: { kind: "PRODUCT" | "PERIOD"; mention: string }[] = [],
): InvestigationPlan {
  return {
    supported: true, userGoal: "g",
    entities: { resolved: [], unresolved },
    informationNeeds: needs,
    specialistTargets: [], candidateTools: [],
    retrievalStrategy: { order: [], parallelizable: [], stopWhen: null },
    evidenceRequirements: [], riskClass: "ROUTINE",
    stoppingCriteria: { maxIterations: 1, maxToolCalls: 6, enough: null },
    clarificationNeeded: false, clarificationReason: null, rationale: null,
    plannerVersion: "test", appliedDefaults: [],
  };
}
