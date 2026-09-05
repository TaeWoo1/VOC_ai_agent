/**
 * "어느 상품이?" — answered with products, or honestly not answered at all.
 *
 * <b>The red case is the whole of §16.7.</b> After A9/C5 the run no longer narrowed wrongly on a
 * category mention, and it still answered a question about PRODUCTS with a list of ISSUES: "접착
 * 탈락에 대한 리뷰 근거가 19건 기록돼 있습니다". True, sourced, and about the org. The seller had asked
 * which of their products to look at.
 *
 * Four properties are pinned here, and they are separable:
 *
 *  1. <b>The axis is a property of the run, decided once.</b> A CATEGORY mention or the seller's own
 *     "상품별 / …있는 상품을" sets it; an INSTANCE always cancels it (A1). One vocabulary, in
 *     `plan/EntityRole.ts`, shared with the role question.
 *  2. <b>A row's number is that row's.</b> The product's own count, ranked by the product's own count,
 *     deduped by canonical id — never the issue's total (C4), never the org's.
 *  3. <b>A bounded scan says so.</b> Issues opened out of issues live, evidence reached out of evidence
 *     there, products the catalogue could not name, rows attributed to nobody.
 *  4. <b>An axis that cannot be produced is stated, not approximated.</b> Repeat rows carry no product
 *     and the inquiry queue carries no product, so those answers say the number is an org total —
 *     rather than letting "최근 28일 반복 0건" read as a verdict on the seller's products.
 */
import { describe, expect, it } from "vitest";
import { OperatorAgentRuntime } from "../../src/operator/operatorRuntime";
import type { OperatorRunResult } from "../../src/operator/operatorRuntime";
import { FakeOperatorSpringClient } from "../support/FakeOperatorSpringClient";
import type { FakeOperatorSeed } from "../support/FakeOperatorSpringClient";
import { FakeSpringClient } from "../support/FakeSpringClient";
import { FakeIssueSpringClient } from "../support/FakeIssueSpringClient";
import { twoInquiries } from "../support/fixtures";
import { makeIssue } from "../support/issueFixtures";
import {
  ANALYSES, CABLE, INBOX, KNOWLEDGE, MEMORY, MOLDING, REPEATS, coveredSignals, unlinkedSignals,
} from "../support/operatorFixtures";
import {
  GROUPED_INQUIRY_PLAN, GROUPED_NO_PERIOD_PLAN, RECORDED_PLANS, REPEATED_REVIEW_AXIS_PLAN,
} from "../support/recordedPlans";
import type { OperatorAnswer } from "../../src/operator/state/OperatorState";
import type { InvestigationPlan, ResolvedEntity } from "../../src/operator/plan/InvestigationPlan";
import { mentionOf } from "../../src/operator/plan/EntityRole";
import { groupByProduct, groupingOf, namedRows } from "../../src/operator/group/ProductGrouping";
import type { IssueSlice } from "../../src/operator/group/ProductGrouping";
import {
  GROUPING_CAPABILITIES, groupingLimitSentence, groupingSupportOf, reachableToolNames,
} from "../../src/operator/tools/ToolReachability";
import type {
  DashboardSummary, IssueEvidenceSummary, ReviewIssueSummary,
} from "../../src/spring/types";
import { senseOf } from "../../src/operator/group/ReviewEvidenceSense";

const GROUPED_GOAL = "상품별로 리뷰 문제가 있는 상품을 알려줘";
const Q2 = "최근 부정적인 리뷰가 있는 상품을 알려줘.";
const Q3 = "반복해서 비슷한 문의가 들어오는 상품이 있어?";
const Q5 = "답변이 필요한 문의를 우선순위대로 정리하고 답변 초안을 만들어줘";
const NAMED_PRODUCT =
  "판도리 일체형 종이컵 수거함 상품의 리뷰와 문의를 같이 보고 고객 불만이나 반복 이슈가 있는지 알려줘.";
const GROUPED_INQUIRY_GOAL = "상품별 미답변 문의를 알려줘";
const REPEATED_AXIS = "최근 반복적으로 리뷰 문제가 나온 상품은?";
const UNNAMED_PRODUCT = "상품에 문제 있어?";

/* ─────────────────────────────── the fixture: three issues, four products ───────────────────────── */

const SOLO_PRODUCT = { id: "p-solo-0001", name: "판도리 조립형 종이컵 수거함" };
/** A product id the catalogue holds no name for — three of eleven in the demo org, live 2026-08-24. */
const NAMELESS_ID = "p-nameless-01";

