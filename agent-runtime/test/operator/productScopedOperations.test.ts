/**
 * Product-scoped operations, end to end — and the three defects that kept the chain from closing.
 *
 * The seller names a product and asks how it is doing. Four things have to hold for that to be
 * answered honestly, and on 2026-08-23 the first three did not:
 *
 *  - <b>A8 — the plan must be able to REACH the product it named.</b> Measured over ten live runs of
 *    one sentence, the planner dispatched the product specialist six times. The other four planned
 *    product-scoped needs, sent only org-wide specialists, read the whole org, watched the scope gate
 *    refuse every row, and told the seller nothing. Such a plan is now REFUSED and the planner is asked
 *    again with the rule — never with a plan, and never by this side adding a specialist.
 *  - <b>C3 — a weaker later answer must not overwrite a stronger earlier one.</b> Two specialists own
 *    the same need kinds by design. Last-writer-wins meant a six-of-nineteen org sweep replaced a
 *    complete, COVERED, product-scoped zero.
 *  - <b>C4 — an org number must never be spoken as the product's.</b> The product's issue list is
 *    product-scoped; every count on it is the issue's org-wide total.
 *  - <b>The audit.</b> Of the three things a seller means by "how is it doing", two are provable per
 *    product with the reads that already exist (review issues, current inquiry state) and one is not
 *    (repeated inquiries — no product axis anywhere in the row). The third stays a stated limitation
 *    rather than an invented capability.
 */
import { describe, expect, it } from "vitest";
import { OperatorAgentRuntime } from "../../src/operator/operatorRuntime";
import type { OperatorRunResult } from "../../src/operator/operatorRuntime";
import { validatePlan, PlanRejectedError, REPLANNABLE_REJECTIONS } from "../../src/operator/plan/PlanValidator";
import { LlmInvestigationPlanner, PlannerUnavailableError } from "../../src/operator/plan/LlmInvestigationPlanner";
import { isStronger, mergeNeedState } from "../../src/operator/plan/needOutcome";
import type { InvestigationPlan, NeedState } from "../../src/operator/plan/InvestigationPlan";
import { productResolvingSpecialists } from "../../src/operator/tools/ToolReachability";
import { OPERATOR_TOOL } from "../../src/operator/tools/OperatorTools";
import { FakeOperatorSpringClient } from "../support/FakeOperatorSpringClient";
import { FakeSpringClient } from "../support/FakeSpringClient";
import { FakeIssueSpringClient } from "../support/FakeIssueSpringClient";
import { twoInquiries } from "../support/fixtures";
import { ISSUE_NORMAL_CONCENTRATED, fourIssues, makeIssue } from "../support/issueFixtures";
import {
  ANALYSES, CABLE, CUP_BIN, INBOX, KNOWLEDGE, MEMORY, MOLDING, REPEATS,
  coveredSignals, cupBinKnowledge, cupBinSignals, unlinkedSignals,
} from "../support/operatorFixtures";
import {
  PRODUCT_COMPLAINT_ORGWIDE_PLAN, PRODUCT_COMPLAINT_REPAIRED_PLAN, RECORDED_PLANS, REPAIRED_PLANS,
} from "../support/recordedPlans";
import type { OperatorAnswer } from "../../src/operator/state/OperatorState";
import type { AgentPlanView } from "../../src/spring/types";
import { mentionOf } from "../../src/operator/plan/EntityRole";

const COMPLAINT_GOAL = "전선몰딩 상품의 리뷰와 문의를 같이 보고 불만이 있는지 알려줘";
const CUP_BIN_GOAL = "판도리 일체형 종이컵 수거함 상품의 리뷰와 문의를 같이 보고 고객 불만이나 반복 이슈가 있는지 알려줘.";

/**
 * Two needs of the same kind, both reaching the product specialist — AUTHORED.
 *
 * A shape a live planner produced on 2026-08-24 (a three-need plan whose second and third needs were
 * both `REVIEW_SIGNAL`); written out here rather than replayed because what is under test is
 * structural — one read per kind — and not a claim about what any model says.
 */
