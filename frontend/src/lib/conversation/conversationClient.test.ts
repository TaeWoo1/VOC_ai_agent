import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../apiClient", () => ({ getToken: () => "test-token" }));
import { conversationClient, parseSseBlock } from "./conversationClient";
import type { ProgressEvent } from "./types";

const TURN = { turnId: "t1", conversationId: "c1", role: "AGENT", message: "m", artifacts: [], suggestedActions: [], continuation: { workingSet: null, pendingHumanAction: null, pendingPrepared: null }, status: "DONE", createdAt: "x" };

afterEach(() => vi.unstubAllGlobals());

describe("conversation client — SSE", () => {
  it("parses stage / turn / error blocks and ignores heartbeats", () => {
    expect(parseSseBlock(': keep-alive')).toBeNull();
    expect(parseSseBlock('event: stage\ndata: {"stage":"PLANNED","label":"계획을 세웠습니다","at":"x"}')).toEqual({ type: "stage", stage: "PLANNED", label: "계획을 세웠습니다", at: "x" });
    expect(parseSseBlock(`event: turn\ndata: ${JSON.stringify(TURN)}`)).toEqual({ type: "turn", turn: TURN });
    expect(parseSseBlock('event: error\ndata: {"code":"NO_PLAN","message":"x"}')).toEqual({ type: "error", code: "NO_PLAN", message: "x" });
  });

  it("streams stages in order and resolves with the final turn; the bearer and Accept header are set", async () => {
    const body = [
      'event: stage\ndata: {"stage":"UNDERSTANDING","label":"이해하는 중","at":"1"}',
      ': heartbeat',
      'event: stage\ndata: {"stage":"READING","label":"읽는 중","at":"2"}',
      `event: turn\ndata: ${JSON.stringify(TURN)}`,
    ].join("\n\n") + "\n\n";
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetchMock);
    const seen: ProgressEvent[] = [];
    const turn = await conversationClient.sendTurn("c1", { text: "안녕" }, (e) => seen.push(e));
    expect(turn.turnId).toBe("t1");
    expect(seen.map((e) => (e.type === "stage" ? e.stage : e.type))).toEqual(["UNDERSTANDING", "READING", "turn"]);
    const init = fetchMock.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>).Accept).toBe("text/event-stream");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-token");
  });

  it("accepts a plain JSON turn when the runtime does not stream", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(TURN), { status: 200, headers: { "content-type": "application/json" } })));
    const turn = await conversationClient.sendTurn("c1", { text: "안녕" }, () => undefined);
    expect(turn.turnId).toBe("t1");
  });

  it("rejects with the runtime's error code on a failed request", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "NOT_FOUND" } }), { status: 404, headers: { "content-type": "application/json" } })));
    await expect(conversationClient.getConversation("nope")).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
  });
});