const SHARED = makeIssue("aaaa0000-0000-0000-0000-0000000000a1", {
  severity: "HIGH", aspect: "배송", problem: "파손", evidenceCount: 15,
  firstEvidenceOn: "2025-08-29", lastEvidenceOn: "2026-06-16",
});
const MOLDING_ONLY = makeIssue("aaaa0000-0000-0000-0000-0000000000a2", {
  severity: "NORMAL", aspect: "접착", problem: "부족", evidenceCount: 4,
  firstEvidenceOn: "2026-01-01", lastEvidenceOn: "2026-02-01",
});
const SOLO_ONLY = makeIssue("aaaa0000-0000-0000-0000-0000000000a3", {
  severity: "NORMAL", aspect: "표면", problem: "누락", evidenceCount: 2,
  firstEvidenceOn: "2026-05-01", lastEvidenceOn: "2026-05-20",
});

interface Row {
  productId: string;
  productName: string | null;
  evidenceCount: number;
  /** THIS product's span. Absent ⇒ the read could not date these rows, and the row stays undated. */
  firstOccurredOn?: string;
  lastOccurredOn?: string;
}

function summary(
  rows: readonly Row[],
  issue: ReviewIssueSummary,
  unattributed = 0,
): IssueEvidenceSummary {
  const total = rows.reduce((s, r) => s + r.evidenceCount, 0) + unattributed;
  return {
    totalEvidence: total,
    byProduct: rows.map((r) => ({
      productId: r.productId,
      productName: r.productName,
      evidenceCount: r.evidenceCount,
      firstOccurredOn: r.firstOccurredOn ?? null,
      lastOccurredOn: r.lastOccurredOn ?? null,
    })),
    unattributedEvidence: unattributed,
    ratingDistribution: { rating1: total, rating2: 0, rating3: 0, rating4: 0, rating5: 0, unrated: 0 },
    firstEvidenceOn: issue.firstEvidenceOn,
    lastEvidenceOn: issue.lastEvidenceOn,
  };
}

/** Two multi-product issues and one exclusive one — the shape the demo org actually has. */
function issueClient(): FakeIssueSpringClient {
  const client = new FakeIssueSpringClient();
  client.put({
    summary: SHARED,
    // Three products inside ONE issue, each with its own span — and no product's span is the
    // issue's (2025-08-29..2026-06-16 starts before any of them). That is what makes "the row was
    // dated from its own rows" checkable rather than merely stated.
    evidence: summary([
      { productId: MOLDING.id, productName: MOLDING.name, evidenceCount: 7,
        firstOccurredOn: "2025-09-02", lastOccurredOn: "2026-06-16" },
      { productId: CABLE.id, productName: CABLE.name, evidenceCount: 7,
        firstOccurredOn: "2025-09-05", lastOccurredOn: "2026-01-10" },
      { productId: NAMELESS_ID, productName: null, evidenceCount: 1,
        firstOccurredOn: "2026-03-03", lastOccurredOn: "2026-03-03" },
    ], SHARED),
  });
  client.put({
    summary: MOLDING_ONLY,
    evidence: summary([
      { productId: MOLDING.id, productName: MOLDING.name, evidenceCount: 4,
        firstOccurredOn: "2026-01-01", lastOccurredOn: "2026-02-01" },
    ], MOLDING_ONLY),
  });
  client.put({
    summary: SOLO_ONLY,
    evidence: summary([
      { productId: SOLO_PRODUCT.id, productName: SOLO_PRODUCT.name, evidenceCount: 2,
        firstOccurredOn: "2026-05-01", lastOccurredOn: "2026-05-20" },
    ], SOLO_ONLY),
  });
  return client;
}

/**
 * The negative-review roll-up, as the dashboard returns it.
 *
 * <b>The numbers deliberately do not match the issue split.</b> 전선몰딩 has 11 rows of issue
 * evidence in the fixture above and 12 negative reviews here; if a test ever sees 11 under the word
 * "부정 리뷰" or 12 under "리뷰 문제 근거", the two senses have been renamed into each other.
 */
const NEGATIVE_ROLLUP: DashboardSummary = {
  cards: { negativeReviews: 31 },
  topProductIssues: [
    { productId: MOLDING.id, productName: MOLDING.name, issueLabel: "부정 리뷰", count: 12,
      firstNegativeOn: "2026-02-11", lastNegativeOn: "2026-08-02" },
    { productId: CABLE.id, productName: CABLE.name, issueLabel: "부정 리뷰", count: 5,
      firstNegativeOn: "2026-01-05", lastNegativeOn: "2026-06-30" },
    { productId: NAMELESS_ID, productName: null, issueLabel: "부정 리뷰", count: 4,
      firstNegativeOn: "2026-03-01", lastNegativeOn: "2026-07-07" },
  ],
};

