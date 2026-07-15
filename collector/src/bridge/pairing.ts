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
  /**
   * In-memory ONLY: the out-of-band approval secret (normalized, no separator). Minted only when the caller
   * asked for an approval-gated request, and delivered to the human ONLY through an `ApprovalPresenter` —
   * never returned over HTTP, never rendered into the confirmation page, never persisted, never logged.
   * `undefined` means this request was minted WITHOUT the approval gate (see {@link requestPairing}).
   */
  approvalSecret?: string;
  /** Remaining wrong-code attempts before the request is burned. Bounds brute force of the short code. */
  attemptsLeft: number;
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
  /**
   * Global cap on SIMULTANEOUSLY-PENDING pairing requests (see {@link PairingRegistry.requestPairing}).
   * Injectable so the abuse behaviour is hermetically testable at a cap of 1–2 instead of by minting the
   * default in a loop.
   */
  maxPendingRequests?: number;
}

export type TicketRejection = "not_found" | "expired" | "used";

/** Why a pairing request was not minted. Coarse and caller-safe — it names a capacity limit, nothing more. */
export type PairingRequestRejection = "pending_limit";

/**
 * The outcome of {@link PairingRegistry.requestPairing}. A discriminated union rather than an optional field:
 * a rejected request has NO requestId and NO code, so the type must make that unrepresentable instead of
 * leaving a caller to destructure `requestId` off a rejection and present `undefined` to a human. `swept` is
 * on BOTH branches — the opportunistic cleanup ran either way, and the shell should log it either way.
 */
export type PairingRequestResult =
  | { ok: true; requestId: string; confirmationCode: string; approvalCode?: string; swept: SweepResult }
  | { ok: false; reason: PairingRequestRejection; pendingCount: number; limit: number; swept: SweepResult };

/** Counts from one bounded-cleanup pass — the safe, coarse timeout-eviction signal (numbers only). */
export interface SweepResult {
  requestsEvicted: number;
  ticketsEvicted: number;
}

const DEFAULT_REQUEST_TTL_MS = 5 * 60 * 1000;
const DEFAULT_TICKET_TTL_MS = 10 * 1000;
/**
 * Wrong approval-code attempts allowed per request before it is burned. The code is short because a human
 * retypes it, so an attempt cap — not code length alone — is what makes brute force infeasible: 8 hex chars
 * (32 bits) with 5 attempts inside the 5-minute request TTL bounds forgery odds at ~5/2^32 (~1.2e-9).
 */
const DEFAULT_APPROVAL_ATTEMPTS = 5;
/**
 * How many pairing requests may be pending AT ONCE, across all origins. One pending request is one human
 * consent in flight, so more than a couple at a time is already abnormal; 8 leaves room for a person who
 * retries a few times (each retry mints a new request, and the old one stays pending for the rest of its
 * 5-minute TTL) while keeping the bound low enough to matter. Injectable via
 * {@link PairingRegistryOptions.maxPendingRequests}.
 */
const DEFAULT_MAX_PENDING_REQUESTS = 8;

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

/** Accept the code as the human might retype it: separators/whitespace stripped, case-insensitive. */
function normalizeApprovalCode(value: string): string {
  return value.replace(/[\s-]/g, "").toUpperCase();
}

/**
 * Constant-time approval-code comparison. Both sides are SHA-256'd FIRST so the comparison operates on two
 * fixed-length (64-char) valid-hex digests: attacker-supplied input never reaches `Buffer.from(x,"hex")`,
 * which silently truncates invalid hex, and no length difference can leak through an early return.
 */
function approvalCodeMatches(input: string, secret: string): boolean {
  return constantTimeEqualHex(sha256Hex(normalizeApprovalCode(input)), sha256Hex(secret));
}

export class PairingRegistry {
  private readonly now: () => number;
  private readonly randomHex: (bytes: number) => string;
  private readonly requestTtlMs: number;
  private readonly ticketTtlMs: number;
  private readonly maxPendingRequests: number;

  private readonly requests = new Map<string, PendingRequest>();
  private readonly pairings = new Map<string, Pairing>();
  private readonly tickets = new Map<string, Ticket>();

