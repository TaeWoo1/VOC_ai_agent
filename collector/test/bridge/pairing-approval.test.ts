/**
 * Pure registry-level tests for the out-of-band approval secret: verification, the bounded attempt burn, the
 * presentation-failure rollback seam, and the rule that the secret never escapes through a view.
 *
 * Hermetic: injected clock + injected randomHex, so nothing here reads a wall clock or ambient RNG.
 */
import { describe, it, expect } from "vitest";
import { PairingRegistry } from "../../src/bridge/pairing";
import { fixedClock, mustRequestPairing } from "./helpers";

/**
 * Deterministic hex generator — digits are valid hex, so `Buffer.from(x,"hex")` stays happy.
 *
 * Zero-padded rather than digit-repeated, so values are UNIQUE per call. The repeat form aliased (call 11
 * produced the same 16 chars as call 1), which silently handed two requests the same `requestId` — the
 * second overwrote the first in the map and freed a slot it should not have. That let a flood exceed the
 * pending cap in a test that was supposed to prove the opposite. A real `randomHex` does not alias.
 */
function seqHex() {
  let n = 0;
  return (bytes: number) => {
    n += 1;
    return n.toString(16).padStart(bytes * 2, "0").slice(-bytes * 2);
  };
}

function registry() {
  const clock = fixedClock();
  return { clock, reg: new PairingRegistry({ now: clock.now, randomHex: seqHex() }) };
}

describe("pairing approval secret", () => {
  it("mints no approval code unless the caller asks for the gate", () => {
    const { reg } = registry();
    const r = mustRequestPairing(reg, "https://app.example", "w");
    expect(r.approvalCode).toBeUndefined();
    expect(reg.getRequestView(r.requestId)?.approvalRequired).toBe(false);
    // Un-gated request: allow needs no code (the pre-existing dev path).
    expect(reg.confirmPairing(r.requestId, "allow").ok).toBe(true);
  });

  it("mints a human-formatted code and gates allow on it", () => {
    const { reg } = registry();
    const r = mustRequestPairing(reg, "https://app.example", "w", { requireApproval: true });
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
      const r = mustRequestPairing(reg, "https://app.example", "w", { requireApproval: true });
      expect(reg.confirmPairing(r.requestId, "allow", mutate(r.approvalCode!)).ok).toBe(true);
    }
  });

  it("burns the request after five wrong attempts — the correct code then fails too", () => {
    const { reg } = registry();
    const r = mustRequestPairing(reg, "https://app.example", "w", { requireApproval: true });
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
    const r = mustRequestPairing(reg, "https://app.example", "w", { requireApproval: true });
    reg.confirmPairing(r.requestId, "allow", "DEAD-BEEF");
    expect(reg.listPairings()).toEqual([]);
    expect(reg.pollPairing(r.requestId)).toEqual({ status: "pending" });
  });

  it("deny needs no code (denial grants no trust)", () => {
    const { reg } = registry();
    const r = mustRequestPairing(reg, "https://app.example", "w", { requireApproval: true });
    expect(reg.confirmPairing(r.requestId, "deny").ok).toBe(true);
    expect(reg.pollPairing(r.requestId).status).toBe("denied");
  });

  it("getRequestView exposes approvalRequired but never the secret itself", () => {
    const { reg } = registry();
    const r = mustRequestPairing(reg, "https://app.example", "w", { requireApproval: true });
    const view = reg.getRequestView(r.requestId)!;
    // The confirm page is fetchable by anyone holding the public requestId — the code must not be in the view.
    const bare = r.approvalCode!.replace("-", "");
    expect(JSON.stringify(view)).not.toContain(bare);
    expect(Object.keys(view).sort()).toEqual(["approvalRequired", "confirmationCode", "origin", "status", "workspaceLabel"]);
  });

  it("the approval secret is distinct from the (attacker-known) confirmationCode", () => {
    const { reg } = registry();
    const r = mustRequestPairing(reg, "https://app.example", "w", { requireApproval: true });
    // confirmationCode is returned to the requester, so it must never be accepted as the approval code.
    expect(reg.confirmPairing(r.requestId, "allow", r.confirmationCode).ok).toBe(false);
  });

  it("discardRequest rolls a request back so it can never be confirmed", () => {
    const { reg } = registry();
    const r = mustRequestPairing(reg, "https://app.example", "w", { requireApproval: true });
    expect(reg.discardRequest(r.requestId).ok).toBe(true);
    expect(reg.getRequestView(r.requestId)).toBeNull();
    expect(reg.confirmPairing(r.requestId, "allow", r.approvalCode!).ok).toBe(false);
    expect(reg.discardRequest(r.requestId).ok).toBe(false); // idempotent
  });

  it("undoConfirm preserves the code AND the attempt cap across a persist-failure retry", () => {
    const { reg } = registry();
    const r = mustRequestPairing(reg, "https://app.example", "w", { requireApproval: true });
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
    const r = mustRequestPairing(reg, "https://app.example", "w", { requireApproval: true });
    clock.advance(5 * 60 * 1000 + 1);
    expect(reg.confirmPairing(r.requestId, "allow", r.approvalCode!).ok).toBe(false);
  });
});

