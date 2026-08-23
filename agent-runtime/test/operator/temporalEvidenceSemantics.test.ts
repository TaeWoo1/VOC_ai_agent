/**
 * Temporal evidence semantics — when we looked, and when it happened.
 *
 * <b>The red test is real, and it is a DIVERGENCE rather than a crash.</b> On 2026-08-23 the same
 * sentence was run twice against the same data. Once the planner named no entity and the Operator
 * reported the unanswered total; once it named "오늘" as a `PERIOD` and the scope gate withheld the same
 * true number, because the inbox count carried no date of any kind. Same data, same question, two
 * answers — decided by a word the planner picked (`docs/agent_real_validation_v1.md` §10.4).
 *
 * <b>What "fixed" does NOT mean.</b> It does not mean stamping today onto the count. A queue depth read
 * today says nothing about when the things in it arrived, and a date that implied otherwise would trade
 * a false negative for a false claim. So the two facts are carried separately — `asOf` (we looked) and
 * `events` (they happened) — and no path fills the second from the first.
 *
 * The suite holds both directions: the true state fact survives every phrasing, and the intake claim
 * survives none.
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
import {
  PRIORITIZE_AND_DRAFT_PLAN, PRIORITIZE_WITH_PERIOD_PLAN, RECORDED_PLANS, TODAY_PLAN,
} from "../support/recordedPlans";
import type { AgentPlanView } from "../../src/spring/types";
import type { EvidenceRef, Finding, OperatorAnswer } from "../../src/operator/state/OperatorState";
import type { InformationNeed, InvestigationPlan, NeedKind } from "../../src/operator/plan/InvestigationPlan";
import { checkEvidence, needScopeOf } from "../../src/operator/scope/EvidenceScope";
import {
  assertsEventOccurrence, eventOn, eventRange, hasEventTime, temporalDemandOf,
} from "../../src/operator/scope/EvidenceTime";
import { RuleEvidenceJudge } from "../../src/operator/judge/EvidenceJudge";
import { EvidenceBuilder, digestFor } from "../../src/operator/state/evidence";

const Q5 = "답변이 필요한 문의를 우선순위대로 정리하고 답변 초안을 만들어줘";
const Q1 = "오늘 뭐부터 봐야 해?";

function build(plansByGoal: Record<string, AgentPlanView> = RECORDED_PLANS) {
  return new OperatorAgentRuntime({
    operator: new FakeOperatorSpringClient({
      inbox: INBOX,
      products: [MOLDING, CABLE],
      signals: { [MOLDING.id]: coveredSignals(), [CABLE.id]: unlinkedSignals() },
      knowledge: KNOWLEDGE,
      customerMemory: MEMORY,
      repeats: REPEATS,
      itemAnalyses: ANALYSES,
      plansByGoal,
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

// --------------------------------------------------------------------------- the canonical red test

describe("the live divergence — one planner word must not decide whether a true fact is said", () => {
  it("reports the current backlog whether or not the plan names a period", async () => {
    const without = done(await build({ [Q5]: PRIORITIZE_AND_DRAFT_PLAN }).run("t-noperiod", { text: Q5 }));
    const withPeriod = done(await build({ [Q5]: PRIORITIZE_WITH_PERIOD_PLAN }).run("t-period", { text: Q5 }));

    const backlog = (a: OperatorAnswer) => a.findings.filter((f) => f.statement.includes("답변이 필요한 문의"));
    // Before: the second run returned zero findings — the same number, withheld as TEMPORAL_UNPROVEN.
    expect(backlog(without).length).toBeGreaterThan(0);
    expect(backlog(withPeriod).length).toBe(backlog(without).length);
    expect(backlog(withPeriod)[0]!.statement).toBe(backlog(without)[0]!.statement);
  });

  it("the surviving sentence says CURRENT state, because that is what a snapshot proves", async () => {
    const answer = done(await build({ [Q5]: PRIORITIZE_WITH_PERIOD_PLAN }).run("t-says", { text: Q5 }));
    const backlog = answer.findings.find((f) => f.statement.includes("답변이 필요한 문의"))!;
    expect(backlog.statement).toContain("현재");
    expect(backlog.statement).not.toContain("들어온");
  });

  it("Q1 is stable across the same difference", async () => {
    const plain = done(await build({ [Q1]: TODAY_PLAN }).run("t-q1", { text: Q1 }));
    const dated = done(await build({
      [Q1]: { ...TODAY_PLAN, unresolvedEntities: [{ kind: "PERIOD", mention: "오늘" }] },
    }).run("t-q1-period", { text: Q1 }));

    const state = (a: OperatorAnswer) => a.findings.filter((f) => f.statement.includes("답변이 필요한 문의"));
    expect(state(dated).length).toBe(state(plain).length);
  });

  it("the repeat findings — real event claims — survive the period plan too", async () => {
    // The over-blocking check that matters: repeats DO carry event dates, so naming a period must not
    // silence them either. A gate that only ever withholds is not evidence that it withholds correctly.
    const answer = done(await build({
      [Q1]: { ...TODAY_PLAN, unresolvedEntities: [{ kind: "PERIOD", mention: "오늘" }] },
    }).run("t-q1-repeats", { text: Q1 }));
    expect(answer.findings.some((f) => f.statement.includes("반복"))).toBe(true);
  });
});

// --------------------------------------------------------------------------- the modelling itself

describe("get_today_inbox produces a snapshot of the current state, and says so", () => {
  it("carries an observation time and no event range", async () => {
    const answer = done(await build().run("t-model", { text: Q1 }));
    const inbox = answer.evidence.filter((e) => e.sourceTool === "get_today_inbox");
    expect(inbox.length).toBeGreaterThan(0);
    for (const ref of inbox) {
      expect(ref.asOf, "a read always happened at a time").toBeTruthy();
      expect(ref.events, "when the queued inquiries arrived is exactly what this read cannot say")
        .toBeNull();
    }
  });

  it("every piece of evidence a run produces knows when it was read", async () => {
    const answer = done(await build().run("t-asof-all", { text: Q1 }));
    expect(answer.evidence.length).toBeGreaterThan(0);
    for (const ref of answer.evidence) {
      expect(ref.asOf, `${ref.kind} must carry its observation time`).toBeTruthy();
    }
  });

  it("the builder never invents an event range, and never copies asOf into one", () => {
    const built = new EvidenceBuilder("2026-08-23").add({
      kind: "INBOX_COUNT", sourceTool: "get_today_inbox", args: {},
      locator: { count: 69 }, provenance: "inbox/SERVER:unansweredInquiries",
    });
    expect(built.asOf).toBe("2026-08-23");
    expect(built.events).toBeNull();
  });

  it("the two times reach the judge under two names", () => {
    const line = digestFor([ref({ asOf: "2026-08-23", events: { from: "2026-08-01", to: "2026-08-20" } })]);
    expect(line).toContain("asOf=2026-08-23");
    expect(line).toContain("events=2026-08-01..2026-08-20");
    // The old single `observedOn` is what let freshness read as recency. It must not come back.
    expect(line).not.toContain("observedOn");
  });
});

// --------------------------------------------------------------------------- the need-side axis

function ref(overrides: Partial<EvidenceRef> = {}): EvidenceRef {
  return {
    evidenceId: "e1",
    kind: "INBOX_COUNT",
    sourceTool: "get_today_inbox",
    sourceCall: "abcd1234",
    locator: { count: 69, label: "미답변 문의" },
    asOf: "2026-08-23",
    events: null,
    coverage: "COVERED",
    provenance: "inbox/SERVER:unansweredInquiries",
    ...overrides,
  };
}

function plan(): InvestigationPlan {
  return {
    supported: true, userGoal: "g",
    entities: { resolved: [], unresolved: [{ kind: "PERIOD", mention: "오늘" }] },
    informationNeeds: [], specialistTargets: [], candidateTools: [],
    retrievalStrategy: { order: [], parallelizable: [], stopWhen: null },
    evidenceRequirements: [], riskClass: "ROUTINE",
    stoppingCriteria: { maxIterations: 1, maxToolCalls: 4, enough: null },
    clarificationNeeded: false, clarificationReason: null, rationale: null, plannerVersion: "test",
    appliedDefaults: [],
  };
}

const need = (kind: NeedKind): InformationNeed =>
  ({ id: "n1", question: "q", kind, why: "w", required: true });

describe("a need asks for one of the two times, decided by its kind", () => {
  it("with no period named, time is not part of what was asked", () => {
    expect(temporalDemandOf("REPEAT_PATTERN", false)).toBe("NONE");
    expect(temporalDemandOf("INQUIRY_VOLUME", false)).toBe("NONE");
  });

  it("a queue-depth need asks how things STAND", () => {
    expect(temporalDemandOf("INQUIRY_VOLUME", true)).toBe("CURRENT_STATE");
    expect(temporalDemandOf("PRODUCT_FACT", true)).toBe("CURRENT_STATE");
  });

  it("a repeat or a history need asks what HAPPENED", () => {
    expect(temporalDemandOf("REPEAT_PATTERN", true)).toBe("PERIOD_EVENTS");
    expect(temporalDemandOf("CUSTOMER_HISTORY", true)).toBe("PERIOD_EVENTS");
    expect(temporalDemandOf("ORDER_HISTORY", true)).toBe("PERIOD_EVENTS");
    expect(temporalDemandOf("REVIEW_SIGNAL", true)).toBe("PERIOD_EVENTS");
  });

  it("CURRENT_STATE need + a recent observation is compatible", () => {
    const scope = needScopeOf(plan(), need("INQUIRY_VOLUME"), []);
    expect(scope.temporal).toBe("CURRENT_STATE");
    expect(checkEvidence(scope, ref())).toBeNull();
  });

  it("PERIOD_EVENTS need + an observation time only is TEMPORAL_UNPROVEN", () => {
    const scope = needScopeOf(plan(), need("REPEAT_PATTERN"), []);
    expect(scope.temporal).toBe("PERIOD_EVENTS");
    // Fresh, and still no proof that anything happened in the period. Freshness is not recency.
    expect(checkEvidence(scope, ref({ asOf: "2026-08-23" }))).toBe("TEMPORAL_UNPROVEN");
  });

  it("PERIOD_EVENTS need + rows carrying their own dates is compatible", () => {
    const scope = needScopeOf(plan(), need("REPEAT_PATTERN"), []);
    expect(checkEvidence(scope, ref({
      kind: "REPEATED_INQUIRY", events: eventRange("2026-08-01", "2026-08-20"),
    }))).toBeNull();
  });

  it("a half-known range still proves something happened", () => {
    expect(hasEventTime(eventRange(null, "2026-08-20"))).toBe(true);
    expect(hasEventTime(eventRange(null, null))).toBe(false);
    expect(hasEventTime(null)).toBe(false);
    expect(eventOn(null)).toBeNull();
  });

  it("a CURRENT_STATE need still refuses evidence that cannot say when it was read", () => {
    const scope = needScopeOf(plan(), need("INQUIRY_VOLUME"), []);
    expect(checkEvidence(scope, ref({ asOf: null }))).toBe("OBSERVATION_TIME_UNKNOWN");
  });
});

// --------------------------------------------------------------------------- the claim-side floor

function finding(statement: string): Finding {
  return {
    findingId: "f-e1", specialist: "INQUIRY_OPS", statement,
    evidenceIds: ["e1"], confidence: "NEEDS_REVIEW", verdict: null, surfaceLink: null,
  };
}

describe("the rule judge reads the CLAIM, which is what the need-side axis cannot", () => {
  const judge = new RuleEvidenceJudge();
  const snapshot = [ref()];

  it("current backlog 69, observed now, events old — '현재 미답변 69건' is allowed", async () => {
    const verdict = await judge.judge(finding("현재 답변이 필요한 문의가 69건 있습니다."), snapshot);
    expect(verdict.unsafeAssertion).toBe(false);
    expect(verdict.hasEvidence).toBe(true);
  });

  it("…and '오늘 들어온 문의 69건' is refused on the very same evidence", async () => {
    const verdict = await judge.judge(finding("오늘 들어온 문의가 69건입니다."), snapshot);
    expect(verdict.unsafeAssertion).toBe(true);
    expect(verdict.unsafeReason).toContain("발생 기간");
  });

  it("refused even when the need said CURRENT_STATE — the sentence outranks the plan", async () => {
    const scope = needScopeOf(plan(), need("INQUIRY_VOLUME"), []);
    const verdict = await judge.judge(finding("오늘 접수된 문의가 69건입니다."), snapshot, scope);
    expect(verdict.unsafeAssertion).toBe(true);
  });

  it("an intake claim IS allowed once the evidence can date its rows", async () => {
    const verdict = await judge.judge(
      finding("최근 30일 동안 배송 문의가 12건 반복됐습니다."),
      [ref({ kind: "REPEATED_INQUIRY", events: eventRange("2026-07-25", "2026-08-20") })],
    );
    expect(verdict.unsafeReason ?? "").not.toContain("발생 기간");
  });

  it("a period word alone is not an event claim, and an occurrence word alone is not either", () => {
    expect(assertsEventOccurrence("현재 답변이 필요한 문의가 69건 있습니다.")).toBe(false);
    expect(assertsEventOccurrence("오늘 확인할 항목입니다.")).toBe(false);
    expect(assertsEventOccurrence("문의가 접수된 상품입니다.")).toBe(false);
    expect(assertsEventOccurrence("오늘 들어온 문의가 69건입니다.")).toBe(true);
  });
});
