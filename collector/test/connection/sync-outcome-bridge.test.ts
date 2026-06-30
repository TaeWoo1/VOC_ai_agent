import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  mapCollectorStateToSyncOutcome,
  mapConnectionStatusToSyncOutcome,
} from "../../src/connection/sync-outcome-bridge";
import { applySyncOutcome } from "../../src/connection/sync-state-reduce";
import type { CollectorState } from "../../src/status";
import type { ConnectionStatus } from "../../src/connection/types";
import type { ConnectorSyncState } from "../../src/connection/sync-state";

const NOW = "2026-06-30T10:00:00.000Z";

function baseState(overrides: Partial<ConnectorSyncState> = {}): ConnectorSyncState {
  return {
    channel: "NAVER",
    connectorType: "BROWSER_EXPORT",
    accountRef: { connectionId: "conn-1", boundStoreFingerprintHash: null, fingerprintSourceCategory: null },
    capabilityStatus: "CONFIRMED",
    authStatus: "CONNECTED",
    syncStatus: "IDLE",
    lastSyncAttemptAt: null,
    lastSuccessfulSyncAt: null,
    nextSyncAt: null,
    internalSyncCadenceMin: 120,
    userReportSchedule: { preset: "DAILY" },
    reconnectRequired: false,
    lastErrorCategory: null,
    lastErrorAt: null,
    staleDataWarning: false,
    dataFreshnessLevel: "UNKNOWN",
    ...overrides,
  };
}

describe("mapCollectorStateToSyncOutcome", () => {
  it("maps a successful completed run to SUCCEEDED", () => {
    expect(mapCollectorStateToSyncOutcome("LAST_SUCCESS")).toEqual({ kind: "SUCCEEDED" });
  });

  it("maps auth/session states to AUTH_RECONNECT_REQUIRED with the right auth status", () => {
    expect(mapCollectorStateToSyncOutcome("SESSION_EXPIRED")).toMatchObject({
      kind: "AUTH_RECONNECT_REQUIRED",
      authStatus: "EXPIRED",
    });
    expect(mapCollectorStateToSyncOutcome("RECONNECT_REQUIRED")).toMatchObject({
      kind: "AUTH_RECONNECT_REQUIRED",
      authStatus: "RECONNECT_REQUIRED",
    });
    expect(mapCollectorStateToSyncOutcome("ACCOUNT_LOGIN_REQUIRED")).toMatchObject({
      kind: "AUTH_RECONNECT_REQUIRED",
      authStatus: "RECONNECT_REQUIRED",
    });
    expect(mapCollectorStateToSyncOutcome("ACTION_REQUIRED_FOR_2FA_OR_CAPTCHA")).toMatchObject({
      kind: "AUTH_RECONNECT_REQUIRED",
      authStatus: "AUTH_CHALLENGE",
    });
  });

  it("maps export/download/target failures to the right sanitized error categories", () => {
    expect(mapCollectorStateToSyncOutcome("EXPORT_LAYOUT_CHANGED")).toEqual({
      kind: "FAILED",
      errorCategory: "EXPORT_LAYOUT_CHANGED",
    });
    expect(mapCollectorStateToSyncOutcome("DOWNLOAD_FAILED")).toEqual({
      kind: "FAILED",
      errorCategory: "DOWNLOAD_FAILED",
    });
    expect(mapCollectorStateToSyncOutcome("EXPORT_TARGET_UNKNOWN")).toEqual({
      kind: "FAILED",
      errorCategory: "UNKNOWN",
    });
  });

  it("maps captured-but-not-uploaded to a recoverable PARTIAL", () => {
    expect(mapCollectorStateToSyncOutcome("UPLOAD_FAILED")).toEqual({ kind: "PARTIAL", errorCategory: "NETWORK" });
  });

  it("maps idle / discovery / action-required / disconnected states to PAUSED", () => {
    for (const state of [
      "CONNECTED",
      "COLLECTING",
      "EXPORT_SYNC_DETECTED",
      "EXPORT_ASYNC_JOB_DETECTED",
      "EXPORT_TARGET_EMPTY",
      "EXPORT_DATE_RANGE_REQUIRED",
      "DISCONNECTED",
    ] as CollectorState[]) {
      expect(mapCollectorStateToSyncOutcome(state)).toEqual({ kind: "PAUSED" });
    }
  });
});

