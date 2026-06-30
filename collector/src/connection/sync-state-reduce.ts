/**
 * Pure reducer for the multi-channel Connector Sync State.
 *
 * `applySyncOutcome` returns a NEW `ConnectorSyncState` from a completed sync
 * outcome. **Pure function only** — no I/O, no persistence, no DB, no API, no
 * worker, no scheduler, no `manualSync`, no browser, no status write. It never
 * mutates its input; `now` is an explicit argument so the result is deterministic.
 *
 * It encodes the design-note state-transition rules (`docs/connector-sync-state-model.md`
 * §5 interplay + §7 worker contract) at the data layer only — it does NOT run a
 * worker, it computes "given this finished outcome, what is the next state":
 *  - Every actual run attempt advances `lastSyncAttemptAt`.
 *  - Only `SUCCEEDED` advances `lastSuccessfulSyncAt` (the report snapshot anchor);
 *    a `FAILED`/`PARTIAL`/auth/paused outcome NEVER overwrites it.
 *  - Error outcomes record `lastErrorCategory` + `lastErrorAt`; success clears them.
 *  - `nextSyncAt` is re-derived from internal cadence — never the report schedule.
 *
 * After the core transition, the derived fields (`reconnectRequired`, `nextSyncAt`,
 * `dataFreshnessLevel`, `staleDataWarning`) are recomputed via
 * `deriveConnectorDashboardState`, so the stored state stays consistent with — and
 * idempotent under — the derivation helpers.
 */

import {
  DEFAULT_FRESHNESS_POLICY,
  deriveConnectorDashboardState,
  epochMsToIsoUtc,
  toEpochMs,
  type FreshnessPolicy,
} from "./sync-state-derive";
import type { AuthStatus, ConnectorSyncState, SyncErrorCategory } from "./sync-state";

/** The kind of a completed sync attempt (or an intentional pause). */
export type SyncOutcomeKind = "SUCCEEDED" | "FAILED" | "PARTIAL" | "AUTH_RECONNECT_REQUIRED" | "PAUSED";

/** The non-usable auth states an `AUTH_RECONNECT_REQUIRED` outcome may record. */
export type ReconnectAuthStatus = Extract<AuthStatus, "RECONNECT_REQUIRED" | "AUTH_CHALLENGE" | "EXPIRED">;

/** Optional sanitized telemetry on an outcome — booleans/buckets only, NEVER raw data. */
export interface SyncOutcomeMeta {
  /** Coarse row-volume bucket observed during the sync. Sanitized; not persisted to state. */
  rowCountBucket?: "zero" | "one" | "few" | "tens" | "hundreds" | "thousands_plus";
}

/**
 * A completed sync outcome. Carries only sanitized signals: a kind, an optional
 * coarse error category, an optional reconnect auth state, and optional coarse
 * metadata. It holds NO raw marketplace/customer/product/review identifiers, NO
 * file paths, and NO URLs.
 */
export interface SyncOutcome {
  kind: SyncOutcomeKind;
  /** Coarse failure class for FAILED / PARTIAL / AUTH outcomes. */
  errorCategory?: SyncErrorCategory;
  /** For AUTH_RECONNECT_REQUIRED: which non-usable auth state to record (default RECONNECT_REQUIRED). */
  authStatus?: ReconnectAuthStatus;
  /** Optional sanitized metadata; reserved for telemetry, intentionally not stored on state. */
  meta?: SyncOutcomeMeta;
}

function assertNever(_x: never): never {
  throw new Error("applySyncOutcome: unhandled outcome kind");
}

/** Normalize an explicit `now` to a canonical ISO-UTC string; throws if not parse-safe. */
function normalizeNowIso(now: Date | string): string {
  const ms = toEpochMs(now);
  if (ms === null) {
    throw new RangeError("applySyncOutcome: `now` must be a parse-safe ISO offset string or Date");
  }
  return epochMsToIsoUtc(ms);
}

/**
 * Pure reducer: fold a completed `SyncOutcome` into a new `ConnectorSyncState`.
 * Never mutates `state`. See the module header for the transition contract.
 */
export function applySyncOutcome(
  state: ConnectorSyncState,
  outcome: SyncOutcome,
  now: Date | string,
  policy: FreshnessPolicy = DEFAULT_FRESHNESS_POLICY,
): ConnectorSyncState {
  const nowIso = normalizeNowIso(now);

  // 1) Core transition: timestamps + status + auth + error. Derived fields recomputed after.
  let core: ConnectorSyncState;
  switch (outcome.kind) {
    case "SUCCEEDED":
      core = {
        ...state,
        syncStatus: "SUCCEEDED",
        lastSyncAttemptAt: nowIso,
        lastSuccessfulSyncAt: nowIso, // advance the report snapshot anchor
        authStatus: "CONNECTED", // a success implies a usable session
        lastErrorCategory: null, // clear stale error state
        lastErrorAt: null,
      };
      break;
    case "FAILED":
      core = {
        ...state,
        syncStatus: "FAILED",
        lastSyncAttemptAt: nowIso,
        // lastSuccessfulSyncAt deliberately preserved — never overwrite good data
        lastErrorCategory: outcome.errorCategory ?? "UNKNOWN",
        lastErrorAt: nowIso,
      };
      break;
    case "PARTIAL":
      core = {
        ...state,
        syncStatus: "PARTIAL",
        lastSyncAttemptAt: nowIso,
        // snapshot preserved — a partial result does not replace the last good snapshot
        lastErrorCategory: outcome.errorCategory ?? state.lastErrorCategory,
        lastErrorAt: outcome.errorCategory ? nowIso : state.lastErrorAt,
      };
      break;
    case "AUTH_RECONNECT_REQUIRED":
      core = {
        ...state,
        syncStatus: "PAUSED", // cannot sync until the human re-authenticates
        lastSyncAttemptAt: nowIso, // an attempt was made and hit an auth wall
        authStatus: outcome.authStatus ?? "RECONNECT_REQUIRED",
        lastErrorCategory: outcome.errorCategory ?? "AUTH",
        lastErrorAt: nowIso,
        // snapshot preserved
      };
      break;
    case "PAUSED":
      core = {
        ...state,
        syncStatus: "PAUSED",
        // No run happened: do NOT advance attempt/success, do NOT fabricate an error.
      };
      break;
    default:
      return assertNever(outcome.kind);
  }

  // 2) Recompute derived fields so stored state matches the derivation helpers.
  const view = deriveConnectorDashboardState(core, now, policy);
  return {
    ...core,
    reconnectRequired: view.reconnectRequired,
    nextSyncAt: view.nextSyncAt,
    dataFreshnessLevel: view.dataFreshnessLevel,
    staleDataWarning: view.staleDataWarning,
  };
}
