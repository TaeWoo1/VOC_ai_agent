/**
 * Operator Graph v2 acceptance — end to end through the real graph, the real planner and the real
 * validator, with only the TRANSPORT faked.
 *
 * <b>The acceptance criterion is no longer "four sentences answer".</b> It is: different information
 * needs produce different investigations, the same need survives paraphrase, product facts are cited
 * with their sources, absence is reported as absence, and a run with no plan fails. Pinning four
 * blessed sentences is what let v1 ship a specialist that ran the same two reads for every goal.
 *
 * <b>Why the fake is at `planGoal` and not at `Planner`.</b> A `FakePlanner` would be a second planner
 * implementation, which `plannerFence.test.ts` forbids and which would make every result here a
 * measurement of the fake. Instead the fake replays plan wire-responses and everything above it runs
 * unmodified. What that CANNOT prove is generalization to sentences with no recorded plan; that is
 * §18.3's live proof and is stated there rather than implied here.
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
import { RECORDED_PLANS, REPAIRED_PLANS } from "../support/recordedPlans";
import type { OperatorAnswer } from "../../src/operator/state/OperatorState";

function build(seedOverrides: Partial<FakeOperatorSeed> = {}) {
  const operator = new FakeOperatorSpringClient({
    inbox: INBOX,
    products: [MOLDING, CABLE],
    signals: { [MOLDING.id]: coveredSignals(), [CABLE.id]: unlinkedSignals() },
    knowledge: KNOWLEDGE,
    customerMemory: MEMORY,
    repeats: REPEATS,
    itemAnalyses: ANALYSES,
    plansByGoal: RECORDED_PLANS,
    repairedPlansByGoal: REPAIRED_PLANS,
    ...seedOverrides,
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

/** Narrow a run to DONE, failing loudly with the reason when it is not. */
function done(result: OperatorRunResult): OperatorAnswer {
  if (result.status !== "DONE") {
    throw new Error(`expected DONE, got FAILED: ${result.failureCode} — ${result.reason}`);
  }
  return result.answer;
}

/** Every statement must trace to evidence that is actually in the answer. */
function assertTraceable(answer: OperatorAnswer): void {
  const ids = new Set(answer.evidence.map((e) => e.evidenceId));
  for (const finding of answer.findings) {
    expect(finding.evidenceIds.length, `"${finding.statement}" cites nothing`).toBeGreaterThan(0);
    for (const id of finding.evidenceIds) {
      expect(ids.has(id), `"${finding.statement}" cites ${id}, which is not in the answer`).toBe(true);
    }
  }
}

/** No answer may carry a customer's own words. */
function assertNoCustomerText(answer: OperatorAnswer): void {
  const serialized = JSON.stringify(answer);
  for (const utterance of ["붙였는데", "떨어졌어요", "환불해주세요", "언제 오나요", "너무 늦게"]) {
    expect(serialized, `a customer utterance ("${utterance}") reached the answer`).not.toContain(utterance);
  }
}

describe("investigation divergence — different information needs, different investigations", () => {
  /**
   * The v2 failure condition, stated as a test.
   *
   * If a spec question, a policy question and a "this is different from last time" question run the
   * same tools in the same order, the Operator is an intent router with extra steps — which is exactly
   * what v1 was, and exactly what the InformationNeed contract exists to end.
   */
  async function toolsUsedFor(goal: string): Promise<{ tools: string[]; needs: string[] }> {
    const { operator, runtime } = build();
    const answer = done(await runtime.run(`t-${goal}`, { text: goal }));
    return {
      tools: [...new Set(answer.evidence.map((e) => e.sourceTool))].sort(),
      needs: [...new Set(answer.needs.map((n) => n.question))].sort(),
      // `operator` is intentionally unused here beyond construction; the evidence IS the observation.
      ...(operator ? {} : {}),
    };
  }

  it("a spec question, a policy question and a difference question do not share one tool sequence", async () => {
    const spec = await toolsUsedFor("폭이 몇 mm인가요?");
    const policy = await toolsUsedFor("교환 가능한가요?");
    const difference = await toolsUsedFor("전에 산 것과 색이 달라요");

    expect(spec.tools).not.toEqual(policy.tools);
    expect(spec.tools).not.toEqual(difference.tools);
    expect(policy.tools).not.toEqual(difference.tools);
  });

  it("their information needs differ too, not just their tool order", async () => {
    const spec = await toolsUsedFor("폭이 몇 mm인가요?");
    const policy = await toolsUsedFor("교환 가능한가요?");
    const difference = await toolsUsedFor("전에 산 것과 색이 달라요");

    // Needs are the SEMANTIC difference. Two plans could reach different tools by accident of ordering;
    // different needs means the planner actually understood two different questions.
    expect(spec.needs).not.toEqual(policy.needs);
    expect(policy.needs).not.toEqual(difference.needs);
    expect(difference.needs.length).toBeGreaterThan(spec.needs.length);
  });

  it("a spec question reaches product facts and NOT the inbox", async () => {
    const spec = await toolsUsedFor("폭이 몇 mm인가요?");
    expect(spec.tools).toContain("search_product_facts");
    expect(spec.tools).not.toContain("get_today_inbox");
  });
});