  constructor(opts: PairingRegistryOptions) {
    this.now = opts.now;
    this.randomHex = opts.randomHex ?? ((bytes) => randomBytes(bytes).toString("hex"));
    this.requestTtlMs = opts.requestTtlMs ?? DEFAULT_REQUEST_TTL_MS;
    this.ticketTtlMs = opts.ticketTtlMs ?? DEFAULT_TICKET_TTL_MS;
    this.maxPendingRequests = opts.maxPendingRequests ?? DEFAULT_MAX_PENDING_REQUESTS;
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

  /**
   * How many requests are pending RIGHT NOW. Counts only `pending` — an `allowed`/`denied` request reached a
   * terminal outcome and no longer holds anyone's attention; it lingers only until the TTL sweep reclaims it.
   * Counting terminal entries would make the flood below EASIER, not harder: a caller could park the registry
   * at its cap with requests nobody is waiting on.
   *
   * Assumes {@link sweep} ran first, so nothing counted here is already expired.
   */
  private pendingRequestCount(): number {
    let n = 0;
    for (const r of this.requests.values()) if (r.status === "pending") n += 1;
    return n;
  }

  /**
   * Step 1: the frontend requests pairing for its origin. Returns a short human-verifiable code, plus the
   * `swept` counts from the opportunistic bounded cleanup this call ran first — so the I/O shell can make the
   * silent timeout-eviction of stale requests/tickets observable without this pure core touching a logger.
   *
   * **Bounded by a global pending cap.** Each pending request costs a human interruption: the shell presents
   * every one through the `ApprovalPresenter`, so an unbounded surface lets any local process (the threat
   * model here — it can spoof `Origin` freely) spray requests and bury the person in approval prompts until
   * they dismiss one blind. The cap bounds how many can be in flight at once.
   *
   * **Expired requests are swept first; live ones are never evicted — new requests are refused instead.** The
   * sweep is what keeps this from being brittle: capacity that has genuinely aged out is reclaimed before the
   * cap is applied, so the limit only ever binds on requests that are actually still live. When it does bind,
   * the choice of who loses matters. Evicting the oldest live request to admit a new one would make the flood
   * STRONGER than doing nothing: an attacker could push out the very request a human is mid-way through
   * approving — reading the code off their console — and their confirm would then fail for no visible reason,
   * or worse, land on an attacker's request that took the slot. Refusing the newcomer instead means a flood
   * can only ever deny NEW pairings (visible, self-healing as the TTL drains, and pairing is not a
   * safety-critical path), never corrupt or steal a consent already under way. Fail-closed, as everywhere
   * else in this flow.
   */
  requestPairing(
    origin: string,
    workspaceLabel: string,
    opts: { requireApproval?: boolean } = {},
  ): PairingRequestResult {
    const swept = this.sweep(); // opportunistic bounded cleanup of stale requests/tickets before we add another
    // Sweep FIRST, then measure: the cap must bind on live consent-in-flight, never on dead entries.
    const pendingCount = this.pendingRequestCount();
    if (pendingCount >= this.maxPendingRequests) {
      // Nothing is minted and nothing is evicted — every request already in flight survives untouched.
      return { ok: false, reason: "pending_limit", pendingCount, limit: this.maxPendingRequests, swept };
    }
    const requestId = this.randomHex(8); // 16 hex
    const raw = this.randomHex(3).toUpperCase(); // 6 hex chars
    const confirmationCode = `${raw.slice(0, 3)}-${raw.slice(3, 6)}`;
    // The approval secret is a SEPARATE value from `confirmationCode` on purpose. `confirmationCode` is
    // returned to the requesting frontend (so it is attacker-known and authenticates nothing — it stays a
    // visual "is this my request?" match). Only this secret gates `allow`, and it leaves the agent solely
    // through the ApprovalPresenter.
    const approvalSecret = opts.requireApproval ? this.randomHex(4).toUpperCase() : undefined; // 8 hex = 32 bits
    this.requests.set(requestId, {
      requestId,
      origin,
      workspaceLabel,
      confirmationCode,
      ...(approvalSecret !== undefined ? { approvalSecret } : {}),
      attemptsLeft: DEFAULT_APPROVAL_ATTEMPTS,
      createdAtMs: this.now(),
      status: "pending",
    });
    return {
      ok: true,
      requestId,
      confirmationCode,
      // Human-formatted for readability; `normalizeApprovalCode` makes the separator irrelevant on the way back.
      ...(approvalSecret !== undefined
        ? { approvalCode: `${approvalSecret.slice(0, 4)}-${approvalSecret.slice(4, 8)}` }
        : {}),
      swept,
    };
  }

  /**
   * **Drop a just-minted request whose approval presentation failed.** The human never saw the code, so the
   * request must not linger in a state where it could still be confirmed; discarding it also means a failed
   * presentation leaves NO ephemeral state behind. Mirrors the persist-then-commit rollback discipline of
   * {@link undoConfirm}/{@link restoreRevoked}: state takes effect only once its precondition truly held.
   */
  discardRequest(requestId: string): { ok: boolean } {
    return { ok: this.requests.delete(requestId) };
  }

  /**
   * The renderable view of a pending request. Exposes `approvalRequired` — whether an approval secret gates
   * this request — but NEVER the secret itself: the confirmation page is fetchable by anyone holding the
   * (already-public) `requestId`, so rendering the code there would hand it straight to the attacker and
   * defeat the entire out-of-band channel.
   */
  getRequestView(requestId: string): {
    origin: string;
    workspaceLabel: string;
    confirmationCode: string;
    approvalRequired: boolean;
    status: PendingRequest["status"];
  } | null {
    const r = this.requests.get(requestId);
    if (!r || this.requestExpired(r)) return null;
    return {
      origin: r.origin,
      workspaceLabel: r.workspaceLabel,
      confirmationCode: r.confirmationCode,
      approvalRequired: r.approvalSecret !== undefined,
      status: r.status,
    };
  }

  /**
   * Step 2 (agent-owned confirmation page): the human allows or denies. Allow mints the pairing token.
   *
   * **`allow` requires the out-of-band approval secret** whenever the request was minted with one — this is
   * what makes a human approval unforgeable by a local process. The process may hold `requestId` and
   * `confirmationCode` (both were returned to the requester) and may spoof any `Origin`, but it cannot read
   * the code off the human's console, so `allow` fails. Each wrong code burns one of a bounded number of
   * attempts; exhausting them denies the request terminally rather than letting the short code be brute-forced.
   *
   * `deny` deliberately does NOT require the code: denial grants no trust (it fails closed), and a human
   * clicking 거부 should not have to type anything. Denying someone else's request would anyway require
   * guessing their 64-bit `requestId`.
   */
  confirmPairing(requestId: string, decision: "allow" | "deny", approvalCode = ""): { ok: boolean } {
    const r = this.requests.get(requestId);
    if (!r || r.status !== "pending" || this.requestExpired(r)) return { ok: false };
    if (decision === "deny") {
      r.status = "denied";
      return { ok: true };
    }
    if (r.approvalSecret !== undefined && !approvalCodeMatches(approvalCode, r.approvalSecret)) {
      r.attemptsLeft -= 1;
      // Burned: a request that ran out of attempts is terminally denied, so the correct code no longer
      // works either and the attacker cannot simply keep guessing within the request TTL.
      if (r.attemptsLeft <= 0) r.status = "denied";
      return { ok: false };
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

  /**
   * **Roll back a just-minted {@link confirmPairing} whose durable persist failed** — restoring the exact
   * pre-confirm state so the confirm takes effect only when it is durable (persist-then-commit). Deletes the
   * minted pairing, discards the undelivered token, and returns the request to `pending`. After this a
   * {@link pollPairing} reports `pending` (never a `paired` status carrying an inert token for a pairing that
   * was never stored), and the human may retry the confirmation. A no-op unless the request is `allowed`.
   *
   * `approvalSecret` and `attemptsLeft` are deliberately PRESERVED: the human retries with the same code they
   * are still reading off the console, and a repeated persist failure must not reset the attempt cap (which
   * would hand an attacker unlimited guesses through a persist-failure loop).
   */
  undoConfirm(requestId: string): { ok: boolean } {
    const r = this.requests.get(requestId);
    if (!r || r.status !== "allowed" || r.pairingId === undefined) return { ok: false };
    this.pairings.delete(r.pairingId);
    r.status = "pending";
    r.pairingId = undefined;
    r.deliverToken = undefined;
    return { ok: true };
  }

  /**
   * **Roll back a {@link revoke} whose durable persist failed** — un-revoking the pairing so the revoke takes
   * effect only when it is durable (persist-then-commit). This keeps the credential valid, so a retry can
   * re-attempt the durable write with the SAME still-valid token instead of a dead one, and memory stays
   * consistent with the (never-written) durable state so a restart cannot resurrect a revoke reported as
   * successful. Outstanding ephemeral tickets stay cleared (short-lived + single-use — the client re-mints);
   * that does not affect the restored pairing's validity. Only un-revokes an existing pairing; never creates one.
   */
  restoreRevoked(pairingId: string): { ok: boolean } {
    const p = this.pairings.get(pairingId);
    if (!p) return { ok: false };
    p.revoked = false;
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

  /**
   * Mint a short-lived, single-use WS ticket for an authenticated pairing. Also returns the `swept` counts
   * from the opportunistic cleanup this call ran first (see {@link requestPairing}), so timeout-eviction stays
   * observable at the transport shell.
   */
  mintTicket(pairingId: string): { ticket: string; expiresInMs: number; swept: SweepResult } {
    const swept = this.sweep(); // opportunistic bounded cleanup of stale requests/tickets before we add another
    const ticket = this.randomHex(24); // 48 hex
    this.tickets.set(sha256Hex(ticket), {
      ticketHash: sha256Hex(ticket),
      pairingId,
      expiresAtMs: this.now() + this.ticketTtlMs,
      used: false,
    });
    return { ticket, expiresInMs: this.ticketTtlMs, swept };
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
  sweep(): SweepResult {
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