const TWO_SIGNAL_GOAL = "이 상품 리뷰에 반복되는 불만이 있는지, 그리고 그 심각도는 어떤지 알려줘";
const TWO_SIGNAL_PLAN: AgentPlanView = {
  available: true,
  supported: true,
  userGoal: "이 상품의 반복 불만과 그 심각도를 알고 싶다",
  unresolvedEntities: [mentionOf("PRODUCT", "판도리 일체형 종이컵 수거함")],
  informationNeeds: [
    { id: "n1", question: "반복되는 불만이 있는가", kind: "REVIEW_SIGNAL", why: "", required: true },
    { id: "n2", question: "그 심각도는 어떤가", kind: "REVIEW_SIGNAL", why: "", required: true },
  ],
  specialists: ["PRODUCT_OPS", "REVIEW_OPS"],
  tools: ["resolve_product", "get_product_knowledge", "get_review_issue_evidence_summary"],
  retrievalOrder: ["n1", "n2"],
  retrievalParallel: [],
  retrievalStopWhen: null,
  evidenceRequirements: [],
  riskClass: "ROUTINE",
  maxIterations: 1,
  maxToolCalls: 8,
  stopWhenEnough: null,
  clarificationNeeded: false,
  clarificationReason: null,
  rationale: null,
  providerVersion: "AUTHORED (structural)",
};

/**
 * A plan whose second need nothing can serve — AUTHORED, and the shortest way to a SECOND pass.
 *
 * The loop re-plans while a required need is still pending and something was learned, so this run reads
 * the same issue list twice and produces the same sentences twice. That is the case the dedupe exists
 * for, and the case the "제외했습니다" count used to describe wrongly.
 */
const REPLAN_GOAL = "반복 리뷰 문제와 지난 주문 이력을 같이 봐줘";
const REPLAN_PLAN: AgentPlanView = {
  available: true,
  supported: true,
  userGoal: "반복 리뷰 문제와 주문 이력을 같이 보고 싶다",
  unresolvedEntities: [],
  informationNeeds: [
    { id: "n1", question: "반복 리뷰 문제가 있는가", kind: "REVIEW_SIGNAL", why: "", required: true },
    { id: "n2", question: "지난 주문 이력은 어떤가", kind: "ORDER_HISTORY", why: "", required: true },
  ],
  specialists: ["REVIEW_OPS"],
  tools: ["search_review_issues"],
  retrievalOrder: ["n1", "n2"],
  retrievalParallel: [],
  retrievalStopWhen: null,
  evidenceRequirements: [],
  riskClass: "ROUTINE",
  maxIterations: 3,
  maxToolCalls: 12,
  stopWhenEnough: null,
  clarificationNeeded: false,
  clarificationReason: null,
  rationale: null,
  providerVersion: "AUTHORED (structural)",
};

const DEPS = {
  catalogue: ["get_today_inbox", "search_review_issues", "resolve_product"],
  limits: { maxIterations: 3, maxToolCalls: 12 },
};

function plan(overrides: Partial<InvestigationPlan> = {}): InvestigationPlan {
  return {
    supported: true,
    userGoal: "이 상품 어때",
    entities: { resolved: [], unresolved: [mentionOf("PRODUCT", "전선몰딩")] },
    informationNeeds: [
      { id: "n1", question: "이 상품에 불만이 있는가", kind: "REVIEW_SIGNAL", why: "", required: true },
    ],
    specialistTargets: ["REVIEW_OPS"],
    candidateTools: ["search_review_issues"],
    retrievalStrategy: { order: ["n1"], parallelizable: [], stopWhen: null },
    evidenceRequirements: [],
    riskClass: "ROUTINE",
    stoppingCriteria: { maxIterations: 1, maxToolCalls: 4, enough: null },
    clarificationNeeded: false,
    clarificationReason: null,
    rationale: null,
    plannerVersion: "test",
    appliedDefaults: [],
    ...overrides,
  };
}

function build(seed: Record<string, unknown> = {}, issues = new FakeIssueSpringClient(fourIssues())) {
  const operator = new FakeOperatorSpringClient({
    inbox: INBOX,
    products: [MOLDING, CABLE, CUP_BIN],
    signals: {
      [MOLDING.id]: coveredSignals(),
      [CABLE.id]: unlinkedSignals(),
      [CUP_BIN.id]: cupBinSignals(),
    },
    knowledge: { ...KNOWLEDGE, [CUP_BIN.id]: cupBinKnowledge() },
    customerMemory: MEMORY,
    repeats: REPEATS,
    itemAnalyses: ANALYSES,
    plansByGoal: RECORDED_PLANS,
    repairedPlansByGoal: REPAIRED_PLANS,
    ...seed,
  });
  return {
    operator,
    issues,
    runtime: new OperatorAgentRuntime({
      operator,
      inquiry: new FakeSpringClient(twoInquiries()),
      issue: issues,
    }),
  };
}

