/**
 * **Projection session + control-lease registry (pure, in-memory).** The authorization core of Browser
 * Projection V0 (slice §0.2, §0.5, §7, §10). It mints short-lived single-use **projection connection
 * tickets** from an already-authenticated pairing, and manages the single **control lease** (one owner,
 * 2-minute inactivity expiry, renewed by accepted input, never force-takeable).
 *
 * Design rules (mirrors the G1 pairing registry style):
 * - Long-term pairing is the trust ROOT; a projection connection needs a **separate** single-use ticket,
 *   and input needs a **separate** control lease — no elevation of the pairing bearer to browser control.
 * - Tickets are hashed at rest, single-use, short-lived. Control is a lease keyed by an opaque connection id.
 * - Forced takeover is NOT supported: while a non-expired lease is held, another connection is refused.
 * - All time + randomness is injected → deterministic and hermetically testable.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

interface ProjectionTicket {
  ticketHash: string;
  pairingId: string;
  expiresAtMs: number;
  used: boolean;
}

interface ControlLease {
  /** Opaque per-connection id of the owner (a viewer WS). */
  connId: string;
  pairingId: string;
  /** Idle-expiry deadline; renewed on accepted input. */
  expiresAtMs: number;
}

export interface ProjectionRegistryOptions {
  now: () => number;
  randomHex?: (bytes: number) => string;
  /** How long a minted projection ticket is valid (single-use). */
  ticketTtlMs?: number;
  /** Control lease inactivity expiry (slice §0.2 = 2 minutes). */
  leaseIdleMs?: number;
}

export type ProjectionTicketRejection = "not_found" | "expired" | "used";
export type ControlGrant =
  | { ok: true; expiresInMs: number }
  | { ok: false; reason: "held" };

const DEFAULT_TICKET_TTL_MS = 10 * 1000;
const DEFAULT_LEASE_IDLE_MS = 2 * 60 * 1000;

function sha256Hex(v: string): string {
  return createHash("sha256").update(v).digest("hex");
}
function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

export class ProjectionRegistry {
  private readonly now: () => number;
  private readonly randomHex: (bytes: number) => string;
  private readonly ticketTtlMs: number;
  private readonly leaseIdleMs: number;

  private readonly tickets = new Map<string, ProjectionTicket>();
  private lease: ControlLease | null = null;

  constructor(opts: ProjectionRegistryOptions) {
    this.now = opts.now;
    this.randomHex = opts.randomHex ?? ((bytes) => randomBytes(bytes).toString("hex"));
    this.ticketTtlMs = opts.ticketTtlMs ?? DEFAULT_TICKET_TTL_MS;
    this.leaseIdleMs = opts.leaseIdleMs ?? DEFAULT_LEASE_IDLE_MS;
  }

  /** Mint a short-lived, single-use projection connection ticket for an authenticated pairing. */
  mintTicket(pairingId: string): { ticket: string; expiresInMs: number } {
    const ticket = this.randomHex(24); // 48 hex
    this.tickets.set(sha256Hex(ticket), {
      ticketHash: sha256Hex(ticket),
      pairingId,
      expiresAtMs: this.now() + this.ticketTtlMs,
      used: false,
    });
    return { ticket, expiresInMs: this.ticketTtlMs };
  }

  /** Consume a projection ticket exactly once (replay-safe). */
  consumeTicket(ticket: string): { ok: true; pairingId: string } | { ok: false; reason: ProjectionTicketRejection } {
    const t = this.tickets.get(sha256Hex(ticket));
    if (!t) return { ok: false, reason: "not_found" };
    if (t.used) return { ok: false, reason: "used" };
    if (this.now() > t.expiresAtMs) return { ok: false, reason: "expired" };
    // constant-time confirm (defensive; the map lookup already used the hash)
    if (!constantTimeEqualHex(t.ticketHash, sha256Hex(ticket))) return { ok: false, reason: "not_found" };
    t.used = true;
    return { ok: true, pairingId: t.pairingId };
  }

  /** Invalidate all outstanding tickets for a pairing (on revoke). */
  invalidateTicketsForPairing(pairingId: string): void {
    for (const [hash, t] of this.tickets) if (t.pairingId === pairingId) this.tickets.delete(hash);
  }

  // ---- control lease --------------------------------------------------------

  /** The current control owner, auto-expiring an idle lease first. */
  controlOwner(): string | null {
    if (this.lease && this.now() > this.lease.expiresAtMs) this.lease = null;
    return this.lease ? this.lease.connId : null;
  }

  hasControl(connId: string): boolean {
    return this.controlOwner() === connId;
  }

  /** Request control. Granted only if free or already this connection's; a live foreign lease → held. */
  requestControl(connId: string, pairingId: string): ControlGrant {
    const owner = this.controlOwner();
    if (owner && owner !== connId) return { ok: false, reason: "held" };
    this.lease = { connId, pairingId, expiresAtMs: this.now() + this.leaseIdleMs };
    return { ok: true, expiresInMs: this.leaseIdleMs };
  }

  /** Renew on accepted input. No-op if this connection is not the current owner. */
  renewControl(connId: string): boolean {
    if (this.controlOwner() !== connId) return false;
    this.lease = { ...this.lease!, expiresAtMs: this.now() + this.leaseIdleMs };
    return true;
  }

  /** Explicit release by the owner. */
  releaseControl(connId: string): void {
    if (this.lease && this.lease.connId === connId) this.lease = null;
  }

  /** A connection closed (disconnect/tab close) — drop its lease if it held control. */
  onConnectionClosed(connId: string): void {
    this.releaseControl(connId);
  }

  /** Revoke everything for a pairing (tickets + lease if owned by that pairing). */
  revokeForPairing(pairingId: string): void {
    this.invalidateTicketsForPairing(pairingId);
    if (this.lease && this.lease.pairingId === pairingId) this.lease = null;
  }

  /** Hard reset (agent restart / projection stop) — clear the lease. */
  clearControl(): void {
    this.lease = null;
  }
}
