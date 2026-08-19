import { describe, expect, it } from "vitest";
import type { BridgePhase } from "./bridgeClient";
import { BRIDGE_TOKEN_KEY } from "./bridgeClient";
import { DOCK_COPY, dockView, hasStoredPairing, initialDockMemory, nextDockMemory, type DockMemory } from "./agentDock";

/** Feed a phase sequence through memory and return the view after each step. */
function run(remembered: boolean, phases: BridgePhase[]) {
  let memory: DockMemory = initialDockMemory(remembered);
  return phases.map((phase) => {
    memory = nextDockMemory(memory, phase);
    return dockView(memory, phase);
  });
}

describe("agent dock — quiet unless the helper is connected or was and broke", () => {
  it("a new seller (no stored pairing) sees nothing: not while searching, not when the helper is off, not when unpaired", () => {
    expect(run(false, ["connecting", "unreachable", "connecting", "unreachable", "unpaired", "connecting"]))
      .toEqual(Array(6).fill({ kind: "hidden" }));
  });

  it("connected → the small chip; a deliberate 연결 해제 (unpaired, token cleared) goes quiet again", () => {
    expect(run(false, ["connecting", "connecting_ws", "paired", "unpaired", "connecting", "unreachable"])).toEqual([
      { kind: "hidden" },
      { kind: "hidden" },
      { kind: "connected" },
      { kind: "hidden" },
      { kind: "hidden" },
      { kind: "hidden" },
    ]);
  });

  it("was connected this page load, then the helper died → reconnect notice that survives the retry cycle", () => {
    expect(run(false, ["paired", "disconnected", "connecting", "unreachable", "connecting", "unreachable", "connecting_ws", "paired"]))
      .toEqual([
        { kind: "connected" },
        { kind: "reconnect", notice: "dropped", retrying: false },
        { kind: "reconnect", notice: "dropped", retrying: true },
        { kind: "reconnect", notice: "agent_off", retrying: false },
        { kind: "reconnect", notice: "agent_off", retrying: true },
        { kind: "reconnect", notice: "agent_off", retrying: false },
        { kind: "reconnect", notice: "agent_off", retrying: true },
        { kind: "connected" },
      ]);
  });

  it("a remembered pairing (stored token) reconnecting normally on load shows nothing until it is connected", () => {
    expect(run(true, ["connecting", "connecting_ws", "paired"])).toEqual([
      { kind: "hidden" },
      { kind: "hidden" },
      { kind: "connected" },
    ]);
  });

  it("a remembered pairing whose helper is now off → the helper-off notice (not an error card for a stranger)", () => {
    expect(run(true, ["connecting", "unreachable", "connecting"])).toEqual([
      { kind: "hidden" },
      { kind: "reconnect", notice: "agent_off", retrying: false },
      { kind: "reconnect", notice: "agent_off", retrying: true },
    ]);
  });

  it("agent-side revocation, a denied re-pair, and a version mismatch each get their own notice; re-pairing shows the code", () => {
    expect(run(true, ["connecting", "connecting_ws", "revoked", "pairing_pending", "pairing_denied", "pairing_pending", "connecting_ws", "paired"]))
      .toEqual([
        { kind: "hidden" },
        { kind: "hidden" },
        { kind: "reconnect", notice: "revoked", retrying: false },
        { kind: "pairing" },
        { kind: "reconnect", notice: "denied", retrying: false },
        { kind: "pairing" },
        { kind: "reconnect", notice: "denied", retrying: true },
        { kind: "connected" },
      ]);
    expect(run(true, ["connecting", "connecting_ws", "incompatible_version"])[2])
      .toEqual({ kind: "reconnect", notice: "incompatible", retrying: false });
    // `revoked` implies a token was held, so it counts as remembered even when the mount did not see one.
    expect(run(false, ["connecting", "connecting_ws", "revoked"])[2]).toEqual({ kind: "reconnect", notice: "revoked", retrying: false });
  });

  it("memory is referentially stable when nothing changes (no render churn)", () => {
    const m = initialDockMemory(false);
    expect(nextDockMemory(m, "connecting")).toBe(m);
    expect(nextDockMemory(m, "unreachable")).toBe(m);
    const paired = nextDockMemory(m, "paired");
    expect(nextDockMemory(paired, "paired")).toBe(paired);
    const broken = nextDockMemory(paired, "unreachable");
    expect(nextDockMemory(broken, "unreachable")).toBe(broken);
    expect(nextDockMemory(broken, "connecting")).toBe(broken);
  });

  it("hasStoredPairing reports presence only and never throws on a broken storage", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null };
    expect(hasStoredPairing(storage)).toBe(false);
    store.set(BRIDGE_TOKEN_KEY, "tok");
    expect(hasStoredPairing(storage)).toBe(true);
    expect(hasStoredPairing({ getItem: () => { throw new Error("blocked"); } })).toBe(false);
    expect(hasStoredPairing(undefined)).toBe(false);
  });

  it("copy says SellerOps 도우미, never 로컬 에이전트", () => {
    expect(JSON.stringify(DOCK_COPY)).not.toMatch(/로컬 에이전트|에이전트/);
    expect(JSON.stringify(DOCK_COPY)).toMatch(/SellerOps 도우미/);
  });
});
