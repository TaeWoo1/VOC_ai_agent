/**
 * Bounded cancel (Chat UI v1). Stop = the client closes the stream = the run's budget is cancelled.
 * The step in flight finishes; no next step is charged; the thread records the stop honestly.
 */
import { describe, expect, it } from "vitest";
import { TOKEN, harness, TODAY } from "./support";
import { CANCELLED_MESSAGE } from "../../src/conversation/ConversationService";
import { OperatorBudget } from "../../src/operator/budget/OperatorBudget";

describe("bounded cancel", () => {
  it("a cancelled budget affords nothing more, and says so", () => {
    const b = new OperatorBudget();
    expect(b.spend("tool")).toBe(true);
    b.cancel();
    expect(b.isCancelled()).toBe(true);
    expect(b.spend("tool")).toBe(false);
    expect(b.spend("llm")).toBe(false);
    expect(b.canIterate()).toBe(false);
  });

  it("aborted before the plan → no tool call, a CANCELLED turn is persisted, nothing is claimed", async () => {
    const h = harness();
    const view = await h.service.create(TOKEN);
    const controller = new AbortController();
    controller.abort();
    const turn = await h.service.turn(TOKEN, view.conversationId, { text: "오늘 새로 달린 리뷰 보여줘", referenceDate: TODAY } as never,
      () => undefined, { signal: controller.signal });
    expect(turn.status).toBe("FAILED");
    expect(turn.failureCode).toBe("CANCELLED");
    expect(turn.message).toBe(CANCELLED_MESSAGE);
    expect(turn.artifacts).toHaveLength(0);
    expect(h.operator.calls.recentReviews).toBe(0);
    const stored = await h.service.get(TOKEN, view.conversationId);
    expect(stored.turns.map((t) => t.role)).toEqual(["USER", "AGENT"]);
    expect(stored.turns[1]!.failureCode).toBe("CANCELLED");
  });

  it("aborted mid-run (after the first stage) → the run stops at its next step; the turn is CANCELLED", async () => {
    const h = harness();
    const view = await h.service.create(TOKEN);
    const controller = new AbortController();
    const turn = await h.service.turn(TOKEN, view.conversationId, { text: "오늘 새로 달린 리뷰 보여줘", referenceDate: TODAY } as never,
      (e) => { if (e.type === "stage") controller.abort(); }, { signal: controller.signal });
    expect(turn.failureCode).toBe("CANCELLED");
    expect(turn.artifacts).toHaveLength(0);
  });

  it("two turns sent to one conversation while the first is still finishing run in order; nothing is dropped", async () => {
    const h = harness();
    const view = await h.service.create(TOKEN);
    const controller = new AbortController();
    const first = h.service.turn(TOKEN, view.conversationId, { text: "오늘 새로 달린 리뷰 보여줘", referenceDate: TODAY } as never,
      (e) => { if (e.type === "stage") controller.abort(); }, { signal: controller.signal });
    const second = h.service.turn(TOKEN, view.conversationId, { text: "오늘 새로 달린 리뷰 보여줘", referenceDate: TODAY } as never, () => undefined);
    const [a, b] = await Promise.all([first, second]);
    expect(a.failureCode).toBe("CANCELLED");
    expect(b.status).toBe("DONE");
    const stored = await h.service.get(TOKEN, view.conversationId);
    expect(stored.turns.map((t) => `${t.role}:${t.failureCode ?? t.status}`)).toEqual(["USER:DONE", "AGENT:CANCELLED", "USER:DONE", "AGENT:DONE"]);
  });
});
