/**
 * Specialist failure semantics — one bad read may not delete the good ones.
 *
 * <b>The red test is real.</b> `PRIORITIZE_AND_DRAFT_PLAN` is the plan a live model produced on
 * 2026-08-23 for "답변이 필요한 문의를 우선순위대로 정리하고 답변 초안을 만들어줘". Under it INQUIRY_OPS
 * read the inbox, read the repeats, then called `search_customer_memory` with no anchor; the backend's
 * correct `400` unwound the specialist and took both successful reads with it, and the run reported
 * `DONE` with zero findings (`docs/agent_real_validation_v1.md` §3 Q5).
 *
 * <b>The fake enforces the same precondition the backend does</b> (`FakeOperatorSpringClient`), so this
 * suite would have gone red on the old code for the same reason the live run did — not because a
 * double was told to fail.
 *
 * <b>What is NOT being fixed here.</b> The backend stays strict: an anchorless customer-memory search
 * is still a 400, because without an anchor that read is a whole-org trawl. The caller stops asking.
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
import {
  classifyToolError, failureSentence, skippedTool, terminalOf,
} from "../../src/operator/failure/SpecialistOutcome";
import { SpringApiError } from "../../src/spring/SpringClient";

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

function done(result: OperatorRunResult): OperatorAnswer {
  if (result.status !== "DONE") {
    throw new Error(`expected DONE, got FAILED: ${result.failureCode} — ${result.reason}`);
  }
  return result.answer;
}

const Q5 = "답변이 필요한 문의를 우선순위대로 정리하고 답변 초안을 만들어줘";

// --------------------------------------------------------------------------- the canonical red test

describe("Q5 regression — one anchorless call no longer erases a specialist", () => {
  it("keeps the reads that worked", async () => {
    const answer = done(await build().runtime.run("q5-red", { text: Q5 }));
    // Before: evidence 0, findings 0. The inbox read had already succeeded and was thrown away.
    expect(answer.evidence.length).toBeGreaterThan(0);
    expect(answer.evidence.some((e) => e.sourceTool === "get_today_inbox")).toBe(true);
    expect(answer.findings.length).toBeGreaterThan(0);
  });

  it("never makes the call the backend would refuse", async () => {
    const { operator, runtime } = build();
    await runtime.run("q5-skip", { text: Q5 });
    // Zero, not "one that failed": the precondition is checked before the call, not learned from a 400.
    expect(operator.calls.memory).toBe(0);
  });

  it("records the skip as a structured reason rather than silence", async () => {
    const answer = done(await build().runtime.run("q5-reason", { text: Q5 }));
    const inquiry = answer.specialistOutcomes.find((o) => o.specialist === "INQUIRY_OPS")!;
    expect(inquiry.terminal).toBe("PARTIAL");
    expect(inquiry.failures).toHaveLength(1);
    expect(inquiry.failures[0]).toMatchObject({
      specialist: "INQUIRY_OPS",
      tool: "search_customer_memory",
      category: "ANCHOR_UNAVAILABLE",
      statusCategory: "NONE",
      recoverable: false,
    });
  });

  it("leaves the unservable need UNSATISFIABLE with a reason, not SATISFIED and not silent", async () => {
    const answer = done(await build().runtime.run("q5-need", { text: Q5 }));
    const need = answer.needs.find((n) => n.id === "n3")!;
    expect(need.status).toBe("UNSATISFIABLE");
    expect(need.reason ?? "").toContain("특정");
  });

  it("says in the answer that past cases needed an anchor", async () => {
    const answer = done(await build().runtime.run("q5-note", { text: Q5 }));
    expect(answer.note ?? "").toContain("대상 상품이나 문의를 먼저 특정");
  });

  // Agent Semantic Ownership v1 §5. This used to assert a note the graph manufactured from a word list
  // (초안·써줘·작성해줘) whenever the plan's `requestedAction` was NONE. Two measurements retired it:
  // the real planner answers `PREPARE_INQUIRY_DRAFT` for THIS very sentence (2026-09-06), which means
  // the old guard suppressed the note in production and only this fixture's recorded `NONE` ever let it
  // through; and the list's one distinct output was false — 「제품 설명 문구 써줘」, planned as `NONE`,
  // was told that reply drafts are not written here. The draft request is the planner's token, read by
  // the conversation lane's own draft path; the graph does not read the sentence to guess at it.
  it("does not manufacture a capability notice from the words in the goal", async () => {
    const answer = done(await build().runtime.run("q5-draft", { text: Q5 }));
    expect(answer.note ?? "").not.toContain("답변 초안 작성은 이 대화 창구에서 하지 않습니다");
    // What still protects the seller is the catalogue itself, asserted below and by the registry.
    expect(answer.nextActions.every((a) => a.actionClass === "READ")).toBe(true);
  });

  it("asserts no WRITE and prepares nothing", async () => {
    const answer = done(await build().runtime.run("q5-write", { text: Q5 }));
    expect(answer.nextActions.every((a) => a.actionClass === "READ")).toBe(true);
  });
});

// --------------------------------------------------------------------------- run terminal semantics

describe("run terminal — an empty answer never hides a failed read", () => {
  it("a run whose reads FAILED and produced nothing does not end DONE", async () => {
    // The inbox read fails outright, so INQUIRY_OPS has no successful read to be PARTIAL about.
    const { runtime } = build({ inboxErrorStatus: 503, repeats: [] });
    const result = await runtime.run("q5-failed", { text: Q5 });
    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") throw new Error("unreachable");
    expect(result.failureCode).toBe("EVIDENCE_UNAVAILABLE");
    expect(result.reason).toContain("일시적으로 실패");
  });

  it("a run whose reads WORKED and found nothing still ends DONE", async () => {
    // The difference this whole package is about: a quiet inbox is a true answer, an unread one is not.
    const answer = done(await build({
      inbox: { items: [], total: 0, unansweredInquiries: 0 }, repeats: [],
    }).runtime.run("q5-quiet", { text: Q5 }));
    expect(answer.specialistOutcomes.find((o) => o.specialist === "INQUIRY_OPS")?.terminal)
      .toBe("PARTIAL");
    expect(answer.note ?? "").toContain("답변이 필요한 문의는 없습니다");
  });

  it("every dispatched specialist reports a terminal, so silence is not a state", async () => {
    const answer = done(await build().runtime.run("q5-outcomes", { text: Q5 }));
    expect(answer.specialistOutcomes.length).toBeGreaterThan(0);
    for (const outcome of answer.specialistOutcomes) {
      expect(["OK", "PARTIAL", "FAILED"]).toContain(outcome.terminal);
    }
  });
});

// --------------------------------------------------------------------------- classification

describe("failure classification reads the error's shape and never its message", () => {
  it("maps HTTP status onto a class, not a number in a sentence", () => {
    expect(classifyToolError(new SpringApiError(400, "HTTP_400", "x")))
      .toEqual({ category: "BAD_REQUEST", statusCategory: "CLIENT_4XX", recoverable: false });
    expect(classifyToolError(new SpringApiError(401, "HTTP_401", "x")))
      .toEqual({ category: "UNAUTHORIZED", statusCategory: "AUTH", recoverable: false });
    expect(classifyToolError(new SpringApiError(404, "HTTP_404", "x")))
      .toEqual({ category: "NOT_FOUND", statusCategory: "CLIENT_4XX", recoverable: false });
    expect(classifyToolError(new SpringApiError(429, "HTTP_429", "x")))
      .toEqual({ category: "RATE_LIMITED", statusCategory: "CLIENT_4XX", recoverable: true });
    expect(classifyToolError(new SpringApiError(503, "HTTP_503", "x")))
      .toEqual({ category: "UPSTREAM_ERROR", statusCategory: "SERVER_5XX", recoverable: true });
  });

  it("a thrown thing with no status is transport, and transport is retryable", () => {
    expect(classifyToolError(new Error("socket hang up")))
      .toEqual({ category: "TRANSPORT", statusCategory: "TRANSPORT", recoverable: true });
  });

  it("a refused tool name is not recoverable — retrying asks the same forbidden thing", () => {
    const err = Object.assign(new Error("x"), { name: "ToolNotInPlanError" });
    expect(classifyToolError(err))
      .toEqual({ category: "TOOL_NOT_ALLOWED", statusCategory: "NONE", recoverable: false });
  });

  it("no failure sentence carries an id, a status number or a value", () => {
    const sentences = ([
      "ANCHOR_UNAVAILABLE", "BAD_REQUEST", "NOT_FOUND", "UNAUTHORIZED",
      "RATE_LIMITED", "UPSTREAM_ERROR", "TRANSPORT", "TOOL_NOT_ALLOWED", "BUDGET", "UNKNOWN",
    ] as const).map((category) => failureSentence({
      specialist: "INQUIRY_OPS", tool: "t", category, statusCategory: "NONE", recoverable: false,
    }));
    for (const sentence of sentences) {
      expect(sentence).not.toMatch(/\d{3}/);
      expect(sentence).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
    }
  });
});

describe("terminal derivation", () => {
  const failure = skippedTool({ specialist: "INQUIRY_OPS", tool: "search_customer_memory" });

  it("no failures is OK", () => {
    expect(terminalOf({ succeeded: 2, failures: [] })).toBe("OK");
  });

  it("some succeeded and some failed is PARTIAL", () => {
    expect(terminalOf({ succeeded: 2, failures: [failure] })).toBe("PARTIAL");
  });

  it("nothing succeeded and something failed is FAILED", () => {
    expect(terminalOf({ succeeded: 0, failures: [failure] })).toBe("FAILED");
  });

  it("a read that succeeded and found nothing still counts as succeeded", () => {
    // Otherwise a working system with a quiet inbox reports itself broken.
    expect(terminalOf({ succeeded: 1, failures: [] })).toBe("OK");
  });
});
