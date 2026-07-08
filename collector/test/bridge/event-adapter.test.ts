import { describe, it, expect } from "vitest";
import {
  connectionStateFromLocalAgent,
  pendingActionFromConnector,
  refFor,
  eventsFromSettle,
  connectionViewFromSettle,
} from "../../src/bridge/event-adapter";
import type { LocalAgentState } from "../../src/agent/local-agent-state";
import type { ConnectorUserAction } from "../../src/connector/channel-connector";
import type { ConnectorStartupResult } from "../../src/connector/connector-orchestrator";

const ALL_STATES: LocalAgentState[] = [
  "STOPPED", "STARTING", "INSPECTING_SESSION", "READY", "PREPARING_RECONNECT",
  "WAITING_FOR_CREDENTIAL_SELECTION", "VERIFYING_LOGIN", "HUMAN_RECONNECT_REQUIRED",
  "SYNCING", "PAUSED", "DEGRADED",
];

const ALL_ACTIONS: ConnectorUserAction[] = [
  "SELECT_SAVED_CREDENTIAL", "ENTER_MISSING_USERNAME", "COMPLETE_MANUAL_LOGIN",
  "COMPLETE_ADDITIONAL_AUTHENTICATION", "PROVIDE_API_CREDENTIAL", "REAUTHORIZE_API_ACCESS",
];

/** Keys/values that must never appear in any sanitized event payload. */
const FORBIDDEN = ["url", "selector", "coord", "dom", "token", "cookie", "credential", "password", "account", "connectionId"];

describe("event adapter", () => {
  it("maps all 11 LocalAgentState values without throwing", () => {
    for (const s of ALL_STATES) expect(typeof connectionStateFromLocalAgent(s)).toBe("string");
    expect(new Set(ALL_STATES.map(connectionStateFromLocalAgent)).size).toBe(11);
  });

  it("maps all 6 ConnectorUserAction values 1:1", () => {
    for (const a of ALL_ACTIONS) expect(typeof pendingActionFromConnector(a)).toBe("string");
    expect(new Set(ALL_ACTIONS.map(pendingActionFromConnector)).size).toBe(6);
  });

  it("refFor is a stable 16-hex opaque id that is NOT the raw connectionId", () => {
    const ref = refFor("conn-secret-store-123", "salt");
    expect(ref).toMatch(/^[0-9a-f]{16}$/);
    expect(ref).not.toContain("conn-secret-store-123");
    expect(refFor("conn-secret-store-123", "salt")).toBe(ref); // stable
    expect(refFor("conn-secret-store-123", "other-salt")).not.toBe(ref); // salted
  });

  it("projects a settle result into a sanitized view + events with only safe fields", () => {
    const result: ConnectorStartupResult = {
      connectionId: "raw-store-account-9",
      channel: "NAVER",
      strategy: "BROWSER",
      implementationStatus: "AVAILABLE",
      outcome: "NEEDS_USER_ACTION",
      authStatus: "RECONNECT_REQUIRED",
      capabilityStatus: "CONFIRMED",
      reconnectPath: "MANUAL_LOGIN",
      pendingUserAction: "COMPLETE_MANUAL_LOGIN",
      syncIntent: null,
    };
    const view = connectionViewFromSettle(result, "salt");
    expect(view.ref).toMatch(/^[0-9a-f]{16}$/);
    expect(view.state).toBe("waiting_for_user");
    expect(view.pendingUserAction).toBe("complete_manual_login");

    const events = eventsFromSettle(result, "salt");
    const serialized = JSON.stringify(events).toLowerCase();
    expect(serialized).not.toContain("raw-store-account-9");
    for (const bad of FORBIDDEN) expect(serialized).not.toContain(bad.toLowerCase());
    // Categories present: connection_lifecycle + pending_user_action
    expect(events.map((e) => e.category)).toContain("connection_lifecycle");
    expect(events.map((e) => e.category)).toContain("pending_user_action");
  });

  it("emits a recoverable_failure event on a FAILED settle", () => {
    const result: ConnectorStartupResult = {
      connectionId: "c1", channel: "NAVER", strategy: "BROWSER", implementationStatus: "AVAILABLE",
      outcome: "FAILED", authStatus: "AUTH_CHALLENGE", capabilityStatus: "CONFIRMED",
      reconnectPath: null, pendingUserAction: null, syncIntent: null,
    };
    expect(eventsFromSettle(result, "s").map((e) => e.category)).toContain("recoverable_failure");
  });
});
