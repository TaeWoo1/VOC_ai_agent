/**
 * **Pilot runtime — single-instance lock + crash recovery.**
 *
 * A seller double-clicks the launcher twice, or a login-item fires while an agent is already up. Two agents
 * sharing one Chrome profile directory corrupt each other's session and fight over the bridge port — so the
 * runtime must admit exactly one. Equally, an agent that was killed (power loss, task-manager end-task, a
 * crash) never runs its clean shutdown, so its lock file is left behind: the NEXT start must be able to tell
 * "someone else is genuinely running" from "the last run died and left its lock" — and, in the latter case,
 * take over and reap whatever that dead run owned.
 *
 * The decision is made by **liveness, not time**: a lock is stale iff the process it names is no longer
 * alive. That avoids every wall-clock pitfall (a paused laptop, a clock change) — a lock is only "someone
 * else" while that someone is a live process. The pure {@link decideLockOutcome} holds that rule; the thin
 * {@link acquireSingleInstanceLock} adapter reads/writes the file and asks the OS whether a pid is alive.
 *
 * The lock record carries the pid AND the process-group id, because the owned-process reaper terminates by
 * exact pid/process-group (never by string match) — so a recovering instance inherits precise handles to the
 * dead run's children rather than a name to grep for.
 */

import { readFileSync, writeFileSync, rmSync } from "node:fs";

/** What a lock file records. Only scalars; never a token, cookie, path, or account — a lock is not a secret. */
export interface LockRecord {
  /** The pid that holds the lock. */
  readonly pid: number;
  /** The process-group id (best-effort; `process.pid` on platforms without groups). Used by the reaper. */
  readonly pgid: number;
  /** When the holder started (ISO). Diagnostic only — NOT used in the staleness decision (that is liveness). */
  readonly startedAt: string;
  /** The holder's agent version — surfaced in diagnostics so a recovery from an older build is visible. */
  readonly agentVersion: string;
}

/**
 * The three outcomes of examining an existing lock against ourselves:
 *  - `ACQUIRE` — no live holder (no file, or the recorded pid is dead → a crash); we take the lock.
 *  - `ALREADY_RUNNING` — the recorded pid is alive and is not us; refuse (duplicate prevention).
 *  - `STALE_TAKEOVER` — a file exists but its pid is dead; we take over AND the caller reaps what it owned.
 *
 * `ACQUIRE` vs `STALE_TAKEOVER` both let us proceed; they differ only in whether a prior run must be recovered.
 */
export type LockOutcome = "ACQUIRE" | "ALREADY_RUNNING" | "STALE_TAKEOVER";

/**
 * Pure staleness decision. `existing` is the parsed prior record (or `null` for no/unreadable file); `isAlive`
 * answers whether a pid is a currently-live process. `self.pid` guards the degenerate re-entrant case (our own
 * pid already in the file → ACQUIRE, not ALREADY_RUNNING) so a re-check inside one process is never a conflict.
 */
export function decideLockOutcome(
  existing: LockRecord | null,
  self: { pid: number },
  isAlive: (pid: number) => boolean,
): LockOutcome {
  if (existing === null) return "ACQUIRE";
  if (existing.pid === self.pid) return "ACQUIRE";
  if (isAlive(existing.pid)) return "ALREADY_RUNNING";
  // A file naming a dead pid is the signature of an unclean exit — take over and recover.
  return "STALE_TAKEOVER";
}

/**
 * Ask the OS whether `pid` is a live process, without touching it. `process.kill(pid, 0)` sends no signal — it
 * only performs the permission/existence check: it succeeds (alive), throws `ESRCH` (no such process → dead),
 * or throws `EPERM` (alive but owned by another user — still alive). A non-positive pid is never alive.
 */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Injected seams so every branch is hermetically testable without a real filesystem or a real process. */
export interface LockAdapter {
  readFile(path: string): string | null;
  writeFile(path: string, contents: string): void;
  remove(path: string): void;
  isAlive(pid: number): boolean;
  now(): string;
}

/** Default adapter over `node:fs` + `process`. A missing/unreadable lock file reads as `null` (→ ACQUIRE). */
export function defaultLockAdapter(): LockAdapter {
  return {
    readFile(path) {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return null;
      }
    },
    writeFile(path, contents) {
      writeFileSync(path, contents, { encoding: "utf8", mode: 0o600 });
    },
    remove(path) {
      try {
        rmSync(path, { force: true });
      } catch {
        /* best-effort: a lock we cannot delete is reaped as stale by the next start */
      }
    },
    isAlive: isProcessAlive,
    now: () => new Date().toISOString(),
  };
}

/** The self-identity a start writes into the lock. `pgid` defaults to the pid where process groups are absent. */
export interface LockSelf {
  readonly pid: number;
  readonly pgid: number;
  readonly agentVersion: string;
}

/** The result of an acquisition attempt. On success, `release()` drops the lock (idempotent, best-effort). */
export type LockAcquireResult =
  | {
      readonly acquired: true;
      /** True when we took over a dead holder's lock — the caller should reap that holder's owned processes. */
      readonly recovered: boolean;
      /** The prior record we took over (only when `recovered`), so the caller can find its owned-process file. */
      readonly recoveredFrom: LockRecord | null;
      release(): void;
    }
  | {
      readonly acquired: false;
      /** The live holder's pid — so the caller can tell the seller an agent is already running (sanitized: a pid). */
      readonly holderPid: number;
    };

/** Parse a lock file's contents into a record, or `null` if it is absent/blank/corrupt (all → ACQUIRE). */
export function parseLockRecord(raw: string | null): LockRecord | null {
  if (raw === null || raw.trim() === "") return null;
  try {
    const v = JSON.parse(raw) as Partial<LockRecord>;
    if (typeof v.pid !== "number") return null;
    return {
      pid: v.pid,
      pgid: typeof v.pgid === "number" ? v.pgid : v.pid,
      startedAt: typeof v.startedAt === "string" ? v.startedAt : "",
      agentVersion: typeof v.agentVersion === "string" ? v.agentVersion : "",
    };
  } catch {
    return null;
  }
}

/**
 * Try to acquire the single-instance lock. Refuses (no side effect) when a live holder exists; otherwise writes
 * our record — recording, when it took over a dead holder, that holder's prior record so the boot can reap the
 * orphaned children it owned. `release()` removes the file; it is safe to call more than once.
 */
export function acquireSingleInstanceLock(
  lockPath: string,
  self: LockSelf,
  adapter: LockAdapter = defaultLockAdapter(),
): LockAcquireResult {
  const existing = parseLockRecord(adapter.readFile(lockPath));
  const outcome = decideLockOutcome(existing, self, adapter.isAlive);
  if (outcome === "ALREADY_RUNNING") {
    return { acquired: false, holderPid: existing!.pid };
  }
  const record: LockRecord = {
    pid: self.pid,
    pgid: self.pgid,
    startedAt: adapter.now(),
    agentVersion: self.agentVersion,
  };
  adapter.writeFile(lockPath, JSON.stringify(record));
  let released = false;
  return {
    acquired: true,
    recovered: outcome === "STALE_TAKEOVER",
    recoveredFrom: outcome === "STALE_TAKEOVER" ? existing : null,
    release() {
      if (released) return;
      released = true;
      adapter.remove(lockPath);
    },
  };
}
