/**
 * The conversation routes over a real socket: create → turn as SSE (stages in order, then `turn`) →
 * get; JSON when the client does not ask for a stream; bearer required; 503 when the lane is absent.
 */
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHttpServer } from "../../src/http/server";
import { AgentRunService } from "../../src/http/AgentRunService";
import type { SpringClientFactory } from "../../src/http/AgentRunService";
import { RunStoreProvider } from "../../src/http/runStoreProvider";
import { CONFIG, harness, TOKEN } from "./support";

interface SseEvent { readonly event: string; readonly data: any }

function parseSse(text: string): SseEvent[] {
  return text.split("\n\n").filter((block) => block.trim().length > 0 && !block.startsWith(":")).map((block) => {
    const lines = block.split("\n");
    const event = lines.find((l) => l.startsWith("event: "))?.slice(7) ?? "message";
    const data = lines.filter((l) => l.startsWith("data: ")).map((l) => l.slice(6)).join("\n");
    return { event, data: data ? JSON.parse(data) : null };
  });
}

describe("conversation HTTP contract", () => {
  let server: Server;
  let base: string;
  let bare: Server;
  let bareBase: string;
  const h = harness();

  beforeAll(async () => {
    const clientFactory: SpringClientFactory = () => h.service["deps" as never]
      ? (h.service as never as { deps: { clientFactory: SpringClientFactory } }).deps.clientFactory(TOKEN)
      : (() => { throw new Error("no factory"); })();
    const runs = new AgentRunService({ storeProvider: new RunStoreProvider(CONFIG), clientFactory, env: "development" });
    server = createHttpServer(runs, CONFIG, { conversations: h.service });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    bare = createHttpServer(runs, CONFIG);
    await new Promise<void>((resolve) => bare.listen(0, "127.0.0.1", resolve));
    bareBase = `http://127.0.0.1:${(bare.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await new Promise<void>((resolve) => bare.close(() => resolve()));
  });

  const auth = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

  it("requires a bearer on every conversation route", async () => {
    const res = await fetch(`${base}/api/conversations`, { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("answers 503 when the lane is not configured", async () => {
    const res = await fetch(`${bareBase}/api/conversations`, { method: "POST", headers: auth });
    expect(res.status).toBe(503);
    expect(((await res.json()) as any).error.code).toBe("CONVERSATIONS_UNAVAILABLE");
  });

  it("create → SSE turn (stages in order, ends with turn) → get → list", async () => {
    const created = await fetch(`${base}/api/conversations`, { method: "POST", headers: auth });
    expect(created.status).toBe(201);
    const { conversationId } = (await created.json()) as { conversationId: string };

    const res = await fetch(`${base}/api/conversations/${conversationId}/turns`, {
      method: "POST", headers: { ...auth, Accept: "text/event-stream" },
      body: JSON.stringify({ text: "오늘 새로 달린 리뷰 보여줘", referenceDate: "2026-08-27" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const events = parseSse(await res.text());
    const stages = events.filter((e) => e.event === "stage").map((e) => e.data.stage);
    expect(stages.slice(0, 2)).toEqual(["UNDERSTANDING", "PLANNED"]);
    expect(stages).toContain("READING");
    expect(stages).toContain("JUDGING");
    expect(stages[stages.length - 1]).toBe("COMPOSING");
    expect(events[events.length - 1]!.event).toBe("turn");
    const turn = events[events.length - 1]!.data.turn;
    expect(turn.status).toBe("DONE");
    expect(turn.artifacts.some((a: { type: string }) => a.type === "REVIEW_LIST")).toBe(true);

    const got = await fetch(`${base}/api/conversations/${conversationId}`, { headers: auth });
    expect(got.status).toBe(200);
    expect(((await got.json()) as any).turns).toHaveLength(2);

    const listed = await fetch(`${base}/api/conversations?limit=5`, { headers: auth });
    expect(((await listed.json()) as any[])[0].conversationId).toBe(conversationId);
  });

  it("a plain JSON client gets the TurnView directly", async () => {
    const created = await fetch(`${base}/api/conversations`, { method: "POST", headers: auth });
    const { conversationId } = (await created.json()) as { conversationId: string };
    const res = await fetch(`${base}/api/conversations/${conversationId}/turns`, {
      method: "POST", headers: auth, body: JSON.stringify({ text: "점심 메뉴 추천해줘" }),
    });
    expect(res.status).toBe(200);
    const turn = (await res.json()) as any;
    expect(turn.role).toBe("AGENT");
    expect(turn.status).toBe("FAILED");
  });

  it("rejects a malformed id and an empty turn", async () => {
    const bad = await fetch(`${base}/api/conversations/not%20ok/turns`, { method: "POST", headers: auth, body: JSON.stringify({ text: "x" }) });
    expect(bad.status).toBe(400);
    const created = await fetch(`${base}/api/conversations`, { method: "POST", headers: auth });
    const { conversationId } = (await created.json()) as { conversationId: string };
    const empty = await fetch(`${base}/api/conversations/${conversationId}/turns`, { method: "POST", headers: auth, body: JSON.stringify({}) });
    expect(empty.status).toBe(400);
  });
});