function done(result: OperatorRunResult): OperatorAnswer {
  if (result.status !== "DONE") {
    throw new Error(`expected DONE, got FAILED: ${result.failureCode} — ${result.reason}`);
  }
  return result.answer;
}

/** A transport that answers a first request and a repair request differently, and counts both. */
function transport(first: AgentPlanView, repaired?: AgentPlanView) {
  const contexts: string[] = [];
  return {
    contexts,
    calls: () => contexts.length,
    backend: {
      async planGoal(request: { goalText: string; toolCatalogue: string[]; priorContext?: string }) {
        contexts.push(request.priorContext ?? "");
        return contexts.length > 1 && repaired ? repaired : first;
      },
    },
  };
}

// ─────────────────────────────────────────────────────── A8 · the plan must reach what it named

describe("A8 — a plan that names a product it cannot resolve is not a valid plan", () => {
  it("refuses it, and names the rule rather than fixing it", () => {
    try {
      validatePlan(plan(), DEPS);
      throw new Error("expected a rejection");
    } catch (err) {
      expect(err).toBeInstanceOf(PlanRejectedError);
      expect((err as PlanRejectedError).rejection).toBe("PRODUCT_UNRESOLVABLE");
    }
  });

  it("accepts the same plan the moment a specialist that CAN resolve is dispatched", () => {
    const ok = validatePlan(plan({ specialistTargets: ["PRODUCT_OPS", "REVIEW_OPS"] }), DEPS);
    // Unchanged — the validator removed nothing and added nothing.
    expect(ok.specialistTargets).toEqual(["PRODUCT_OPS", "REVIEW_OPS"]);
  });

  it("derives WHO can resolve from the capability matrix, not from a list here", () => {
    expect(productResolvingSpecialists()).toEqual(["PRODUCT_OPS"]);
  });

  it("does not fire when no product was named", () => {
    const ok = validatePlan(plan({ entities: { resolved: [], unresolved: [] } }), DEPS);
    expect(ok.specialistTargets).toEqual(["REVIEW_OPS"]);
  });

  it("does not fire on a clarification or a refusal — neither runs a specialist at all", () => {
    expect(validatePlan(plan({ clarificationNeeded: true }), DEPS).specialistTargets).toEqual([]);
    expect(validatePlan(plan({ supported: false }), DEPS).specialistTargets).toEqual([]);
  });

  it("is the only rejection a re-plan is spent on", () => {
    expect([...REPLANNABLE_REJECTIONS]).toEqual(["PRODUCT_UNRESOLVABLE"]);
  });
});