function build(seed: Partial<FakeOperatorSeed> = {}) {
  const operator = new FakeOperatorSpringClient({
    inbox: INBOX,
    products: [MOLDING, CABLE],
    signals: { [MOLDING.id]: coveredSignals(), [CABLE.id]: unlinkedSignals() },
    knowledge: KNOWLEDGE,
    customerMemory: MEMORY,
    repeats: REPEATS,
    itemAnalyses: ANALYSES,
    dashboard: NEGATIVE_ROLLUP,
    plansByGoal: {
      ...RECORDED_PLANS,
      [GROUPED_GOAL]: GROUPED_NO_PERIOD_PLAN,
      [GROUPED_INQUIRY_GOAL]: GROUPED_INQUIRY_PLAN,
      [REPEATED_AXIS]: REPEATED_REVIEW_AXIS_PLAN,
    },
    ...seed,
  });
  const inquiry = new FakeSpringClient(twoInquiries());
  const issue = issueClient();
  return { runtime: new OperatorAgentRuntime({ operator, inquiry, issue }), operator, inquiry, issue };
}

function done(result: OperatorRunResult): OperatorAnswer {
  if (result.status !== "DONE") {
    throw new Error(`expected DONE, got FAILED: ${result.failureCode} — ${result.reason}`);
  }
  return result.answer;
}

function planOf(
  unresolved: InvestigationPlan["entities"]["unresolved"],
  resolved: readonly ResolvedEntity[] = [],
  userGoal = "무엇이든",
): InvestigationPlan {
  return {
    supported: true, userGoal,
    entities: { resolved, unresolved },
    informationNeeds: [], specialistTargets: [], candidateTools: [],
    retrievalStrategy: { order: [], parallelizable: [], stopWhen: null },
    evidenceRequirements: [], riskClass: "ROUTINE",
    stoppingCriteria: { maxIterations: 1, maxToolCalls: 6, enough: null },
    clarificationNeeded: false, clarificationReason: null, rationale: null,
    plannerVersion: "test", appliedDefaults: [],
  };
}

/* ───────────────────────────────────────── 1. the axis ───────────────────────────────────────── */

describe("the axis is decided once, from the plan and the seller's own words", () => {
  it("a PRODUCT CATEGORY mention names the axis", () => {
    expect(groupingOf(planOf([mentionOf("PRODUCT", "상품별")]))).toBe("PRODUCT");
    expect(groupingOf(planOf([mentionOf("PRODUCT", "전체 상품")]))).toBe("PRODUCT");
  });

  it("so does the seller's sentence, which is where the word usually is", () => {
    // Live 2026-08-24, three planner samples of Q2: PERIOD and ISSUE entities, and no PRODUCT entity
    // at all — three times out of three. An axis read only off the plan would never fire here.
    expect(groupingOf(planOf([mentionOf("PERIOD", "최근"), mentionOf("ISSUE", "부정적인 리뷰")]), Q2))
      .toBe("PRODUCT");
    expect(groupingOf(planOf([]), Q3)).toBe("PRODUCT");
    expect(groupingOf(planOf([]), "상품별 최근 문제를 알려줘")).toBe("PRODUCT");
  });

  it("an INSTANCE cancels it, whatever else the sentence says", () => {
    // "…상품의" carries the head noun. It is not a request for a ranking, and answering it with one
    // would be A1 in new clothes.
    expect(groupingOf(planOf([mentionOf("PRODUCT", "전선몰딩 상품")]),
      "전선몰딩 상품의 리뷰와 문의를 같이 보고 불만이 있는지 알려줘")).toBe("NONE");
    expect(groupingOf(planOf([mentionOf("PRODUCT", "판도리 일체형 종이컵 수거함")]), Q2)).toBe("NONE");
  });

  it("a resolved product cancels it too — the run is about that product", () => {
    const resolved: ResolvedEntity[] = [
      { kind: "PRODUCT", mention: "전선몰딩", id: MOLDING.id, label: MOLDING.name, resolvedBy: "tool" },
    ];
    expect(groupingOf(planOf([], resolved), Q2)).toBe("NONE");
  });

  it("a head noun with no axis particle is not an axis request", () => {
    // The negative control that must not move: "상품에 문제 있어?" still asks WHICH product.
    expect(groupingOf(planOf([]), UNNAMED_PRODUCT)).toBe("NONE");
    expect(groupingOf(planOf([]), "이 상품의 리뷰 보여줘")).toBe("NONE");
  });

  it("a question with no product axis in it is not grouped", () => {
    expect(groupingOf(planOf([mentionOf("INQUIRY", "답변이 필요한 문의")]), Q5)).toBe("NONE");
    expect(groupingOf(planOf([]), "오늘 뭐부터 봐야 해?")).toBe("NONE");
  });
});

