/**
 * Pure derivation helpers for the multi-channel Connector Sync State.
 *
 * These translate a stored `ConnectorSyncState` into the derived dashboard /
 * scheduling fields described in `docs/connector-sync-state-model.md` §6–§7.
 * **Pure functions only** — no I/O, no DB, no API, no scheduler, no worker, no
 * `manualSync`, no browser, no status write. Nothing here starts or owns a timer;
 * `now` is always an explicit caller argument, so every result is deterministic.
 *
 * DESIGN RULES enforced structurally here:
 *  - **Internal cadence drives `nextSyncAt`, never the report schedule.**
 *    `deriveNextSyncAt` accepts only `internalSyncCadenceMin` + the last
 *    attempt/success timestamps — `userReportSchedule` is not even a parameter, so
 *    it CANNOT influence the next sync time. Report time ≠ export/download time.
 *  - **Failed attempts never overwrite the successful snapshot.** These helpers
 *    are read-only and never mutate the input; `lastSuccessfulSyncAt` is treated
 *    as the immutable report anchor.
 *  - **No wall-clock reads / no `Date.*` parsing.** Timestamps are converted with
 *    the sanctioned offset parser (`parseOffsetTimestampToEpochMs`, manual
 *    arithmetic); formatting back to ISO uses a manual UTC formatter below. A
 *    `Date` passed as `now` is read via `.getTime()` only (deterministic, not a
 *    wall-clock read) — the helpers never call `Date.now()`.
 */

import { parseOffsetTimestampToEpochMs } from "../events/offset-timestamp-parser";
import type {
  AuthStatus,
  ConnectorSyncState,
  DataFreshnessLevel,
  SyncErrorCategory,
} from "./sync-state";

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Convert an explicit `now` (ISO offset-bearing string or `Date`) to epoch ms, or
 * `null` when it is not parse-safe (e.g. a timezone-less string, an invalid Date).
 * A `Date` is read via `.getTime()` only — no wall-clock read, no `Date.now()`.
 */
export function toEpochMs(value: Date | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  return parseOffsetTimestampToEpochMs(value);
}

function pad(n: number, width: number): string {
  const s = Math.abs(n).toString();
  return s.length >= width ? s : "0".repeat(width - s.length) + s;
}

/**
 * Deterministic epoch-ms → ISO-8601 UTC string (`YYYY-MM-DDTHH:mm:ss.SSSZ`) using
 * manual civil-date arithmetic (Howard Hinnant's algorithm) — **no `Date.*` API**.
 * Inverse of `parseOffsetTimestampToEpochMs` for the `Z` offset.
 */