describe("paraphrase — the same goal in different words reaches the same needs", () => {
  const PAIRS: Array<[string, string]> = [
    ["폭이 몇 mm인가요?", "전선몰딩 폭이 몇 mm예요?"],
    ["교환 가능한가요?", "이거 교환돼요?"],
    ["전에 산 것과 색이 달라요", "지난번에 산 거랑 색깔이 다른데요"],
    ["오늘 뭐부터 봐야 해?", "지금 제일 급한 게 뭐야?"],
  ];

  it.each(PAIRS)("«%s» and «%s» produce the same information needs", async (a, b) => {
    const { runtime } = build();
    const first = done(await runtime.run("t-a", { text: a }));
    const second = done(await runtime.run("t-b", { text: b }));
    expect(first.needs.map((n) => n.question)).toEqual(second.needs.map((n) => n.question));
  });

  it("what this can and cannot prove is stated, not implied", () => {
    // A replayed plan proves the CONTRACT holds for a paraphrase the recording covers. It cannot prove
    // the model generalizes to a sentence nobody recorded — that is a live-model property and it is
    // measured in docs/sellerops_operator_graph_v2.md §18.3, not here.
    expect(RECORDED_PLANS["폭이 몇 mm인가요?"]!.providerVersion).toBeTruthy();
  });
});

describe("product knowledge as evidence", () => {
  it("a stated fact is cited with its source and its observation date", async () => {
    const { runtime } = build();
    const answer = done(await runtime.run("t-spec", { text: "폭이 몇 mm인가요?" }));

    assertTraceable(answer);
    const factEvidence = answer.evidence.filter((e) => e.kind === "PRODUCT_FACT");
    expect(factEvidence.length).toBeGreaterThan(0);
    for (const ref of factEvidence) {
      expect(ref.locator.factKey, "a product fact must name which key it is").toBeTruthy();
      expect(ref.locator.factSource, "a product fact must name who stated it").toBeTruthy();
      expect(ref.asOf, "a product fact must carry when it was observed").toBeTruthy();
    }
  });

  it("a product we know nothing about says so, and never says the product lacks the property", async () => {
    const { runtime } = build();
    const answer = done(await runtime.run("t-unknown", { text: "폭이 몇 mm인가요?" }));
    // Seeded so the resolver lands on the KNOWN product; re-run against the unknown one by mention.
    const unknown = done(await runtime.run("t-unknown-2", { text: "케이블타이 폭이 몇 mm인가요?" }));

    const gapFindings = unknown.findings.filter((f) => f.claimsCoverageLimit);
    expect(gapFindings.length, "an unknown product must produce a coverage-limit finding").toBeGreaterThan(0);

    // TWO different limits, said in two different sentences — and keeping them apart is the point.
    // Availability: we never held this fact. Attribution: we hold rows we cannot tie to this product.
    // A single merged sentence would leave a seller unable to tell "connect the channel" from
    // "run the product read".
    const availability = gapFindings.filter((f) => f.statement.includes("갖고 있지 않습니다"));
    const attribution = gapFindings.filter((f) => f.statement.includes("연결되지 않아 판단할 수 없습니다"));
    expect(availability.length, "the missing-fact limit must be stated").toBeGreaterThan(0);
    expect(attribution.length, "the unattributable-signal limit must be stated").toBeGreaterThan(0);

    // Neither may ever become a claim ABOUT the product.
    for (const finding of gapFindings) {
      expect(finding.statement).not.toMatch(/규격이 없습니다|문제가 없습니다|없는 상품/);
    }
    expect(answer.goalEcho).toBeTruthy();
  });

  it("knowledge coverage is reported beside signal coverage, not merged into it", async () => {
    const { runtime } = build();
    const answer = done(await runtime.run("t-health", { text: "전선몰딩 상품 요즘 문제 있어?" }));
    expect(answer.knowledgeCoverage.length).toBeGreaterThan(0);
    // Two axes, two vocabularies. A merged field would have to answer both with one word.
    const facets = answer.knowledgeCoverage.map((c) => c.facet);
    expect(facets).toContain("IDENTITY");
    for (const row of answer.coverage) {
      expect(["COVERED", "UNCERTAIN_MULTI_ACCOUNT", "UNCERTAIN_UNSUPPORTED_CHANNEL",
        "UNCERTAIN_PRODUCT_UNLINKED"]).toContain(row.coverage);
    }
  });
});

