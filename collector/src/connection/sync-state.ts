/**
 * Multi-channel **Connector Sync State** — shared types only.
 *
 * Channel-agnostic sync state for NAVER, ESM+, Cafe24, and future commerce
 * channels. This module is **pure types only** — no I/O, no runtime sync logic,
 * no worker, no scheduler, no DB entity, no backend. It is the type-level
 * translation of `docs/connector-sync-state-model.md`; read that note for the
 * product rationale these types encode.
 *
 * It sits ABOVE the run-level `CollectorState` (`../status.ts`, one export
 * attempt) and BESIDE the per-store `CollectorConnection` (`./types.ts`, the
 * binding/auth identity), unifying both into one durable per-(channel × account)
 * record. It does not re-implement either; it reads their outcomes.
 *
 * CORE DESIGN RULE (preserved here as the contract these types serve):
 *  - **Internal sync cadence is system-controlled** — the worker decides WHEN to
 *    refresh stored data (`internalSyncCadenceMin` → `nextSyncAt`), e.g. ~2h for
 *    browser-export channels (TTL-bounded by the keep-open probe).
 *  - **User report schedule is user-controlled** (`userReportSchedule`) — it
 *    decides when the user is SHOWN a report, independently of syncing.
 *  - **Report time is NOT export/download time.** `nextSyncAt` is never derived
 *    from `userReportSchedule`, and the report's snapshot anchor is
 *    `lastSuccessfulSyncAt`, never the moment a download fired.
 *  - **Reports read from the latest SUCCESSFUL snapshot.** A failed/partial sync
 *    updates only the attempt/error fields and leaves `lastSuccessfulSyncAt`
 *    pinned to the last good data — never overwriting good data with a failure.
 *
 * Privacy invariant (inherited from the connection layer): identity is NEVER
 * stored raw. The account/store reference carries only a one-way fingerprint
 * *hash* + a coarse source *category*.
 */

import type { FingerprintSourceCategory } from "./types";

/**
 * The commerce channel a sync record belongs to. Channel-level (not
 * platform-level): the connection layer's `Platform` is finer-grained
 * (`NAVER_SMARTSTORE`); this is the seller-facing channel a dashboard groups by.
 * New channels extend this union; the rest of the model is unchanged by adding one.
 */
export type CommerceChannel = "NAVER" | "ESM" | "CAFE24";

/**
 * How a channel's data is reached. The state shape is identical regardless of
 * which is active — only the connector type and cadence policy differ. Fallback
 * order (most automatic → least): API → BROWSER_EXPORT → MANUAL_UPLOAD →
 * EMAIL_REPORT (future) → NONE. Records the *currently active* connector only.
 */
export type ConnectorType =
  | "API"
  | "BROWSER_EXPORT"
  | "MANUAL_UPLOAD"
  | "EMAIL_REPORT"
  | "NONE";

/**
 * Discovery posture of a channel's data path (honest, not binary). ESM+ REVIEW is
 * `NEEDS_DISCOVERY` today; a wired-but-unproven wire shape is `NEEDS_VERIFICATION`;
 * `CONFIRMED` needs a proven end-to-end path; `DEGRADED` = works but reduced (e.g.
 * on browser-export fallback after API loss); `DISABLED` = intentionally off.
 */
export type CapabilityStatus =
  | "NEEDS_DISCOVERY"
  | "NEEDS_VERIFICATION"
  | "CONFIRMED"
  | "DEGRADED"
  | "DISABLED";

/**
 * Session/credential health — the channel-agnostic generalization of NAVER's
 * 5-state session verdict. `RECONNECT_REQUIRED`/`AUTH_CHALLENGE`/`EXPIRED` each
 * make a sync attempt pointless; `UNKNOWN` is the pre-first-contact state.
 */
export type AuthStatus =
  | "CONNECTED"
  | "RECONNECT_REQUIRED"
  | "AUTH_CHALLENGE"
  | "EXPIRED"
  | "UNKNOWN";

/**
 * Lifecycle of a single sync cycle. `PARTIAL` = some data refreshed but not all;
 * `PAUSED` = the worker is intentionally not scheduling (usually unusable auth or
 * a `NONE`/`DISABLED` connector). Only `SUCCEEDED` advances the snapshot anchor.
 */
export type SyncStatus =
  | "IDLE"
  | "SCHEDULED"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "PARTIAL"
  | "PAUSED";

