/**
 * Pure **worker-session lifecycle** state machine for the ESM+ REVIEW
 * persistent-session scheduled beta (M-Sync-1.5A).
 *
 * This is the NEW runtime-lifecycle axis described in `docs` / the M-Sync-1.5
 * plan §2 — the state of the long-lived server worker + its held-open browser
 * context. It sits ABOVE, and is deliberately SEPARATE from, the operational
 * `ConnectorSyncState` axis (`../connection/sync-state.ts`): a running worker is
 * NOT a CONFIRMED capability, and no transition here ever touches
 * `CapabilityStatus` / `schemaMappingConfirmed` / `dedupKeyConfirmed`.
 *
 * **Pure only** — no I/O, no persistence, no timers, no browser, no Playwright,
 * no scheduler, no upload. Every function is a deterministic reducer over plain
 * structured inputs, so the whole lifecycle is offline-unit-testable with zero
 * browser (M-Sync-1.5A ships primitives only; the fake-runtime orchestration is
 * 1.5B and the live worker is 1.5C/1.5D).
 *
 * Key invariants encoded here (plan §3):
 *  - A process/context/server restart is NEVER treated as session-restoration
 *    success: `RESTART` always returns to `STARTING`, and `READY` is reachable
 *    only via a fresh `INSPECTED` verdict of `LOGGED_IN`.
 *  - A scheduled sync (`SYNC_STARTED`) is reachable ONLY from `READY` — never
 *    directly from `RECONNECT_REQUIRED`/`PAUSED`/`STARTING`.
 *  - `DELETE_FAILED` is a hard stop: the only ways out are an explicit `STOP`
 *    or a `RESTART` (operator intervention), never a silent next cycle.
 */

import type { SyncErrorCategory } from "../connection/sync-state";

/**
 * The runtime lifecycle state of one account's persistent worker. Distinct from
 * the operational `SyncStatus` / `AuthStatus` axes — see `operationalHintFor`.
 */
export type WorkerSessionState =
  | "STARTING"
  | "RECONNECT_REQUIRED"
  | "READY"
  | "SYNCING"
  | "SUCCESS"
  | "DEGRADED"
  | "UI_CHANGED"
  | "DOWNLOAD_FAILED"
  | "UPLOAD_FAILED"
  | "DELETE_FAILED"
  | "PAUSED"
  | "STOPPED";

/** Result of the no-click session inspection (plan §3). Never carries DOM/URL/HTML. */
export type InspectionVerdict = "LOGGED_IN" | "NOT_LOGGED_IN";

/**
 * The sanitized events that drive the worker lifecycle. Each carries only a kind
 * (plus, for the inspection event, a coarse verdict) — never raw page content.
 */
export type WorkerEvent =
  /** A no-click session inspection completed with the given verdict. */
  | { kind: "INSPECTED"; verdict: InspectionVerdict }
  /** The scheduler dispatched a cycle into the held-open context. */
  | { kind: "SYNC_STARTED" }
  /** A cycle ingested rows (honest backend result). */
  | { kind: "SYNC_SUCCEEDED" }
  /** Actionable-count ≠ 1 or a candidate-signature mismatch — no click was fired. */
  | { kind: "SYNC_UI_CHANGED" }
  /** The single click fired but the download did not arrive. */
  | { kind: "SYNC_DOWNLOAD_FAILED" }
  /** A validated file failed the backend upload (`uploaded:false`). */
  | { kind: "SYNC_UPLOAD_FAILED" }
  /** The quarantine file could not be deleted — hard stop. */
  | { kind: "SYNC_DELETE_FAILED" }
  /** The session dropped mid-cycle; a human must re-authenticate. */
  | { kind: "SYNC_AUTH_LOST" }
  /** Repeated soft failures crossed the degrade threshold (still alive). */
  | { kind: "DEGRADE" }
  /** Operator (or unusable auth) intentionally halts scheduling. */
  | { kind: "PAUSE" }
  /** Process/context/server restart — forces a fresh no-click inspection. */
  | { kind: "RESTART" }
  /** Explicit shutdown (close context). Terminal. */
  | { kind: "STOP" };