describe("the run says what it did not find out", () => {
  it("a policy need is declared, reported unsatisfiable, and never answered from anecdote", async () => {
    const { runtime } = build();
    const answer = done(await runtime.run("t-policy", { text: "교환 가능한가요?" }));

    const policyNeed = answer.needs.find((n) => n.question.includes("교환 정책"));
    expect(policyNeed, "the plan declared a policy need").toBeTruthy();
    expect(policyNeed!.status).toBe("UNSATISFIABLE");
    // The one sentence that must never appear: a policy asserted without a policy source.
    expect(answer.findings.some((f) => /교환이 가능합니다|교환됩니다/.test(f.statement))).toBe(false);
    expect(answer.findings.some((f) => f.statement.includes("보관하고 있지 않아"))).toBe(true);
  });
});

describe("clarification and refusal are answers", () => {
  it("an ambiguous goal asks back instead of guessing", async () => {
    const { runtime } = build();
    const answer = done(await runtime.run("t-clarify", { text: "상품에 문제 있어?" }));
    expect(answer.clarification).toBe("어떤 상품을 말씀하시는지 알려주세요.");
    expect(answer.findings).toEqual([]);
    expect(answer.budget.stopReason).toBe("CLARIFICATION_NEEDED");
  });

  it("a goal the model refused is reported as unsupported, with the model's own reason", async () => {
    const { runtime } = build();
    const answer = done(await runtime.run("t-refuse", { text: "오늘 날씨 어때?" }));
    expect(answer.budget.stopReason).toBe("NO_PLAN");
    expect(answer.findings).toEqual([]);
    expect(answer.note).toContain("판매 운영과 관련이 없는");
  });
});

describe("REPORT_OPS composes and never sources", () => {
  it("a report cites only evidence other specialists registered", async () => {
    const { runtime } = build();
    const answer = done(await runtime.run("t-report", { text: "이번 주 대표에게 보고할 내용 정리해줘" }));

    assertTraceable(answer);
    const reportFindings = answer.findings.filter((f) => f.specialist === "REPORT_OPS");
    expect(reportFindings.length).toBeGreaterThan(0);
    // The structural claim: no EvidenceRef in the whole answer was minted by a report tool, because
    // ReportOps has no tools. v1's version called three of its own and double-counted a real number.
    const reportSourced = answer.evidence.filter((e) => e.sourceTool.startsWith("report"));
    expect(reportSourced).toEqual([]);
  });
});

describe("standing guarantees, unchanged from v1", () => {
  it("every next action is READ", async () => {
    const { runtime } = build();
    const answer = done(await runtime.run("t-today", { text: "오늘 뭐부터 봐야 해?" }));
    for (const action of answer.nextActions) {
      expect(action.actionClass).toBe("READ");
    }
  });

  it("no customer utterance reaches an answer", async () => {
    const { runtime } = build();
    for (const goal of ["오늘 뭐부터 봐야 해?", "전에 산 것과 색이 달라요", "폭이 몇 mm인가요?"]) {
      assertNoCustomerText(done(await runtime.run(`t-${goal}`, { text: goal })));
    }
  });

  it("the same goal over the same backend state gives the same answer", async () => {
    const first = done(await build().runtime.run("t-1", { text: "오늘 뭐부터 봐야 해?" }));
    const second = done(await build().runtime.run("t-2", { text: "오늘 뭐부터 봐야 해?" }));
    expect(first.findings.map((f) => f.statement)).toEqual(second.findings.map((f) => f.statement));
  });
});

/**
 * Two defects the live run found, pinned so they cannot come back.
 *
 * Both are about a SECOND pass: it may add, and it may not un-say. A loop that re-reads the same source
 * produces the same sentence, and a loop that runs out of budget must not overwrite what an earlier pass
 * already determined — either failure makes a run report less than it actually knew.
 */
describe("a second pass may add, but never un-say", () => {
  it("the same statement is printed once, not once per pass", async () => {
    const { runtime } = build();
    const answer = done(await runtime.run("t-dup", { text: "이번 주 대표에게 보고할 내용 정리해줘" }));

    const statements = answer.findings.map((f) => `${f.specialist}::${f.statement}`);
    // Measured twice on real data: v1 printed 3,208 unanswered inquiries from two specialists, and v2's
    // first live spec answer stated one coverage gap twice. Two copies of one claim read as two facts.
    expect(new Set(statements).size).toBe(statements.length);
  });

  it("a resolved need is never regressed to PENDING by a later, poorer pass", async () => {
    const { runtime } = build();
    // A tight budget forces the second pass to run out mid-way — exactly the shape that overwrote a
    // determined need with PENDING on 2026-08-21.
    const tight = new (Object.getPrototypeOf(runtime).constructor)({
      ...(runtime as unknown as { deps: Record<string, unknown> }).deps,
      limits: { maxIterations: 3, maxToolCalls: 2, maxLlmCalls: 6, deadlineMs: 60_000 },
    });
    const answer = done(await tight.run("t-regress", { text: "오늘 뭐부터 봐야 해?" }));

    // Whatever it managed to answer stays answered. A run that stops early may say less; it may not
    // retract what it already said.
    for (const need of answer.needs) {
      if (need.evidenceIds.length > 0) {
        expect(need.status, `need ${need.id} cited evidence but reports ${need.status}`)
          .not.toBe("PENDING");
      }
    }
  });
});