describe("A8 — the repair is the planner's, bounded, and charged", () => {
  const input = {
    request: { text: "전선몰딩 상품에 불만이 있어?" },
    catalogue: ["resolve_product: 상품을 찾는다", "search_review_issues: 반복 문제"],
    toolNames: ["resolve_product", "search_review_issues", "get_product_knowledge", "get_today_inbox"],
    limits: { maxIterations: 3, maxToolCalls: 12 },
  };

  it("asks again with the RULE, and the second answer is the model's own plan", async () => {
    const t = transport(PRODUCT_COMPLAINT_ORGWIDE_PLAN, PRODUCT_COMPLAINT_REPAIRED_PLAN);
    const result = await new LlmInvestigationPlanner(t.backend).plan(input);
    expect(t.calls()).toBe(2);
    expect(t.contexts[1]).toContain("plan-invalid: PRODUCT_UNRESOLVABLE");
    expect(result.specialistTargets).toContain("PRODUCT_OPS");
  });

  it("sends no seller row, id, mention or evidence back with the rule", async () => {
    const t = transport(PRODUCT_COMPLAINT_ORGWIDE_PLAN, PRODUCT_COMPLAINT_REPAIRED_PLAN);
    await new LlmInvestigationPlanner(t.backend).plan(input);
    const repair = t.contexts[1]!;
    expect(repair).not.toContain("전선몰딩");
    expect(repair).not.toContain(MOLDING.id);
    // Closed vocabulary only: a rejection name, the rule, and a specialist name.
    expect(repair).toMatch(/^plan-invalid: PRODUCT_UNRESOLVABLE\./);
  });

  it("stops at one repair — a planner that repeats itself fails the run", async () => {
    const t = transport(PRODUCT_COMPLAINT_ORGWIDE_PLAN);
    await expect(new LlmInvestigationPlanner(t.backend).plan(input))
      .rejects.toThrow(PlannerUnavailableError);
    expect(t.calls()).toBe(2);
  });

  it("does not repair when the budget refuses the second model call", async () => {
    const t = transport(PRODUCT_COMPLAINT_ORGWIDE_PLAN, PRODUCT_COMPLAINT_REPAIRED_PLAN);
    await expect(new LlmInvestigationPlanner(t.backend)
      .plan({ ...input, chargeLlmCall: () => false })).rejects.toThrow(PlannerUnavailableError);
    expect(t.calls()).toBe(1);
  });

  it("live shape: the plan that read the org is refused, and the second one goes for the product", async () => {
    const { runtime, operator } = build();
    const answer = done(await runtime.run("a8-live", { text: COMPLAINT_GOAL }));

    // At least twice: the first plan was refused and the planner was asked again. The loop may plan
    // more than once overall — the budget is the ceiling, not this number.
    expect(operator.calls.plan).toBeGreaterThanOrEqual(2);
    expect(answer.specialists).toContain("PRODUCT_OPS");
    expect(operator.calls.products).toBeGreaterThan(0);
  });

  it("and when the name still matches nothing, no org row becomes a sentence about it", async () => {
    // The repaired plan restates the mention as 「전선몰딩 상품」, which matches no catalogue row. That
    // is the honest outcome and A1 still holds underneath A8: the org-wide reads happen, and every one
    // of their rows is refused rather than attributed.
    const { runtime } = build();
    const answer = done(await runtime.run("a8-unresolved", { text: COMPLAINT_GOAL }));
    expect(answer.findings.filter((f) => !f.claimsCoverageLimit)).toHaveLength(0);
    expect(answer.note ?? "").toContain("전선몰딩");
  });
});

// ─────────────────────────────────────────────────────────────── C3 · outcome merge semantics

describe("C3 — the need keeps the outcome that knows more", () => {
  const covered: NeedState = {
    id: "n1", status: "SATISFIED", evidenceIds: ["e1"],
    coverage: "COVERED", complete: true, settledBy: "PRODUCT_OPS",
  };
  const bounded: NeedState = {
    id: "n1", status: "UNSATISFIABLE", evidenceIds: [],
    coverage: "COVERED", complete: false, settledBy: "REVIEW_OPS",
  };

  it("a bounded org sweep never overwrites a complete covered answer", () => {
    expect(mergeNeedState(covered, bounded)).toBe(covered);
  });

  it("nor does a blind spot, even when it claims the same status", () => {
    const blind: NeedState = { ...covered, coverage: "UNCERTAIN_PRODUCT_UNLINKED", settledBy: "REVIEW_OPS" };
    expect(mergeNeedState(covered, blind)).toBe(covered);
    // …and the reverse DOES move: an actual read beats an admitted blind spot.
    expect(mergeNeedState(blind, covered)).toBe(covered);
  });

  it("a resolved need never regresses to PENDING", () => {
    const pending: NeedState = { id: "n1", status: "PENDING", evidenceIds: [] };
    expect(mergeNeedState(covered, pending)).toBe(covered);
    expect(mergeNeedState(bounded, pending)).toBe(bounded);
  });

  it("never promotes silence to calm — a merge cannot invent an answer", () => {
    const pending: NeedState = { id: "n1", status: "PENDING", evidenceIds: [] };
    expect(mergeNeedState(pending, pending).status).toBe("PENDING");
    // Nothing in the rule can raise a status; the winner is always one of the two inputs.
    expect(isStronger(pending, pending)).toBe(false);
  });

  it("a tie keeps the incumbent — the rule replaces last-writer-wins, it does not invert it", () => {
    const twin: NeedState = { ...covered, settledBy: "REVIEW_OPS" };
    expect(mergeNeedState(covered, twin)).toBe(covered);
  });

  it("a complete read beats a bounded one at the same status and coverage", () => {
    const boundedSat: NeedState = { ...covered, complete: false, settledBy: "REVIEW_OPS" };
    expect(mergeNeedState(boundedSat, covered)).toBe(covered);
    expect(mergeNeedState(covered, boundedSat)).toBe(covered);
  });
});

// ────────────────────────────────────────────────────── C4 · a product sentence quotes its own count

