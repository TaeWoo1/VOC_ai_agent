import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { deriveConnectorDashboardState } from "../../src/connection/sync-state-derive";
import { applySyncOutcome, type SyncOutcome } from "../../src/connection/sync-state-reduce";
import type { ConnectorSyncState } from "../../src/connection/sync-state";

const CADENCE_MIN = 120;
const NOW = "2026-06-30T10:00:00.000Z";
const OLD_SNAPSHOT = "2026-06-30T06:00:00.000Z";

function baseState(overrides: Partial<ConnectorSyncState> = {}): ConnectorSyncState {
  return {
    channel: "ESM",
    connectorType: "BROWSER_EXPORT",
    accountRef: { connectionId: "conn-1", boundStoreFingerprintHash: null, fingerprintSourceCategory: null },
    capabilityStatus: "CONFIRMED",
    authStatus: "CONNECTED",
    syncStatus: "IDLE",
    lastSyncAttemptAt: null,
    lastSuccessfulSyncAt: null,
    nextSyncAt: null,
    internalSyncCadenceMin: CADENCE_MIN,
    userReportSchedule: { preset: "DAILY" },
    reconnectRequired: false,
    lastErrorCategory: null,
    lastErrorAt: null,
    staleDataWarning: false,
    dataFreshnessLevel: "UNKNOWN",
    ...overrides,
  };
}

describe("applySyncOutcome — transitions", () => {
  it("SUCCEEDED advances both attempt and successful-sync timestamps", () => {
    const out = applySyncOutcome(baseState({ lastSuccessfulSyncAt: OLD_SNAPSHOT }), { kind: "SUCCEEDED" }, NOW);
    expect(out.syncStatus).toBe("SUCCEEDED");
    expect(out.lastSyncAttemptAt).toBe(NOW);
    expect(out.lastSuccessfulSyncAt).toBe(NOW);
    expect(out.dataFreshnessLevel).toBe("FRESH");
    // nextSyncAt = attempt + cadence (internal), not the report schedule.
    expect(out.nextSyncAt).toBe("2026-06-30T12:00:00.000Z");
  });

  it("FAILED advances the attempt only and preserves the last successful snapshot", () => {
    const out = applySyncOutcome(
      baseState({ lastSuccessfulSyncAt: OLD_SNAPSHOT }),
      { kind: "FAILED", errorCategory: "DOWNLOAD_FAILED" },
      NOW,
    );
    expect(out.syncStatus).toBe("FAILED");
    expect(out.lastSyncAttemptAt).toBe(NOW);
    expect(out.lastSuccessfulSyncAt).toBe(OLD_SNAPSHOT); // good snapshot retained
    expect(out.lastErrorCategory).toBe("DOWNLOAD_FAILED");
    expect(out.lastErrorAt).toBe(NOW);
  });

  it("FAILED without an explicit category records UNKNOWN", () => {
    const out = applySyncOutcome(baseState(), { kind: "FAILED" }, NOW);
    expect(out.lastErrorCategory).toBe("UNKNOWN");
  });

  it("PARTIAL advances the attempt, keeps the snapshot, and is not a success", () => {
    const out = applySyncOutcome(
      baseState({ lastSuccessfulSyncAt: OLD_SNAPSHOT }),
      { kind: "PARTIAL", errorCategory: "RATE_LIMITED" },
      NOW,
    );
    expect(out.syncStatus).toBe("PARTIAL");
    expect(out.lastSyncAttemptAt).toBe(NOW);
    expect(out.lastSuccessfulSyncAt).toBe(OLD_SNAPSHOT);
    expect(out.lastErrorCategory).toBe("RATE_LIMITED");
  });

  it("AUTH_RECONNECT_REQUIRED sets reconnect/auth and preserves the snapshot", () => {
    const out = applySyncOutcome(
      baseState({ lastSuccessfulSyncAt: OLD_SNAPSHOT }),
      { kind: "AUTH_RECONNECT_REQUIRED", authStatus: "AUTH_CHALLENGE" },
      NOW,
    );
    expect(out.syncStatus).toBe("PAUSED");
    expect(out.authStatus).toBe("AUTH_CHALLENGE");
    expect(out.reconnectRequired).toBe(true);
    expect(out.lastErrorCategory).toBe("AUTH");
    expect(out.lastSuccessfulSyncAt).toBe(OLD_SNAPSHOT); // snapshot retained
    expect(out.nextSyncAt).toBeNull(); // not scheduled while reconnect is required
    expect(out.staleDataWarning).toBe(true);
  });

  it("AUTH_RECONNECT_REQUIRED defaults authStatus to RECONNECT_REQUIRED", () => {
    const out = applySyncOutcome(baseState(), { kind: "AUTH_RECONNECT_REQUIRED" }, NOW);
    expect(out.authStatus).toBe("RECONNECT_REQUIRED");
  });

  it("PAUSED does not mark a success or fabricate an attempt/error", () => {
    const prior = baseState({ lastSuccessfulSyncAt: OLD_SNAPSHOT, lastSyncAttemptAt: OLD_SNAPSHOT });
    const out = applySyncOutcome(prior, { kind: "PAUSED" }, NOW);
    expect(out.syncStatus).toBe("PAUSED");
    expect(out.lastSuccessfulSyncAt).toBe(OLD_SNAPSHOT);
    expect(out.lastSyncAttemptAt).toBe(OLD_SNAPSHOT); // no run happened
    expect(out.lastErrorCategory).toBeNull();
  });

  it("SUCCEEDED clears previous error and reconnect state", () => {
    const broken = baseState({
      authStatus: "EXPIRED",
      reconnectRequired: true,
      lastErrorCategory: "AUTH",
      lastErrorAt: OLD_SNAPSHOT,
      lastSuccessfulSyncAt: OLD_SNAPSHOT,
      syncStatus: "PAUSED",
    });
    const out = applySyncOutcome(broken, { kind: "SUCCEEDED" }, NOW);
    expect(out.authStatus).toBe("CONNECTED");
    expect(out.reconnectRequired).toBe(false);
    expect(out.lastErrorCategory).toBeNull();
    expect(out.lastErrorAt).toBeNull();
    expect(out.staleDataWarning).toBe(false);
  });
});

