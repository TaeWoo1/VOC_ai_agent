/**
 * Account-scoped **single-flight lock** for the ESM+ REVIEW scheduled beta
 * (M-Sync-1.5A) — the net-new "one active sync per account" primitive (plan §4).
 *
 * The collector has no locking today; the backend's `FOR UPDATE SKIP LOCKED`
 * claim guards the API-connector path only, not the browser-export worker. When
 * the worker's timer fires while a cycle for the same account is still in flight,
 * the overlapping tick must **skip or queue — never double-run** a click/download
 * into the one held-open context.
 *
 * **Pure, in-process, no I/O.** This is an in-memory advisory lock for a single
 * worker process (one process per account in the first beta); it is NOT a
 * cross-process/distributed lock. The lock is keyed by a sanitized account key
 * (e.g. the connection id) — never raw store/account identity.
 */

/** A held lock. `release()` is idempotent — calling it twice is safe and a no-op the second time. */
export interface AccountLockHandle {
  readonly key: string;
  release(): void;
}

/** The result of `runExclusive`: whether the body ran, and its value when it did. */
export type ExclusiveResult<T> = { ran: true; value: T } | { ran: false };

/**
 * In-process, account-scoped single-flight gate. At most one holder per key at a
 * time; a second acquire for a held key fails (returns `null` / `{ran:false}`) so
 * the caller can skip or queue — it never blocks and never double-runs.
 */
export class AccountSingleFlight {
  private readonly held = new Set<string>();

  /** True while `key` is currently locked. */
  isHeld(key: string): boolean {
    return this.held.has(key);
  }

  /**
   * Acquire the lock for `key`, or return `null` if it is already held. The
   * returned handle's `release()` is idempotent.
   */
  tryAcquire(key: string): AccountLockHandle | null {
    if (this.held.has(key)) return null;
    this.held.add(key);
    let released = false;
    return {
      key,
      release: () => {
        if (released) return;
        released = true;
        this.held.delete(key);
      },
    };
  }

  /**
   * Run `fn` under the lock for `key`. If the lock is already held, SKIP (return
   * `{ran:false}`) — the overlapping tick does nothing. Otherwise acquire, run,
   * and release in `finally` (even if `fn` throws), then return `{ran:true,value}`.
   */
  async runExclusive<T>(key: string, fn: () => Promise<T>): Promise<ExclusiveResult<T>> {
    const handle = this.tryAcquire(key);
    if (handle === null) return { ran: false };
    try {
      const value = await fn();
      return { ran: true, value };
    } finally {
      handle.release();
    }
  }
}
