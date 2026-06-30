import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseOffsetTimestampToEpochMs } from "../../src/events/offset-timestamp-parser";
import {
  DEFAULT_FRESHNESS_POLICY,
  deriveConnectorDashboardState,
  deriveDataFreshnessLevel,
  deriveNextSyncAt,
  deriveReconnectRequired,
  deriveStaleDataWarning,
  epochMsToIsoUtc,
  toEpochMs,
} from "../../src/connection/sync-state-derive";
import type { AuthStatus, ConnectorSyncState } from "../../src/connection/sync-state";

const CADENCE_MIN = 120; // ~2h browser-export cadence

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

describe("epochMsToIsoUtc / toEpochMs", () => {
  it("round-trips against the sanctioned offset parser", () => {
    for (const iso of [
      "2026-06-30T00:00:00.000Z",
      "2026-06-30T08:15:30.250Z",
      "1970-01-01T00:00:00.000Z",
      "2000-02-29T23:59:59.999Z", // leap day
      "2024-12-31T12:34:56.789Z",
    ]) {
      const ms = parseOffsetTimestampToEpochMs(iso)!;
      expect(epochMsToIsoUtc(ms)).toBe(iso);
    }
  });

  it("reads a Date via getTime and rejects unparseable / timezone-less input", () => {
    expect(toEpochMs(new Date(0))).toBe(0);
    expect(toEpochMs("2026-06-30T00:00:00.000Z")).toBe(parseOffsetTimestampToEpochMs("2026-06-30T00:00:00.000Z"));
    expect(toEpochMs("2026-06-30 00:00:00")).toBeNull(); // timezone-less → unknown
    expect(toEpochMs(null)).toBeNull();
    expect(toEpochMs(new Date(NaN))).toBeNull();
  });
});

describe("deriveNextSyncAt", () => {
  const now = "2026-06-30T10:00:00.000Z";

  it("uses internal cadence from the last attempt, NOT the report schedule", () => {
    const state = baseState({
      lastSyncAttemptAt: "2026-06-30T08:00:00.000Z",
      lastSuccessfulSyncAt: "2026-06-30T06:00:00.000Z",
      userReportSchedule: { preset: "WEEKLY" },
    });
    // 08:00 + 120min = 10:00 — derived purely from cadence + last attempt.
    expect(deriveNextSyncAt(state, now)).toBe("2026-06-30T10:00:00.000Z");
  });

  it("changing the report schedule does not change nextSyncAt", () => {
    const a = baseState({ lastSyncAttemptAt: "2026-06-30T08:00:00.000Z", userReportSchedule: { preset: "DAILY" } });
    const b = baseState({ lastSyncAttemptAt: "2026-06-30T08:00:00.000Z", userReportSchedule: { preset: "WEEKLY" } });
    expect(deriveNextSyncAt(a, now)).toBe(deriveNextSyncAt(b, now));
  });

  it("falls back to last success, then to now, when no attempt exists", () => {
    expect(
      deriveNextSyncAt(baseState({ lastSuccessfulSyncAt: "2026-06-30T06:00:00.000Z" }), now),
    ).toBe("2026-06-30T08:00:00.000Z");
    // No attempt, no success → anchored at now.
    expect(deriveNextSyncAt(baseState(), now)).toBe("2026-06-30T12:00:00.000Z");
  });

  it("returns null for a non-positive cadence", () => {
    expect(deriveNextSyncAt(baseState({ internalSyncCadenceMin: 0 }), now)).toBeNull();
  });
});

describe("deriveDataFreshnessLevel", () => {
  it("is UNKNOWN when there is no successful sync", () => {
    expect(deriveDataFreshnessLevel(baseState(), "2026-06-30T10:00:00.000Z")).toBe("UNKNOWN");
  });

  it("is FRESH within one cadence window", () => {
    expect(
      deriveDataFreshnessLevel(
        baseState({ lastSuccessfulSyncAt: "2026-06-30T09:30:00.000Z" }),
        "2026-06-30T10:00:00.000Z",
      ),
    ).toBe("FRESH");
  });

  it("is RECENT between one and three cadence windows", () => {
    // 5h old, cadence 2h → >1×, ≤3× → RECENT.
    expect(
      deriveDataFreshnessLevel(
        baseState({ lastSuccessfulSyncAt: "2026-06-30T05:00:00.000Z" }),
        "2026-06-30T10:00:00.000Z",
      ),
    ).toBe("RECENT");
  });

  it("becomes STALE when the successful sync is old", () => {
    // 9h old, cadence 2h → >3× → STALE.
    expect(
      deriveDataFreshnessLevel(
        baseState({ lastSuccessfulSyncAt: "2026-06-30T01:00:00.000Z" }),
        "2026-06-30T10:00:00.000Z",
      ),
    ).toBe("STALE");
  });

  it("is UNKNOWN for a future snapshot or a non-positive cadence", () => {
    expect(
      deriveDataFreshnessLevel(
        baseState({ lastSuccessfulSyncAt: "2026-06-30T11:00:00.000Z" }),
        "2026-06-30T10:00:00.000Z",
      ),
    ).toBe("UNKNOWN");
    expect(
      deriveDataFreshnessLevel(
        baseState({ lastSuccessfulSyncAt: "2026-06-30T09:00:00.000Z", internalSyncCadenceMin: 0 }),
        "2026-06-30T10:00:00.000Z",
      ),
    ).toBe("UNKNOWN");
  });
});

