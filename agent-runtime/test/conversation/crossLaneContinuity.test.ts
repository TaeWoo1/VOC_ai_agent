/**
 * <b>Cross-Lane Context Continuity — the object survives the change of lane.</b>
 *
 * Grounded Conversation Lane v1 §4/§5/§7. The product this package is aiming at is one conversation
 * that moves freely between asking and doing: open a review, ask why it matters, ask for a draft, ask
 * why it was written that way, ask for a softer one. Every one of those is a different lane, and the
 * thing that must not move between them is WHICH object is on the table.
 *
 * <b>Three properties, and the third is a fence rather than a feature.</b> The anchor is kept; the step
 * in flight is kept; and a conversational turn cannot advance a procedure — an approval waiting for the
 * seller is still waiting after they ask 「이 답변 괜찮아?」.
 */
import { describe, expect, it } from "vitest";
import { TOKEN, harness, say } from "./support";
import { CONVERSATION_PLANS, RECORDED_PLANS, SCENARIO_PLANS, capabilityPlan } from "../support/recordedPlans";
import { selectProcedure } from "../../src/aop/router";
import { PROCEDURES } from "../../src/aop/procedures";
import { MemoryAopCheckpointStore } from "../../src/aop/AopCheckpointStore";
import type { AgentConverseView } from "../../src/spring/types";

const PLANS = { ...RECORDED_PLANS, ...CONVERSATION_PLANS, ...SCENARIO_PLANS };
const ASK = "왜 이런 게 반복되는 거야?";
const answer: AgentConverseView =
  { available: true, answer: "반복되는 문제는 리뷰에서 같은 표현이 여러 번 나올 때 모아 드립니다.", providerVersion: "test" };

function lane() {
  return harness({
    plansByGoal: { ...PLANS, [ASK]: capabilityPlan("반복 문제 설명", "PRODUCT_OVERVIEW", null) },
    converse: answer,
  });
}

describe("the object on the table survives a conversational turn", () => {
  it("a selected review is still the anchor, and the step in flight is still in flight", async () => {
    const h = lane();
    const { conversationId: id } = await h.service.create(TOKEN);
    await say(h, id, "오늘 새로 달린 리뷰 보여줘");
    // A press on a row: the same focus transition as naming it.
    const clicked = await h.service.turn(TOKEN, id, { select: { kind: "REVIEW", reviewId: "r-2" } } as never, () => {});
    expect(clicked.continuation.workingSet?.selectedObject?.id).toBe("r-2");
    expect(clicked.continuation.activeTask).toBe("INSPECT");

    const { turn } = await say(h, id, ASK);

    // <b>The defect this closes.</b> The carry rule tested `selectedInquiry` alone, so a thread standing
    // on a REVIEW lost its task on the first question — and the context bar stopped saying what the
    // conversation was doing with the object it was still showing.
    expect(turn.continuation.workingSet?.selectedObject?.id).toBe("r-2");
    expect(turn.continuation.activeTask).toBe("INSPECT");
  });

  it("the grounded answer is told an object is anchored, and never which one", async () => {
    const h = lane();
    const { conversationId: id } = await h.service.create(TOKEN);
    await say(h, id, "오늘 새로 달린 리뷰 보여줘");
    await h.service.turn(TOKEN, id, { select: { kind: "REVIEW", reviewId: "r-2" } } as never, () => {});

    await say(h, id, ASK);

    const context = h.operator.converseRequests.at(-1)!.context.join("\n");
    expect(context).toContain("focus=REVIEW");
    expect(context).not.toContain("r-2");
  });
});

describe("a conversational turn does not advance a procedure", () => {
  it("no procedure with a draft, approval or execute step claims a question", () => {
    // The router reads closed tokens, never the sentence — so this is a table, and the table is the
    // fence: an ASK arrives as EXPLAIN_CAPABILITY (or NONE), and the procedures that can move a draft
    // toward a channel all require a DO token.
    const doing = new Set(Object.values(PROCEDURES)
      .filter((p) => p.steps.some((s) => s.handler === "prepare" || s.handler === "validateApproval" || s.handler === "execute"))
      .map((p) => p.id));
    expect(doing.size).toBeGreaterThan(0);
    for (const readiness of ["NO_CHANNEL", "NO_DATA", "WORKING", "UNKNOWN"] as const) {
      for (const anchor of [null, "INQUIRY", "REVIEW", "PRODUCT"] as const) {
        for (const requestedAction of ["NONE", "EXPLAIN_CAPABILITY"]) {
          const selected = selectProcedure({ readiness, anchor, requestedAction, needKinds: [], pendingCapture: false });
          expect(selected == null || !doing.has(selected.id),
            `${readiness}/${anchor}/${requestedAction} → ${selected?.id}`).toBe(true);
        }
      }
    }
  });

  it("a procedure stopped for a person is still stopped after a question", async () => {
    const cursors = new MemoryAopCheckpointStore();
    const stopped = {
      threadId: "c-1:ANSWER_REVIEW", conversationId: "c-1", procedureId: "ANSWER_REVIEW" as const,
      procedureVersion: "v1", step: "approval", stepTrail: ["loadObject", "gate", "approval"],
      refs: { reviewId: "r-2" }, draftId: "1", approvalId: "apr-1",
      terminal: "WAITING_HUMAN" as const, absence: null, interrupt: "SEND_APPROVAL" as const,
      updatedAt: "2026-09-07T00:00:00Z",
    };
    const h = harness({
      plansByGoal: { ...PLANS, [ASK]: capabilityPlan("반복 문제 설명", "PRODUCT_OVERVIEW", null) },
      converse: answer,
    });
    const service = new (await import("../../src/conversation/ConversationService")).ConversationService({
      storeProvider: h.stores, clientFactory: h.clientFactory, procedureCheckpoints: cursors,
    });
    const { conversationId: id } = await service.create(TOKEN);
    await cursors.save({ ...stopped, threadId: `${id}:ANSWER_REVIEW`, conversationId: id });

    await service.turn(TOKEN, id, { text: ASK, referenceDate: "2026-08-27" } as never, () => {});

    // An interrupt is a pause, never a permission — and a question is not the confirmation that lifts it.
    const after = await cursors.load(`${id}:ANSWER_REVIEW`);
    expect(after?.approvalId).toBe("apr-1");
    expect(after?.terminal).toBe("WAITING_HUMAN");
  });
});
