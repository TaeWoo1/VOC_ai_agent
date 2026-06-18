import { describe, expect, it } from "vitest";
import { createPendingConnection, fingerprintHash } from "../../src/connection/connection";
import {
  connectionStatusBridge,
  connectionStatusDetail,
  connectionStatusToCollectorState,
  connectionToStatusSnapshot,
} from "../../src/connection/status-bridge";
import type { CollectorConnection, ConnectionStatus } from "../../src/connection/types";

const NOW = "2026-06-18T00:00:00.000Z";
const FAKE_RAW_IDENTITY = "FAKE_STORE_홍길동테스트_0001";
const HASH = fingerprintHash(FAKE_RAW_IDENTITY);

const ALL_STATUSES: ConnectionStatus[] = [
  "PENDING_USER_LOGIN",
  "PENDING_ACCOUNT_SELECTION",
  "CONNECTED",
  "NEEDS_REAUTH",
  "ACCOUNT_MISMATCH",
  "EXPORT_READY",
  "EXPORT_FAILED",
];

function withStatus(status: ConnectionStatus): CollectorConnection {
  const base = createPendingConnection({
    connectionId: "conn-bridge-1",
    platform: "NAVER_SMARTSTORE",
    userProvidedDisplayName: "별칭",
    now: NOW,
  });
  // Synthetic: a bound hash present for all statuses so we can assert it never leaks.
  return {
    ...base,
    connectionStatus: status,
    boundStoreFingerprintHash: HASH,
    fingerprintSourceCategory: "commerce-id",
  };
}

describe("connectionStatusToCollectorState", () => {
  const EXPECTED: Record<ConnectionStatus, string> = {
    PENDING_USER_LOGIN: "COLLECTING",
    PENDING_ACCOUNT_SELECTION: "COLLECTING",
    CONNECTED: "CONNECTED",
    EXPORT_READY: "CONNECTED",
    NEEDS_REAUTH: "SESSION_EXPIRED",
    ACCOUNT_MISMATCH: "ACTION_REQUIRED_FOR_2FA_OR_CAPTCHA",
    EXPORT_FAILED: "DOWNLOAD_FAILED",
  };

  it.each(ALL_STATUSES)("maps %s deterministically", (status) => {
    expect(connectionStatusToCollectorState(withStatus(status))).toBe(EXPECTED[status]);
    // Determinism: same input, same output.
    expect(connectionStatusToCollectorState(withStatus(status))).toBe(
      connectionStatusToCollectorState(withStatus(status)),
    );
  });

  it("never maps any connection status to LAST_SUCCESS", () => {
    for (const status of ALL_STATUSES) {
      expect(connectionStatusToCollectorState(withStatus(status))).not.toBe("LAST_SUCCESS");
    }
  });

  it("CONNECTED and EXPORT_READY are non-success (CONNECTED, not LAST_SUCCESS)", () => {
    expect(connectionStatusToCollectorState(withStatus("CONNECTED"))).toBe("CONNECTED");
    expect(connectionStatusToCollectorState(withStatus("EXPORT_READY"))).toBe("CONNECTED");
  });

  it("NEEDS_REAUTH maps to the reconnect-required (SESSION_EXPIRED) state", () => {
    expect(connectionStatusToCollectorState(withStatus("NEEDS_REAUTH"))).toBe("SESSION_EXPIRED");
  });

  it("ACCOUNT_MISMATCH maps to an action-required state and blocks success", () => {
    const state = connectionStatusToCollectorState(withStatus("ACCOUNT_MISMATCH"));
    expect(state).toBe("ACTION_REQUIRED_FOR_2FA_OR_CAPTCHA");
    expect(state).not.toBe("LAST_SUCCESS");
  });

  it("EXPORT_FAILED maps to a failed-like state", () => {
    expect(connectionStatusToCollectorState(withStatus("EXPORT_FAILED"))).toBe("DOWNLOAD_FAILED");
  });
});

describe("connectionStatusDetail", () => {
  it.each(ALL_STATUSES)("returns a non-empty sanitized detail for %s", (status) => {
    const detail = connectionStatusDetail(withStatus(status));
    expect(detail.length).toBeGreaterThan(0);
    // No raw identity and no fingerprint hash in the detail.
    expect(detail).not.toContain(FAKE_RAW_IDENTITY);
    expect(detail).not.toContain(HASH);
    expect(detail).not.toContain("conn-bridge-1"); // connectionId
    expect(detail).not.toContain("naver-conn-bridge-1"); // profileName
  });

  it("appends the fixed re-auth reason category for NEEDS_REAUTH", () => {
    const c = { ...withStatus("NEEDS_REAUTH"), reauthRequiredReason: "session-logged-out" as const };
    expect(connectionStatusDetail(c)).toBe("재인증 필요 (session-logged-out)");
  });
});

describe("connectionToStatusSnapshot", () => {
  it("produces a JSON-safe StatusRecord without lastCollectedAt", () => {
    const snap = connectionToStatusSnapshot(withStatus("CONNECTED"), NOW);
    expect(snap).toEqual({ state: "CONNECTED", detail: "연결됨; 내보내기 대기", updatedAt: NOW });
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
    expect("lastCollectedAt" in snap).toBe(false);
  });

  it("never leaks raw identity, hash, connectionId, or profileName in the snapshot", () => {
    for (const status of ALL_STATUSES) {
      const serialized = JSON.stringify(connectionToStatusSnapshot(withStatus(status), NOW));
      expect(serialized).not.toContain(FAKE_RAW_IDENTITY);
      expect(serialized).not.toContain(HASH);
      expect(serialized).not.toContain("conn-bridge-1");
      expect(serialized).not.toContain("naver-conn-bridge-1");
    }
  });
});

describe("connectionStatusBridge", () => {
  it("bundles state + detail + fixed reason category, with no leakage", () => {
    const bridge = connectionStatusBridge(withStatus("ACCOUNT_MISMATCH"));
    expect(bridge).toEqual({
      collectorState: "ACTION_REQUIRED_FOR_2FA_OR_CAPTCHA",
      detail: "선택된 스토어가 연결된 스토어와 다름; 내보내기 차단됨",
      reasonCategory: "account-mismatch",
    });
    expect(JSON.stringify(bridge)).not.toContain(HASH);
  });
});