describe("deriveReconnectRequired", () => {
  it("is true for every non-usable auth status", () => {
    for (const authStatus of ["RECONNECT_REQUIRED", "AUTH_CHALLENGE", "EXPIRED"] as AuthStatus[]) {
      expect(deriveReconnectRequired(baseState({ authStatus }))).toBe(true);
    }
  });

  it("is false when connected, true when unknown with a prior auth error", () => {
    expect(deriveReconnectRequired(baseState({ authStatus: "CONNECTED" }))).toBe(false);
    expect(deriveReconnectRequired(baseState({ authStatus: "UNKNOWN" }))).toBe(false);
    expect(
      deriveReconnectRequired(baseState({ authStatus: "UNKNOWN", lastErrorCategory: "AUTH" })),
    ).toBe(true);
  });
});

describe("deriveStaleDataWarning", () => {
  const now = "2026-06-30T10:00:00.000Z";

  it("is true when reconnect is required even if data would otherwise be fresh", () => {
    expect(
      deriveStaleDataWarning(
        baseState({ lastSuccessfulSyncAt: "2026-06-30T09:45:00.000Z", authStatus: "RECONNECT_REQUIRED" }),
        now,
      ),
    ).toBe(true);
  });

  it("is true when the snapshot is stale", () => {
    expect(deriveStaleDataWarning(baseState({ lastSuccessfulSyncAt: "2026-06-30T01:00:00.000Z" }), now)).toBe(true);
  });

  it("is false when fresh and connected", () => {
    expect(deriveStaleDataWarning(baseState({ lastSuccessfulSyncAt: "2026-06-30T09:30:00.000Z" }), now)).toBe(false);
  });
});

describe("deriveConnectorDashboardState", () => {
  const now = "2026-06-30T10:00:00.000Z";

  it("does not mutate the input state and exposes the snapshot anchor", () => {
    const state = baseState({
      lastSyncAttemptAt: "2026-06-30T09:00:00.000Z",
      lastSuccessfulSyncAt: "2026-06-30T09:00:00.000Z",
    });
    const snapshot = JSON.stringify(state);
    const view = deriveConnectorDashboardState(state, now);
    expect(JSON.stringify(state)).toBe(snapshot); // input untouched
    expect(view.latestSnapshotAt).toBe(state.lastSuccessfulSyncAt);
    expect(view.nextSyncAt).toBe("2026-06-30T11:00:00.000Z"); // 09:00 + 120min
  });

  it("a failed attempt updates attempt time but keeps the last successful snapshot", () => {
    const state = baseState({
      syncStatus: "FAILED",
      lastSyncAttemptAt: "2026-06-30T10:00:00.000Z",
      lastSuccessfulSyncAt: "2026-06-30T06:00:00.000Z", // older good snapshot, retained
      lastErrorCategory: "DOWNLOAD_FAILED",
      lastErrorAt: "2026-06-30T10:00:00.000Z",
    });
    const view = deriveConnectorDashboardState(state, now);
    // The report anchor stays pinned to the last good data, distinct from the attempt.
    expect(view.latestSnapshotAt).toBe("2026-06-30T06:00:00.000Z");
    expect(state.lastSuccessfulSyncAt).toBe("2026-06-30T06:00:00.000Z");
    expect(view.latestSnapshotAt).not.toBe(state.lastSyncAttemptAt);
  });

  it("suppresses nextSyncAt when reconnect is required", () => {
    const view = deriveConnectorDashboardState(baseState({ authStatus: "EXPIRED" }), now);
    expect(view.reconnectRequired).toBe(true);
    expect(view.nextSyncAt).toBeNull();
  });

  it("suppresses nextSyncAt for a NONE connector or DISABLED capability", () => {
    expect(deriveConnectorDashboardState(baseState({ connectorType: "NONE" }), now).nextSyncAt).toBeNull();
    expect(deriveConnectorDashboardState(baseState({ capabilityStatus: "DISABLED" }), now).nextSyncAt).toBeNull();
  });
});

describe("module purity (no scheduler / I/O / marketplace / Date.now)", () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const SRC = join(__dirname, "..", "..", "src", "connection", "sync-state-derive.ts");
  const code = readFileSync(SRC, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("imports nothing from scheduler / status / backend / browser / marketplace layers", () => {
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

  it("contains no timer / scheduler / wall-clock / manualSync tokens", () => {
    for (const token of [
      "setInterval",
      "setTimeout",
      "cron",
      "manualSync",
      "scheduler",
      "Date.now",
      "Date.parse",
      "Date.UTC",
      "new Date",
      "writeStatus",
      "saveAs",
    ]) {
      expect(code.includes(token)).toBe(false);
    }
  });

  it("exposes the design-default freshness policy", () => {
    expect(DEFAULT_FRESHNESS_POLICY).toEqual({ freshMultiplier: 1, staleMultiplier: 3 });
  });
});
