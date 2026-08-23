/**
 * Evidence scope integrity — the contract, and the two live failures it exists for.
 *
 * <b>The red test is real.</b> `PRODUCT_COMPLAINT_ORGWIDE_PLAN` is the plan a live model produced on
 * 2026-08-23 for a seller who named one product and asked whether it had complaints. Under that plan
 * the Operator reported three HIGH-severity issues that belonged to other products, with no warning,
 * about a product that had none (`docs/agent_real_validation_v1.md` §3 Q4). The plan is replayed here
 * unchanged: the fix must hold with the planner still making that mistake, because a planner will.
 *
 * <b>What "fixed" means here.</b> Not that the run answers better — it answers LESS, and says so. The
 * failure being closed is a confident wrong answer, and the only correct replacement for one is silence
 * with a reason.
 */
import { describe, expect, it } from "vitest";
import { OperatorAgentRuntime } from "../../src/operator/operatorRuntime";
import type { OperatorRunResult } from "../../src/operator/operatorRuntime";
import { FakeOperatorSpringClient } from "../support/FakeOperatorSpringClient";
import { FakeSpringClient } from "../support/FakeSpringClient";
import { FakeIssueSpringClient } from "../support/FakeIssueSpringClient";
import { twoInquiries } from "../support/fixtures";
import { fourIssues } from "../support/issueFixtures";
import {
  ANALYSES, CABLE, INBOX, KNOWLEDGE, MEMORY, MOLDING, REPEATS, coveredSignals, unlinkedSignals,
} from "../support/operatorFixtures";
import { RECORDED_PLANS, REPAIRED_PLANS } from "../support/recordedPlans";
import type { OperatorAnswer, EvidenceRef } from "../../src/operator/state/OperatorState";
import type { InvestigationPlan, InformationNeed } from "../../src/operator/plan/InvestigationPlan";
import {
  checkEvidence, evidenceScopeOf, granularityOf, needScopeOf, partitionEvidence,
} from "../../src/operator/scope/EvidenceScope";
import type { NeedScope } from "../../src/operator/scope/EvidenceScope";
import { RuleEvidenceJudge } from "../../src/operator/judge/EvidenceJudge";
import { mentionOf } from "../../src/operator/plan/EntityRole";

function build() {
  const operator = new FakeOperatorSpringClient({
    inbox: INBOX,
    products: [MOLDING, CABLE],
    signals: { [MOLDING.id]: coveredSignals(), [CABLE.id]: unlinkedSignals() },
    knowledge: KNOWLEDGE,
    customerMemory: MEMORY,
    repeats: REPEATS,
    itemAnalyses: ANALYSES,
    plansByGoal: RECORDED_PLANS,
  });
  return new OperatorAgentRuntime({
    operator,
    inquiry: new FakeSpringClient(twoInquiries()),
    issue: new FakeIssueSpringClient(fourIssues()),
  });
}

/**
 * The same run, against an org that does NOT hold the product the seller named.
 *
 * <b>Why the red case needs its own org now.</b> `PRODUCT_COMPLAINT_ORGWIDE_PLAN` dispatches no
 * product specialist, and since A8 the validator refuses such a plan outright — so the planner is asked
 * again and returns one that DOES resolve. That is the right outcome, and it means the org-evidence
 * failure can no longer be reached through a missing specialist. It is still reachable the way it will
 * actually happen in production: the specialist runs, the name matches nothing, and the org-wide reads
 * come back anyway. Everything this suite asserts is about what happens NEXT, and none of it moves.
 */