describe("C4 — the number in a product sentence is the product's", () => {
  /** The product's own issue index names an issue the issue-store can split; 2 of the issue's 9. */
  function withSplit(extra: Record<string, unknown> = {}) {
    const cupBin = cupBinSignals([makeIssue(ISSUE_NORMAL_CONCENTRATED, {
      severity: "NORMAL", aspect: "뚜껑", problem: "이탈", evidenceCount: 9,
      dominantProductId: MOLDING.id, dominantProductName: "몰딩 화이트 10m",
      lastEvidenceOn: "2026-07-22",
    })]);
    const issues = new FakeIssueSpringClient(fourIssues());
    issues.put({
      summary: makeIssue(ISSUE_NORMAL_CONCENTRATED, {
        severity: "NORMAL", aspect: "뚜껑", problem: "이탈", evidenceCount: 9,
        dominantProductId: MOLDING.id, dominantProductName: "몰딩 화이트 10m",
        lastEvidenceOn: "2026-07-22",
      }),
      evidence: {
        totalEvidence: 9,
        byProduct: [
          { productId: MOLDING.id, productName: "몰딩 화이트 10m", evidenceCount: 7,
            firstOccurredOn: "2026-06-01", lastOccurredOn: "2026-07-22" },
          { productId: CUP_BIN.id, productName: "판도리 일체형 종이컵 수거함", evidenceCount: 2,
            firstOccurredOn: "2026-06-04", lastOccurredOn: "2026-06-09" },
        ],
        unattributedEvidence: 0,
        ratingDistribution: { rating1: 9, rating2: 0, rating3: 0, rating4: 0, rating5: 0, unrated: 0 },
        firstEvidenceOn: "2026-06-01",
        lastEvidenceOn: "2026-07-22",
      },
    });
    const seed = {
      signals: { [MOLDING.id]: coveredSignals(), [CABLE.id]: unlinkedSignals(), [CUP_BIN.id]: cupBin },
      knowledge: { ...KNOWLEDGE, [CUP_BIN.id]: cupBinKnowledge(cupBin) },
    };
    const built = build({ ...seed, ...extra }, issues);
    return { ...built, issues };
  }

  it("states the product's 2, not the issue's 9 — and names the 9 as the issue's", async () => {
    const { runtime } = withSplit();
    const answer = done(await runtime.run("c4-split", { text: CUP_BIN_GOAL }));
    const stated = answer.findings.find((f) => f.specialist === "PRODUCT_OPS"
      && f.statement.includes("리뷰 근거가"))!;
    expect(stated.statement).toContain("2건");
    expect(stated.statement).toContain("전체 9건");
    // The bare org total may never stand where the product's count belongs.
    expect(stated.statement).not.toMatch(/근거가 9건 있습니다/);
  });

  it("cites the split, not the product-knowledge row, behind that number", async () => {
    const { runtime, issues } = withSplit();
    const answer = done(await runtime.run("c4-cite", { text: CUP_BIN_GOAL }));
    const stated = answer.findings.find((f) => f.specialist === "PRODUCT_OPS"
      && f.statement.includes("리뷰 근거가"))!;
    const ref = answer.evidence.find((e) => e.evidenceId === stated.evidenceIds[0])!;
    expect(ref.kind).toBe("ISSUE_EVIDENCE");
    expect(ref.sourceTool).toBe(OPERATOR_TOOL.GET_ISSUE_EVIDENCE_SUMMARY);
    expect(ref.locator.count).toBe(2);
    expect(ref.locator.productId).toBe(CUP_BIN.id);
    // One split per issue in the product's own index — not a sweep of the org's.
    expect(issues.reads.evidenceSummary).toBe(1);
  });

  it("when the split cannot be read, it says the count is unknown rather than using the org's", async () => {
    const cupBin = cupBinSignals([makeIssue("99999999-9999-9999-9999-999999999999", {
      severity: "NORMAL", aspect: "뚜껑", problem: "이탈", evidenceCount: 9,
    })]);
    const { runtime } = build({
      signals: { [MOLDING.id]: coveredSignals(), [CABLE.id]: unlinkedSignals(), [CUP_BIN.id]: cupBin },
      knowledge: { ...KNOWLEDGE, [CUP_BIN.id]: cupBinKnowledge(cupBin) },
    });
    const answer = done(await runtime.run("c4-unknown", { text: CUP_BIN_GOAL }));
    const stated = answer.findings.find((f) => f.specialist === "PRODUCT_OPS"
      && f.statement.includes("연결돼 있습니다"))!;
    expect(stated.statement).toContain("이 상품 몫은 확인하지 못했습니다");
    expect(stated.statement).toContain("전체 9건");
  });

  it("buys one split per issue however many needs of that kind the plan declared", async () => {
    // Live 2026-08-24: a plan with two REVIEW_SIGNAL needs read the same five splits twice — twelve
    // tool calls for seven issues' worth of facts — and the five duplicate sentences were then reported
    // to the seller as findings dropped for lack of evidence. One read, one set of sentences, and BOTH
    // needs satisfied by the same fact, which is what makes the reuse a merge and not a skip.
    const { runtime, issues } = withSplit({ plansByGoal: { [TWO_SIGNAL_GOAL]: TWO_SIGNAL_PLAN } });
    const answer = done(await runtime.run("c4-once", { text: TWO_SIGNAL_GOAL }));
    expect(issues.reads.evidenceSummary).toBe(1);
    const stated = answer.findings.filter((f) => f.statement.includes("리뷰 근거가"));
    expect(stated).toHaveLength(1);
    expect(answer.needs.map((n) => n.status)).toEqual(["SATISFIED", "SATISFIED"]);
    expect(answer.note ?? "").not.toContain("근거가 확인되지 않아");
  });

  it("ranks what it says by the PRODUCT's count, not by the issue's", async () => {
    // Live 2026-08-24 on a real product with 15 live issues. The backend orders them by SEVERITY first
    // and then by the ISSUE's org-wide count, so five HIGH issues holding 7·4·2·1·1 of the product's
    // rows outranked the two NORMAL ones holding 16 and 8 — and a five-row brief named the small ones.
    const rowsFor = [
      { id: "00000000-0000-0000-0000-0000000000a1", title: "배송 파손", sev: "HIGH", mine: 7, total: 15 },
      { id: "00000000-0000-0000-0000-0000000000a2", title: "배송 누락", sev: "HIGH", mine: 4, total: 4 },
      { id: "00000000-0000-0000-0000-0000000000a3", title: "표면 누락", sev: "HIGH", mine: 2, total: 2 },
      { id: "00000000-0000-0000-0000-0000000000a4", title: "접착 파손", sev: "HIGH", mine: 1, total: 1 },
      { id: "00000000-0000-0000-0000-0000000000a5", title: "접착 누락", sev: "HIGH", mine: 1, total: 1 },
      { id: "00000000-0000-0000-0000-0000000000a6", title: "접착 부족", sev: "NORMAL", mine: 16, total: 18 },
      { id: "00000000-0000-0000-0000-0000000000a7", title: "접착 탈락", sev: "NORMAL", mine: 8, total: 19 },
    ];
    const summaryOf = (r: typeof rowsFor[number]) => makeIssue(r.id, {
      severity: r.sev, aspect: r.title.slice(0, 2), problem: r.title.slice(3), evidenceCount: r.total,
    });
    const issues = new FakeIssueSpringClient([]);
    for (const r of rowsFor) {
      issues.put({
        summary: summaryOf(r),
        evidence: {
          totalEvidence: r.total,
          byProduct: [{ productId: CUP_BIN.id, productName: "판도리 일체형 종이컵 수거함",
            evidenceCount: r.mine, firstOccurredOn: "2026-06-01", lastOccurredOn: "2026-07-22" }],
          unattributedEvidence: 0,
          ratingDistribution: { rating1: r.total, rating2: 0, rating3: 0, rating4: 0, rating5: 0, unrated: 0 },
          firstEvidenceOn: "2026-06-01", lastEvidenceOn: "2026-07-22",
        },
      });
    }
    // The product's index EXACTLY as the backend orders it: severity, then the issue's own total.
    const rank = (s: string) => (s === "HIGH" ? 0 : s === "MEDIUM" ? 1 : 2);
    const cupBin = cupBinSignals([...rowsFor]
      .sort((a, b) => rank(a.sev) - rank(b.sev) || b.total - a.total)
      .map(summaryOf));
    const { runtime } = build({
      signals: { [MOLDING.id]: coveredSignals(), [CABLE.id]: unlinkedSignals(), [CUP_BIN.id]: cupBin },
      knowledge: { ...KNOWLEDGE, [CUP_BIN.id]: cupBinKnowledge(cupBin) },
    }, issues);
    const answer = done(await runtime.run("c4-rank", { text: CUP_BIN_GOAL }));

    const said = answer.findings.filter((f) => f.statement.includes("리뷰 근거가")).map((f) => f.statement);
    expect(said).toHaveLength(5);
    // The product's two largest problems are stated; the one-row issues are what fall off.
    expect(said.some((t) => t.includes("접착 부족") && t.includes("16건"))).toBe(true);
    expect(said.some((t) => t.includes("접착 탈락") && t.includes("8건"))).toBe(true);
    expect(said.some((t) => t.includes("접착 파손"))).toBe(false);
    expect(said.some((t) => t.includes("접착 누락"))).toBe(false);
    // …and the cut is disclosed rather than presented as the whole list.
    expect(answer.note ?? "").toContain("7건 가운데 7건을 확인해 근거가 많은 5건을 정리했습니다");
  });

  it("no product count is ever bought without an issue id to ask about", async () => {
    const { runtime, issues } = build();
    await runtime.run("c4-precondition", { text: CUP_BIN_GOAL });
    // The product's index is empty, so there is no issue to split. A precondition unmet is a call not
    // made — never a call made with a guess.
    expect(issues.reads.evidenceSummary).toBe(0);
  });
});