/* ──────────────────────────────────────── 2. the rows ────────────────────────────────────────── */

describe("a grouped row carries one product's own number", () => {
  const slice = (o: Partial<IssueSlice> & { productId: string; count: number }): IssueSlice => ({
    issueId: "i-1", issueTitle: "배송 파손", productName: "이름", issueTotal: 15, events: null, ...o,
  });

  it("sums one product across issues and ranks by ITS count, not the issue's", () => {
    const grouped = groupByProduct([
      slice({ productId: "p-a", count: 4, issueId: "i-1", issueTotal: 99 }),
      slice({ productId: "p-a", count: 7, issueId: "i-2", issueTotal: 8 }),
      slice({ productId: "p-b", count: 9, issueId: "i-1", issueTotal: 99 }),
    ]);
    expect(grouped.rows.map((r) => [r.productId, r.count])).toEqual([["p-b", 9], ["p-a", 11]]
      .sort((x, y) => (y[1] as number) - (x[1] as number)));
    expect(grouped.rows[0]!.count, "11 = 4 + 7, and never 99").toBe(11);
  });

  it("keys by canonical id, so one shared name is still two products", () => {
    const grouped = groupByProduct([
      slice({ productId: "p-a", count: 3, productName: "스노우 누리젠" }),
      slice({ productId: "p-b", count: 2, productName: "스노우 누리젠", issueId: "i-2" }),
    ]);
    expect(grouped.rows).toHaveLength(2);
  });

  it("counts one (issue, product) pair once however often it is offered", () => {
    const grouped = groupByProduct([
      slice({ productId: "p-a", count: 5 }),
      slice({ productId: "p-a", count: 5 }),
    ]);
    expect(grouped.rows[0]!.count).toBe(5);
  });

  it("dates a row only when EVERY slice behind its count could be dated", () => {
    const dated = groupByProduct([
      slice({ productId: "p-a", count: 2, events: { from: "2026-05-01", to: "2026-05-20" } }),
      slice({ productId: "p-a", count: 1, issueId: "i-2", events: { from: "2026-06-01", to: "2026-06-02" } }),
    ]);
    expect(dated.rows[0]!.events).toEqual({ from: "2026-05-01", to: "2026-06-02" });

    const partly = groupByProduct([
      slice({ productId: "p-a", count: 2, events: { from: "2026-05-01", to: "2026-05-20" } }),
      slice({ productId: "p-a", count: 9, issueId: "i-2", events: null }),
    ]);
    expect(partly.rows[0]!.count).toBe(11);
    // 11 rows, 2 of them dated. Dating the row would date nine rows nobody can see — the C4 failure
    // on the temporal axis.
    expect(partly.rows[0]!.events).toBeNull();
  });

  it("keeps an unnamed product as a disclosed remainder, never as a label", () => {
    const grouped = groupByProduct([
      slice({ productId: "p-a", count: 3, productName: "이름 있음" }),
      slice({ productId: NAMELESS_ID, count: 2, productName: null }),
    ]);
    expect(grouped.rows).toHaveLength(2);
    expect(namedRows(grouped).map((r) => r.productId)).toEqual(["p-a"]);
    expect(grouped.unnamed).toEqual({ products: 1, count: 2 });
  });

  it("reports evidence attributed to nobody rather than distributing it", () => {
    const grouped = groupByProduct([slice({ productId: "p-a", count: 3 })], 6);
    expect(grouped.rows[0]!.count).toBe(3);
    expect(grouped.unattributed).toBe(6);
  });
});

/* ─────────────────────────────── 3. the grouped answer, end to end ──────────────────────────── */

