/**
 * **Pilot runtime — reconnect / bridge-bind policy (pure).**
 *
 * "SellerOps 자동 pairing·reconnect" has two halves, and only one is new here:
 *
 *  - **The frontend already auto-pairs and auto-reconnects** — `useBridge` re-polls and re-`refresh()`es on
 *    an interval, the pairing token lives in `localStorage`, and the durable pairing store means a restarted
 *    agent is still paired (valid-until-revoked). Moving the pairing store to the data root (so an update
 *    keeps it) is what makes that hold across updates; no new FE code is needed.
 *  - **The agent side is bridge-bind retry.** After a crash-recovery takeover, or a reboot where the login
 *    launcher fires while the OS has not yet released the previous socket, the bridge port can be transiently
 *    held even though the single-instance lock proves we are the sole agent. Rather than give up on the first
 *    `EADDRINUSE`, the boot retries with bounded backoff. This module is that decision — pure, so the boot's
 *    retry loop is deterministic and testable without a socket.
 *
 * The single-instance LOCK, not this module, decides duplicate-vs-sole. By the time bind is attempted we hold
 * the lock, so an `already_running` bind here is transient (a dying prior socket), never a real duplicate.
 */

/** Bounded exponential backoff options. Integers only (no float factor) so delays are exactly reproducible. */
export interface ReconnectBackoffOptions {
  /** First delay (ms). */
  readonly baseMs?: number;
  /** Ceiling (ms) — the delay never exceeds this however many attempts pass. */
  readonly maxMs?: number;
  /** Doubling steps: delay = base * 2^attempt, capped at max. */
  readonly factor?: number;
}

const DEFAULT_BASE_MS = 500;
const DEFAULT_MAX_MS = 30_000;
const DEFAULT_FACTOR = 2;

/**
 * The delay before reconnect attempt `attempt` (0-indexed): `min(base * factor^attempt, max)`. Monotonic,
 * bounded, deterministic — no jitter, so a test asserts exact values and a reboot storm cannot degenerate.
 */
export function nextReconnectDelayMs(attempt: number, opts: ReconnectBackoffOptions = {}): number {
  const base = opts.baseMs ?? DEFAULT_BASE_MS;
  const max = opts.maxMs ?? DEFAULT_MAX_MS;
  const factor = opts.factor ?? DEFAULT_FACTOR;
  const step = Math.max(0, Math.floor(attempt));
  // Guard against overflow on a large attempt count: cap the multiplier before multiplying.
  const multiplier = factor ** Math.min(step, 40);
  return Math.min(base * multiplier, max);
}

/** The outcome of one bridge-bind attempt, as the boot observes it. */
export type BindOutcome = "ok" | "already_running" | "error";

/** What the boot should do after a bind attempt. */
export type BindDecision =
  | { readonly action: "PROCEED" }
  | { readonly action: "RETRY"; readonly delayMs: number; readonly nextAttempt: number }
  | { readonly action: "GIVE_UP" };

/**
 * Decide the boot's next step after a bind attempt. A successful bind proceeds; a transient failure retries
 * with backoff until `maxAttempts` is exhausted, then gives up (the boot surfaces a self-check-style failure
 * rather than spinning forever). `attempt` is the 0-indexed attempt that just ran.
 */
export function decideBindRetry(
  outcome: BindOutcome,
  attempt: number,
  maxAttempts: number,
  opts: ReconnectBackoffOptions = {},
): BindDecision {
  if (outcome === "ok") return { action: "PROCEED" };
  const nextAttempt = attempt + 1;
  if (nextAttempt >= maxAttempts) return { action: "GIVE_UP" };
  return { action: "RETRY", delayMs: nextReconnectDelayMs(nextAttempt, opts), nextAttempt };
}
