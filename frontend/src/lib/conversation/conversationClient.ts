/**
 * Client for the Agent Runtime's CONVERSATION surface (Agentic Operating Workspace v2 §3-A).
 *
 * Same origin rule as `agentClient.ts`: `VITE_AGENT_RUNTIME_URL`, the operator's own JWT, no shared
 * axios instance. One addition — `sendTurn` asks for `text/event-stream` and reports the STAGES the
 * runtime actually reached as they arrive; the final `turn` event resolves the promise. A runtime that
 * answers with plain JSON (no SSE) resolves the same way with no stage events. Nothing here interprets
 * the sentence: it is carried as typed, and the structured hints travel as fields.
 */
import { getToken } from "../apiClient";
import { AGENT_URL, AgentRuntimeError } from "../agentRuntime/agentClient";
import type {
  ConversationSummary,
  ConversationView,
  ProgressEvent,
  StartTurnRequest,
  TurnView,
} from "./types";

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const token = getToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

async function failure(res: Response): Promise<AgentRuntimeError> {
  let code = `HTTP_${res.status}`;
  try {
    const body = (await res.json()) as { error?: { code?: string } };
    if (body?.error?.code) code = body.error.code;
  } catch {
    // no JSON body — keep the coarse code
  }
  return new AgentRuntimeError(res.status, code);
}

async function json<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${AGENT_URL}${path}`, { ...init, headers: headers() });
  if (!res.ok) throw await failure(res);
  return (await res.json()) as T;
}

/** One `event:`/`data:` block of an SSE stream, as the typed event it carries — or null for a comment/heartbeat. */
export function parseSseBlock(block: string): ProgressEvent | null {
  let event = "message";
  const data: string[] = [];
  for (const raw of block.split(/\r?\n/)) {
    if (!raw || raw.startsWith(":")) continue;
    const idx = raw.indexOf(":");
    const field = idx === -1 ? raw : raw.slice(0, idx);
    const value = idx === -1 ? "" : raw.slice(idx + 1).replace(/^ /, "");
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }
  if (data.length === 0) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(data.join("\n"));
  } catch {
    return null;
  }
  // The runtime writes the whole ProgressEvent as `data` ({type, ...}); a bare payload is accepted too.
  const body = payload as Record<string, unknown>;
  if (event === "stage") return { type: "stage", ...(body as Omit<ProgressEvent & { type: "stage" }, "type">) };
  if (event === "turn") return { type: "turn", turn: (body.turn ?? body) as TurnView };
  if (event === "error") return { type: "error", ...(body as { code: string; message: string }) };
  return null;
}

/** Feed SSE text through; returns the leftover partial block. */
function drain(buffer: string, onEvent: (e: ProgressEvent) => void, final = false): string {
  const blocks = buffer.split(/\r?\n\r?\n/);
  const rest = final ? "" : (blocks.pop() ?? "");
  for (const block of blocks) {
    const event = parseSseBlock(block);
    if (event) onEvent(event);
  }
  if (final && rest === "" && blocks.length === 0) return "";
  return rest;
}

async function readStream(res: Response, onEvent: (e: ProgressEvent) => void): Promise<void> {
  const body = res.body;
  if (body && typeof body.getReader === "function") {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = drain(buffer, onEvent);
    }
    buffer += decoder.decode();
    drain(buffer, onEvent, true);
    return;
  }
  // No streaming body on this platform: the whole stream arrived as text.
  drain(await res.text(), onEvent, true);
}

export const conversationClient = {
  createConversation(): Promise<{ conversationId: string; createdAt: string }> {
    return json("/api/conversations", { method: "POST", body: "{}" });
  },
  getConversation(id: string): Promise<ConversationView> {
    return json(`/api/conversations/${encodeURIComponent(id)}`);
  },
  listConversations(limit = 10): Promise<ConversationSummary[]> {
    return json(`/api/conversations?limit=${encodeURIComponent(String(limit))}`);
  },
  /**
   * One turn. `onEvent` receives every stage as the runtime reaches it; the promise resolves with the
   * agent's turn. An `error` event rejects with its code; a transport failure rejects as usual.
   */
  async sendTurn(id: string, request: StartTurnRequest, onEvent: (e: ProgressEvent) => void, signal?: AbortSignal): Promise<TurnView> {
    const res = await fetch(`${AGENT_URL}/api/conversations/${encodeURIComponent(id)}/turns`, {
      method: "POST",
      headers: headers({ Accept: "text/event-stream" }),
      body: JSON.stringify(request),
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) throw await failure(res);
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("text/event-stream")) {
      return (await res.json()) as TurnView;
    }
    let turn: TurnView | null = null;
    let error: { code: string; message: string } | null = null;
    await readStream(res, (event) => {
      if (event.type === "turn") turn = event.turn;
      else if (event.type === "error") error = { code: event.code, message: event.message };
      onEvent(event);
    });
    if (turn) return turn;
    if (error) throw new AgentRuntimeError(res.status, (error as { code: string }).code);
    throw new AgentRuntimeError(res.status, "STREAM_ENDED");
  },
};

export type ConversationClient = typeof conversationClient;
