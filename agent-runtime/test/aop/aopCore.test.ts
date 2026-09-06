/**
 * <b>The AOP Runtime Core's invariants.</b>
 *
 * LangGraph Orchestration Migration + AOP Runtime Core v1 §4. A definition is data, so the things
 * worth pinning are properties OF that data: that it names only tools the registry actually publishes
 * and every one of them is a READ, that it names only handlers the runtime implements, that the six
 * procedures are still six, and that the compiler turns a definition into a graph whose behaviour is
 * the definition's own order — including the one escape a procedure has.
 */
import { describe, expect, it } from "vitest";
import { MemorySaver } from "@langchain/langgraph";
import { compileProcedure, MissingHandlerError } from "../../src/aop/compile";
import type { ProcedureHandlers } from "../../src/aop/compile";
import { PROCEDURES, PROCEDURES_BY_PRIORITY } from "../../src/aop/procedures";
import { admits, selectProcedure } from "../../src/aop/router";
import type { RoutingContext } from "../../src/aop/router";
import type { HandlerName, ProcedureDefinition } from "../../src/aop/ProcedureDefinition";
import type { ProcedureState } from "../../src/aop/ProcedureState";
import { buildOperatorTools } from "../../src/operator/tools/OperatorTools";
import { OperatorToolRegistry } from "../../src/operator/tools/OperatorToolRegistry";
import { FakeOperatorSpringClient } from "../support/FakeOperatorSpringClient";
import { FakeSpringClient } from "../support/FakeSpringClient";
import { FakeIssueSpringClient } from "../support/FakeIssueSpringClient";

const ALL: readonly ProcedureDefinition[] = Object.values(PROCEDURES);

/** Every handler this repository's runtime is expected to publish, as the definitions name them. */
const HANDLERS_NAMED: HandlerName[] = [...new Set(ALL.flatMap((d) => d.steps.map((s) => s.handler)))];

function table(over: Partial<Record<HandlerName, ProcedureHandlers["handlers"][HandlerName]>> = {}): ProcedureHandlers {
  const handlers: Record<string, unknown> = {};
  for (const name of HANDLERS_NAMED) handlers[name] = () => ({});
  return { handlers: { ...handlers, ...over } as ProcedureHandlers["handlers"] };
}

describe("§A — the definitions describe this product, not a target state", () => {
  it("is exactly the six procedures Agent Procedure Layer v1 named", () => {
    expect(Object.keys(PROCEDURES).sort()).toEqual([
      "ANSWER_INQUIRY", "ANSWER_REVIEW", "CAPTURE_KNOWLEDGE", "DAILY_WORK",
      "IMPROVE_FROM_ISSUES", "ONBOARD_CHANNEL",
    ]);
  });

  it("names only tools the registry publishes, and every one of them is a READ", () => {
    const registry = new OperatorToolRegistry(buildOperatorTools({
      operator: new FakeOperatorSpringClient({}),
      inquiry: new FakeSpringClient([]),
      issue: new FakeIssueSpringClient([]),
    }));
    const published = new Set(registry.names());
    for (const definition of ALL) {
      for (const tool of definition.allowedTools) {
        expect(published, `${definition.id} names ${tool}`).toContain(tool);
        expect(registry.actionClassOf(tool), `${definition.id}.${tool}`).toBe("READ");
      }
    }
  });

  it("gives every procedure a version, and no two share one", () => {
    const versions = ALL.map((d) => d.version);
    expect(new Set(versions).size).toBe(versions.length);
    for (const d of ALL) expect(d.version).toMatch(/^[a-z-]+\/v\d+$/);
  });

  it("declares an interrupt exactly where the product stops for a person", () => {
    // These three, and nothing else, can stop a turn — the approval boundary, a guided marketplace
    // step, and the knowledge question. A procedure that listed a fourth would be claiming a pause
    // this runtime has no way to publish.
    expect(PROCEDURES.ANSWER_INQUIRY.humanInterrupt).toEqual(["SEND_APPROVAL", "KNOWLEDGE_ANSWER"]);
    expect(PROCEDURES.ANSWER_REVIEW.humanInterrupt).toEqual(["SEND_APPROVAL", "HUMAN_ACTION_ON_CHANNEL"]);
    expect(PROCEDURES.CAPTURE_KNOWLEDGE.humanInterrupt).toEqual(["KNOWLEDGE_ANSWER"]);
    expect(PROCEDURES.DAILY_WORK.humanInterrupt).toEqual([]);
    expect(PROCEDURES.ONBOARD_CHANNEL.humanInterrupt).toEqual([]);
    expect(PROCEDURES.IMPROVE_FROM_ISSUES.humanInterrupt).toEqual([]);
  });

  it("puts the approval guardrail on exactly the procedures that can send", () => {
    for (const d of ALL) {
      const canSend = d.humanInterrupt.includes("SEND_APPROVAL");
      expect(d.guardrails.includes("APPROVAL_VALIDATED_SEPARATELY"), d.id).toBe(canSend);
      // Whatever else changes, no procedure is allowed to claim it may write to a marketplace.
      expect(d.guardrails).toContain("NO_MARKETPLACE_WRITE");
      expect(d.guardrails).toContain("READ_ONLY_TOOLS");
    }
  });

  it("keeps only ids and closed tokens in the references it may hold", () => {
    // §5: a checkpoint is an execution cursor. Nothing here may name a draft body, an evidence
    // passage, an approval record or a customer's words.
    const allowed = new Set([
      "WORK_ITEM_ID", "INQUIRY_ID", "REVIEW_ID", "PRODUCT_ID", "ISSUE_ID", "CANDIDATE_ID",
      "CHANNEL_CODE", "DRAFT_VERSION",
    ]);
    for (const d of ALL) for (const ref of d.references) expect(allowed).toContain(ref);
  });
});