describe("the run answers with products", () => {
  it("names each product with its own count, largest first", async () => {
    const { runtime } = build();
    const answer = done(await runtime.run("g-1", { text: GROUPED_GOAL }));

    const grouped = answer.findings.filter((f) => f.statement.includes("리뷰 문제 근거가"));
    expect(grouped.length, "before: zero sentences about products").toBeGreaterThan(0);
    // 전선몰딩: 7 from the shared issue + 4 from its own = 11. The shared issue's total is 15 and the
    // org's is 21; neither may appear as this product's number.
    const molding = grouped.find((f) => f.statement.startsWith(MOLDING.name));
    expect(molding?.statement).toContain("11건");
    expect(molding?.statement).not.toContain("15건");
    expect(grouped[0]!.statement.startsWith(MOLDING.name), "ranked by the product's own count").toBe(true);
  });

  it("says how much of the org it actually opened", async () => {
    const { runtime } = build();
    const answer = done(await runtime.run("g-2", { text: GROUPED_GOAL }));
    const scan = answer.findings.find((f) => f.statement.includes("나눴습니다"));
    expect(scan, "a grouped answer discloses its own scan").toBeDefined();
    expect(scan!.statement).toContain("3건");
    expect(scan!.claimsCoverageLimit).toBe(true);
    // The product the catalogue cannot name is disclosed rather than dropped or labelled with its id.
    expect(scan!.statement).toContain("상품명을 확인할 수 없는");
    expect(answer.findings.some((f) => f.statement.includes(NAMELESS_ID))).toBe(false);
  });

  it("calls no resolver — the ids come out of the evidence (C5)", async () => {
    const { runtime, operator } = build();
    await runtime.run("g-3", { text: GROUPED_GOAL });
    expect(operator.calls.products, "resolve_product for a category is the C5 defect").toBe(0);
    expect(operator.productQueries).toEqual([]);
  });

  it("does not turn eleven rows into eleven resolved entities", async () => {
    // A resolved PRODUCT entity narrows the whole run (needScopeOf). Writing the grouped ids there
    // would make every org-wide read in the same answer illegal — and the answer would then withhold
    // the very evidence it was grouping.
    const { runtime } = build();
    const answer = done(await runtime.run("g-4", { text: GROUPED_GOAL }));
    const cited = new Set(answer.findings.flatMap((f) => f.evidenceIds));
    const orgRows = answer.evidence.filter(
      (e) => e.kind === "REVIEW_ISSUE" && cited.has(e.evidenceId),
    );
    expect(orgRows.length, "the org brief still stands beside the grouped rows").toBeGreaterThan(0);
  });

  it("every grouped sentence rests on evidence carrying that product's id", async () => {
    const { runtime } = build();
    const answer = done(await runtime.run("g-5", { text: GROUPED_GOAL }));
    const refs = new Map(answer.evidence.map((e) => [e.evidenceId, e]));
    for (const finding of answer.findings.filter((f) => f.statement.includes("리뷰 문제 근거가"))) {
      const rows = finding.evidenceIds.map((id) => refs.get(id)!).filter(Boolean);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.kind).toBe("ISSUE_EVIDENCE");
        expect(row.locator.productId, "a product sentence cites a product row").toBeTruthy();
        expect(finding.statement).toContain(String(row.locator.count));
      }
    }
  });

  it("a product question by name still takes the attribution path, not the axis", async () => {
    const { runtime, operator } = build();
    await runtime.run("g-6", { text: NAMED_PRODUCT });
    // The A1/A8 path is untouched: a named product is resolved (or the plan is refused), never grouped.
    expect(operator.calls.products, "a named product is still looked up").toBeGreaterThan(0);
  });
});

/* ──────────────────────────── 4. the axis that cannot be produced ───────────────────────────── */