/** The outcome of applying one event: the next state, and whether the event was legal here. */
export interface WorkerTransition {
  next: WorkerSessionState;
  /** False when `event` is illegal from `state` — then `next === state` (a safe no-op). */
  accepted: boolean;
}

/**
 * Terminal states from which a completed cycle returns to await the next tick.
 * A cycle that ended in one of these (except the hard stop) can re-enter `READY`
 * via a fresh `INSPECTED: LOGGED_IN` — never by assuming the session held.
 */
const POST_CYCLE_STATES: ReadonlySet<WorkerSessionState> = new Set([
  "SUCCESS",
  "UI_CHANGED",
  "DOWNLOAD_FAILED",
  "UPLOAD_FAILED",
  "DEGRADED",
]);

/**
 * Pure reducer: given the current lifecycle state and a sanitized event, return
 * the next state. An illegal transition is a SAFE NO-OP (`accepted:false`,
 * `next === state`) rather than a throw — a long-lived worker must never crash on
 * an unexpected event. Restart/reconnect invariants (plan §3) are enforced here.
 */
export function reduceWorkerSession(state: WorkerSessionState, event: WorkerEvent): WorkerTransition {
  // `STOP` and `RESTART` are always legal (except from the terminal `STOPPED`) and
  // dominate every other transition — a crash/restart can arrive at any moment.
  if (state !== "STOPPED") {
    if (event.kind === "STOP") return accept("STOPPED");
    if (event.kind === "RESTART") return accept("STARTING");
  }

  switch (state) {
    case "STARTING":
      // Boot: the ONLY exit is a no-click inspection verdict. No sync before READY.
      if (event.kind === "INSPECTED") {
        return accept(event.verdict === "LOGGED_IN" ? "READY" : "RECONNECT_REQUIRED");
      }
      if (event.kind === "PAUSE") return accept("PAUSED");
      return reject(state);

    case "RECONNECT_REQUIRED":
      // Held until a human re-authenticates AND a fresh inspection passes.
      if (event.kind === "INSPECTED") {
        return accept(event.verdict === "LOGGED_IN" ? "READY" : "RECONNECT_REQUIRED");
      }
      if (event.kind === "PAUSE") return accept("PAUSED");
      return reject(state);

    case "READY":
      // The ONLY state from which a scheduled cycle may begin.
      if (event.kind === "SYNC_STARTED") return accept("SYNCING");
      if (event.kind === "INSPECTED") {
        return accept(event.verdict === "LOGGED_IN" ? "READY" : "RECONNECT_REQUIRED");
      }
      if (event.kind === "PAUSE") return accept("PAUSED");
      if (event.kind === "DEGRADE") return accept("DEGRADED");
      return reject(state);

    case "SYNCING":
      switch (event.kind) {
        case "SYNC_SUCCEEDED":
          return accept("SUCCESS");
        case "SYNC_UI_CHANGED":
          return accept("UI_CHANGED");
        case "SYNC_DOWNLOAD_FAILED":
          return accept("DOWNLOAD_FAILED");
        case "SYNC_UPLOAD_FAILED":
          return accept("UPLOAD_FAILED");
        case "SYNC_DELETE_FAILED":
          return accept("DELETE_FAILED"); // hard stop
        case "SYNC_AUTH_LOST":
          return accept("RECONNECT_REQUIRED");
        default:
          return reject(state);
      }

    case "SUCCESS":
    case "UI_CHANGED":
    case "DOWNLOAD_FAILED":
    case "UPLOAD_FAILED":
    case "DEGRADED":
      // A completed cycle awaits the next tick. Re-arming REQUIRES a fresh
      // inspection — the session is never assumed to have held.
      if (event.kind === "INSPECTED") {
        return accept(event.verdict === "LOGGED_IN" ? "READY" : "RECONNECT_REQUIRED");
      }
      if (event.kind === "DEGRADE") return accept("DEGRADED");
      if (event.kind === "PAUSE") return accept("PAUSED");
      return reject(state);

    case "DELETE_FAILED":
      // Hard stop: no INSPECTED re-arm. Only STOP / RESTART (handled above) escape.
      if (event.kind === "PAUSE") return accept("PAUSED");
      return reject(state);

    case "PAUSED":
      // Resume only through a fresh inspection.
      if (event.kind === "INSPECTED") {
        return accept(event.verdict === "LOGGED_IN" ? "READY" : "RECONNECT_REQUIRED");
      }
      return reject(state);

    case "STOPPED":
      // Terminal. A brand-new worker process starts fresh at STARTING, not from here.
      return reject(state);

    default:
      return assertNever(state);
  }

  function accept(next: WorkerSessionState): WorkerTransition {
    return { next, accepted: true };
  }
}

