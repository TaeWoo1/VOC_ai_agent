/**
 * **Pilot runtime — owned-process registry (terminate only what we started, by exact pid/process-group).**
 *
 * The agent launches Chrome (and, potentially, helper processes). When it shuts down — or when it recovers
 * from a crashed prior run — it must terminate THOSE processes and only those. Two ways to do that are wrong
 * and forbidden here:
 *
 *  - **matching by name** (`pgrep -f chrome`, `taskkill /IM chrome.exe`) — this reaper session once took down
 *    a *protected* stale agent because a name pattern matched a parent it never owned. A name is not
 *    ownership. This module records the exact pid and process-group of every process it starts and kills
 *    ONLY those numbers; it has no code path that accepts a pattern, an image name, or a wildcard.
 *  - **killing the seller's own Chrome** — the seller may have their normal browser open. We launched a
 *    dedicated, profile-isolated Chrome; its pid is recorded at launch, and only recorded pids are ever
 *    signalled, so a browser we did not start is untouchable by construction.
 *
 * The registry persists to a small file so a crashed run's still-alive orphans can be reaped by the instance
 * that takes over its lock (see `single-instance-lock`). Pure list/serialize logic is separated from the
 * platform kill adapter, so the ownership discipline is unit-testable without spawning or killing anything.
 */

import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { isProcessAlive } from "./single-instance-lock";

/** What kind of process we own — kept coarse; it is diagnostic, never a decision input. */
export type OwnedProcessKind = "browser" | "helper";

/** One owned process. Only numbers + coarse enums — a pid is not a secret; a path or command line would be. */
export interface OwnedProcessRecord {
  /** The exact process id we started. The ONLY thing ever passed to the killer. */
  readonly pid: number;
  /** Its process-group id (POSIX). Equals `pid` where groups are absent (Windows). Used to reap a tree. */
  readonly pgid: number;
  readonly kind: OwnedProcessKind;
  /** ISO start time — diagnostic only. */
  readonly startedAt: string;
}

/** Graceful asks the process to exit; force terminates it (and its tree). Platform-neutral by design. */
export type TerminateMode = "graceful" | "force";

/** Outcome of one kill attempt — sanitized (no pid echoed here; the caller logs a count, not identities). */
export type TerminateOutcome = "signaled" | "not_found" | "error";

/** The kill seam: terminate ONE record by its exact pid/process-group. Injected so tests never kill a process. */
export interface ProcessKiller {
  terminate(record: OwnedProcessRecord, mode: TerminateMode): TerminateOutcome;
}

/**
 * POSIX killer: signal the process GROUP by exact negative pgid when it differs from the pid (reaps the
 * browser's helper tree in one call), else the exact pid. `SIGTERM` for graceful, `SIGKILL` for force. Never
 * composes a name or a pattern — the only argument is a number we recorded at launch.
 */
export function posixProcessKiller(): ProcessKiller {
  return {
    terminate(record, mode) {
      const signal: NodeJS.Signals = mode === "force" ? "SIGKILL" : "SIGTERM";
      // A distinct process group means we launched it detached and own the whole group: signal `-pgid` to
      // reach the tree. Otherwise signal the single pid. Both are exact numbers, never a match expression.
      const target = record.pgid !== record.pid ? -record.pgid : record.pid;
      try {
        process.kill(target, signal);
        return "signaled";
      } catch (err) {
        return (err as NodeJS.ErrnoException).code === "ESRCH" ? "not_found" : "error";
      }
    },
  };
}

/**
 * Windows killer: `taskkill` by exact `/PID`, with `/T` to end the child tree and (force) `/F`. Absolute path
 * under `%SystemRoot%\System32`, `shell:false`, so no shell ever parses a dynamic value — and the ONLY dynamic
 * value is the numeric pid, passed as its own argv entry. Never `/IM <name>`, which would match by image name.
 */
export function windowsProcessKiller(env: NodeJS.ProcessEnv = process.env): ProcessKiller {
  const systemRoot = env.SystemRoot?.trim() || "C:\\Windows";
  const taskkill = join(systemRoot, "System32", "taskkill.exe");
  return {
    terminate(record, mode) {
      const args = ["/PID", String(record.pid), "/T"];
      if (mode === "force") args.push("/F");
      try {
        const res = spawn(taskkill, args, { shell: false, stdio: "ignore" });
        // Fire-and-forget: taskkill is synchronous enough for shutdown, and a failure to reach it is an
        // `error` outcome the caller counts. We do not block the event loop waiting on it.
        res.on("error", () => {});
        return "signaled";
      } catch {
        return "error";
      }
    },
  };
}