describe("applySyncOutcome — cadence/report separation & purity", () => {
  it("nextSyncAt is from internal cadence; the report schedule does not change it", () => {
    const daily = applySyncOutcome(baseState({ userReportSchedule: { preset: "DAILY" } }), { kind: "SUCCEEDED" }, NOW);
    const weekly = applySyncOutcome(baseState({ userReportSchedule: { preset: "WEEKLY" } }), { kind: "SUCCEEDED" }, NOW);
    expect(daily.nextSyncAt).toBe("2026-06-30T12:00:00.000Z");
    expect(weekly.nextSyncAt).toBe(daily.nextSyncAt); // report schedule irrelevant to cadence
  });

  it("does not mutate the input state", () => {
    const state = baseState({ lastSuccessfulSyncAt: OLD_SNAPSHOT });
    const snapshot = JSON.stringify(state);
    applySyncOutcome(state, { kind: "FAILED", errorCategory: "NETWORK" }, NOW);
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it("output is consistent with (idempotent under) deriveConnectorDashboardState", () => {
    const out = applySyncOutcome(baseState({ lastSuccessfulSyncAt: OLD_SNAPSHOT }), { kind: "SUCCEEDED" }, NOW);
    const view = deriveConnectorDashboardState(out, NOW);
    expect(view.nextSyncAt).toBe(out.nextSyncAt);
    expect(view.reconnectRequired).toBe(out.reconnectRequired);
    expect(view.dataFreshnessLevel).toBe(out.dataFreshnessLevel);
    expect(view.staleDataWarning).toBe(out.staleDataWarning);
    expect(view.latestSnapshotAt).toBe(out.lastSuccessfulSyncAt);
  });

  it("accepts a Date for now and rejects an unparseable now", () => {
    const out = applySyncOutcome(baseState(), { kind: "SUCCEEDED" }, new Date(0));
    expect(out.lastSuccessfulSyncAt).toBe("1970-01-01T00:00:00.000Z");
    expect(() => applySyncOutcome(baseState(), { kind: "SUCCEEDED" }, "2026-06-30 10:00:00")).toThrow(RangeError);
  });

  it("a sanitized outcome carries no raw identifiers/paths/urls (type-level + shape)", () => {
    const outcome: SyncOutcome = { kind: "PARTIAL", errorCategory: "SCHEMA_CHANGED", meta: { rowCountBucket: "few" } };
    // Only sanitized keys exist on the outcome.
    expect(Object.keys(outcome).sort()).toEqual(["errorCategory", "kind", "meta"]);
    expect(Object.keys(outcome.meta!)).toEqual(["rowCountBucket"]);
  });
});

describe("sync-state-reduce — module purity (no I/O / scheduler / backend / browser)", () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const SRC = join(__dirname, "..", "..", "src", "connection", "sync-state-reduce.ts");
  const code = readFileSync(SRC, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("imports nothing from backend / status / browser / upload / download / scheduler layers", () => {
    const importLines = code.split("\n").filter((l) => /^\s*import\b/.test(l));
    for (const forbidden of [
      "playwright",
      "../status",
      "../upload",
      "review-export",
      "review-download-save",
      "capture-esm-review",
      "node:fs",
      "node:http",
      "child_process",
    ]) {
      expect(importLines.some((l) => l.includes(forbidden))).toBe(false);
    }
  });

  it("contains no timer / scheduler / wall-clock / manualSync / status-write tokens", () => {
    for (const token of [
      "Date.now",
      "Date.parse",
      "Date.UTC",
      "new Date",
      "setInterval",
      "setTimeout",
      "cron",
      "manualSync",
      "scheduler",
      "writeStatus",
      "saveAs",
      "uploadReviewFile",
    ]) {
      expect(code.includes(token)).toBe(false);
    }
  });
});