function buildWithoutTheProduct() {
  const operator = new FakeOperatorSpringClient({
    inbox: INBOX,
    products: [CABLE],
    signals: { [CABLE.id]: unlinkedSignals() },
    knowledge: KNOWLEDGE,
    customerMemory: MEMORY,
    repeats: REPEATS,
    itemAnalyses: ANALYSES,
    plansByGoal: RECORDED_PLANS,
    repairedPlansByGoal: REPAIRED_PLANS,
  });
  return new OperatorAgentRuntime({
    operator,
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

const COMPLAINT_GOAL = "전선몰딩 상품의 리뷰와 문의를 같이 보고 불만이 있는지 알려줘";
const LIST_GOAL = "오늘 뭐부터 봐야 해? 목록으로";

// --------------------------------------------------------------------------- the canonical red test

describe("Q4 regression — a product question is never answered with the org's evidence", () => {
  it("says nothing about the named product when nothing resolved it", async () => {
    const answer = done(await buildWithoutTheProduct().run("q4-red", { text: COMPLAINT_GOAL }));

    // Before the contract: four SUPPORTED findings, three of them HIGH-severity issues belonging to
    // other products and one an org-wide inbox count, all presented as this product's.
    expect(answer.findings.filter((f) => !f.claimsCoverageLimit)).toHaveLength(0);
    expect(answer.specialists).toContain("REVIEW_OPS");
  });

  it("leaves both product-scoped needs unsatisfied rather than satisfied by the wrong rows", async () => {
    const answer = done(await buildWithoutTheProduct().run("q4-needs", { text: COMPLAINT_GOAL }));
    for (const need of answer.needs) {
      expect(need.status).not.toBe("SATISFIED");
    }
  });

  it("tells the seller WHY, instead of falling silent", async () => {
    const answer = done(await buildWithoutTheProduct().run("q4-note", { text: COMPLAINT_GOAL }));
    // The seller's own words for the product, and the reason in plain Korean. A run that withheld
    // everything and said nothing would read as "확인했고 문제 없습니다" — the false calm.
    expect(answer.note ?? "").toContain("전선몰딩");
    expect(answer.note ?? "").toMatch(/상품을 찾지 못|전체 집계/);
  });

  it("never presents another product's issue id as this product's next action", async () => {
    const answer = done(await buildWithoutTheProduct().run("q4-actions", { text: COMPLAINT_GOAL }));
    expect(answer.nextActions.filter((a) => a.surfaceLink.startsWith("/memory/"))).toHaveLength(0);
  });

  it("still reads nothing but READ tools and asserts no WRITE", async () => {
    const answer = done(await buildWithoutTheProduct().run("q4-write", { text: COMPLAINT_GOAL }));
    expect(answer.nextActions.every((a) => a.actionClass !== "WRITE")).toBe(true);
  });
});

// --------------------------------------------------------------------------- Q1 granularity

describe("Q1 regression — a count does not answer a need that asked for rows", () => {
  it("answers the list need with rows, and never with the count", async () => {
    const answer = done(await build().run("q1-red", { text: LIST_GOAL }));
    const byId = new Map(answer.needs.map((n) => [n.id, n]));
    const kinds = new Map(answer.evidence.map((e) => [e.evidenceId, e.kind]));
    // n1 asked for a total and a total is what it got.
    expect(byId.get("n1")?.status).toBe("SATISFIED");
    // <b>n2 asked for the first page of rows.</b> Live 2026-08-23 the same 69 was offered to it and
    // marked SATISFIED — a count answering a list question, which the granularity axis then refused
    // (the original red case, still asserted below). Since Grouped Product Answers v1 the queue read
    // exists, so the need is answered — by ROWS. The axis is unchanged; what changed is that there is
    // finally something of the right shape to accept.
    const n2 = byId.get("n2")!;
    expect(n2.evidenceIds.length).toBeGreaterThan(0);
    for (const id of n2.evidenceIds) {
      expect(kinds.get(id), "the list need rests on rows, never on the org count").toBe("INQUIRY");
    }
  });

  it("still refuses the count for the list need when only the count was read", async () => {
    // The red case as a unit, so it survives whatever the queue read can or cannot do: an INBOX_COUNT
    // offered to a need whose plan declared it wants `INQUIRY` rows is a granularity mismatch.
    const listNeed: NeedScope = {
      needId: "n2", entity: "ORG", productIds: [], channelCode: null, temporal: "NONE",
      granularities: ["DETAIL"],
    };
    expect(checkEvidence(listNeed, ref({ kind: "INBOX_COUNT", locator: { count: 69 } })))
      .toBe("GRANULARITY_MISMATCH");
    expect(checkEvidence(listNeed, ref({ kind: "INQUIRY", locator: { workItemId: "w-1" } })))
      .toBeNull();
  });

  it("every surviving finding cites only evidence of an acceptable shape", async () => {
    const answer = done(await build().run("q1-shapes", { text: LIST_GOAL }));
    const refs = new Map(answer.evidence.map((e) => [e.evidenceId, e]));
    for (const finding of answer.findings) {
      if (finding.claimsCoverageLimit) continue;
      for (const id of finding.evidenceIds) {
        const ref = refs.get(id);
        if (ref) expect(granularityOf(ref.kind)).not.toBe("GAP");
      }
    }
  });
});

// --------------------------------------------------------------------------- the axes, one at a time

function ref(overrides: Partial<EvidenceRef> = {}): EvidenceRef {
  return {
    evidenceId: "e1",
    kind: "REVIEW_ISSUE",
    sourceTool: "search_review_issues",
    sourceCall: "abcd1234",
    locator: { issueId: "i-1", count: 15, label: "배송 파손", severity: "HIGH" },
    asOf: "2026-06-16",
    events: { from: "2026-06-01", to: "2026-06-16" },
    coverage: "COVERED",
    provenance: "issue-memory/RULE_BASED",
    ...overrides,
  };
}

function plan(overrides: Partial<InvestigationPlan> = {}): InvestigationPlan {
  return {
    supported: true,
    userGoal: "g",
    entities: { resolved: [], unresolved: [] },
    informationNeeds: [],
    specialistTargets: [],
    candidateTools: [],
    retrievalStrategy: { order: [], parallelizable: [], stopWhen: null },
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

const NEED: InformationNeed = {
  id: "n1", question: "q", kind: "REVIEW_SIGNAL", why: "w", required: true,
};

describe("entity axis", () => {
  it("invariant 1 — a product need with no resolved product cannot be satisfied by anything", () => {
    const scope = needScopeOf(
      plan({ entities: { resolved: [], unresolved: [mentionOf("PRODUCT", "전선몰딩")] } }),
      NEED, [],
    );
    // Even PRODUCT-scoped evidence fails: nothing established which product the seller meant, so
    // nothing can be checked against it. Refusing here is what stops "the only product we read about"
    // from quietly becoming "the product you asked about".
    expect(checkEvidence(scope, ref({ locator: { productId: "p-molding" } })))
      .toBe("NO_RESOLVED_PRODUCT");
  });

  it("invariant 2 — org-wide evidence never narrows to a product by being cited next to one", () => {
    const scope = needScopeOf(
      plan({ entities: { resolved: [], unresolved: [mentionOf("PRODUCT", "전선몰딩")] } }),
      NEED,
      [{ kind: "PRODUCT", mention: "전선몰딩", id: "p-molding", label: "전선몰딩 1호", resolvedBy: "resolve_product" }],
    );
    expect(checkEvidence(scope, ref())).toBe("ORG_EVIDENCE_FOR_PRODUCT_NEED");
  });

  it("invariant 3 — a different product's evidence is named as a different product's", () => {
    const scope = needScopeOf(
      plan({ entities: { resolved: [], unresolved: [mentionOf("PRODUCT", "전선몰딩")] } }),
      NEED,
      [{ kind: "PRODUCT", mention: "전선몰딩", id: "p-molding", label: "전선몰딩 1호", resolvedBy: "resolve_product" }],
    );
    expect(checkEvidence(scope, ref({ locator: { productId: "p-cable" } }))).toBe("PRODUCT_MISMATCH");
    expect(checkEvidence(scope, ref({ locator: { productId: "p-molding" } }))).toBeNull();
  });

  it("an org question is answered by org evidence, unchanged", () => {
    const scope = needScopeOf(plan(), NEED, []);
    expect(checkEvidence(scope, ref())).toBeNull();
  });
});

describe("channel axis", () => {
  const scoped = () => needScopeOf(
    plan({ entities: { resolved: [], unresolved: [mentionOf("CHANNEL", "쿠팡")] } }),
    NEED, [],
  );

  it("evidence from another channel is refused", () => {
    expect(checkEvidence(scoped(), ref({ locator: { channelCode: "NAVER" } })))
      .toBe("CHANNEL_MISMATCH");
  });

  it("evidence that cannot say which channel it came from has not proven this one", () => {
    expect(checkEvidence(scoped(), ref())).toBe("CHANNEL_UNPROVEN");
  });

  it("the named channel passes, written the way a seller writes it", () => {
    expect(checkEvidence(scoped(), ref({ locator: { channelCode: "COUPANG" } }))).toBeNull();
  });
});

describe("temporal axis", () => {
  const dated = () => needScopeOf(
    plan({ entities: { resolved: [], unresolved: [mentionOf("PERIOD", "최근 30일")] } }),
    NEED, [],
  );

  it("a snapshot does not answer a question about events in a period", () => {
    expect(checkEvidence(dated(), ref({
      kind: "INBOX_COUNT", asOf: "2026-08-23", events: null, locator: { count: 69 },
    }))).toBe("TEMPORAL_UNPROVEN");
  });

  it("evidence whose rows carry their own dates passes the axis", () => {
    expect(checkEvidence(dated(), ref({ events: { from: "2026-08-01", to: "2026-08-20" } }))).toBeNull();
  });
});

describe("granularity axis", () => {
  it("invariant 4 — a count does not satisfy a need that declared it wants rows", () => {
    const p = plan({
      informationNeeds: [{ ...NEED, kind: "INQUIRY_VOLUME" }],
      evidenceRequirements: [{ needId: "n1", minEvidence: 1, acceptableKinds: ["INQUIRY"] }],
    });
    const scope = needScopeOf(p, p.informationNeeds[0]!, []);
    expect(checkEvidence(scope, ref({ kind: "INBOX_COUNT", locator: { count: 69 } })))
      .toBe("GRANULARITY_MISMATCH");
    expect(checkEvidence(scope, ref({ kind: "INQUIRY", locator: { inquiryId: "i-1", productId: "p" } })))
      .toBeNull();
  });

  it("a need that declared nothing falls back to its kind's floor rather than to a guess", () => {
    const p = plan({ informationNeeds: [{ ...NEED, kind: "INQUIRY_VOLUME" }] });
    const scope = needScopeOf(p, p.informationNeeds[0]!, []);
    expect(checkEvidence(scope, ref({ kind: "INBOX_COUNT", locator: { count: 69 } }))).toBeNull();
    // …and still refuses a shape the kind cannot use.
    expect(checkEvidence(scope, ref({ kind: "PRODUCT_KNOWLEDGE_GAP", locator: { facet: "SPEC" } })))
      .toBe("GRANULARITY_MISMATCH");
  });

  it("reads granularity off the evidence kind, not off the tool that produced it", () => {
    expect(evidenceScopeOf(ref({ kind: "INBOX_COUNT" })).granularity).toBe("COUNT");
    expect(evidenceScopeOf(ref({ kind: "REPEATED_INQUIRY" })).granularity).toBe("LIST");
    expect(evidenceScopeOf(ref({ kind: "REVIEW_ISSUE" })).granularity).toBe("ISSUE_SIGNAL");
  });
});

// --------------------------------------------------------------------------- invariants 5 and 6

describe("invariant 5 — compatibility is checked before a finding is assembled", () => {
  it("partition keeps the reason, so nothing is dropped without one", () => {
    const scope = needScopeOf(
      plan({ entities: { resolved: [], unresolved: [mentionOf("PRODUCT", "전선몰딩")] } }),
      NEED,
      [{ kind: "PRODUCT", mention: "전선몰딩", id: "p-molding", label: "L", resolvedBy: "resolve_product" }],
    );
    const { accepted, rejected } = partitionEvidence(scope, [
      ref({ evidenceId: "e1" }),
      ref({ evidenceId: "e2", locator: { productId: "p-molding" } }),
    ]);
    expect(accepted.map((e) => e.evidenceId)).toEqual(["e2"]);
    expect(rejected).toEqual([{ evidenceId: "e1", reason: "ORG_EVIDENCE_FOR_PRODUCT_NEED" }]);
  });
});

describe("invariant 6 — the rule judge carries the same floor, independently", () => {
  const judge = new RuleEvidenceJudge();
  const finding = {
    findingId: "f-e1", specialist: "REVIEW_OPS" as const,
    statement: "「배송 파손」에 대한 리뷰 근거가 15건 기록돼 있습니다.",
    evidenceIds: ["e1"], confidence: "SUPPORTED" as const, verdict: null, surfaceLink: null,
    needId: "n1",
  };
  const productScope = () => needScopeOf(
    plan({ entities: { resolved: [], unresolved: [mentionOf("PRODUCT", "전선몰딩")] } }),
    NEED,
    [{ kind: "PRODUCT", mention: "전선몰딩", id: "p-molding", label: "L", resolvedBy: "resolve_product" }],
  );

  it("refuses to find evidence in a citation about the whole org", async () => {
    const verdict = await judge.judge(finding, [ref()], productScope());
    expect(verdict.hasEvidence).toBe(false);
    expect(verdict.supportingEvidenceIds).toEqual([]);
  });

  it("approves the same sentence when the citation is about the resolved product", async () => {
    const verdict = await judge.judge(
      finding, [ref({ locator: { productId: "p-molding", count: 15 } })], productScope(),
    );
    expect(verdict.hasEvidence).toBe(true);
  });

  it("without a scope it behaves exactly as before — the parameter adds, never changes", async () => {
    const verdict = await judge.judge(finding, [ref()]);
    expect(verdict.hasEvidence).toBe(true);
  });

  it("a coverage-limit claim is never withheld by the scope floor", async () => {
    const gapFinding = {
      ...finding,
      statement: "이 상품에 연결된 데이터가 없어 판단할 수 없습니다.",
      claimsCoverageLimit: true,
    };
    const verdict = await judge.judge(gapFinding, [ref({ coverage: "UNCERTAIN_PRODUCT_UNLINKED" })],
      productScope());
    expect(verdict.hasEvidence).toBe(true);
  });
});