export function epochMsToIsoUtc(ms: number): string {
  const total = Math.trunc(ms);
  const dayCount = Math.floor(total / DAY_MS);
  let rem = total - dayCount * DAY_MS; // 0 ≤ rem < DAY_MS (floor division)
  const hours = Math.floor(rem / HOUR_MS);
  rem -= hours * HOUR_MS;
  const minutes = Math.floor(rem / MINUTE_MS);
  rem -= minutes * MINUTE_MS;
  const seconds = Math.floor(rem / SECOND_MS);
  const millis = rem - seconds * SECOND_MS;

  // Civil date from days since the Unix epoch, shifting the era to 0000-03-01.
  const z = dayCount + 719468;
  const era = Math.floor((z >= 0 ? z : z - 146096) / 146097);
  const doe = z - era * 146097; // [0, 146096]
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100)); // [0, 365]
  const mp = Math.floor((5 * doy + 2) / 153); // [0, 11]
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1; // [1, 31]
  const month = mp < 10 ? mp + 3 : mp - 9; // [1, 12]
  const year = month <= 2 ? y + 1 : y;

  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}T${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}.${pad(millis, 3)}Z`;
}

/** Inputs that determine the next sync time. Deliberately excludes `userReportSchedule`. */
export type NextSyncInput = Pick<
  ConnectorSyncState,
  "lastSyncAttemptAt" | "lastSuccessfulSyncAt" | "internalSyncCadenceMin"
>;

/**
 * Derive the next INTERNAL sync time as an ISO-UTC string, or `null` when it cannot
 * be scheduled (non-positive cadence, or no parse-safe anchor and no parse-safe
 * `now`). The anchor is the last *attempt* (cadence counts from when we last tried),
 * falling back to the last *success*, then to `now`. **Never uses the report
 * schedule** — it is not a parameter here.
 */
export function deriveNextSyncAt(input: NextSyncInput, now: Date | string): string | null {
  if (!(input.internalSyncCadenceMin > 0)) return null;
  const anchorMs =
    toEpochMs(input.lastSyncAttemptAt) ?? toEpochMs(input.lastSuccessfulSyncAt) ?? toEpochMs(now);
  if (anchorMs === null) return null;
  return epochMsToIsoUtc(anchorMs + input.internalSyncCadenceMin * MINUTE_MS);
}

/** Coarse freshness thresholds, as multiples of the internal cadence. */
export interface FreshnessPolicy {
  /** Age ≤ `freshMultiplier` × cadence ⇒ FRESH. */
  freshMultiplier: number;
  /** Age ≤ `staleMultiplier` × cadence ⇒ RECENT; beyond ⇒ STALE. */
  staleMultiplier: number;
}

/** Default: within one cadence window is FRESH; up to three is RECENT; beyond is STALE. */
export const DEFAULT_FRESHNESS_POLICY: FreshnessPolicy = { freshMultiplier: 1, staleMultiplier: 3 };

/** Inputs that determine snapshot freshness. */
export type FreshnessInput = Pick<ConnectorSyncState, "lastSuccessfulSyncAt" | "internalSyncCadenceMin">;

/**
 * Derive the coarse freshness bucket of the latest successful snapshot. Returns
 * `UNKNOWN` when there is no parse-safe successful sync, the cadence is non-positive,
 * `now` is not parse-safe, or the snapshot is in the future (un-reasonable). Never a
 * raw elapsed duration — a bucket only.
 */
export function deriveDataFreshnessLevel(
  input: FreshnessInput,
  now: Date | string,
  policy: FreshnessPolicy = DEFAULT_FRESHNESS_POLICY,
): DataFreshnessLevel {
  const successMs = toEpochMs(input.lastSuccessfulSyncAt);
  const nowMs = toEpochMs(now);
  if (successMs === null || nowMs === null) return "UNKNOWN";
  if (!(input.internalSyncCadenceMin > 0)) return "UNKNOWN";
  const ageMs = nowMs - successMs;
  if (ageMs < 0) return "UNKNOWN"; // snapshot newer than now — cannot reason
  const cadenceMs = input.internalSyncCadenceMin * MINUTE_MS;
  if (ageMs <= policy.freshMultiplier * cadenceMs) return "FRESH";
  if (ageMs <= policy.staleMultiplier * cadenceMs) return "RECENT";
  return "STALE";
}

/** Inputs that determine whether re-authentication is required. */
export type ReconnectInput = Pick<ConnectorSyncState, "authStatus" | "lastErrorCategory">;

const RECONNECT_AUTH_STATES: readonly AuthStatus[] = ["RECONNECT_REQUIRED", "AUTH_CHALLENGE", "EXPIRED"];

/**
 * Derive whether a human must re-authenticate. True when `authStatus` is any
 * non-usable state, or when the session is `UNKNOWN` and the last failure was an
 * auth error. Pure boolean — reads only auth signals.
 */
export function deriveReconnectRequired(input: ReconnectInput): boolean {
  if (RECONNECT_AUTH_STATES.includes(input.authStatus)) return true;
  const authError: SyncErrorCategory = "AUTH";
  return input.authStatus === "UNKNOWN" && input.lastErrorCategory === authError;
}

/** Inputs that determine the stale-data warning. */
export type StaleWarningInput = Pick<
  ConnectorSyncState,
  "lastSuccessfulSyncAt" | "internalSyncCadenceMin" | "authStatus" | "lastErrorCategory"
>;

/**
 * Derive the stale-data warning: true when the latest successful snapshot is `STALE`
 * OR re-authentication is required. Read-only — never touches the successful
 * snapshot state.
 */
export function deriveStaleDataWarning(
  input: StaleWarningInput,
  now: Date | string,
  policy: FreshnessPolicy = DEFAULT_FRESHNESS_POLICY,
): boolean {
  if (deriveReconnectRequired(input)) return true;
  return deriveDataFreshnessLevel(input, now, policy) === "STALE";
}

/** Display-only projection of a sync record with derived fields folded in. */
export interface ConnectorDashboardState {
  channel: ConnectorSyncState["channel"];
  connectorType: ConnectorSyncState["connectorType"];
  capabilityStatus: ConnectorSyncState["capabilityStatus"];
  authStatus: ConnectorSyncState["authStatus"];
  syncStatus: ConnectorSyncState["syncStatus"];
  /** The report snapshot anchor (= `lastSuccessfulSyncAt`), surfaced for display. */
  latestSnapshotAt: string | null;
  lastSuccessfulSyncAt: string | null;
  /** Derived; `null` when the connector cannot currently sync (paused/disabled/none/reconnect). */
  nextSyncAt: string | null;
  reconnectRequired: boolean;
  staleDataWarning: boolean;
  dataFreshnessLevel: DataFreshnessLevel;
  /** User-controlled — passed through for display; does NOT affect `nextSyncAt`. */
  userReportSchedule: ConnectorSyncState["userReportSchedule"];
}

/**
 * Combine a stored state with its derived fields for dashboard display. Pure and
 * non-mutating — returns a fresh object. `nextSyncAt` is suppressed to `null` when
 * the connector cannot currently sync (reconnect required, `NONE` connector, or
 * `DISABLED` capability), mirroring the worker's pause behavior without running it.
 */
export function deriveConnectorDashboardState(
  state: ConnectorSyncState,
  now: Date | string,
  policy: FreshnessPolicy = DEFAULT_FRESHNESS_POLICY,
): ConnectorDashboardState {
  const reconnectRequired = deriveReconnectRequired(state);
  const canSync =
    !reconnectRequired && state.connectorType !== "NONE" && state.capabilityStatus !== "DISABLED";
  return {
    channel: state.channel,
    connectorType: state.connectorType,
    capabilityStatus: state.capabilityStatus,
    authStatus: state.authStatus,
    syncStatus: state.syncStatus,
    latestSnapshotAt: state.lastSuccessfulSyncAt,
    lastSuccessfulSyncAt: state.lastSuccessfulSyncAt,
    nextSyncAt: canSync ? deriveNextSyncAt(state, now) : null,
    reconnectRequired,
    staleDataWarning: deriveStaleDataWarning(state, now, policy),
    dataFreshnessLevel: deriveDataFreshnessLevel(state, now, policy),
    userReportSchedule: state.userReportSchedule,
  };
}