/**
 * Coarse class of a sync failure. Unifies the existing run/export/ingest/transport
 * error vocabularies: `EXPORT_LAYOUT_CHANGED`/`DOWNLOAD_FAILED` (browser-export),
 * `SCHEMA_CHANGED`/`PARSE_FAILED` (ingest), `RATE_LIMITED` (ESM+ 429), and the
 * cross-cutting `AUTH`/`NETWORK`/`PERMISSION`/`UNKNOWN`.
 */
export type SyncErrorCategory =
  | "AUTH"
  | "NETWORK"
  | "EXPORT_LAYOUT_CHANGED"
  | "DOWNLOAD_FAILED"
  | "SCHEMA_CHANGED"
  | "PARSE_FAILED"
  | "RATE_LIMITED"
  | "PERMISSION"
  | "UNKNOWN";

/**
 * Coarse freshness of the latest successful snapshot — a derived bucket, never a
 * raw elapsed duration. Derived from `lastSuccessfulSyncAt` vs. a channel
 * freshness threshold (typically a small multiple of `internalSyncCadenceMin`).
 */
export type DataFreshnessLevel = "FRESH" | "RECENT" | "STALE" | "UNKNOWN";

/**
 * Sanitized, hash-safe reference to the bound account/store. Carries NO raw
 * store/account identity — only the connection id, a one-way fingerprint hash,
 * and a coarse source category (reused from the connection layer's convention).
 */
export interface SanitizedAccountRef {
  /** The owning SellerOps ↔ channel connection id. */
  connectionId: string;
  /** One-way hash of the bound store identity; null until binding completes. */
  boundStoreFingerprintHash: string | null;
  /** Coarse category of what the fingerprint was derived from; null until bound. */
  fingerprintSourceCategory: FingerprintSourceCategory | null;
}

/**
 * User-controlled report cadence — independent of `internalSyncCadenceMin`. The
 * exact grammar is provisional (see `docs/connector-sync-state-model.md` §10);
 * this models the shape only. A report always renders from the latest SUCCESSFUL
 * snapshot, so this never drives `nextSyncAt`.
 */
export type ReportSchedulePreset = "ON_DEMAND" | "DAILY" | "WEEKLY";

export interface UserReportSchedule {
  /** Coarse preset the user picked. */
  preset: ReportSchedulePreset;
}

/**
 * One durable sync record per (channel × account/store). Field set mirrors
 * `docs/connector-sync-state-model.md` §4. Timestamps are ISO-8601 strings
 * (nullable until first occurrence), consistent with `CollectorConnection`.
 *
 * Cadence vs. report-schedule separation is structural here: `internalSyncCadenceMin`
 * + `nextSyncAt` are the SYSTEM's; `userReportSchedule` is the USER's; the report
 * snapshot anchor is `lastSuccessfulSyncAt` — kept distinct from `lastSyncAttemptAt`
 * so a failed attempt never disturbs the last good snapshot.
 */
export interface ConnectorSyncState {
  /** The commerce channel this record belongs to. */
  channel: CommerceChannel;
  /** Currently active connector mechanism (records active one, not the fallback chain). */
  connectorType: ConnectorType;
  /** Hash-safe account/store reference — never raw identity/PII. */
  accountRef: SanitizedAccountRef;
  /** Discovery posture of this channel's data path. */
  capabilityStatus: CapabilityStatus;
  /** Session/credential health. */
  authStatus: AuthStatus;
  /** Lifecycle state of the current/last sync. */
  syncStatus: SyncStatus;
  /** ISO time the worker last *attempted* a sync (success or not); null if never. */
  lastSyncAttemptAt: string | null;
  /** ISO time data was last *successfully* refreshed — the report snapshot anchor. */
  lastSuccessfulSyncAt: string | null;
  /** ISO time of the next scheduled attempt, computed from INTERNAL cadence; null if unscheduled. */
  nextSyncAt: string | null;
  /** System-controlled cadence in minutes (e.g. ~120 for browser-export). */
  internalSyncCadenceMin: number;
  /** User-controlled report cadence — independent of sync cadence. */
  userReportSchedule: UserReportSchedule;
  /** A human must re-authenticate before sync can resume. */
  reconnectRequired: boolean;
  /** Coarse class of the most recent failure; null if none. */
  lastErrorCategory: SyncErrorCategory | null;
  /** ISO time of that failure; null if none. */
  lastErrorAt: string | null;
  /** Derived: the latest snapshot is older than this channel's freshness threshold. */
  staleDataWarning: boolean;
  /** Derived coarse freshness bucket of the latest successful snapshot. */
  dataFreshnessLevel: DataFreshnessLevel;
}