describe("an axis the data cannot be cut along is stated, not approximated", () => {
  it("repeat rows carry no product, and the answer says the number is an org total", async () => {
    const { runtime } = build();
    const answer = done(await runtime.run("g-7", { text: Q3 }));
    const limit = answer.findings.find((f) => f.statement.includes("상품 정보가 없어"));
    expect(limit, "Q3 asked which products; the repeat read cannot say").toBeDefined();
    expect(limit!.claimsCoverageLimit).toBe(true);
    // The demo fixture HAS repeat rows, so the sentence promises the totals that follow. With none, it
    // promises nothing — live 2026-08-24 Q3 said "아래 수치는 전체 기준입니다" over an empty read.
    expect(limit!.statement).toContain("전체 기준");
    expect(groupingLimitSentence("REPEAT_PATTERN", "NO_PRODUCT_ATTRIBUTION", false))
      .toContain("상품별로는 지금 답할 수 없습니다");
  });

  it("the inquiry queue carries no product either, and says which kind of gap that is", async () => {
    const { runtime } = build();
    const answer = done(await runtime.run("g-8", { text: GROUPED_INQUIRY_GOAL }));
    const limit = answer.findings.find((f) => f.statement.includes("상품별로 모아 볼 수 있는 조회가"));
    expect(limit?.claimsCoverageLimit).toBe(true);
  });

  it("the two gaps are different facts and the matrix keeps them apart", () => {
    expect(groupingSupportOf("REVIEW_SIGNAL", "PRODUCT")).toBe("SUPPORTED");
    expect(groupingSupportOf("REPEAT_PATTERN", "PRODUCT")).toBe("NO_PRODUCT_ATTRIBUTION");
    expect(groupingSupportOf("INQUIRY_VOLUME", "PRODUCT")).toBe("NO_GROUPED_READ");
    // An undeclared pair fails closed rather than being assumed groupable.
    expect(groupingSupportOf("ORDER_HISTORY", "PRODUCT")).toBe("NO_GROUPED_READ");
  });

  it("every supported row names reads that actually exist", () => {
    const reachable = new Set(reachableToolNames());
    for (const row of GROUPING_CAPABILITIES) {
      expect(row.why.length, `${row.needKind} says where the verdict comes from`).toBeGreaterThan(10);
      if (row.support === "SUPPORTED") {
        expect(row.via.length).toBeGreaterThan(0);
        for (const tool of row.via) {
          expect(reachable.has(tool), `${tool} is executable`).toBe(true);
        }
      } else {
        expect(row.via, "an unavailable axis claims no read").toEqual([]);
      }
    }
  });
});

/* ────────────────────────────── 5. the queue behind the count ───────────────────────────────── */

describe("a count is not a priority order", () => {
  it("names how long the oldest has waited, from the rows' own dates", async () => {
    const { runtime } = build();
    const answer = done(await runtime.run("g-9", { text: Q5 }));
    const queue = answer.findings.find((f) => f.statement.includes("가장 오래 기다렸습니다"));
    expect(queue, "before: only '69건 있습니다'").toBeDefined();
    expect(queue!.statement).toContain("2026-07-18");
  });

  it("carries no customer text — not a title, not a body", async () => {
    const { runtime } = build();
    const answer = done(await runtime.run("g-10", { text: Q5 }));
    const surface = [
      ...answer.findings.map((f) => f.statement),
      ...answer.evidence.map((e) => JSON.stringify(e.locator)),
    ].join("\n");
    for (const leak of ["사이즈 문의", "환불 요청", "색상 옵션"]) {
      expect(surface, `queue rows must not carry ${leak}`).not.toContain(leak);
    }
  });

  it("labels the two totals rather than reconciling them", async () => {
    // Live 2026-08-24: `get_today_inbox` said 69 (status UNANSWERED) and the queue page said 68
    // (phase OPEN). Both are true of different corpora, so both are named.
    const { runtime } = build();
    const answer = done(await runtime.run("g-11", { text: Q5 }));
    expect(answer.note ?? "").toContain("세는 대상이 서로 완전히 같지는 않습니다");
  });

  it("reads the queue once however many volume needs asked for it", async () => {
    const { runtime, inquiry } = build();
    await runtime.run("g-12", { text: "오늘 뭐부터 봐야 해? 목록으로" });
    expect(inquiry.calls.list, "two INQUIRY_VOLUME needs, one page").toBe(1);
  });
});

/* ──────────────────────────────── 6. the temporal contract ─────────────────────────────────── */

