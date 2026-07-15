/**
 * Pure registry-level tests for the out-of-band approval secret: verification, the bounded attempt burn, the
 * presentation-failure rollback seam, and the rule that the secret never escapes through a view.
 *
 * Hermetic: injected clock + injected randomHex, so nothing here reads a wall clock or ambient RNG.
 */
import { describe, it, expect } from "vitest";
import { PairingRegistry } from "../../src/bridge/pairing";
import { fixedClock } from "./helpers";

/** Deterministic hex generator — digits are valid hex, so `Buffer.from(x,"hex")` stays happy. */
function seqHex() {
  let n = 0;
  return (bytes: number) => {
    n += 1;
    return String(n).repeat(bytes * 2).slice(0, bytes * 2);
  };
}

function registry() {
  const clock = fixedClock();
  return { clock, reg: new PairingRegistry({ now: clock.now, randomHex: seqHex() }) };
}

describe("pairing approval secret", () => {
  it("mints no approval code unless the caller asks for the gate", () => {
    const { reg } = registry();
    const r = reg.requestPairing("https://app.example", "w");
    expect(r.approvalCode).toBeUndefined();
    expect(reg.getRequestView(r.requestId)?.approvalRequired).toBe(false);
    // Un-gated request: allow needs no code (the pre-existing dev path).
    expect(reg.confirmPairing(r.requestId, "allow").ok).toBe(true);
  });

  it("mints a human-formatted code and gates allow on it", () => {
    const { reg } = registry();
    const r = reg.requestPairing("https://app.example", "w", { requireApproval: true });
    expect(r.approvalCode).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
    expect(reg.getRequestView(r.requestId)?.approvalRequired).toBe(true);
    // No code → refused. This is the forgery the whole slice exists to stop.
    expect(reg.confirmPairing(r.requestId, "allow").ok).toBe(false);
    expect(reg.confirmPairing(r.requestId, "allow", r.approvalCode!).ok).toBe(true);
  });

  it("accepts the code as a human would retype it (separator/case insensitive)", () => {
    for (const mutate of [
      (c: string) => c.replace("-", ""),
      (c: string) => c.toLowerCase(),
      (c: string) => ` ${c} `,
    ]) {
      const { reg } = registry();
      const r = reg.requestPairing("https://app.example", "w", { requireApproval: true });
      expect(reg.confirmPairing(r.requestId, "allow", mutate(r.approvalCode!)).ok).toBe(true);
    }
  });

  it("burns the request after five wrong attempts — the correct code then fails too", () => {
    const { reg } = registry();
    const r = reg.requestPairing("https://app.example", "w", { requireApproval: true });
    for (let i = 0; i < 5; i += 1) {
      expect(reg.confirmPairing(r.requestId, "allow", "DEAD-BEEF").ok).toBe(false);
    }
    // Burned: brute-forcing the short code within the request TTL is now impossible.
    expect(reg.confirmPairing(r.requestId, "allow", r.approvalCode!).ok).toBe(false);
    expect(reg.pollPairing(r.requestId).status).toBe("denied");
    expect(reg.hasActivePairing()).toBe(false);
  });

  it("a wrong attempt mints no pairing and leaks no token", () => {
    const { reg } = registry();
    const r = reg.requestPairing("https://app.example", "w", { requireApproval: true });
    reg.confirmPairing(r.requestId, "allow", "DEAD-BEEF");
    expect(reg.listPairings()).toEqual([]);
    expect(reg.pollPairing(r.requestId)).toEqual({ status: "pending" });
  });

  it("deny needs no code (denial grants no trust)", () => {
    const { reg } = registry();
    const r = reg.requestPairing("https://app.example", "w", { requireApproval: true });
    expect(reg.confirmPairing(r.requestId, "deny").ok).toBe(true);
    expect(reg.pollPairing(r.requestId).status).toBe("denied");
  });

  it("getRequestView exposes approvalRequired but never the secret itself", () => {
    const { reg } = registry();
    const r = reg.requestPairing("https://app.example", "w", { requireApproval: true });
    const view = reg.getRequestView(r.requestId)!;
    // The confirm page is fetchable by anyone holding the public requestId — the code must not be in the view.
    const bare = r.approvalCode!.replace("-", "");
    expect(JSON.stringify(view)).not.toContain(bare);
    expect(Object.keys(view).sort()).toEqual(["approvalRequired", "confirmationCode", "origin", "status", "workspaceLabel"]);
  });

  it("the approval secret is distinct from the (attacker-known) confirmationCode", () => {
    const { reg } = registry();
    const r = reg.requestPairing("https://app.example", "w", { requireApproval: true });
    // confirmationCode is returned to the requester, so it must never be accepted as the approval code.
    expect(reg.confirmPairing(r.requestId, "allow", r.confirmationCode).ok).toBe(false);
  });

  it("discardRequest rolls a request back so it can never be confirmed", () => {
    const { reg } = registry();
    const r = reg.requestPairing("https://app.example", "w", { requireApproval: true });
    expect(reg.discardRequest(r.requestId).ok).toBe(true);
    expect(reg.getRequestView(r.requestId)).toBeNull();
    expect(reg.confirmPairing(r.requestId, "allow", r.approvalCode!).ok).toBe(false);
    expect(reg.discardRequest(r.requestId).ok).toBe(false); // idempotent
  });

  it("undoConfirm preserves the code AND the attempt cap across a persist-failure retry", () => {
    const { reg } = registry();
    const r = reg.requestPairing("https://app.example", "w", { requireApproval: true });
    // Burn three attempts, then succeed, then roll back (as a failed persist does).
    for (let i = 0; i < 3; i += 1) reg.confirmPairing(r.requestId, "allow", "DEAD-BEEF");
    expect(reg.confirmPairing(r.requestId, "allow", r.approvalCode!).ok).toBe(true);
    expect(reg.undoConfirm(r.requestId).ok).toBe(true);
    // Same code still works (the human is still reading it off the console)...
    expect(reg.confirmPairing(r.requestId, "allow", r.approvalCode!).ok).toBe(true);
    reg.undoConfirm(r.requestId);
    // ...and the cap did NOT reset: 2 attempts remain, so the 2nd wrong one burns it.
    expect(reg.confirmPairing(r.requestId, "allow", "DEAD-BEEF").ok).toBe(false);
    expect(reg.confirmPairing(r.requestId, "allow", "DEAD-BEEF").ok).toBe(false);
    expect(reg.confirmPairing(r.requestId, "allow", r.approvalCode!).ok).toBe(false);
  });

  it("an expired request cannot be confirmed even with the correct code", () => {
    const { clock, reg } = registry();
    const r = reg.requestPairing("https://app.example", "w", { requireApproval: true });
    clock.advance(5 * 60 * 1000 + 1);
    expect(reg.confirmPairing(r.requestId, "allow", r.approvalCode!).ok).toBe(false);
  });
});
