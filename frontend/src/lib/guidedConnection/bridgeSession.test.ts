// Bridge → NAVER session-detection adapter tests (B4). Pure/node-env — no DOM, no live NAVER.
import { describe, it, expect } from "vitest";
import { bridgeSessionDetection } from "./bridgeSession";
import type { BridgeState } from "../bridge/bridgeClient";
import type {
  BridgeConnectionState,
  BridgeConnectionView,
  BridgePendingUserAction,
} from "../bridge/bridgeProtocol";

function conn(state: BridgeConnectionState, pendingUserAction: BridgePendingUserAction | null = null): BridgeConnectionView {
  return { ref: "opaque-ref", state, pendingUserAction, browserOpen: false };
}
function paired(connections: BridgeConnectionView[]): BridgeState {
  return {
    phase: "paired",
    maybeNeedsLocalNetworkAccess: false,
    snapshot: { agentVersion: "x", protocolVersion: 1, capabilities: [], supportedEvents: [], connections },
  };
}

describe("bridgeSessionDetection — sanitized enums in, session signal out", () => {
  it("ready → logged_in", () => {
    expect(bridgeSessionDetection(paired([conn("ready")]))).toBe("logged_in");
  });

  it("human_reconnect_required → reconnect_required", () => {
    expect(bridgeSessionDetection(paired([conn("human_reconnect_required")]))).toBe("reconnect_required");
  });

  it("waiting_for_user + complete_manual_login → logged_out", () => {
    expect(bridgeSessionDetection(paired([conn("waiting_for_user", "complete_manual_login")]))).toBe("logged_out");
  });

  it("waiting_for_user + reauthorize_api_access → reconnect_required", () => {
    expect(bridgeSessionDetection(paired([conn("waiting_for_user", "reauthorize_api_access")]))).toBe("reconnect_required");
  });

  it("transient / paused / other-wait states → null (neutral → attestation fallback)", () => {
    for (const s of ["starting", "inspecting", "reconnecting", "verifying", "syncing", "paused", "degraded", "stopped"] as const) {
      expect(bridgeSessionDetection(paired([conn(s)]))).toBeNull();
    }
    expect(bridgeSessionDetection(paired([conn("waiting_for_user", "enter_missing_username")]))).toBeNull();
    expect(bridgeSessionDetection(paired([conn("waiting_for_user", null)]))).toBeNull();
  });

  it("not paired → null", () => {
    expect(bridgeSessionDetection({ phase: "unpaired", maybeNeedsLocalNetworkAccess: false })).toBeNull();
    expect(bridgeSessionDetection({ phase: "unreachable", maybeNeedsLocalNetworkAccess: false })).toBeNull();
  });

  it("paired but no snapshot → null", () => {
    expect(bridgeSessionDetection({ phase: "paired", maybeNeedsLocalNetworkAccess: false })).toBeNull();
  });

  it("zero or multiple connections → null (opaque ref can't disambiguate NAVER — v1 single-connection)", () => {
    expect(bridgeSessionDetection(paired([]))).toBeNull();
    expect(bridgeSessionDetection(paired([conn("ready"), conn("ready")]))).toBeNull();
  });
});