describe("a period question is answered by the rows' own dates, or not at all", () => {
  it("a product row on the issue axis now carries the span of ITS OWN evidence", async () => {
    const { runtime } = build();
    const answer = done(await runtime.run("g-13", { text: REPEATED_AXIS }));
    const grouped = answer.findings.filter((f) => f.statement.includes("리뷰 문제 근거가"));
    // 전선몰딩's 11 rows come from two issues — 7 from one shared with two other products. Until the
    // backend carried per-product dates this row could not be dated at all and a "최근" question
    // withheld it; its span is now its own rows' (2025-09-02..2026-06-16), so it answers.
    expect(grouped.some((f) => f.statement.startsWith(MOLDING.name))).toBe(true);
    expect(grouped.map((f) => f.statement).join(" ")).toContain(SOLO_PRODUCT.name);
    const molding = answer.evidence.find(
      (e) => e.kind === "ISSUE_EVIDENCE" && e.locator.productId === MOLDING.id,
    );
    expect(molding!.events).toEqual({ from: "2025-09-02", to: "2026-06-16" });
    // And the seller can SEE when, in the sentence: a row dated ten months ago and one dated this
    // month are both "datable", and only the date tells them apart under a "최근" question.
    expect(grouped.find((f) => f.statement.startsWith(MOLDING.name))!.statement)
      .toContain("가장 최근 근거 2026-06-16");
    // And it is NOT the issue's span, which starts 2025-08-29 — the borrowing this whole axis refuses.
    expect(molding!.events!.from).not.toBe("2025-08-29");
  });

  it("a row the read could not date is still withheld, and the answer says so", async () => {
    // One issue comes back with no dates on its splits. Nothing infers them; the row that depends on
    // that issue loses its span and a period question cannot rest on it.
    const issue = issueClient();
    issue.put({
      summary: SHARED,
      evidence: summary([
        { productId: MOLDING.id, productName: MOLDING.name, evidenceCount: 7 },
        { productId: CABLE.id, productName: CABLE.name, evidenceCount: 7 },
        { productId: NAMELESS_ID, productName: null, evidenceCount: 1 },
      ], SHARED),
    });
    const operator = new FakeOperatorSpringClient({
      inbox: INBOX, products: [MOLDING, CABLE], knowledge: KNOWLEDGE, customerMemory: MEMORY,
      repeats: REPEATS, itemAnalyses: ANALYSES, dashboard: NEGATIVE_ROLLUP,
      signals: { [MOLDING.id]: coveredSignals(), [CABLE.id]: unlinkedSignals() },
      plansByGoal: { ...RECORDED_PLANS, [REPEATED_AXIS]: REPEATED_REVIEW_AXIS_PLAN },
    });
    const runtime = new OperatorAgentRuntime({
      operator, inquiry: new FakeSpringClient(twoInquiries()), issue,
    });
    const answer = done(await runtime.run("g-13b", { text: REPEATED_AXIS }));

    // 전선몰딩 now has 11 rows of which 7 are undated → the whole row is undated → withheld.
    const grouped = answer.findings.filter((f) => f.statement.includes("리뷰 문제 근거가"));
    expect(grouped.some((f) => f.statement.startsWith(MOLDING.name))).toBe(false);
    // 케이블타이's only rows are the undated ones, so it goes too. 판도리 조립형 keeps its own dates.
    expect(grouped.map((f) => f.statement).join(" ")).toContain(SOLO_PRODUCT.name);
    const scan = answer.findings.find((f) => f.statement.includes("나눴습니다"));
    expect(scan!.statement).toContain("언제 발생했는지 확인할 수 없어");
  });

  it("and the org brief that CAN be dated still answers", async () => {
    const { runtime } = build();
    const answer = done(await runtime.run("g-14", { text: REPEATED_AXIS }));
    expect(answer.findings.some((f) => f.statement.includes("리뷰 근거가")), "nothing regressed")
      .toBe(true);
  });
});

/* ─────────────────────────── 6. two review evidences, never each other ──────────────────────── */