function reject(state: WorkerSessionState): WorkerTransition {
  return { next: state, accepted: false };
}

function assertNever(_x: never): never {
  throw new Error("reduceWorkerSession: unhandled state");
}

// ── Restart / reconnect policy (pure helpers) ────────────────────────────────────────────────────

/** Map a fresh no-click inspection verdict to the state it authorizes. */
export function stateFromInspection(verdict: InspectionVerdict): Extract<WorkerSessionState, "READY" | "RECONNECT_REQUIRED"> {
  return verdict === "LOGGED_IN" ? "READY" : "RECONNECT_REQUIRED";
}

/** A scheduled sync may begin ONLY from `READY` — the single gate the timer consults. */
export function mayScheduleSync(state: WorkerSessionState): boolean {
  return state === "READY";
}

/** True once a cycle has completed and the worker is awaiting the next tick (needs re-inspection). */
export function isPostCycle(state: WorkerSessionState): boolean {
  return POST_CYCLE_STATES.has(state);
}

// ── Operational-axis bridge (pure mapping only; NO applySyncOutcome call here) ────────────────────

/** The kind of `SyncOutcome` a finished worker state implies, for the 1.5B applySyncOutcome bridge. */
export type WorkerSyncOutcomeKind = "SUCCEEDED" | "FAILED" | "PARTIAL" | "AUTH_RECONNECT_REQUIRED" | "PAUSED";

/**
 * A finished worker state's operational hint — the sanitized inputs 1.5B will feed
 * to `applySyncOutcome`. Returns `null` for in-flight/boot states that imply no
 * operational transition. **Deliberately carries NO `CapabilityStatus`**: worker
 * health (incl. `DEGRADED`) must never move capability verification (plan §10).
 */
export function operationalHintFor(
  state: WorkerSessionState,
): { kind: WorkerSyncOutcomeKind; errorCategory?: SyncErrorCategory } | null {
  switch (state) {
    case "SUCCESS":
      return { kind: "SUCCEEDED" };
    case "UI_CHANGED":
      return { kind: "FAILED", errorCategory: "EXPORT_LAYOUT_CHANGED" };
    case "DOWNLOAD_FAILED":
      return { kind: "FAILED", errorCategory: "DOWNLOAD_FAILED" };
    case "UPLOAD_FAILED":
      return { kind: "FAILED", errorCategory: "NETWORK" };
    case "DELETE_FAILED":
      return { kind: "FAILED", errorCategory: "UNKNOWN" };
    case "DEGRADED":
      // Operational health only — a soft-failure streak. Reported as PARTIAL so the
      // last good snapshot is preserved; NEVER a capability change.
      return { kind: "PARTIAL" };
    case "RECONNECT_REQUIRED":
      return { kind: "AUTH_RECONNECT_REQUIRED" };
    case "PAUSED":
      return { kind: "PAUSED" };
    case "STARTING":
    case "READY":
    case "SYNCING":
    case "STOPPED":
      return null;
    default:
      return assertNever(state);
  }
}