describe("mapConnectionStatusToSyncOutcome", () => {
  it("maps onboarding / re-auth states to reconnect, mismatch to PERMISSION, ready to PAUSED", () => {
    for (const status of ["PENDING_USER_LOGIN", "PENDING_ACCOUNT_SELECTION", "NEEDS_REAUTH"] as ConnectionStatus[]) {
      expect(mapConnectionStatusToSyncOutcome(status)).toMatchObject({ kind: "AUTH_RECONNECT_REQUIRED" });
    }
    expect(mapConnectionStatusToSyncOutcome("ACCOUNT_MISMATCH")).toEqual({ kind: "FAILED", errorCategory: "PERMISSION" });
    expect(mapConnectionStatusToSyncOutcome("EXPORT_FAILED")).toEqual({ kind: "FAILED", errorCategory: "UNKNOWN" });
    expect(mapConnectionStatusToSyncOutcome("CONNECTED")).toEqual({ kind: "PAUSED" });
    expect(mapConnectionStatusToSyncOutcome("EXPORT_READY")).toEqual({ kind: "PAUSED" });
  });
});

describe("output shape is sanitized (enum/category only)", () => {
  it("every mapped outcome has only sanitized keys", () => {
    const allStates: CollectorState[] = [
      "CONNECTED",
      "COLLECTING",
      "LAST_SUCCESS",
      "SESSION_EXPIRED",
      "RECONNECT_REQUIRED",
      "ACCOUNT_LOGIN_REQUIRED",
      "ACTION_REQUIRED_FOR_2FA_OR_CAPTCHA",
      "EXPORT_LAYOUT_CHANGED",
      "EXPORT_ASYNC_JOB_DETECTED",
      "EXPORT_SYNC_DETECTED",
      "EXPORT_TARGET_EMPTY",
      "EXPORT_TARGET_UNKNOWN",
      "EXPORT_DATE_RANGE_REQUIRED",
      "DOWNLOAD_FAILED",
      "UPLOAD_FAILED",
      "DISCONNECTED",
    ];
    const allowedKeys = new Set(["kind", "errorCategory", "authStatus", "meta"]);
    for (const s of allStates) {
      const outcome = mapCollectorStateToSyncOutcome(s);
      for (const key of Object.keys(outcome)) expect(allowedKeys.has(key)).toBe(true);
      // No raw-looking string values (no slashes, dots, spaces, or long tokens).
      for (const v of Object.values(outcome)) {
        if (typeof v === "string") expect(v).toMatch(/^[A-Z_]+$/);
      }
    }
  });
});

describe("composition with applySyncOutcome (pure)", () => {
  it("bridged SUCCEEDED advances the snapshot via the reducer", () => {
    const outcome = mapCollectorStateToSyncOutcome("LAST_SUCCESS");
    const next = applySyncOutcome(baseState({ lastSuccessfulSyncAt: "2026-06-30T06:00:00.000Z" }), outcome, NOW);
    expect(next.syncStatus).toBe("SUCCEEDED");
    expect(next.lastSuccessfulSyncAt).toBe(NOW);
    expect(next.nextSyncAt).toBe("2026-06-30T12:00:00.000Z");
  });

  it("bridged auth failure pauses and preserves the prior snapshot via the reducer", () => {
    const outcome = mapCollectorStateToSyncOutcome("SESSION_EXPIRED");
    const next = applySyncOutcome(baseState({ lastSuccessfulSyncAt: "2026-06-30T06:00:00.000Z" }), outcome, NOW);
    expect(next.reconnectRequired).toBe(true);
    expect(next.authStatus).toBe("EXPIRED");
    expect(next.lastSuccessfulSyncAt).toBe("2026-06-30T06:00:00.000Z"); // snapshot retained
    expect(next.nextSyncAt).toBeNull();
  });
});

describe("sync-outcome-bridge — module purity (read-only, no I/O / backend / browser)", () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const SRC = join(__dirname, "..", "..", "src", "connection", "sync-outcome-bridge.ts");
  const raw = readFileSync(SRC, "utf8");
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const importLines = code.split("\n").filter((l) => /^\s*import\b/.test(l));

  it("any ../status import is type-only (no status-writing runtime pulled in)", () => {
    for (const l of importLines) {
      if (l.includes("../status")) expect(/^\s*import\s+type\b/.test(l)).toBe(true);
    }
  });

  it("does not value-import backend / browser / upload / download / scheduler modules", () => {
    for (const forbidden of [
      "playwright",
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

  it("calls no writer / scheduler / wall-clock / manualSync APIs and never calls applySyncOutcome", () => {
    for (const token of [
      "writeStatus",
      "writeFileSync",
      "mkdirSync",
      "saveAs",
      "applySyncOutcome",
      "Date.now",
      "new Date",
      "setInterval",
      "setTimeout",
      "cron",
      "manualSync",
      "scheduler",
    ]) {
      expect(code.includes(token)).toBe(false);
    }
  });
});