describe("부정 리뷰 and 리뷰 문제 근거 are different questions with different answers", () => {
  // Agent Semantic Ownership v1 §2: the sense is the PLAN's, read from the reads it named. Every case
  // below is a tool list measured against the real planner on 2026-09-06 for the sentence in its comment.
  it("reads the plan's own choice of read, not the sentence a second time", () => {
    // 「최근 부정적인 리뷰가 있는 상품을 알려줘」 / 「별점 낮은 리뷰가 많은 상품이 뭐야?」
    expect(senseOf(["list_recent_reviews", "get_dashboard_product_issues"])).toBe("NEGATIVE_REVIEW");
    // 「리뷰가 안 좋은 상품 뭐야?」 — the sentence the deleted word table got WRONG: it names no word in
    // either list and fell to the issue default, while the planner read it correctly.
    expect(senseOf(["get_dashboard_product_issues", "list_recent_reviews"])).toBe("NEGATIVE_REVIEW");
    // 「리뷰 문제가 반복되는 상품 알려줘」 / 「요즘 자꾸 나오는 불만이 뭐야?」
    expect(senseOf(["search_review_issues"])).toBe("ISSUE_EVIDENCE");
    // 「최근 반복적으로 리뷰 문제가 나온 상품은?」 / 「부정적인 리뷰가 반복되는 상품이 있어?」 — the planner
    // names the dashboard read as a supporting one, so a plan holding BOTH is still the issue question.
    // This is the conservative direction, and it is why rung 2 exists.
    expect(senseOf(["search_review_issues", "get_dashboard_product_issues"])).toBe("ISSUE_EVIDENCE");
    // 「상품별로 리뷰 문제가 있는 상품을 알려줘」 — naming the sense's own read settles it outright.
    expect(senseOf(["search_review_issues", "get_dashboard_product_issues", "get_review_issue_evidence_summary"]))
      .toBe("ISSUE_EVIDENCE");
    // A plan that named neither gets what every grouped run got before this module existed.
    expect(senseOf([])).toBe("ISSUE_EVIDENCE");
  });

  it("answers Q2 with negative reviews per product, dated by those reviews", async () => {
    const { runtime, operator, issue } = build();
    const answer = done(await runtime.run("g-15", { text: Q2 }));

    const negatives = answer.findings.filter((f) => f.statement.includes("부정 리뷰가"));
    expect(negatives.map((f) => f.statement)).toEqual([
      `${MOLDING.name}에 부정 리뷰가 12건 있습니다 (가장 최근 2026-08-02, 처음 2026-02-11).`,
      `${CABLE.name}에 부정 리뷰가 5건 있습니다 (가장 최근 2026-06-30, 처음 2026-01-05).`,
    ]);
    // Dated by the reviews counted in that row, so a "최근" question rests on them and they survive.
    const row = answer.evidence.find(
      (e) => e.kind === "NEGATIVE_REVIEW" && e.locator.productId === MOLDING.id,
    );
    expect(row!.events).toEqual({ from: "2026-02-11", to: "2026-08-02" });
    expect(operator.calls.dashboard).toBe(1);
    // And the OTHER read is not bought: the answer is about negative reviews, so eight evidence
    // summaries would be eight calls producing a number this answer must not use.
    expect(issue.reads.evidenceSummary).toBe(0);
  });

  it("never states the issue-evidence number under the negative-review noun, or the reverse", async () => {
    const { runtime } = build();
    const negative = done(await runtime.run("g-16", { text: Q2 }));
    const repeated = done(await runtime.run("g-17", { text: REPEATED_AXIS }));

    const negativeRows = negative.findings.filter((f) => f.statement.includes("부정 리뷰가"));
    const issueRows = repeated.findings.filter((f) => f.statement.includes("리뷰 문제 근거가"));
    // 전선몰딩 is in both answers with two different numbers, and neither wears the other's noun.
    expect(negativeRows.some((f) => f.statement.includes("12건"))).toBe(true);
    expect(negativeRows.some((f) => f.statement.includes("11건"))).toBe(false);
    expect(issueRows.some((f) => f.statement.includes("11건"))).toBe(true);
    expect(issueRows.some((f) => f.statement.includes("12건"))).toBe(false);
    // The evidence kinds are separate too, so the gate and the judge see two facts, not one.
    expect(negative.evidence.some((e) => e.kind === "ISSUE_EVIDENCE")).toBe(false);
    expect(repeated.evidence.some((e) => e.kind === "NEGATIVE_REVIEW")).toBe(false);
  });

  it("says what the top-five roll-up does not cover, including the products it cannot name", async () => {
    const { runtime } = build();
    const answer = done(await runtime.run("g-18", { text: Q2 }));
    const scan = answer.findings.find((f) => f.claimsCoverageLimit)!;
    expect(scan.statement).toContain("부정 리뷰 31건 가운데");
    expect(scan.statement).toContain("상위 2개 상품의 17건");
    expect(scan.statement).toContain("전체 순위가 아닙니다");
    expect(scan.statement).toContain("1개 상품의 4건은 이름 없이");
    expect(scan.statement).toContain("반복 리뷰 문제의 근거 건수와는 다른 집계");
  });

  it("keys rows by canonical id, so the roll-up's names are labels and never identity", async () => {
    const { runtime } = build();
    const answer = done(await runtime.run("g-19", { text: Q2 }));
    const rows = answer.evidence.filter(
      (e) => e.kind === "NEGATIVE_REVIEW" && e.locator.productId != null,
    );
    expect(rows.map((e) => e.locator.productId)).toEqual([MOLDING.id, CABLE.id]);
    // The nameless product is not among them and is not given its id to read.
    expect(answer.findings.map((f) => f.statement).join(" ")).not.toContain(NAMELESS_ID);
  });

  it("calls no resolver on either sense — the ids come out of the evidence (C5)", async () => {
    const { runtime, operator } = build();
    done(await runtime.run("g-20", { text: Q2 }));
    expect(operator.calls.products).toBe(0);
  });
});
