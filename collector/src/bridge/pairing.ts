/**
 * **Pairing registry (pure, in-memory).** The security core of the bridge: it turns a frontend-initiated
 * pairing request into a locally-confirmed, revocable trust relationship, and mints short-lived single-use
 * WebSocket connection tickets from the long-lived pairing token (slice §0.2/§0.4/§5).
 *
 * Design rules enforced here:
 * - The long-lived **pairing token** is a secret; at rest we keep only its SHA-256 hash. The plaintext is
 *   returned exactly once (right after local confirmation) for the frontend to store — never persisted.
 * - Pairing is valid **until revoked** (no expiry). Tickets DO expire and are **single-use** (replay-safe).
 * - The ephemeral **requests/tickets maps are bounded**: {@link PairingRegistry.sweep} (run opportunistically
 *   on each new request/ticket, and callable directly) evicts entries past their TTL using the injected clock,
 *   so neither map grows without bound on a long-lived agent. A used-but-unexpired ticket is deliberately KEPT
 *   until it expires, so a replay within its validity window still reports `used` (never a weaker `not_found`).
 * - Token/ticket comparison is constant-time.
 * - All time + randomness is injected, so this module is deterministic and hermetically testable (no
 *   wall-clock, no ambient RNG). The default adapters use `node:crypto`.
 *
 * No filesystem/socket here — {@link ./pairing-store} adds durable persistence of the `pairings` slice.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export interface Pairing {
  pairingId: string;
  origin: string;
  /** SHA-256 hex of the pairing token. The plaintext token is never stored. */
  tokenHash: string;
  createdAtMs: number;
  revoked: boolean;
}

interface PendingRequest {
  requestId: string;
  origin: string;
  workspaceLabel: string;
  confirmationCode: string;
  createdAtMs: number;
  status: "pending" | "allowed" | "denied";
  pairingId?: string;
  /** In-memory ONLY: the plaintext token awaiting first poll. Cleared on delivery; never serialized. */
  deliverToken?: string;
}

interface Ticket {
  ticketHash: string;
  pairingId: string;
  expiresAtMs: number;
  used: boolean;
}

export interface PairingRegistryOptions {
  now: () => number;
  /** Returns `bytes*2` hex chars of randomness. */
  randomHex?: (bytes: number) => string;
  /** How long a pending pairing request stays confirmable. */
  requestTtlMs?: number;
  /** How long a minted WS ticket is valid. */
  ticketTtlMs?: number;
}

export type TicketRejection = "not_found" | "expired" | "used";

const DEFAULT_REQUEST_TTL_MS = 5 * 60 * 1000;
const DEFAULT_TICKET_TTL_MS = 10 * 1000;

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

export class PairingRegistry {
  private readonly now: () => number;
  private readonly randomHex: (bytes: number) => string;
  private readonly requestTtlMs: number;
  private readonly ticketTtlMs: number;

  private readonly requests = new Map<string, PendingRequest>();
  private readonly pairings = new Map<string, Pairing>();
  private readonly tickets = new Map<string, Ticket>();

  constructor(opts: PairingRegistryOptions) {
    this.now = opts.now;
    this.randomHex = opts.randomHex ?? ((bytes) => randomBytes(bytes).toString("hex"));
    this.requestTtlMs = opts.requestTtlMs ?? DEFAULT_REQUEST_TTL_MS;
    this.ticketTtlMs = opts.ticketTtlMs ?? DEFAULT_TICKET_TTL_MS;
  }

  /** Seed durable pairings loaded from disk (store use only). */
  load(pairings: readonly Pairing[]): void {
    for (const p of pairings) this.pairings.set(p.pairingId, { ...p });
  }

  /** The durable slice to persist — pairings only (requests/tickets are ephemeral). */
  exportPairings(): Pairing[] {
    return [...this.pairings.values()].map((p) => ({ ...p }));
  }

  /** Is there any non-revoked pairing? (Health `paired` flag — presence only.) */
  hasActivePairing(): boolean {
    for (const p of this.pairings.values()) if (!p.revoked) return true;
    return false;
  }

  listPairings(): Pairing[] {
    return this.exportPairings();
  }

  /** Step 1: the frontend requests pairing for its origin. Returns a short human-verifiable code. */
  requestPairing(origin: string, workspaceLabel: string): { requestId: string; confirmationCode: string } {
    this.sweep(); // opportunistic bounded cleanup of stale requests/tickets before we add another
    const requestId = this.randomHex(8); // 16 hex
    const raw = this.randomHex(3).toUpperCase(); // 6 hex chars
    const confirmationCode = `${raw.slice(0, 3)}-${raw.slice(3, 6)}`;
    this.requests.set(requestId, {
      requestId,
      origin,
      workspaceLabel,
      confirmationCode,
      createdAtMs: this.now(),
      status: "pending",
    });
    return { requestId, confirmationCode };
  }

  getRequestView(
    requestId: string,
  ): { origin: string; workspaceLabel: string; confirmationCode: string; status: PendingRequest["status"] } | null {
    const r = this.requests.get(requestId);
    if (!r || this.requestExpired(r)) return null;
    return { origin: r.origin, workspaceLabel: r.workspaceLabel, confirmationCode: r.confirmationCode, status: r.status };
  }

