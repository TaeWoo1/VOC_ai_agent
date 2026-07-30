/**
 * Client for the Agent Runtime HTTP service — a SEPARATE-origin Node service, not the Spring
 * backend. Mirrors the bridge-client precedent (a separate `VITE_…_URL` with a loopback default):
 * it reads `VITE_AGENT_RUNTIME_URL` and attaches the SAME operator JWT the rest of the app uses
 * (via `getToken()`), which the runtime forwards to the backend. We do NOT route this through the
 * shared axios instance — that one is hardwired to the Spring `VITE_API_BASE_URL`.
 *
 * Errors surface as {@link AgentRuntimeError} carrying the HTTP status + a coarse code, never a raw
 * body (the service already suppresses bodies). Fail closed: no token → the request still goes and
 * the runtime/backend returns 401.
 */
import { getToken } from "../apiClient";
import type {
  AgentRunView,
  CapabilitiesView,
  ResumeRunRequest,
  StartRunRequest,
} from "./types";

const AGENT_URL = (import.meta.env.VITE_AGENT_RUNTIME_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");

export class AgentRuntimeError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`agent runtime error ${status} (${code})`);
    this.name = "AgentRuntimeError";
  }
}

async function agentFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${AGENT_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    let code = `HTTP_${res.status}`;
    try {
      const body = (await res.json()) as { error?: { code?: string } };
      if (body?.error?.code) code = body.error.code;
    } catch {
      // no JSON body — keep the coarse code
    }
    throw new AgentRuntimeError(res.status, code);
  }
  return (await res.json()) as T;
}

export const agentRuntime = {
  capabilities(): Promise<CapabilitiesView> {
    return agentFetch<CapabilitiesView>("/capabilities");
  },
  startRun(request: StartRunRequest): Promise<AgentRunView> {
    return agentFetch<AgentRunView>("/api/agent-runs", { method: "POST", body: JSON.stringify(request) });
  },
  resumeRun(threadId: string, decision: ResumeRunRequest): Promise<AgentRunView> {
    return agentFetch<AgentRunView>(`/api/agent-runs/${encodeURIComponent(threadId)}/resume`, {
      method: "POST",
      body: JSON.stringify(decision),
    });
  },
  getRun(threadId: string): Promise<AgentRunView> {
    return agentFetch<AgentRunView>(`/api/agent-runs/${encodeURIComponent(threadId)}`);
  },
};
