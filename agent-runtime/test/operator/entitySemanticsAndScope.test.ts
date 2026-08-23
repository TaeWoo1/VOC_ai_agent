/**
 * Entity semantics — the difference between a thing and a kind of thing.
 *
 * Two live defects, one cause. The planner declares what the seller named; every scope decision
 * downstream reads that declaration as *one particular row the seller has in mind*. When the seller
 * names a CATEGORY — "미답변 문의", "상품별", "부정 리뷰" — that reading is wrong in two directions at
 * once:
 *
 *  - <b>A9.</b> `INQUIRY: "미답변 문의"` put a whole run into ITEM scope. The org-wide inbox count it
 *    had just read correctly was then refused — org evidence cannot answer an item question — and a
 *    run that knew 3208 inquiries were waiting said nothing about any of them.
 *  - <b>C5.</b> `PRODUCT: "상품"` was handed to `resolve_product`, which searched the catalogue for a
 *    product named "상품", spent a call, and found nothing.
 *
 * The fix is one structural field with one owner (`plan/EntityRole.ts`), and its whole burden of proof
 * runs one way: CATEGORY has to be earned, INSTANCE is what an unrecognised word means. That direction
 * is what keeps A1 exactly as strict as it was — the tests below assert both halves, because a change
 * that fixed A9 by loosening the entity axis would be a much worse defect than A9.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { OperatorAgentRuntime } from "../../src/operator/operatorRuntime";
import type { OperatorRunResult } from "../../src/operator/operatorRuntime";
import {
  entityRoleOf, instanceMentionsOf, mentionOf, namesInstance,
} from "../../src/operator/plan/EntityRole";
import { checkEvidence, needScopeOf, planScopeOf } from "../../src/operator/scope/EvidenceScope";
import { isServable } from "../../src/operator/defaults/OperationalDefaults";
import { validatePlan, PlanRejectedError } from "../../src/operator/plan/PlanValidator";
import { LlmInvestigationPlanner } from "../../src/operator/plan/LlmInvestigationPlanner";
import type {
  EntityKind, InformationNeed, InvestigationPlan,
} from "../../src/operator/plan/InvestigationPlan";
import type { EvidenceRef, OperatorAnswer } from "../../src/operator/state/OperatorState";
import type { AgentPlanView } from "../../src/spring/types";
import { FakeOperatorSpringClient } from "../support/FakeOperatorSpringClient";
import { FakeSpringClient } from "../support/FakeSpringClient";
import { FakeIssueSpringClient } from "../support/FakeIssueSpringClient";
import { twoInquiries } from "../support/fixtures";
import { fourIssues } from "../support/issueFixtures";
import {
  ANALYSES, CABLE, CUP_BIN, INBOX, KNOWLEDGE, MEMORY, MOLDING, REPEATS,
  coveredSignals, cupBinKnowledge, cupBinSignals, unlinkedSignals,
} from "../support/operatorFixtures";
import {
  PRIORITIZE_AND_DRAFT_PLAN, PRIORITIZE_WITH_CATEGORY_PLAN, RECORDED_PLANS, REPAIRED_PLANS,
} from "../support/recordedPlans";

const PRIORITIZE_GOAL = "답변이 필요한 문의를 우선순위대로 정리하고 답변 초안을 만들어줘";

/** A category-heavy goal — the C5 shape, AUTHORED. Nothing here names a product to look up. */
const CATEGORY_GOAL = "상품별 최근 문제를 알려줘";
const CATEGORY_PRODUCT_PLAN: AgentPlanView = {
  available: true,
  supported: true,
  userGoal: "상품별로 최근 어떤 문제가 있었는지 알고 싶다",
  // The planner's own habit: it labels the grouping dimension as the entity. Kept verbatim, because the
  // fix has to hold for a planner that keeps doing this.
  unresolvedEntities: [{ kind: "PRODUCT", mention: "상품" }],
  informationNeeds: [
    { id: "n1", question: "최근 반복되는 리뷰 문제가 있는가", kind: "REVIEW_SIGNAL", why: "", required: true },
  ],
  specialists: ["PRODUCT_OPS", "REVIEW_OPS"],
  tools: ["resolve_product", "search_review_issues"],
  retrievalOrder: ["n1"],
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

const DEPS = {
  catalogue: ["get_today_inbox", "search_review_issues", "resolve_product"],
  limits: { maxIterations: 3, maxToolCalls: 12 },
};

// ──────────────────────────────────────────────────────────── the classification itself

describe("a mention names one thing, or a kind of thing", () => {
  const CATEGORIES: Array<[EntityKind, string]> = [
    // The two the live planner actually produced on 2026-08-24, sampled six times on one goal.
    ["INQUIRY", "답변이 필요한 문의"],
    ["INQUIRY", "오늘 처리해야 할 문의"],
    ["INQUIRY", "미답변 문의"],
    ["INQUIRY", "밀린 문의"],
    ["INQUIRY", "들어온 문의"],
    ["INQUIRY", "미답변문의"],
    ["INQUIRY", "반복 문의"],
    ["INQUIRY", "문의"],
    ["INQUIRY", "문의사항"],
    ["ISSUE", "부정 리뷰"],
    ["ISSUE", "반복 이슈"],
    ["PRODUCT", "상품"],
    ["PRODUCT", "상품별"],
    ["PRODUCT", "전체 상품"],
    ["ORDER", "최근 주문"],
    ["CHANNEL", "판매채널"],
  ];
  for (const [kind, mention] of CATEGORIES) {
    it(`"${mention}" is a category`, () => {
      expect(entityRoleOf(kind, mention)).toBe("CATEGORY");
    });
  }

  const INSTANCES: Array<[EntityKind, string]> = [
    ["PRODUCT", "판도리 일체형 종이컵 수거함"],
    ["PRODUCT", "전선몰딩"],
    // A category word INSIDE a name does not make the name a category: the seller still named a thing.
    ["PRODUCT", "전선몰딩 상품"],
    // Demonstratives point at one thing the seller has in mind, and are deliberately in no table.
    ["PRODUCT", "이 상품"],
    ["INQUIRY", "이 문의"],
    ["PRODUCT", "해당 상품"],
    ["CHANNEL", "쿠팡"],
    ["CHANNEL", "스마트스토어"],
    ["PERIOD", "최근 30일"],
  ];
  for (const [kind, mention] of INSTANCES) {
    it(`"${mention}" names something`, () => {
      expect(entityRoleOf(kind, mention)).toBe("INSTANCE");
    });
  }

  it("a modifier with no head names no category — it is the seller's own scope word", () => {
    // "최근" as a PERIOD is what A4 reads to decide the temporal axis. If this file called it a
    // category, this file would be deciding time.
    expect(entityRoleOf("PERIOD", "최근")).toBe("INSTANCE");
    expect(entityRoleOf("PERIOD", "오늘")).toBe("INSTANCE");
  });

  it("the KIND the planner declared does not decide it — that field was wrong in both defects", () => {
    // A9 arrived labelled INQUIRY, C5 labelled PRODUCT. Both are categories whatever the label says.
    expect(entityRoleOf("PRODUCT", "미답변 문의")).toBe("CATEGORY");
    expect(entityRoleOf("INQUIRY", "판도리 일체형 종이컵 수거함")).toBe("INSTANCE");
  });

  it("a predicate needs a known stem AND a predicate ending — a product name has neither", () => {
    // "필요한" = 필요 + 한. "일체형" ends in no predicate, "판도리" begins with no stem, and either
    // half alone leaves the mention an INSTANCE.
    expect(entityRoleOf("PRODUCT", "접이식 우산")).toBe("INSTANCE");
    expect(entityRoleOf("PRODUCT", "일체형 상품")).toBe("INSTANCE");
  });

  it("an unrecognised word always means INSTANCE — one is enough", () => {
    expect(entityRoleOf("PRODUCT", "판도리 상품")).toBe("INSTANCE");
    expect(entityRoleOf("INQUIRY", "미답변 김철수 문의")).toBe("INSTANCE");
    expect(entityRoleOf("PRODUCT", "")).toBe("INSTANCE");
  });

  it("is the only way a role is assigned — no caller can assert one by hand", () => {
    expect(mentionOf("INQUIRY", "답변이 필요한 문의")).toEqual({
      kind: "INQUIRY", mention: "답변이 필요한 문의", role: "CATEGORY",
    });
  });
});

// ──────────────────────────────────────────────────────────── A9 · a category narrows nothing

describe("A9 — a category mention does not put the run into item scope", () => {
  it("leaves the run org-wide", () => {
    const scope = needScopeOf(planOf([mentionOf("INQUIRY", "답변이 필요한 문의")]), NEED, []);
    expect(scope.entity).toBe("ORG");
  });

  it("so the org-wide count the run read is usable evidence", () => {
    const scope = needScopeOf(planOf([mentionOf("INQUIRY", "오늘 처리해야 할 문의")]), NEED, []);
    expect(checkEvidence(scope, inboxCount())).toBeNull();
  });

  it("and the same is true of a finding with no need attached", () => {
    expect(planScopeOf(planOf([mentionOf("INQUIRY", "미답변 문의")]), []).entity).toBe("ORG");
  });

  it("live shape — the run that said nothing about 3208 inquiries now says the number", async () => {
    const { runtime } = build({ plansByGoal: { [PRIORITIZE_GOAL]: PRIORITIZE_WITH_CATEGORY_PLAN } });
    const answer = done(await runtime.run("a9-live", { text: PRIORITIZE_GOAL }));

    expect(answer.findings.length).toBeGreaterThan(0);
    expect(answer.findings.map((f) => f.statement).join(" ")).toContain("3208");
  });

  it("and answers the category plan exactly as it answers the plan that named no entity", async () => {
    const withCategory = done(await build(
      { plansByGoal: { [PRIORITIZE_GOAL]: PRIORITIZE_WITH_CATEGORY_PLAN } },
    ).runtime.run("a9-cat", { text: PRIORITIZE_GOAL }));
    const without = done(await build(
      { plansByGoal: { [PRIORITIZE_GOAL]: PRIORITIZE_AND_DRAFT_PLAN } },
    ).runtime.run("a9-none", { text: PRIORITIZE_GOAL }));

    // The live divergence this closes: one sentence, two plans, and only one of them answered.
    expect(withCategory.findings.map((f) => f.statement))
      .toEqual(without.findings.map((f) => f.statement));
  });

  it("keeps A2's skip semantics — an unservable need is still reported, not answered", async () => {
    const { runtime } = build({ plansByGoal: { [PRIORITIZE_GOAL]: PRIORITIZE_WITH_CATEGORY_PLAN } });
    const answer = done(await runtime.run("a9-skip", { text: PRIORITIZE_GOAL }));
    // n3 (CUSTOMER_HISTORY) has no anchor and never had one. It stays unsatisfied and says so.
    expect(answer.needs.find((n) => n.id === "n3")?.status).not.toBe("SATISFIED");
    expect(answer.nextActions.every((a) => a.actionClass !== "WRITE")).toBe(true);
  });

  it("and the draft limitation is unchanged — no run mints one", async () => {
    const { runtime } = build({ plansByGoal: { [PRIORITIZE_GOAL]: PRIORITIZE_WITH_CATEGORY_PLAN } });
    const answer = done(await runtime.run("a9-draft", { text: PRIORITIZE_GOAL }));
    // READ opens a screen and PREPARE stages a human checkpoint. WRITE — the class a "초안을 만들어줘"
    // goal would need — is the one no Operator action may ever carry, drafting included.
    expect(answer.nextActions.every((a) => a.actionClass !== "WRITE")).toBe(true);
    expect(answer.nextActions.length).toBeGreaterThan(0);
  });
});

// ──────────────────────────────────────────────────────────── A1 · exactly as strict as before

describe("A1 fence — an instance still narrows, resolved or not", () => {
  it("a named product with nothing resolved is answered by NOTHING", () => {
    const scope = needScopeOf(planOf([mentionOf("PRODUCT", "판도리 일체형 종이컵 수거함")]), NEED, []);
    expect(scope.entity).toBe("PRODUCT");
    // The whole point: the narrow requirement survives the failure to resolve. No org fallback.
    expect(checkEvidence(scope, inboxCount())).toBe("NO_RESOLVED_PRODUCT");
  });

  it("a resolved inquiry is an item, whatever the mention looked like", () => {
    const scope = needScopeOf(planOf([mentionOf("INQUIRY", "미답변 문의")]), NEED, [
      { kind: "INQUIRY", mention: "이 문의", id: "inq-1", label: "문의", resolvedBy: "tool" },
    ]);
    expect(scope.entity).toBe("ITEM");
    expect(checkEvidence(scope, inboxCount())).toBe("ORG_EVIDENCE_FOR_PRODUCT_NEED");
  });

  it("a category next to an instance does not widen the instance", () => {
    const scope = needScopeOf(
      planOf([mentionOf("PRODUCT", "상품"), mentionOf("PRODUCT", "판도리 일체형 종이컵 수거함")]),
      NEED, [],
    );
    expect(scope.entity).toBe("PRODUCT");
  });

  it("a category channel does not demand a channel nothing can prove", () => {
    // "판매채널" as a CHANNEL mention normalized to itself and matched no evidence, so every row was
    // CHANNEL_UNPROVEN — A9 on the channel axis.
    const scope = needScopeOf(planOf([mentionOf("CHANNEL", "판매채널")]), NEED, []);
    expect(scope.channelCode).toBeNull();
    expect(checkEvidence(scope, inboxCount())).toBeNull();
  });

  it("a named channel still narrows", () => {
    const scope = needScopeOf(planOf([mentionOf("CHANNEL", "쿠팡")]), NEED, []);
    expect(scope.channelCode).toBe("COUPANG");
    expect(checkEvidence(scope, inboxCount())).toBe("CHANNEL_UNPROVEN");
  });
});

// ──────────────────────────────────────────────────────────── C5 · a category reaches no resolver

describe("C5 — a category is never handed to a resolver", () => {
  it("is not among the mentions a specialist may resolve", () => {
    expect(instanceMentionsOf(planOf([mentionOf("PRODUCT", "상품")]), "PRODUCT")).toEqual([]);
    expect(instanceMentionsOf(planOf([mentionOf("PRODUCT", "전선몰딩 상품")]), "PRODUCT"))
      .toEqual(["전선몰딩 상품"]);
  });

  it("live shape — resolve_product is never called with the word 상품", async () => {
    const { runtime, operator } = build({ plansByGoal: { [CATEGORY_GOAL]: CATEGORY_PRODUCT_PLAN } });
    done(await runtime.run("c5-live", { text: CATEGORY_GOAL }));

    expect(operator.productQueries).not.toContain("상품");
    expect(operator.calls.products).toBe(0);
  });

  it("and the run still answers from the org, rather than failing on the category", async () => {
    const { runtime } = build({ plansByGoal: { [CATEGORY_GOAL]: CATEGORY_PRODUCT_PLAN } });
    const answer = done(await runtime.run("c5-answer", { text: CATEGORY_GOAL }));
    // REVIEW_OPS reads the org's repeated issues; nothing is attributed to a product nobody named.
    expect(answer.findings.length).toBeGreaterThan(0);
    expect(answer.nextActions.every((a) => a.actionClass !== "WRITE")).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────── A8 · unchanged where it applies

describe("A8 keeps its shape — a named product must still be reachable", () => {
  it("a plan that names a real product and cannot reach it is still refused", () => {
    expect(() => validatePlan(
      planOf([mentionOf("PRODUCT", "전선몰딩")], ["REVIEW_OPS"]), DEPS,
    )).toThrow(PlanRejectedError);
  });

  it("a plan whose only product word is a category is valid without PRODUCT_OPS", () => {
    const ok = validatePlan(planOf([mentionOf("PRODUCT", "상품별")], ["REVIEW_OPS"]), DEPS);
    expect(ok.specialistTargets).toEqual(["REVIEW_OPS"]);
  });

  it("and no repair call is spent on it", async () => {
    let calls = 0;
    const planner = new LlmInvestigationPlanner({
      async planGoal() {
        calls += 1;
        return { ...CATEGORY_PRODUCT_PLAN, specialists: ["REVIEW_OPS"] };
      },
    });
    await planner.plan({
      request: { text: CATEGORY_GOAL },
      catalogue: DEPS.catalogue,
      toolNames: DEPS.catalogue,
      limits: DEPS.limits,
    });
    expect(calls).toBe(1);
  });
});

// ──────────────────────────────────────────────────────────── the anchor, and the one table

describe("one meaning of 'the seller named something', shared", () => {
  it("a category anchors nothing — a need that needs one is not servable", () => {
    const need: InformationNeed = { id: "n1", question: "q", kind: "PRODUCT_FACT", why: "", required: true };
    expect(isServable(planOf([mentionOf("PRODUCT", "상품")]), need)).toBe(false);
    expect(isServable(planOf([mentionOf("PRODUCT", "전선몰딩")]), need)).toBe(true);
  });

  it("and a resolved entity always counts, because a tool matched it to a row", () => {
    expect(namesInstance(planOf([]), ["PRODUCT"], [
      { kind: "PRODUCT", mention: "전선몰딩", id: "p-1", label: "전선몰딩", resolvedBy: "tool" },
    ])).toBe(true);
  });

  it("the vocabulary lives in exactly one file, and is not exported for copying", async () => {
    const module = await import("../../src/operator/plan/EntityRole");
    expect(Object.keys(module).sort())
      .toEqual(["entityRoleOf", "instanceMentionsOf", "isInstance", "mentionOf", "namesInstance"]);

    for (const file of sources(join(__dirname, "../../src"))) {
      if (file.endsWith("EntityRole.ts")) continue;
      const text = readFileSync(file, "utf8");
      expect(text, `${file} carries a second category list`).not.toMatch(/CATEGORY_(HEADS|MODIFIERS)/);
      // A second reading of the same words, by any other means: a substring test on a mention, or a
      // comparison against a Korean literal.
      expect(text, `${file} re-reads a mention's words`)
        .not.toMatch(/\bmention\.(includes|startsWith|endsWith|match)\b|\.mention\s*===\s*"[^"]*[가-힣]/);
    }
  });
});

// --------------------------------------------------------------------------- helpers

const NEED: InformationNeed = { id: "n1", question: "q", kind: "INQUIRY_VOLUME", why: "", required: true };

function planOf(
  unresolved: InvestigationPlan["entities"]["unresolved"],
  specialistTargets: InvestigationPlan["specialistTargets"] = ["INQUIRY_OPS"],
): InvestigationPlan {
  return {
    supported: true,
    userGoal: "g",
    entities: { resolved: [], unresolved },
    informationNeeds: [NEED],
    specialistTargets,
    candidateTools: [],
    retrievalStrategy: { order: ["n1"], parallelizable: [], stopWhen: null },
    evidenceRequirements: [],
    riskClass: "ROUTINE",
    stoppingCriteria: { maxIterations: 1, maxToolCalls: 4, enough: null },
    clarificationNeeded: false,
    clarificationReason: null,
    rationale: null,
    plannerVersion: "test",
    appliedDefaults: [],
  };
}

/** The org's unanswered total — the row A9 threw away. */
function inboxCount(): EvidenceRef {
  return {
    evidenceId: "e1",
    kind: "INBOX_COUNT",
    sourceTool: "get_today_inbox",
    sourceCall: "abcd1234",
    locator: { count: 3208, label: "미답변 문의" },
    asOf: "2026-08-24",
    events: null,
    coverage: "COVERED",
    provenance: "inquiry-store/INGEST:canonical",
  };
}

function build(seed: Record<string, unknown> = {}) {
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
    runtime: new OperatorAgentRuntime({
      operator,
      inquiry: new FakeSpringClient(twoInquiries()),
      issue: new FakeIssueSpringClient(fourIssues()),
    }),
  };
}

function done(result: OperatorRunResult): OperatorAnswer {
  if (result.status !== "DONE") {
    throw new Error(`expected DONE, got FAILED: ${result.failureCode} — ${result.reason}`);
  }
  return result.answer;
}

/** Every `.ts` under a directory — the structural scan's input. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sources(full);
    return full.endsWith(".ts") ? [full] : [];
  });
}
