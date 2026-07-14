import { describe, it, expect } from "vitest";
import { PairingRegistry, type PairingRegistryOptions } from "../../src/bridge/pairing";
import { fixedClock } from "./helpers";

/** Deterministic randomness so tokens/ids/tickets are reproducible per test. */
function seededHex(): (bytes: number) => string {
  let counter = 0;
  return (bytes: number) => {
    counter += 1;
    return (counter.toString(16).padStart(2, "0") + "ab".repeat(bytes)).slice(0, bytes * 2);
  };
}

function make(overrides: Partial<PairingRegistryOptions> = {}) {
  const clock = fixedClock();
  const reg = new PairingRegistry({ now: clock.now, randomHex: seededHex(), ticketTtlMs: 10_000, requestTtlMs: 300_000, ...overrides });
  return { reg, clock };
}

describe("pairing registry", () => {
  it("request → confirm(allow) → poll delivers the token exactly once", () => {
    const { reg } = make();
    const { requestId, confirmationCode } = reg.requestPairing("https://app.example", "우리 회사");
    expect(confirmationCode).toMatch(/^[0-9A-F]{3}-[0-9A-F]{3}$/);
    expect(reg.getRequestView(requestId)?.status).toBe("pending");

    expect(reg.confirmPairing(requestId, "allow").ok).toBe(true);
    const first = reg.pollPairing(requestId);
    expect(first.status).toBe("paired");
    expect(typeof first.pairingToken).toBe("string");
    // Second poll reports paired but never re-exposes the secret.
    const second = reg.pollPairing(requestId);
    expect(second.status).toBe("paired");
    expect(second.pairingToken).toBeUndefined();
  });

  it("cannot pair without confirmation (pending → no token)", () => {
    const { reg } = make();
    const { requestId } = reg.requestPairing("https://app.example", "w");
    expect(reg.pollPairing(requestId).status).toBe("pending");
    expect(reg.hasActivePairing()).toBe(false);
  });

  it("deny yields a denied poll and no pairing", () => {
    const { reg } = make();
    const { requestId } = reg.requestPairing("https://app.example", "w");
    expect(reg.confirmPairing(requestId, "deny").ok).toBe(true);
    expect(reg.pollPairing(requestId).status).toBe("denied");
    expect(reg.hasActivePairing()).toBe(false);
  });

  it("authenticates a valid token and rejects a wrong one", () => {
    const { reg } = make();
    const { requestId } = reg.requestPairing("https://app.example", "w");
    reg.confirmPairing(requestId, "allow");
    const token = reg.pollPairing(requestId).pairingToken!;
    expect(reg.authenticate(token)?.origin).toBe("https://app.example");
    expect(reg.authenticate("deadbeef")).toBeNull();
  });

  it("mints a single-use ticket; a replay is rejected", () => {
    const { reg } = make();
    const { requestId } = reg.requestPairing("https://app.example", "w");
    reg.confirmPairing(requestId, "allow");
    const token = reg.pollPairing(requestId).pairingToken!;
    const pairing = reg.authenticate(token)!;
    const { ticket } = reg.mintTicket(pairing.pairingId);
    const first = reg.consumeTicket(ticket);
    expect(first).toEqual({ ok: true, pairingId: pairing.pairingId });
    expect(reg.consumeTicket(ticket)).toEqual({ ok: false, reason: "used" });
  });

  it("rejects an expired ticket", () => {
    const { reg, clock } = make();
    const { requestId } = reg.requestPairing("https://app.example", "w");
    reg.confirmPairing(requestId, "allow");
    const pairing = reg.authenticate(reg.pollPairing(requestId).pairingToken!)!;
    const { ticket } = reg.mintTicket(pairing.pairingId);
    clock.advance(10_001);
    expect(reg.consumeTicket(ticket)).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects an unknown ticket", () => {
    const { reg } = make();
    expect(reg.consumeTicket("nope")).toEqual({ ok: false, reason: "not_found" });
  });

  it("revoke invalidates the pairing, its tokens, and its tickets", () => {
    const { reg } = make();
    const { requestId } = reg.requestPairing("https://app.example", "w");
    reg.confirmPairing(requestId, "allow");
    const token = reg.pollPairing(requestId).pairingToken!;
    const pairing = reg.authenticate(token)!;
    const { ticket } = reg.mintTicket(pairing.pairingId);
    expect(reg.revoke(pairing.pairingId).ok).toBe(true);
    expect(reg.authenticate(token)).toBeNull();
    expect(reg.consumeTicket(ticket).ok).toBe(false);
    expect(reg.hasActivePairing()).toBe(false);
  });

  it("revoke-by-token works for a frontend-initiated revoke", () => {
    const { reg } = make();
    const { requestId } = reg.requestPairing("https://app.example", "w");
    reg.confirmPairing(requestId, "allow");
    const token = reg.pollPairing(requestId).pairingToken!;
    expect(reg.revokeByToken(token).ok).toBe(true);
    expect(reg.revokeByToken(token).ok).toBe(false); // already revoked
  });

  it("expires a stale pairing request before confirmation", () => {
    const { reg, clock } = make();
    const { requestId } = reg.requestPairing("https://app.example", "w");
    clock.advance(300_001);
    expect(reg.getRequestView(requestId)).toBeNull();
    expect(reg.confirmPairing(requestId, "allow").ok).toBe(false);
  });

  it("sweep evicts expired requests and expired tickets, retains the pairing, and is idempotent", () => {
    const { reg, clock } = make();
    const { requestId } = reg.requestPairing("https://app.example", "w");
    reg.confirmPairing(requestId, "allow");
    const pairing = reg.authenticate(reg.pollPairing(requestId).pairingToken!)!;
    const { ticket } = reg.mintTicket(pairing.pairingId);
    clock.advance(300_001); // past the request TTL (and well past the 10s ticket TTL)

    const first = reg.sweep();
    expect(first).toEqual({ requestsEvicted: 1, ticketsEvicted: 1 });
    // The ticket is now GONE from the map (evicted), not merely expired-in-place.
    expect(reg.consumeTicket(ticket)).toEqual({ ok: false, reason: "not_found" });
    // A second sweep finds nothing to do; the pairing itself survives (valid until revoked).
    expect(reg.sweep()).toEqual({ requestsEvicted: 0, ticketsEvicted: 0 });
    expect(reg.hasActivePairing()).toBe(true);
  });

  it("opportunistically evicts stale entries when a new request is created (bounded growth)", () => {
    const { reg, clock } = make();
    reg.requestPairing("https://app.example", "a");
    clock.advance(300_001);
    // Creating a new request runs the opportunistic sweep FIRST, evicting the now-stale one.
    reg.requestPairing("https://app.example", "b");
    // If eviction were not opportunistic, the stale "a" would still be here and this would report 1.
    expect(reg.sweep().requestsEvicted).toBe(0);
  });

  it("keeps a used-but-unexpired ticket so a replay still reports 'used', then evicts it after expiry", () => {
    const { reg, clock } = make();
    const { requestId } = reg.requestPairing("https://app.example", "w");
    reg.confirmPairing(requestId, "allow");
    const pairing = reg.authenticate(reg.pollPairing(requestId).pairingToken!)!;
    const { ticket } = reg.mintTicket(pairing.pairingId);
    expect(reg.consumeTicket(ticket).ok).toBe(true); // used, still within the 10s TTL

    // A sweep while the ticket is unexpired must NOT evict it — a replay still specifically reports "used".
    expect(reg.sweep().ticketsEvicted).toBe(0);
    expect(reg.consumeTicket(ticket)).toEqual({ ok: false, reason: "used" });

    // Once the ticket TTL passes, the sweep reclaims it (a later replay degrades to not_found — still rejected).
    clock.advance(10_001);
    expect(reg.sweep().ticketsEvicted).toBe(1);
    expect(reg.consumeTicket(ticket)).toEqual({ ok: false, reason: "not_found" });
  });

  it("persists only pairing-token hashes, never a plaintext token", () => {
    const { reg } = make();
    const { requestId } = reg.requestPairing("https://app.example", "w");
    reg.confirmPairing(requestId, "allow");
    const token = reg.pollPairing(requestId).pairingToken!;
    const exported = JSON.stringify(reg.exportPairings());
    expect(exported).not.toContain(token);
    expect(reg.exportPairings()[0]!.tokenHash).toHaveLength(64); // sha256 hex
  });
});