// ────────────────────────────────────────── the audit · what IS provable per product, and what is not

describe("product-scoped execution audit — three questions, two answers, one limitation", () => {
  it("current inquiry state is provable per product, including its zero", async () => {
    const { runtime } = build();
    const answer = done(await runtime.run("audit-inquiry", { text: CUP_BIN_GOAL }));
    const zero = answer.findings.find((f) => f.statement.includes("답변이 필요한 문의는 없습니다"));
    expect(zero).toBeDefined();
    expect(zero!.specialist).toBe("PRODUCT_OPS");
    const ref = answer.evidence.find((e) => e.evidenceId === zero!.evidenceIds[0])!;
    expect(ref.kind).toBe("INQUIRY");
    expect(ref.locator.productId).toBe(CUP_BIN.id);
    expect(ref.locator.count).toBe(0);
  });

  it("the org inbox is not read at all once the product's own count is held", async () => {
    const { runtime, operator } = build();
    await runtime.run("audit-no-org-inbox", { text: CUP_BIN_GOAL });
    expect(operator.calls.inbox).toBe(0);
  });

  it("and the answer therefore carries no org-scope withholding note about inquiries", async () => {
    const { runtime } = build();
    const answer = done(await runtime.run("audit-note", { text: CUP_BIN_GOAL }));
    expect(answer.note ?? "").not.toContain("전체 집계뿐이라");
  });

  it("repeated inquiries have no product axis to prove — the row carries none", async () => {
    const { runtime } = build();
    const answer = done(await runtime.run("audit-repeat", { text: CUP_BIN_GOAL }));
    // Nothing in this run claims a per-product repeat. If one ever does, the row it cites must carry a
    // productId — and `RepeatedInquiry` has no such field, so this is a limitation, not an omission.
    const repeats = answer.evidence.filter((e) => e.kind === "REPEATED_INQUIRY");
    expect(repeats.every((e) => e.locator.productId === undefined)).toBe(true);
  });

  it("a sentence said twice is one fact, not a finding that failed a check", async () => {
    // The withholding note counts what was dropped for lack of EVIDENCE. Collapsing a repeated
    // statement loses nothing, and reporting it as a drop told the seller that true sentences had
    // failed a check they never took (live 2026-08-24).
    const { runtime } = build({ plansByGoal: { [REPLAN_GOAL]: REPLAN_PLAN } });
    const answer = done(await runtime.run("dedupe-note", { text: REPLAN_GOAL }));
    expect(answer.budget.iterations).toBeGreaterThan(1);
    expect(answer.findings.every((f) => f.evidenceIds.length > 0)).toBe(true);
    expect(answer.note ?? "").not.toContain("근거가 확인되지 않아");
  });

  it("every read is still READ, and the answer proposes no WRITE", async () => {
    const { runtime } = build();
    const answer = done(await runtime.run("audit-write", { text: CUP_BIN_GOAL }));
    expect(answer.nextActions.every((a) => a.actionClass !== "WRITE")).toBe(true);
    expect(Object.values(OPERATOR_TOOL).includes("submit_reply" as never)).toBe(false);
  });
});
