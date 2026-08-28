/**
 * The backend-owned conversation store over the real {@link HttpAgentRunStateClient} and the fake
 * `/api/agent-run-store`: save → load round-trips through the version-guarded write, updates do not
 * collide, the list index is bounded and newest-first, and a foreign org sees nothing.
 */
import { describe, expect, it } from "vitest";
import { HttpAgentRunStateClient } from "../../src/spring/AgentRunStateClient";
import { SpringConversationStore, MemoryConversationStore } from "../../src/conversation/ConversationStore";
import { boundedTurns, persistableTurn } from "../../src/conversation/contract";
import type { ConversationView, TurnView } from "../../src/conversation/contract";
import { FakeAgentRunStateBackend } from "../support/FakeAgentRunStateBackend";

function view(id: string, updatedAt: string, turns: TurnView[] = []): ConversationView {
  return { conversationId: id, createdAt: "2026-08-27T00:00:00Z", updatedAt, turns, workingSet: null, pendingHumanAction: null, pendingPrepared: null };
}

function userTurn(id: string, text: string): TurnView {
  return { turnId: `t-${id}`, conversationId: id, role: "USER", text, message: text, artifacts: [], suggestedActions: [],
    continuation: { workingSet: null, pendingHumanAction: null, pendingPrepared: null }, status: "DONE", createdAt: "2026-08-27T00:00:00Z" };
}

describe("SpringConversationStore", () => {
  it("round-trips, updates in place, lists newest first, and isolates orgs", async () => {
    const backend = new FakeAgentRunStateBackend({ "tok-a": "org-a", "tok-b": "org-b" });
    const storeA = () => new SpringConversationStore(new HttpAgentRunStateClient({ baseUrl: "http://fake", token: "tok-a", fetchImpl: backend.fetch }));

    await storeA().save(view("c1", "2026-08-27T01:00:00Z", [userTurn("c1", "첫 질문")]));
    await storeA().save(view("c2", "2026-08-27T02:00:00Z"));
    // A second save from a FRESH client (a new request) must be an update, not a colliding insert.
    await storeA().save(view("c1", "2026-08-27T03:00:00Z", [userTurn("c1", "첫 질문"), userTurn("c1", "둘째")]));

    const loaded = await storeA().load("c1");
    expect(loaded?.turns).toHaveLength(2);
    const listed = await storeA().list(10);
    expect(listed.map((r) => r.conversationId)).toEqual(["c1", "c2"]);
    expect(listed[0]).toMatchObject({ turnCount: 2, headline: "첫 질문" });
    expect(backend.peek("org-a", "c1")?.status).toBe("OPEN");

    const storeB = new SpringConversationStore(new HttpAgentRunStateClient({ baseUrl: "http://fake", token: "tok-b", fetchImpl: backend.fetch }));
    expect(await storeB.load("c1")).toBeNull();
    expect(await storeB.list(10)).toEqual([]);
  });

  it("marks a conversation waiting on a human in the row status", async () => {
    const backend = new FakeAgentRunStateBackend({ "tok-a": "org-a" });
    const store = new SpringConversationStore(new HttpAgentRunStateClient({ baseUrl: "http://fake", token: "tok-a", fetchImpl: backend.fetch }));
    await store.save({ ...view("c3", "2026-08-27T01:00:00Z"), pendingHumanAction: {
      turnId: "t", actionType: "REVIEW_IMPORT", path: "MANUAL_SYNC", channelCode: "CAFE24", accountId: "a", dataType: "REVIEW", requestedAt: "2026-08-27T00:00:00Z",
    } });
    expect(backend.peek("org-a", "c3")?.status).toBe("WAITING_HUMAN");
  });
});

describe("persistable form", () => {
  it("bounds turns and strips transient fields without touching ids", () => {
    const turns: TurnView[] = Array.from({ length: 45 }, (_, i) => userTurn("c", `q${i}`));
    expect(boundedTurns(turns)).toHaveLength(40);
    const withArtifacts: TurnView = {
      ...userTurn("c", "x"), role: "AGENT",
      artifacts: [{ artifactId: "a", type: "REVIEW_LIST", title: "t", scope: { channelCode: null, period: null, rating: "ALL" }, totalCount: 1,
        items: [{ reviewId: "r", accountId: "a", channelCode: "CAFE24", channelNameKo: null, writtenOn: null, rating: 1, negative: true,
          preview: "본문", productId: null, productName: null, to: "/reviews" }], freshness: [] }],
      answer: {} as never,
    };
    const stored = persistableTurn(withArtifacts);
    expect(stored.answer).toBeUndefined();
    expect((stored.artifacts[0] as unknown as { items: { preview?: string; reviewId: string }[] }).items[0]).toEqual(expect.not.objectContaining({ preview: "본문" }));
    expect((stored.artifacts[0] as unknown as { items: { reviewId: string }[] }).items[0]!.reviewId).toBe("r");
  });

  it("the memory store keeps whatever it was handed and lists newest first", async () => {
    const store = new MemoryConversationStore();
    await store.save(view("m1", "2026-08-27T01:00:00Z"));
    await store.save(view("m2", "2026-08-27T02:00:00Z"));
    expect((await store.list(1)).map((r) => r.conversationId)).toEqual(["m2"]);
  });
});
