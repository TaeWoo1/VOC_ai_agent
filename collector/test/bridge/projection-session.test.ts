import { describe, it, expect } from "vitest";
import { ProjectionRegistry } from "../../src/bridge/projection-session";
import { fixedClock } from "./helpers";

function make(opts: { leaseIdleMs?: number; ticketTtlMs?: number } = {}) {
  const clock = fixedClock();
  let n = 0;
  const reg = new ProjectionRegistry({
    now: clock.now,
    randomHex: (bytes) => `r${(n++).toString(16).padStart(bytes * 2 - 1, "0")}`,
    ticketTtlMs: opts.ticketTtlMs ?? 10_000,
    leaseIdleMs: opts.leaseIdleMs ?? 120_000,
  });
  return { reg, clock };
}

describe("projection ticket lifecycle", () => {
  it("mints a single-use ticket bound to a pairing and consumes it once", () => {
    const { reg } = make();
    const { ticket } = reg.mintTicket("pairA");
    const first = reg.consumeTicket(ticket);
    expect(first).toEqual({ ok: true, pairingId: "pairA" });
    expect(reg.consumeTicket(ticket)).toEqual({ ok: false, reason: "used" });
  });

  it("rejects an unknown ticket", () => {
    const { reg } = make();
    expect(reg.consumeTicket("nope")).toEqual({ ok: false, reason: "not_found" });
  });

  it("expires a ticket after its TTL", () => {
    const { reg, clock } = make({ ticketTtlMs: 5_000 });
    const { ticket } = reg.mintTicket("pairA");
    clock.advance(5_001);
    expect(reg.consumeTicket(ticket)).toEqual({ ok: false, reason: "expired" });
  });

  it("invalidates a pairing's outstanding tickets on revoke", () => {
    const { reg } = make();
    const { ticket } = reg.mintTicket("pairA");
    reg.revokeForPairing("pairA");
    expect(reg.consumeTicket(ticket)).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("projection control lease", () => {
  it("grants control to the first requester and refuses a foreign takeover", () => {
    const { reg } = make();
    expect(reg.requestControl("tabA", "pairA")).toEqual({ ok: true, expiresInMs: 120_000 });
    expect(reg.hasControl("tabA")).toBe(true);
    // Another tab cannot force takeover while the lease is live (slice §0.2).
    expect(reg.requestControl("tabB", "pairA")).toEqual({ ok: false, reason: "held" });
    expect(reg.hasControl("tabB")).toBe(false);
  });

  it("renews on accepted input and expires after 2 minutes of inactivity", () => {
    const { reg, clock } = make({ leaseIdleMs: 120_000 });
    reg.requestControl("tabA", "pairA");
    clock.advance(119_000);
    expect(reg.renewControl("tabA")).toBe(true); // accepted input renews
    clock.advance(119_000);
    expect(reg.hasControl("tabA")).toBe(true); // still within the renewed window
    clock.advance(2_000);
    expect(reg.controlOwner()).toBeNull(); // idle-expired
  });

  it("lets another tab take control only after release", () => {
    const { reg } = make();
    reg.requestControl("tabA", "pairA");
    expect(reg.requestControl("tabB", "pairA").ok).toBe(false);
    reg.releaseControl("tabA");
    expect(reg.requestControl("tabB", "pairA").ok).toBe(true);
    expect(reg.hasControl("tabB")).toBe(true);
  });

  it("drops the lease when the owning connection closes", () => {
    const { reg } = make();
    reg.requestControl("tabA", "pairA");
    reg.onConnectionClosed("tabA");
    expect(reg.controlOwner()).toBeNull();
    expect(reg.requestControl("tabB", "pairA").ok).toBe(true);
  });

  it("revokes lease + tickets for a pairing on pairing revocation", () => {
    const { reg } = make();
    reg.requestControl("tabA", "pairA");
    reg.revokeForPairing("pairA");
    expect(reg.controlOwner()).toBeNull();
  });

  it("clears control on a hard reset (agent restart / stop)", () => {
    const { reg } = make();
    reg.requestControl("tabA", "pairA");
    reg.clearControl();
    expect(reg.controlOwner()).toBeNull();
  });
});