/** Pick the killer for a platform. Non-Windows uses the POSIX signaller. */
export function defaultProcessKiller(platform: string = process.platform, env: NodeJS.ProcessEnv = process.env): ProcessKiller {
  return platform === "win32" ? windowsProcessKiller(env) : posixProcessKiller();
}

/** Injected persistence seam (a tiny JSON file), so the registry is testable without a real filesystem. */
export interface RegistryStore {
  read(): string | null;
  write(contents: string): void;
  remove(): void;
}

/** Default store over a single file path under the runtime `run/` dir. */
export function fileRegistryStore(path: string): RegistryStore {
  return {
    read() {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return null;
      }
    },
    write(contents) {
      writeFileSync(path, contents, { encoding: "utf8", mode: 0o600 });
    },
    remove() {
      try {
        rmSync(path, { force: true });
      } catch {
        /* best-effort */
      }
    },
  };
}

/** Parse a persisted registry file into records; absent/corrupt → empty (a lost registry is not fatal). */
export function parseRegistry(raw: string | null): OwnedProcessRecord[] {
  if (raw === null || raw.trim() === "") return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    const out: OwnedProcessRecord[] = [];
    for (const item of arr) {
      const v = item as Partial<OwnedProcessRecord>;
      if (typeof v.pid !== "number") continue;
      out.push({
        pid: v.pid,
        pgid: typeof v.pgid === "number" ? v.pgid : v.pid,
        kind: v.kind === "helper" ? "helper" : "browser",
        startedAt: typeof v.startedAt === "string" ? v.startedAt : "",
      });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * The registry: owns the in-memory set, mirrors it to the store on every change so a crash leaves a readable
 * record, and reaps by exact pid/process-group only.
 */
export class OwnedProcessRegistry {
  private readonly byPid = new Map<number, OwnedProcessRecord>();

  constructor(
    private readonly store: RegistryStore,
    private readonly killer: ProcessKiller,
    private readonly now: () => string = () => new Date().toISOString(),
    /** Liveness check — injected for tests. A recorded pid that is no longer alive is never signalled. */
    private readonly isAlive: (pid: number) => boolean = isProcessAlive,
  ) {
    for (const r of parseRegistry(store.read())) this.byPid.set(r.pid, r);
  }

  /** Record a process we just started. `pgid` defaults to `pid` (single process / no group). Persisted at once. */
  register(pid: number, opts: { pgid?: number; kind?: OwnedProcessKind } = {}): OwnedProcessRecord {
    const record: OwnedProcessRecord = {
      pid,
      pgid: opts.pgid ?? pid,
      kind: opts.kind ?? "browser",
      startedAt: this.now(),
    };
    this.byPid.set(pid, record);
    this.flush();
    return record;
  }

  /** Forget a process we closed cleanly (e.g. Playwright already tore its browser down). Persisted at once. */
  deregister(pid: number): void {
    if (this.byPid.delete(pid)) this.flush();
  }

  /** A snapshot of what we currently own. */
  snapshot(): OwnedProcessRecord[] {
    return [...this.byPid.values()];
  }

  /**
   * Terminate everything we own, by exact pid/process-group. Returns a sanitized tally (counts only, never
   * pids). After signalling, the in-memory set and the persisted file are cleared — we no longer own them.
   */
  terminateAll(mode: TerminateMode = "graceful"): Record<TerminateOutcome, number> {
    const tally = this.reapRecords(this.snapshot(), mode);
    this.byPid.clear();
    this.store.remove();
    return tally;
  }

  /**
   * Reap an EXTERNALLY-supplied record set (a crashed prior run's file), by exact pid only. Used on
   * crash-takeover: the recovering instance kills the dead run's still-alive orphans without ever owning them
   * itself. Returns the same sanitized tally.
   *
   * **Liveness-gated to bound PID reuse.** A recorded pid that is no longer alive is skipped (counted
   * `not_found`), never signalled — so a crashed run's browser that already self-terminated (the common
   * case: Playwright's persistent Chrome exits when the driver pipe closes) is never re-signalled, and the
   * window in which a recycled pid could be hit shrinks to "an orphan is STILL alive AND its exact pid was
   * already reused", which the persisted-across-crash records could otherwise widen. Start-time verification
   * would close it fully and is a documented further hardening.
   */
  reapRecords(records: readonly OwnedProcessRecord[], mode: TerminateMode = "force"): Record<TerminateOutcome, number> {
    const tally: Record<TerminateOutcome, number> = { signaled: 0, not_found: 0, error: 0 };
    for (const record of records) {
      if (!this.isAlive(record.pid)) {
        tally.not_found += 1;
        continue;
      }
      tally[this.killer.terminate(record, mode)] += 1;
    }
    return tally;
  }

  private flush(): void {
    this.store.write(JSON.stringify(this.snapshot()));
  }
}
