import { describe, expect, it } from "vitest";
import type {
  AuthStatus,
  CapabilityStatus,
  CommerceChannel,
  ConnectorSyncState,
  ConnectorType,
  DataFreshnessLevel,
  SanitizedAccountRef,
  SyncErrorCategory,
  SyncStatus,
  UserReportSchedule,
} from "../../src/connection/sync-state";

/**
 * Type-only sketch — `src/connection/sync-state.ts` has no runtime exports, so
 * these are compile-time assertions wrapped in trivial runtime checks. They
 * import the types and construct typed literals; if a union member or field
 * name/shape drifts from `docs/connector-sync-state-model.md`, this file fails
 * to typecheck. No sync logic, no I/O, no behavior is exercised.
 */

// Exhaustive literal lists — typed so a removed/renamed union member is a compile error.
const CHANNELS: readonly CommerceChannel[] = ["NAVER", "ESM", "CAFE24"];
const CONNECTOR_TYPES: readonly ConnectorType[] = [
  "API",
  "BROWSER_EXPORT",
  "MANUAL_UPLOAD",
  "EMAIL_REPORT",
  "NONE",
];
const CAPABILITY_STATUSES: readonly CapabilityStatus[] = [
  "NEEDS_DISCOVERY",
  "NEEDS_VERIFICATION",
  "CONFIRMED",
  "DEGRADED",
  "DISABLED",
];
const AUTH_STATUSES: readonly AuthStatus[] = [
  "CONNECTED",
  "RECONNECT_REQUIRED",
  "AUTH_CHALLENGE",
  "EXPIRED",
  "UNKNOWN",
];
const SYNC_STATUSES: readonly SyncStatus[] = [
  "IDLE",
  "SCHEDULED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "PARTIAL",
  "PAUSED",
];
const ERROR_CATEGORIES: readonly SyncErrorCategory[] = [
  "AUTH",
  "NETWORK",
  "EXPORT_LAYOUT_CHANGED",
  "DOWNLOAD_FAILED",
  "SCHEMA_CHANGED",
  "PARSE_FAILED",
  "RATE_LIMITED",
  "PERMISSION",
  "UNKNOWN",
];
const FRESHNESS_LEVELS: readonly DataFreshnessLevel[] = ["FRESH", "RECENT", "STALE", "UNKNOWN"];

describe("connector sync-state types", () => {
  it("enumerates each union with the design-note members", () => {
    expect(CHANNELS).toHaveLength(3);
    expect(CONNECTOR_TYPES).toHaveLength(5);
    expect(CAPABILITY_STATUSES).toHaveLength(5);
    expect(AUTH_STATUSES).toHaveLength(5);
    expect(SYNC_STATUSES).toHaveLength(7);
    expect(ERROR_CATEGORIES).toHaveLength(9);
    expect(FRESHNESS_LEVELS).toHaveLength(4);
  });

  it("constructs a hash-safe account reference (no raw identity fields)", () => {
    const ref: SanitizedAccountRef = {
      connectionId: "conn-1",
      boundStoreFingerprintHash: "0123456789abcdef",
      fingerprintSourceCategory: "commerce-id",
    };
    // Only the three sanitized reference keys exist — no raw store/account/name field.
    expect(Object.keys(ref).sort()).toEqual([
      "boundStoreFingerprintHash",
      "connectionId",
      "fingerprintSourceCategory",
    ]);
  });

  it("constructs a full ConnectorSyncState mirroring the design-note field set", () => {
    const schedule: UserReportSchedule = { preset: "WEEKLY" };
    const state: ConnectorSyncState = {
      channel: "ESM",
      connectorType: "BROWSER_EXPORT",
      accountRef: {
        connectionId: "conn-esm-1",
        boundStoreFingerprintHash: null,
        fingerprintSourceCategory: null,
      },
      capabilityStatus: "NEEDS_DISCOVERY",
      authStatus: "CONNECTED",
      syncStatus: "IDLE",
      lastSyncAttemptAt: null,
      lastSuccessfulSyncAt: null,
      nextSyncAt: null,
      internalSyncCadenceMin: 120,
      userReportSchedule: schedule,
      reconnectRequired: false,
      lastErrorCategory: null,
      lastErrorAt: null,
      staleDataWarning: false,
      dataFreshnessLevel: "UNKNOWN",
    };

    expect(Object.keys(state).sort()).toEqual(
      [
        "channel",
        "connectorType",
        "accountRef",
        "capabilityStatus",
        "authStatus",
        "syncStatus",
        "lastSyncAttemptAt",
        "lastSuccessfulSyncAt",
        "nextSyncAt",
        "internalSyncCadenceMin",
        "userReportSchedule",
        "reconnectRequired",
        "lastErrorCategory",
        "lastErrorAt",
        "staleDataWarning",
        "dataFreshnessLevel",
      ].sort(),
    );
  });

  it("models the cadence-vs-report separation as distinct fields", () => {
    // System-controlled cadence and user-controlled report schedule are separate
    // fields; the snapshot anchor (lastSuccessfulSyncAt) is distinct from the
    // attempt timestamp (lastSyncAttemptAt). Type-level proof: the literal below
    // sets a failed attempt without disturbing a prior successful snapshot.
    const afterFailedSync: ConnectorSyncState = {
      channel: "NAVER",
      connectorType: "BROWSER_EXPORT",
      accountRef: { connectionId: "c", boundStoreFingerprintHash: null, fingerprintSourceCategory: null },
      capabilityStatus: "CONFIRMED",
      authStatus: "CONNECTED",
      syncStatus: "FAILED",
      lastSyncAttemptAt: "2026-06-30T08:00:00.000Z",
      lastSuccessfulSyncAt: "2026-06-30T06:00:00.000Z", // last good snapshot, untouched by the failure
      nextSyncAt: "2026-06-30T08:00:00.000Z", // from internal cadence, not the report schedule
      internalSyncCadenceMin: 120,
      userReportSchedule: { preset: "DAILY" },
      reconnectRequired: false,
      lastErrorCategory: "DOWNLOAD_FAILED",
      lastErrorAt: "2026-06-30T08:00:00.000Z",
      staleDataWarning: false,
      dataFreshnessLevel: "RECENT",
    };
    expect(afterFailedSync.lastSuccessfulSyncAt).not.toEqual(afterFailedSync.lastSyncAttemptAt);
  });
});
