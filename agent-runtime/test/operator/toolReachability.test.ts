/**
 * The catalogue tells the truth about what this Operator can do.
 *
 * <b>The red case is a live one.</b> On 2026-08-23 the planner was shown 18 tools; 7 had a caller.
 * `get_review_issue_evidence_summary` — the only read that can say how many of an issue's review rows
 * belong to ONE product — was one of the eleven with none, which is why a seller asking about their own
 * product by name got the org's issue list, watched the scope gate refuse every row of it, and was told
 * nothing (`docs/agent_real_validation_v1.md` §5 P4 · A5 · B1).
 *
 * Two properties are pinned here, and they are not the same property:
 *
 *  1. <b>Advertised = executable.</b> Every tool the planner is offered has a specialist that actually
 *     invokes it, and every tool a specialist invokes is declared in the capability matrix. Neither
 *     direction may drift, so a tool cannot quietly become dead and cannot quietly become uncatalogued.
 *  2. <b>A precondition is a precondition.</b> A tool that needs a resolved product is not called
 *     without one — the "answer" that would produce is about a product nobody looked at.
 *
 * What is NOT claimed: that all 18 are reachable. Several duplicate a read that already runs and one
 * carries customer text the Operator has no lane for; those stay registered, stay READ, and stay out of
 * the planner's sight until a specialist owns them.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OperatorAgentRuntime } from "../../src/operator/operatorRuntime";
import type { OperatorRunResult } from "../../src/operator/operatorRuntime";
import type { Planner, PlanInput } from "../../src/operator/plan/LlmInvestigationPlanner";
import { LlmInvestigationPlanner, PlannerUnavailableError } from "../../src/operator/plan/LlmInvestigationPlanner";
import { OPERATOR_TOOL, buildOperatorTools, toolCatalogueFor } from "../../src/operator/tools/OperatorTools";
import {
  GROUPING_CAPABILITIES, TOOL_CAPABILITIES, reachableToolNames, toolsFor, unreachableToolNames,
} from "../../src/operator/tools/ToolReachability";
import { REVIEW_SENSES } from "../../src/operator/group/ReviewEvidenceSense";
import type { SpecialistName } from "../../src/operator/state/OperatorState";
import { FakeOperatorSpringClient } from "../support/FakeOperatorSpringClient";
import type { FakeOperatorSeed } from "../support/FakeOperatorSpringClient";
import { FakeSpringClient } from "../support/FakeSpringClient";
import { FakeIssueSpringClient } from "../support/FakeIssueSpringClient";
import { twoInquiries } from "../support/fixtures";
import { ISSUE_HIGH_QUIET, ISSUE_NORMAL_CONCENTRATED, fourIssues, makeIssue } from "../support/issueFixtures";
import {
  ANALYSES, CABLE, CUP_BIN, INBOX, KNOWLEDGE, MEMORY, MOLDING, REPEATS,
  coveredSignals, cupBinKnowledge, cupBinSignals, cupBinSignalsUnlinked, unlinkedSignals,
} from "../support/operatorFixtures";
import { RECORDED_PLANS, TODAY_PLAN } from "../support/recordedPlans";
import type { OperatorAnswer } from "../../src/operator/state/OperatorState";

const GOAL = "판도리 일체형 종이컵 수거함 상품의 리뷰와 문의를 같이 보고 고객 불만이나 반복 이슈가 있는지 알려줘.";
const NO_PRODUCT_GOAL = "오늘 뭐부터 봐야 해?";

const SPECIALIST_SOURCES: Partial<Record<SpecialistName, string>> = {
  PRODUCT_OPS: "productOps.ts",
  REVIEW_OPS: "reviewOps.ts",
  INQUIRY_OPS: "inquiryOps.ts",
  REPORT_OPS: "reportOpsNode.ts",
};

function sourceOf(specialist: SpecialistName): string {
  return readFileSync(
    join(__dirname, "../../src/operator/graph", SPECIALIST_SOURCES[specialist]!), "utf8",
  );
}

/** The tools one specialist's code actually calls, read off its `registry.invoke` sites. */
function invokedBy(specialist: SpecialistName): string[] {
  const names = new Map(Object.entries(OPERATOR_TOOL).map(([k, v]) => [k, v as string]));
  const found = new Set<string>();
  const pattern = /registry\.invoke(?:<[^>]*>)?\(\s*OPERATOR_TOOL\.([A-Z_]+)/g;
  for (const match of sourceOf(specialist).matchAll(pattern)) {
    const value = names.get(match[1]!);
    if (value) found.add(value);
  }
  return [...found].sort();
}

function catalogue() {
  const operator = new FakeOperatorSpringClient({});
  return buildOperatorTools({ operator, inquiry: {} as never, issue: {} as never });
}

/** A planner that records what it was offered, then fails the run. Nothing else needs to happen. */
class RecordingPlanner implements Planner {
  readonly kind = "LLM" as const;
  seen: PlanInput | null = null;

  async plan(input: PlanInput): Promise<never> {
    this.seen = input;
    throw new PlannerUnavailableError("TRANSPORT", "recorded");
  }
}

function build(seed: Partial<FakeOperatorSeed> = {}, issues = new FakeIssueSpringClient(fourIssues())) {
  return {
    issues,
    runtime: new OperatorAgentRuntime({
      operator: new FakeOperatorSpringClient({
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
        ...seed,
      }),
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

/** The signals map with one cup-bin variant swapped in — `build`'s seed replaces the map wholesale. */
function signalsWith(cupBin: ReturnType<typeof cupBinSignals>) {
  return { [MOLDING.id]: coveredSignals(), [CABLE.id]: unlinkedSignals(), [CUP_BIN.id]: cupBin };
}

/** The same variant seeded on BOTH reads — ProductOps sees signals through `get_product_knowledge`. */
function seedFor(cupBin: ReturnType<typeof cupBinSignals>) {
  return {
    signals: signalsWith(cupBin),
    knowledge: { ...KNOWLEDGE, [CUP_BIN.id]: cupBinKnowledge(cupBin) },
  };
}

/** The product's own issue index, naming the issue whose evidence the issue-store also splits. */
function cupBinWithConcentratedIssue() {
  return cupBinSignals([makeIssue(ISSUE_NORMAL_CONCENTRATED, {
    severity: "NORMAL", aspect: "뚜껑", problem: "이탈", evidenceCount: 9,
    dominantProductId: MOLDING.id, dominantProductName: "몰딩 화이트 10m",
    lastEvidenceOn: "2026-07-22",
  })]);
}

/** The issue list, with one issue whose evidence includes the cup bin but whose dominant product is not. */
function issuesAttributedToCupBin() {
  const client = new FakeIssueSpringClient(fourIssues());
  client.put({
    summary: makeIssue(ISSUE_NORMAL_CONCENTRATED, {
      severity: "NORMAL",
      aspect: "뚜껑",
      problem: "이탈",
      evidenceCount: 9,
      dominantProductId: MOLDING.id,
      dominantProductName: "몰딩 화이트 10m",
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
  return client;
}

// --------------------------------------------------------------- 1. advertised = executable

describe("the planner is only shown tools something can run", () => {
  it("every advertised tool has a specialist that invokes it", async () => {
    const planner = new RecordingPlanner();
    const runtime = new OperatorAgentRuntime({
      operator: new FakeOperatorSpringClient({ plansByGoal: RECORDED_PLANS }),
      inquiry: new FakeSpringClient(twoInquiries()),
      issue: new FakeIssueSpringClient(fourIssues()),
      planner,
    });
    await runtime.run("t-catalogue", { text: GOAL });

    const advertised = planner.seen!.catalogue.map((line) => line.split(":")[0]!.trim());
    const executable = new Set(
      (["PRODUCT_OPS", "REVIEW_OPS", "INQUIRY_OPS", "REPORT_OPS"] as SpecialistName[])
        .flatMap((s) => invokedBy(s)),
    );
    expect(advertised.length).toBeGreaterThan(0);
    expect(advertised.filter((name) => !executable.has(name))).toEqual([]);
    // The names go to the validator separately from the description lines — they are different shapes,
    // and matching a plan's tool choice against the LINES silently emptied `candidateTools` on every run.
    expect([...planner.seen!.toolNames!].sort()).toEqual([...advertised].sort());
  });

  it("a plan's own tool choice survives validation", async () => {
    // The defect this pins: V2 filtered `candidateTools` against the catalogue it was handed, and the
    // catalogue handed to it in production is `name: 설명` LINES. Every tool every planner ever chose
    // was therefore dropped, on every run, and `allowedTools` was only ever the specialist's own list —
    // silently, because the validator's own unit test feeds it bare names.
    const advertised = catalogue().filter((t) => reachableToolNames().includes(t.tool.name));
    const lines = toolCatalogueFor(advertised);
    const names = advertised.map((t) => t.tool.name);
    const planner = new LlmInvestigationPlanner({ planGoal: async () => TODAY_PLAN });
    const limits = { maxIterations: 3, maxToolCalls: 24 };

    const withNames = await planner.plan({
      request: { text: "오늘 뭐부터 봐야 해?" }, catalogue: lines, toolNames: names, limits,
    });
    expect([...withNames.candidateTools].sort()).toEqual([...TODAY_PLAN.tools].sort());

    // And the shape that caused it, kept visible rather than merely fixed.
    const withLines = await planner.plan({
      request: { text: "오늘 뭐부터 봐야 해?" }, catalogue: lines, limits,
    });
    expect(withLines.candidateTools).toEqual([]);
  });

  it("every tool a specialist invokes is declared in the capability matrix, and vice versa", () => {
    for (const specialist of ["PRODUCT_OPS", "REVIEW_OPS", "INQUIRY_OPS", "REPORT_OPS"] as SpecialistName[]) {
      expect(invokedBy(specialist), `${specialist} invocations`)
        .toEqual([...toolsFor(specialist)].sort());
    }
  });

  it("names the dead tools it does NOT advertise, rather than hiding the gap", () => {
    const all = catalogue().map((t) => t.tool.name);
    const dead = unreachableToolNames(all);
    // The eleven found live, minus the three that have since been connected: the evidence summary
    // (A5), the queue list (Grouped Product Answers v1 — a count is not a priority order) and the
    // dashboard roll-up (Product Review Signals v1 — negative reviews by canonical product).
    expect(dead.sort()).toEqual([
      OPERATOR_TOOL.GET_CHANNEL_CAPABILITY,
      OPERATOR_TOOL.GET_CONNECTION_GUIDANCE,
      OPERATOR_TOOL.GET_INQUIRY_CONTEXT,
      OPERATOR_TOOL.GET_INQUIRY_DETAIL,
      OPERATOR_TOOL.GET_ISSUE_TREND,
      OPERATOR_TOOL.GET_PRODUCT_SIGNALS,
      OPERATOR_TOOL.LIST_ITEM_ANALYSIS,
      OPERATOR_TOOL.SEARCH_CHANNEL_KNOWLEDGE,
    ].sort());
    expect(reachableToolNames()).toContain(OPERATOR_TOOL.GET_ISSUE_EVIDENCE_SUMMARY);
  });

  it("no evidence row is stamped with a tool that never runs", () => {
    // A `sourceTool` naming a dead tool is the same lie one layer down: it makes a capability that was
    // never exercised look like a read that happened. `get_inquiry_thread_context` was on the POLICY gap.
    const reachable = new Set(reachableToolNames());
    const byKey = new Map(Object.entries(OPERATOR_TOOL).map(([k, v]) => [k, v as string]));
    for (const specialist of ["PRODUCT_OPS", "REVIEW_OPS", "INQUIRY_OPS"] as SpecialistName[]) {
      for (const match of sourceOf(specialist).matchAll(/sourceTool: OPERATOR_TOOL\.([A-Z_]+)/g)) {
        expect(reachable.has(byKey.get(match[1]!)!), `${specialist} stamps ${match[1]}`).toBe(true);
      }
    }
  });

  it("every capability row still declares READ and a need it serves", () => {
    for (const row of TOOL_CAPABILITIES) {
      expect(row.needKinds.length, `${row.tool} serves a need`).toBeGreaterThan(0);
      expect(row.requires.length, `${row.tool} declares a precondition`).toBeGreaterThan(0);
    }
  });

  it("the two review senses share no read, no evidence kind and no noun", () => {
    // Product Review Signals v1 §3. Two grouped answers about reviews exist and they count different
    // things; the structural guarantee that neither can be renamed into the other is that no field
    // they are stated with is shared. A third sense added later inherits this check by existing.
    expect(REVIEW_SENSES.length).toBeGreaterThan(1);
    for (const field of ["tool", "evidenceKind", "noun", "counts"] as const) {
      const values = REVIEW_SENSES.map((d) => d[field]);
      expect(new Set(values).size, `${field} is unique per sense`).toBe(values.length);
    }
    // And each sense's read is one the planner is actually shown — a sense reached by nothing would
    // be a promise, which is the defect this whole file exists for.
    for (const declaration of REVIEW_SENSES) {
      expect(reachableToolNames(), `${declaration.sense} is reachable`).toContain(declaration.tool);
    }
    // The grouping matrix names both, so the REVIEW_SIGNAL × PRODUCT row is not describing half of
    // what it supports.
    const review = GROUPING_CAPABILITIES.find(
      (c) => c.needKind === "REVIEW_SIGNAL" && c.dimension === "PRODUCT",
    )!;
    for (const declaration of REVIEW_SENSES) {
      expect(review.via).toContain(declaration.tool);
    }
  });
});

// ------------------------------------------------- 2. the connection: product-scoped issue evidence

describe("a resolved product reaches its own review evidence", () => {
  it("attributes an issue's rows to the product, and quotes the product's own count", async () => {
    const { runtime, issues } = build(
      seedFor(cupBinWithConcentratedIssue()), issuesAttributedToCupBin(),
    );
    const answer = done(await runtime.run("t-attributed", { text: GOAL }));

    expect(issues.reads.evidenceSummary).toBeGreaterThan(0);
    const attributed = answer.findings.filter((f) => f.statement.includes("판도리 일체형 종이컵 수거함")
      && f.statement.includes("리뷰 근거가"));
    expect(attributed).toHaveLength(1);
    // The product's 2, not the issue's 9 — and the 9 named beside it so the two cannot be confused.
    expect(attributed[0]!.statement).toContain("2건");
    expect(attributed[0]!.statement).toContain("전체 9건");

    const cited = answer.evidence.filter((e) => attributed[0]!.evidenceIds.includes(e.evidenceId));
    expect(cited).toHaveLength(1);
    expect(cited[0]!.kind).toBe("ISSUE_EVIDENCE");
    expect(cited[0]!.locator.productId).toBe(CUP_BIN.id);
    expect(cited[0]!.sourceTool).toBe(OPERATOR_TOOL.GET_ISSUE_EVIDENCE_SUMMARY);
  });

  it("never turns another product's org-wide issue into a sentence about this one", async () => {
    const { runtime } = build(
      seedFor(cupBinWithConcentratedIssue()), issuesAttributedToCupBin(),
    );
    const answer = done(await runtime.run("t-no-org", { text: GOAL }));

    const stated = answer.findings.filter((f) => !f.claimsCoverageLimit)
      .flatMap((f) => f.evidenceIds);
    const rows = answer.evidence.filter((e) => stated.includes(e.evidenceId));
    // Every row behind a stated sentence is this product's. The HIGH-severity org issue is not.
    expect(rows.every((e) => e.locator.productId === CUP_BIN.id)).toBe(true);
    expect(answer.findings.some((f) => f.statement.includes("포장 파손"))).toBe(false);
    expect(rows.some((e) => e.locator.issueId === ISSUE_HIGH_QUIET)).toBe(false);
  });

  it("states a measured zero from the product's own index, and buys no org sweep to do it", async () => {
    const { runtime, issues } = build();
    const answer = done(await runtime.run("t-zero", { text: GOAL }));

    // The product's issue index is empty and every issue-evidence row in the org is attributed, so the
    // zero is MEASURED. ProductOps says so from a read it already made; ReviewOps' bounded org sweep
    // could only produce a hedged version of the same sentence, so it is not bought at all (C3).
    expect(issues.reads.evidenceSummary).toBe(0);
    const zero = answer.findings.filter((f) => f.statement.includes("반복 문제로 기록된 리뷰 근거는 없습니다"));
    expect(zero).toHaveLength(1);
    expect(zero[0]!.specialist).toBe("PRODUCT_OPS");
    // NOT a coverage-limit claim: it is a positive fact about the data and must face the same scope
    // gate every other claim does.
    expect(zero[0]!.claimsCoverageLimit).toBeUndefined();
    expect(zero[0]!.statement).not.toContain("확인하지 않았습니다");
    const ref = answer.evidence.find((e) => e.evidenceId === zero[0]!.evidenceIds[0]);
    expect(ref!.kind).toBe("ISSUE_EVIDENCE");
    expect(ref!.locator.productId).toBe(CUP_BIN.id);
    expect(ref!.locator.count).toBe(0);
    expect(ref!.coverage).toBe("COVERED");
  });

  it("keeps the complete answer when a bounded sweep would have overwritten it", async () => {
    // C3, end to end. Both specialists answer the same REVIEW_SIGNAL need; the one that ran second used
    // to win. Now the need carries the outcome that knows more.
    const { runtime } = build();
    const answer = done(await runtime.run("t-merge", { text: GOAL }));

    const review = answer.needs.find((n) => n.evidenceIds.length > 0
      && answer.evidence.some((e) => e.evidenceId === n.evidenceIds[0] && e.kind === "ISSUE_EVIDENCE"));
    expect(review?.status).toBe("SATISFIED");
    expect(answer.note ?? "").not.toContain("나머지는 확인하지 않았습니다");
  });

  it("falls back to the org sweep only when the product's own index cannot answer", async () => {
    // `UNCERTAIN_PRODUCT_UNLINKED`: rows exist that belong to no product, so an empty product index
    // proves nothing. This is the one case ReviewOps' sweep is the only path — and it reads.
    const { runtime, issues } = build(seedFor(cupBinSignalsUnlinked()));
    const answer = done(await runtime.run("t-fallback", { text: GOAL }));

    expect(issues.reads.evidenceSummary).toBe(4);
    const zero = answer.findings.filter((f) => f.statement.includes("귀속된") && f.statement.includes("없습니다"));
    expect(zero).toHaveLength(1);
    expect(zero[0]!.specialist).toBe("REVIEW_OPS");
    expect(zero[0]!.claimsCoverageLimit).toBe(true);
    expect(zero[0]!.statement).toContain("4건을 모두 확인");
  });

  it("never says \"모두 확인했다\" about a sweep that stopped at the cap", async () => {
    // Live on the first run of this path: the demo org held 19 open issues, the sweep read the top six,
    // and the sentence claimed all six were the whole list. A bounded read that reports as complete is
    // the same invented certainty as a wrong number.
    const many = new FakeIssueSpringClient(
      Array.from({ length: 9 }, (_, i) => makeIssue(`00000000-0000-0000-0000-00000000000${i}`, {
        severity: "NORMAL", aspect: "배송", problem: `지연${i}`,
      })),
    );
    const { runtime } = build(seedFor(cupBinSignalsUnlinked()), many);
    const answer = done(await runtime.run("t-capped", { text: GOAL }));

    const zero = answer.findings.find((f) => f.statement.includes("귀속된 리뷰 근거는 없습니다"))!;
    expect(zero.statement).toContain("9건 가운데");
    expect(zero.statement).toContain("나머지는 확인하지 않았습니다");
    expect(zero.statement).not.toContain("모두 확인");
    expect(many.reads.evidenceSummary).toBe(6);
  });

  it("does not lend the issue's dates to one product's slice of it", async () => {
    // The summary's first/last span the whole issue. A product's count borrowing them would let another
    // product's recent review prove this product's "최근" — the A1 failure wearing temporal clothes.
    const { runtime } = build(
      seedFor(cupBinWithConcentratedIssue()), issuesAttributedToCupBin(),
    );
    const answer = done(await runtime.run("t-dates", { text: GOAL }));
    const rows = answer.evidence.filter((e) => e.kind === "ISSUE_EVIDENCE");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((e) => e.events === null)).toBe(true);
    expect(rows.every((e) => e.asOf !== null)).toBe(true);
  });

  it("reads no product-scoped tool when no product was resolved", async () => {
    const { runtime, issues } = build();
    const answer = done(await runtime.run("t-org", { text: NO_PRODUCT_GOAL }));

    // Precondition RESOLVED_PRODUCT, enforced where it matters: the org question still gets the org's
    // issue list, and the attribution read that would have had nothing to attribute to never happens.
    expect(issues.reads.search).toBe(1);
    expect(issues.reads.evidenceSummary).toBe(0);
    expect(answer.evidence.some((e) => e.kind === "ISSUE_EVIDENCE")).toBe(false);
    // The org path is untouched: the issue list still becomes the org-scope sentences it always did.
    expect(answer.evidence.some((e) => e.kind === "REVIEW_ISSUE")).toBe(true);
  });

  it("keeps the WRITE count at zero and the run READ-only", async () => {
    const { runtime } = build({}, issuesAttributedToCupBin());
    const answer = done(await runtime.run("t-write", { text: GOAL }));
    expect(answer.nextActions.every((a) => a.actionClass === "READ")).toBe(true);
    expect(TOOL_CAPABILITIES.every((c) => reachableToolNames().includes(c.tool))).toBe(true);
  });
});