describe("§B — routing is a table over closed tokens", () => {
  const base: RoutingContext = {
    readiness: "WORKING", anchor: null, requestedAction: "NONE", needKinds: [], pendingCapture: false,
  };

  it("a shop with no channel gets the onboarding procedure whatever it asked", () => {
    expect(selectProcedure({ ...base, readiness: "NO_CHANNEL" })?.id).toBe("ONBOARD_CHANNEL");
    expect(selectProcedure({ ...base, readiness: "NO_CHANNEL", requestedAction: "LIST_ACTIONS" })?.id)
      .toBe("ONBOARD_CHANNEL");
  });

  it("an open knowledge question outranks everything, because it is what the seller is answering", () => {
    expect(selectProcedure({ ...base, pendingCapture: true, requestedAction: "LIST_ACTIONS" })?.id)
      .toBe("CAPTURE_KNOWLEDGE");
  });

  it("the anchored object decides which answer procedure runs", () => {
    const prepare = { ...base, requestedAction: "PREPARE_INQUIRY_DRAFT" as const };
    expect(selectProcedure({ ...prepare, anchor: "INQUIRY" })?.id).toBe("ANSWER_INQUIRY");
    expect(selectProcedure({ ...prepare, anchor: "REVIEW" })?.id).toBe("ANSWER_REVIEW");
    // …and with nothing anchored, no answer procedure claims the turn.
    expect(selectProcedure(prepare)).toBeNull();
  });

  it("most turns belong to no procedure at all, and that is the honest answer", () => {
    // 「최근 문의 보여줘」 — a question about rows. Naming a procedure for it would invent one.
    expect(selectProcedure(base)).toBeNull();
  });

  it("is a total order, so «first in the file» is nobody's contract", () => {
    const priorities = PROCEDURES_BY_PRIORITY.map((d) => d.entry.priority);
    expect(new Set(priorities).size).toBe(priorities.length);
    expect([...priorities]).toEqual([...priorities].sort((a, b) => a - b));
  });

  it("an unreadable world claims nothing and still routes", () => {
    expect(admits(PROCEDURES.ONBOARD_CHANNEL, { ...base, readiness: "UNKNOWN" })).toBe(false);
    expect(admits(PROCEDURES.DAILY_WORK, { ...base, readiness: "UNKNOWN", requestedAction: "LIST_ACTIONS" }))
      .toBe(true);
  });
});

describe("§C — the compiler turns a definition into that definition's graph", () => {
  it("runs the steps in the definition's own order", async () => {
    const graph = compileProcedure(PROCEDURES.DAILY_WORK, table());
    const out = await graph.invoke({} as never);
    expect(out.stepTrail).toEqual(["world", "gate", "investigate", "settle"]);
  });

  it("a step that ends the run is the last step that runs", async () => {
    const graph = compileProcedure(PROCEDURES.DAILY_WORK, table({
      checkPrecondition: () => ({ terminal: "BLOCKED_BY_PRECONDITION", absence: "NO_DATA_YET" }),
    }));
    const out = await graph.invoke({} as never);
    expect(out.stepTrail).toEqual(["world", "gate"]);
    expect(out.terminal).toBe("BLOCKED_BY_PRECONDITION");
    expect(out.absence).toBe("NO_DATA_YET");
  });

  it("an optional step is skipped when the runtime says it does not apply", async () => {
    const graph = compileProcedure(PROCEDURES.ANSWER_INQUIRY, {
      ...table(),
      // 말투 요청도, 전송 요청도 없는 평범한 초안 준비.
      shouldRun: (stepId) => !["revise", "approval", "execute"].includes(stepId),
    });
    const out = await graph.invoke({} as never);
    expect(out.stepTrail).toEqual(["loadObject", "gate", "prepare", "settle"]);
  });

  it("refuses to compile a step whose handler the runtime does not publish", () => {
    expect(() => compileProcedure(PROCEDURES.ANSWER_REVIEW, { handlers: {} }))
      .toThrow(MissingHandlerError);
  });

  it("keeps the references it was given, and a checkpoint can resume on them", async () => {
    const saver = new MemorySaver();
    const graph = compileProcedure(PROCEDURES.IMPROVE_FROM_ISSUES, table({
      readOpportunities: () => ({ refs: { issueId: "iss-1", productId: "p-1" } }),
    }), saver);
    const config = { configurable: { thread_id: "t-1" } } as never;
    const out = await graph.invoke({} as never, config);
    expect(out.refs).toEqual({ issueId: "iss-1", productId: "p-1" });
    const state = await graph.getState(config);
    expect(state.values.refs).toEqual({ issueId: "iss-1", productId: "p-1" });
    expect(state.values.stepTrail).toEqual(["investigate", "evidence", "settle"]);
  });
});