  /** Step 2 (agent-owned confirmation page): the human allows or denies. Allow mints the pairing token. */
  confirmPairing(requestId: string, decision: "allow" | "deny"): { ok: boolean } {
    const r = this.requests.get(requestId);
    if (!r || r.status !== "pending" || this.requestExpired(r)) return { ok: false };
    if (decision === "deny") {
      r.status = "denied";
      return { ok: true };
    }
    const pairingId = this.randomHex(8);
    const token = this.randomHex(32); // 64 hex, long-lived secret
    this.pairings.set(pairingId, {
      pairingId,
      origin: r.origin,
      tokenHash: sha256Hex(token),
      createdAtMs: this.now(),
      revoked: false,
    });
    r.status = "allowed";
    r.pairingId = pairingId;
    r.deliverToken = token; // in-memory, delivered once via poll
    return { ok: true };
  }

  /** Step 3: the frontend polls to collect the outcome. The plaintext token is handed over exactly once. */
  pollPairing(requestId: string): { status: "pending" | "denied" | "expired" | "paired"; pairingToken?: string } {
    const r = this.requests.get(requestId);
    if (!r) return { status: "expired" };
    if (this.requestExpired(r) && r.status === "pending") return { status: "expired" };
    if (r.status === "denied") return { status: "denied" };
    if (r.status === "allowed") {
      const token = r.deliverToken;
      if (token) {
        r.deliverToken = undefined; // single delivery
        return { status: "paired", pairingToken: token };
      }
      // Already delivered — the frontend must already hold it; report paired without re-exposing the secret.
      return { status: "paired" };
    }
    return { status: "pending" };
  }

  /** Authenticate a long-lived pairing token → the owning non-revoked pairing, or null. Constant-time. */
  authenticate(pairingToken: string): Pairing | null {
    const hash = sha256Hex(pairingToken);
    for (const p of this.pairings.values()) {
      if (!p.revoked && constantTimeEqualHex(p.tokenHash, hash)) return p;
    }
    return null;
  }

  /** Mint a short-lived, single-use WS ticket for an authenticated pairing. */
  mintTicket(pairingId: string): { ticket: string; expiresInMs: number } {
    this.sweep(); // opportunistic bounded cleanup of stale requests/tickets before we add another
    const ticket = this.randomHex(24); // 48 hex
    this.tickets.set(sha256Hex(ticket), {
      ticketHash: sha256Hex(ticket),
      pairingId,
      expiresAtMs: this.now() + this.ticketTtlMs,
      used: false,
    });
    return { ticket, expiresInMs: this.ticketTtlMs };
  }

  /** Consume a WS ticket exactly once. Rejects expired/replayed/unknown tickets and revoked pairings. */
  consumeTicket(ticket: string): { ok: true; pairingId: string } | { ok: false; reason: TicketRejection } {
    const t = this.tickets.get(sha256Hex(ticket));
    if (!t) return { ok: false, reason: "not_found" };
    if (t.used) return { ok: false, reason: "used" };
    if (this.now() > t.expiresAtMs) return { ok: false, reason: "expired" };
    const pairing = this.pairings.get(t.pairingId);
    if (!pairing || pairing.revoked) return { ok: false, reason: "not_found" };
    t.used = true; // single-use: mark before returning so a concurrent replay fails
    return { ok: true, pairingId: t.pairingId };
  }

  /** Revoke a pairing by id (agent-initiated) and invalidate its outstanding tickets. */
  revoke(pairingId: string): { ok: boolean } {
    const p = this.pairings.get(pairingId);
    if (!p) return { ok: false };
    p.revoked = true;
    for (const [hash, t] of this.tickets) if (t.pairingId === pairingId) this.tickets.delete(hash);
    return { ok: true };
  }

  /** Revoke by presenting the pairing token (frontend-initiated). */
  revokeByToken(pairingToken: string): { ok: boolean } {
    const p = this.authenticate(pairingToken);
    if (!p) return { ok: false };
    return this.revoke(p.pairingId);
  }

  /**
   * Evict stale ephemeral state so the `requests`/`tickets` maps stay bounded on a long-lived agent. Uses the
   * injected clock — deterministic and hermetically testable. A request past its confirmation TTL is dead
   * (it can no longer be confirmed/polled to any live outcome); a ticket is evicted only once it has EXPIRED,
   * never merely because it was used — a used-but-unexpired ticket is kept so a replay still reports `used`.
   * Pairings are never touched here (they are valid until explicitly revoked). Returns the eviction counts.
   */
  sweep(): { requestsEvicted: number; ticketsEvicted: number } {
    const now = this.now();
    let requestsEvicted = 0;
    for (const [id, r] of this.requests) {
      if (now - r.createdAtMs > this.requestTtlMs) { this.requests.delete(id); requestsEvicted += 1; }
    }
    let ticketsEvicted = 0;
    for (const [hash, t] of this.tickets) {
      if (now > t.expiresAtMs) { this.tickets.delete(hash); ticketsEvicted += 1; }
    }
    return { requestsEvicted, ticketsEvicted };
  }

  private requestExpired(r: PendingRequest): boolean {
    return this.now() - r.createdAtMs > this.requestTtlMs;
  }
}
