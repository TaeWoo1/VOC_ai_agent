import { describe, expect, it } from "vitest";
import {
  bindConnectionToFingerprint,
  createPendingConnection,
  fingerprintHash,
} from "../../src/connection/connection";
import { applyGuardDecision, recordExportAttempt } from "../../src/connection/apply";
import { evaluateExportGuard } from "../../src/connection/guard";
import type { CollectorConnection } from "../../src/connection/types";

const NOW = "2026-06-18T00:00:00.000Z";
const LATER = "2026-06-18T02:00:00.000Z";
const FAKE_RAW_IDENTITY = "FAKE_STORE_홍길동테스트_0001";
const OTHER_RAW_IDENTITY = "FAKE_STORE_김철수테스트_9999";

function bound(): CollectorConnection {
  return bindConnectionToFingerprint(
    createPendingConnection({
      connectionId: "conn-apply-1",
      platform: "NAVER_SMARTSTORE",
      userProvidedDisplayName: "적용 테스트 연결",
      now: NOW,
    }),
    {
      fingerprintHash: fingerprintHash(FAKE_RAW_IDENTITY),
      fingerprintSourceCategory: "commerce-id",
      now: NOW,
    },
  );
}

describe("applyGuardDecision", () => {
  it("allows export → EXPORT_READY and refreshes lastVerifiedAt", () => {
    const decision = evaluateExportGuard({
      connection: bound(),
      session: "LOGGED_IN",
      currentFingerprintHash: fingerprintHash(FAKE_RAW_IDENTITY),
      exportPageReachability: "REACHABLE",
    });
    const c = applyGuardDecision(bound(), decision, LATER);
    expect(c.connectionStatus).toBe("EXPORT_READY");
    expect(c.lastVerifiedAt).toBe(LATER);
  });

  it.each(["LOGGED_OUT", "AUTH_CHALLENGE"] as const)(
    "maps %s to NEEDS_REAUTH with a sanitized reason",
    (session) => {
      const decision = evaluateExportGuard({
        connection: bound(),
        session,
        currentFingerprintHash: fingerprintHash(FAKE_RAW_IDENTITY),
        exportPageReachability: "REACHABLE",
      });
      const c = applyGuardDecision(bound(), decision, LATER);
      expect(c.connectionStatus).toBe("NEEDS_REAUTH");
      expect(c.reauthRequiredReason).toBe(
        session === "LOGGED_OUT" ? "session-logged-out" : "auth-challenge",
      );
      // Binding preserved across re-auth.
      expect(c.boundStoreFingerprintHash).toBe(fingerprintHash(FAKE_RAW_IDENTITY));
    },
  );

  it("maps a fingerprint mismatch to ACCOUNT_MISMATCH (bound hash preserved)", () => {
    const decision = evaluateExportGuard({
      connection: bound(),
      session: "LOGGED_IN",
      currentFingerprintHash: fingerprintHash(OTHER_RAW_IDENTITY),
      exportPageReachability: "REACHABLE",
    });
    const c = applyGuardDecision(bound(), decision, LATER);
    expect(c.connectionStatus).toBe("ACCOUNT_MISMATCH");
    expect(c.reauthRequiredReason).toBeNull();
    expect(c.boundStoreFingerprintHash).toBe(fingerprintHash(FAKE_RAW_IDENTITY));
  });

  it.each(["UNREACHABLE_LAYOUT", "UNREACHABLE_NETWORK", "UNREACHABLE_UNKNOWN"] as const)(
    "maps export page failure (%s) to EXPORT_FAILED with a fixed result category",
    (reachability) => {
      const decision = evaluateExportGuard({
        connection: bound(),
        session: "LOGGED_IN",
        currentFingerprintHash: fingerprintHash(FAKE_RAW_IDENTITY),
        exportPageReachability: reachability,
      });
      const c = applyGuardDecision(bound(), decision, LATER);
      expect(c.connectionStatus).toBe("EXPORT_FAILED");
      expect(c.lastExportResult).toBe("EXPORT_FAILED");
    },
  );

  it("maps missing current fingerprint to PENDING_ACCOUNT_SELECTION", () => {
    const decision = evaluateExportGuard({
      connection: bound(),
      session: "LOGGED_IN",
      currentFingerprintHash: null,
      exportPageReachability: "REACHABLE",
    });
    const c = applyGuardDecision(bound(), decision, LATER);
    expect(c.connectionStatus).toBe("PENDING_ACCOUNT_SELECTION");
  });

  it("does not mutate the original connection", () => {
    const original = bound();
    const snapshot = JSON.stringify(original);
    const decision = evaluateExportGuard({
      connection: original,
      session: "LOGGED_OUT",
      currentFingerprintHash: fingerprintHash(FAKE_RAW_IDENTITY),
      exportPageReachability: "REACHABLE",
    });
    applyGuardDecision(original, decision, LATER);
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it("never leaks raw identity through an applied connection", () => {
    for (const session of ["LOGGED_IN", "LOGGED_OUT", "AUTH_CHALLENGE"] as const) {
      for (const current of [fingerprintHash(OTHER_RAW_IDENTITY), null]) {
        const decision = evaluateExportGuard({
          connection: bound(),
          session,
          currentFingerprintHash: current,
          exportPageReachability: "UNREACHABLE_LAYOUT",
        });
        const c = applyGuardDecision(bound(), decision, LATER);
        const serialized = JSON.stringify(c);
        expect(serialized).not.toContain(FAKE_RAW_IDENTITY);
        expect(serialized).not.toContain(OTHER_RAW_IDENTITY);
      }
    }
  });
});

describe("recordExportAttempt", () => {
  it("updates only the attempt timestamp + fixed result category", () => {
    const before = bound();
    const c = recordExportAttempt(before, "EXPORT_FAILED", LATER);
    expect(c.lastExportAttemptAt).toBe(LATER);
    expect(c.lastExportResult).toBe("EXPORT_FAILED");
    // Nothing else changed.
    expect(c.connectionStatus).toBe(before.connectionStatus);
    expect(c.boundStoreFingerprintHash).toBe(before.boundStoreFingerprintHash);
    // Pure: input untouched.
    expect(before.lastExportAttemptAt).toBeNull();
  });

  it("stores no raw filename, error, or store name (only the fixed category)", () => {
    const c = recordExportAttempt(bound(), "BLOCKED", LATER);
    const serialized = JSON.stringify(c);
    expect(serialized).not.toContain(FAKE_RAW_IDENTITY);
    expect(serialized).not.toContain(".xlsx");
    expect(c.lastExportResult).toBe("BLOCKED");
  });
});