/**
 * The global pending cap. Each pending request costs a human interruption (the shell presents every one), so
 * an unbounded surface lets a local process — which can spoof `Origin` freely — bury the person in approval
 * prompts until they dismiss one blind.
 *
 * The load-bearing choice is WHO loses when the cap binds: expired capacity is reclaimed first, and once the
 * limit truly binds the NEW request is refused rather than a live one evicted. Eviction would make the flood
 * stronger than doing nothing — it would let an attacker push out the request a human is mid-way through
 * approving. These tests pin that direction, not just the number.
 */
describe("pairing pending-request cap", () => {
  const capped = (max: number) => {
    const clock = fixedClock();
    return { clock, reg: new PairingRegistry({ now: clock.now, randomHex: seqHex(), maxPendingRequests: max }) };
  };

  it("admits requests up to the cap, then refuses with a coarse capacity rejection", () => {
    const { reg } = capped(2);
    expect(reg.requestPairing("https://app.example", "a").ok).toBe(true);
    expect(reg.requestPairing("https://app.example", "b").ok).toBe(true);
    expect(reg.requestPairing("https://app.example", "c")).toMatchObject({
      ok: false,
      reason: "pending_limit",
      pendingCount: 2,
      limit: 2,
    });
  });

  it("REFUSES the newcomer instead of evicting a live request — an in-flight consent survives a flood", () => {
    const { reg } = capped(2);
    // The human is reading THIS request's code off their console right now.
    const live = mustRequestPairing(reg, "https://app.example", "real", { requireApproval: true });
    reg.requestPairing("https://evil.example", "filler");

    for (let i = 0; i < 20; i += 1) expect(reg.requestPairing("https://evil.example", `flood${i}`).ok).toBe(false);

    // The flood evicted nothing: the human's request is still confirmable with the code they are holding.
    expect(reg.getRequestView(live.requestId)).not.toBeNull();
    expect(reg.confirmPairing(live.requestId, "allow", live.approvalCode!).ok).toBe(true);
    expect(reg.hasActivePairing()).toBe(true);
  });

  it("mints NOTHING for a refused request — no id, no code, no entry, no pairing", () => {
    const { reg } = capped(1);
    mustRequestPairing(reg, "https://app.example", "a");
    const rejected = reg.requestPairing("https://evil.example", "b");
    expect(rejected.ok).toBe(false);
    expect(JSON.stringify(rejected)).not.toContain("evil.example"); // the rejection echoes no caller input
    // Still exactly one pending request: the refused one left no state behind to age out or be confirmed.
    expect(reg.requestPairing("https://evil.example", "c")).toMatchObject({ pendingCount: 1 });
  });

  it("sweeps EXPIRED requests first, so dead entries never hold the cap shut", () => {
    const { reg, clock } = capped(2);
    mustRequestPairing(reg, "https://app.example", "a");
    mustRequestPairing(reg, "https://app.example", "b");
    expect(reg.requestPairing("https://app.example", "c").ok).toBe(false); // at capacity

    clock.advance(5 * 60 * 1000 + 1); // both age out
    const admitted = reg.requestPairing("https://app.example", "d");
    expect(admitted.ok).toBe(true);
    // The capacity came back from the sweep, and the sweep is reported so the shell can log it.
    expect(admitted.swept).toEqual({ requestsEvicted: 2, ticketsEvicted: 0 });
  });

  it("a terminal (allowed/denied) request frees its slot — the cap bounds live consent, not history", () => {
    const { reg } = capped(1);
    const a = mustRequestPairing(reg, "https://app.example", "a", { requireApproval: true });
    expect(reg.requestPairing("https://app.example", "b").ok).toBe(false);

    // Counting terminal entries would make the flood EASIER: a caller could park the registry at its cap with
    // requests nobody is waiting on, for a full TTL.
    reg.confirmPairing(a.requestId, "deny");
    expect(reg.requestPairing("https://app.example", "c").ok).toBe(true);
  });

  it("the cap is GLOBAL — one origin cannot be flooded out by another", () => {
    const { reg } = capped(1);
    mustRequestPairing(reg, "https://evil.example", "a");
    // A spoofed Origin buys no extra capacity: the limit is on the human's attention, not on the origin.
    expect(reg.requestPairing("https://app.example", "b").ok).toBe(false);
  });

  it("defaults to a bounded cap when none is injected", () => {
    const clock = fixedClock();
    const reg = new PairingRegistry({ now: clock.now, randomHex: seqHex() });
    let admitted = 0;
    for (let i = 0; i < 50; i += 1) if (reg.requestPairing("https://app.example", `w${i}`).ok) admitted += 1;
    expect(admitted).toBe(8); // an un-configured registry is bounded, not unlimited
  });
});
