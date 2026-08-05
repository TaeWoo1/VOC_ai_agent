// Local Agent env classifier (pure). The load-bearing guarantee: "agent not running" and "agent hosting a
// different run/session" are DISTINCT codes — never collapsed — so the walkthrough guides each to its own fix.
import { describe, expect, it } from "vitest";
import { AGENT_ENV_COPY, classifyAgentEnv, type AgentEnvCode } from "./agentEnv";

describe("classifyAgentEnv — distinct situations for distinct fixes", () => {
  it("unreachable → NOT_RUNNING (agent process is off)", () => {
    const s = classifyAgentEnv({ bridgePhase: "unreachable" });
    expect(s.code).toBe("NOT_RUNNING");
    expect(s.fault).toBe("agent");
    expect(s.canRetry).toBe(true);
    expect(s.offerTextFallback).toBe(true);
  });

  it("paired + carrier-mismatch → SESSION_MISMATCH (agent on a DIFFERENT run) — NOT the same as NOT_RUNNING", () => {
    const s = classifyAgentEnv({ bridgePhase: "paired", hostRefusal: "carrier-mismatch" });
    expect(s.code).toBe("SESSION_MISMATCH");
    expect(s.fault).toBe("environment");
    expect(s.canRetry).toBe(true);
    // The two are genuinely different codes — this is the whole point.
    expect(s.code).not.toBe("NOT_RUNNING");
  });

  it("NOT_RUNNING and SESSION_MISMATCH have distinct, non-empty copy", () => {
    const a = AGENT_ENV_COPY.NOT_RUNNING!;
    const b = AGENT_ENV_COPY.SESSION_MISMATCH!;
    expect(a.body.length).toBeGreaterThan(0);
    expect(b.body.length).toBeGreaterThan(0);
    expect(a.body).not.toBe(b.body);
    expect(a.title).not.toBe(b.title);
  });

  it("paired with no host refusal → PAIRED (absence is never a fabricated mismatch)", () => {
    expect(classifyAgentEnv({ bridgePhase: "paired" }).code).toBe("PAIRED");
    expect(classifyAgentEnv({ bridgePhase: "paired", hostRefusal: null }).code).toBe("PAIRED");
  });

  it("paired + unreachable host → NOT_RUNNING (agent dropped after pairing)", () => {
    expect(classifyAgentEnv({ bridgePhase: "paired", hostRefusal: "unreachable" }).code).toBe("NOT_RUNNING");
  });

  it("paired + no-announcement/ticket-rejected/version → HOST_UNAVAILABLE (connected but cannot host)", () => {
    for (const r of ["no-announcement", "ticket-rejected", "transport-version-mismatch", "bridge-disabled", "unpaired"] as const) {
      expect(classifyAgentEnv({ bridgePhase: "paired", hostRefusal: r }).code).toBe("HOST_UNAVAILABLE");
    }
  });

  it("transient phases → CONNECTING (no error, retry, no text fallback yet)", () => {
    for (const p of ["connecting", "connecting_ws", "disconnected"] as const) {
      const s = classifyAgentEnv({ bridgePhase: p });
      expect(s.code).toBe("CONNECTING");
      expect(s.offerTextFallback).toBe(false);
    }
  });

  it("unpaired → NOT_PAIRED; pairing_pending → PAIRING_PENDING", () => {
    expect(classifyAgentEnv({ bridgePhase: "unpaired" }).code).toBe("NOT_PAIRED");
    const p = classifyAgentEnv({ bridgePhase: "pairing_pending" });
    expect(p.code).toBe("PAIRING_PENDING");
    expect(p.canRetry).toBe(false);
  });

  it("denied/revoked → PAIRING_BLOCKED with retry; incompatible_version → PAIRING_BLOCKED WITHOUT retry (needs update)", () => {
    expect(classifyAgentEnv({ bridgePhase: "pairing_denied" }).code).toBe("PAIRING_BLOCKED");
    expect(classifyAgentEnv({ bridgePhase: "revoked" }).canRetry).toBe(true);
    const iv = classifyAgentEnv({ bridgePhase: "incompatible_version" });
    expect(iv.code).toBe("PAIRING_BLOCKED");
    expect(iv.canRetry).toBe(false);
    expect(iv.offerTextFallback).toBe(true);
  });

  it("every code has a copy entry (null only for the two healthy/transient states)", () => {
    const codes: AgentEnvCode[] = [
      "PAIRED", "CONNECTING", "NOT_RUNNING", "NOT_PAIRED",
      "PAIRING_PENDING", "PAIRING_BLOCKED", "SESSION_MISMATCH", "HOST_UNAVAILABLE",
    ];
    for (const c of codes) expect(c in AGENT_ENV_COPY).toBe(true);
    expect(AGENT_ENV_COPY.PAIRED).toBeNull();
  });
});
