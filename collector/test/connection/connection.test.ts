import { describe, expect, it } from "vitest";
import {
  bindConnectionToFingerprint,
  createPendingConnection,
  fingerprintHash,
  markAccountMismatch,
  markNeedsReauth,
  profileNameForConnection,
} from "../../src/connection/connection";
import { evaluateExportGuard } from "../../src/connection/guard";
import type { CollectorConnection } from "../../src/connection/types";

// Synthetic-only fixtures. Never a real store/account identity.
const NOW = "2026-06-18T00:00:00.000Z";
const LATER = "2026-06-18T01:00:00.000Z";
const FAKE_RAW_IDENTITY = "FAKE_STORE_홍길동테스트_0001";
const OTHER_RAW_IDENTITY = "FAKE_STORE_김철수테스트_9999";

function pending(): CollectorConnection {
  return createPendingConnection({
    connectionId: "conn-abc-123",
    platform: "NAVER_SMARTSTORE",
    userProvidedDisplayName: "내 테스트 연결",
    now: NOW,
  });
}

function bound(): CollectorConnection {
  return bindConnectionToFingerprint(pending(), {
    fingerprintHash: fingerprintHash(FAKE_RAW_IDENTITY),
    fingerprintSourceCategory: "commerce-id",
    now: LATER,
  });
}

describe("createPendingConnection", () => {
  it("creates a PENDING_USER_LOGIN connection with no binding yet", () => {
    const c = pending();
    expect(c.connectionStatus).toBe("PENDING_USER_LOGIN");
    expect(c.boundStoreFingerprintHash).toBeNull();
    expect(c.fingerprintSourceCategory).toBeNull();
    expect(c.lastVerifiedAt).toBeNull();
    expect(c.lastExportResult).toBeNull();
    expect(c.reauthRequiredReason).toBeNull();
    expect(c.createdAt).toBe(NOW);
    expect(c.platform).toBe("NAVER_SMARTSTORE");
    expect(c.userProvidedDisplayName).toBe("내 테스트 연결");
  });
});

describe("profileNameForConnection", () => {
  it("is deterministic and derived only from platform + connectionId", () => {
    expect(profileNameForConnection("conn-abc-123", "NAVER_SMARTSTORE")).toBe("naver-conn-abc-123");
    // Same inputs → same output, every time.
    expect(profileNameForConnection("conn-abc-123", "NAVER_SMARTSTORE")).toBe(
      profileNameForConnection("conn-abc-123", "NAVER_SMARTSTORE"),
    );
    // Different ids → different profiles.
    expect(profileNameForConnection("conn-xyz-999", "NAVER_SMARTSTORE")).toBe("naver-conn-xyz-999");
  });

  it("does not embed the user display name or any raw identity", () => {
    const c = pending();
    expect(c.profileName).toBe("naver-conn-abc-123");
    expect(c.profileName).not.toContain(c.userProvidedDisplayName);
    expect(c.profileName).not.toContain(FAKE_RAW_IDENTITY);
  });
});

describe("bindConnectionToFingerprint", () => {
  it("stores only the fingerprint hash + category, never the raw identity", () => {
    const c = bound();
    expect(c.connectionStatus).toBe("CONNECTED");
    expect(c.fingerprintSourceCategory).toBe("commerce-id");
    expect(c.lastVerifiedAt).toBe(LATER);
    // The stored value is the hash, not the raw token.
    expect(c.boundStoreFingerprintHash).toBe(fingerprintHash(FAKE_RAW_IDENTITY));
    expect(c.boundStoreFingerprintHash).not.toBe(FAKE_RAW_IDENTITY);
    // SHA-256 hex digest shape.
    expect(c.boundStoreFingerprintHash).toMatch(/^[0-9a-f]{64}$/);
    // The whole record must not contain the raw identity anywhere.
    expect(JSON.stringify(c)).not.toContain(FAKE_RAW_IDENTITY);
  });

  it("is a pure transform — the input connection is unchanged", () => {
    const p = pending();
    bindConnectionToFingerprint(p, {
      fingerprintHash: fingerprintHash(FAKE_RAW_IDENTITY),
      fingerprintSourceCategory: "commerce-id",
      now: LATER,
    });
    expect(p.connectionStatus).toBe("PENDING_USER_LOGIN");
    expect(p.boundStoreFingerprintHash).toBeNull();
  });
});

describe("markNeedsReauth / markAccountMismatch", () => {
  it("markNeedsReauth preserves the binding and records the reason category", () => {
    const c = markNeedsReauth(bound(), "session-logged-out");
    expect(c.connectionStatus).toBe("NEEDS_REAUTH");
    expect(c.reauthRequiredReason).toBe("session-logged-out");
    expect(c.boundStoreFingerprintHash).toBe(fingerprintHash(FAKE_RAW_IDENTITY));
  });

  it("markAccountMismatch preserves the bound hash and clears reauth reason", () => {
    const c = markAccountMismatch(markNeedsReauth(bound(), "auth-challenge"));
    expect(c.connectionStatus).toBe("ACCOUNT_MISMATCH");
    expect(c.reauthRequiredReason).toBeNull();
    expect(c.boundStoreFingerprintHash).toBe(fingerprintHash(FAKE_RAW_IDENTITY));
  });
});

describe("evaluateExportGuard", () => {
  it("blocks and marks NEEDS_REAUTH when logged out", () => {
    const d = evaluateExportGuard({
      connection: bound(),
      session: "LOGGED_OUT",
      currentFingerprintHash: fingerprintHash(FAKE_RAW_IDENTITY),
      exportPageReachability: "REACHABLE",
    });
    expect(d).toEqual({
      allow: false,
      nextStatus: "NEEDS_REAUTH",
      reasonCategory: "session-logged-out",
    });
  });

  it("blocks and marks NEEDS_REAUTH on an auth challenge", () => {
    const d = evaluateExportGuard({
      connection: bound(),
      session: "AUTH_CHALLENGE",
      currentFingerprintHash: fingerprintHash(FAKE_RAW_IDENTITY),
      exportPageReachability: "REACHABLE",
    });
    expect(d.allow).toBe(false);
    expect(d.nextStatus).toBe("NEEDS_REAUTH");
    expect(d.reasonCategory).toBe("auth-challenge");
  });

  it("blocks when the bound fingerprint is missing", () => {
    const d = evaluateExportGuard({
      connection: pending(), // never bound
      session: "LOGGED_IN",
      currentFingerprintHash: fingerprintHash(FAKE_RAW_IDENTITY),
      exportPageReachability: "REACHABLE",
    });
    expect(d.allow).toBe(false);
    expect(d.nextStatus).toBe("PENDING_ACCOUNT_SELECTION");
    expect(d.reasonCategory).toBe("bound-fingerprint-missing");
  });

  it("blocks when the current fingerprint cannot be resolved", () => {
    const d = evaluateExportGuard({
      connection: bound(),
      session: "LOGGED_IN",
      currentFingerprintHash: null,
      exportPageReachability: "REACHABLE",
    });
    expect(d.allow).toBe(false);
    expect(d.nextStatus).toBe("PENDING_ACCOUNT_SELECTION");
    expect(d.reasonCategory).toBe("current-fingerprint-missing");
  });

  it("blocks and marks ACCOUNT_MISMATCH when the current store differs", () => {
    const d = evaluateExportGuard({
      connection: bound(),
      session: "LOGGED_IN",
      currentFingerprintHash: fingerprintHash(OTHER_RAW_IDENTITY),
      exportPageReachability: "REACHABLE",
    });
    expect(d.allow).toBe(false);
    expect(d.nextStatus).toBe("ACCOUNT_MISMATCH");
    expect(d.reasonCategory).toBe("fingerprint-mismatch");
  });

  it("allows and marks EXPORT_READY when session + fingerprint + page all check out", () => {
    const d = evaluateExportGuard({
      connection: bound(),
      session: "LOGGED_IN",
      currentFingerprintHash: fingerprintHash(FAKE_RAW_IDENTITY),
      exportPageReachability: "REACHABLE",
    });
    expect(d).toEqual({ allow: true, nextStatus: "EXPORT_READY", reasonCategory: "ok" });
  });

  it("blocks and marks NEEDS_REAUTH when the export page is unreachable due to auth", () => {
    const d = evaluateExportGuard({
      connection: bound(),
      session: "LOGGED_IN",
      currentFingerprintHash: fingerprintHash(FAKE_RAW_IDENTITY),
      exportPageReachability: "UNREACHABLE_AUTH",
    });
    expect(d.allow).toBe(false);
    expect(d.nextStatus).toBe("NEEDS_REAUTH");
    expect(d.reasonCategory).toBe("export-page-unreachable-auth");
  });

  it.each([
    ["UNREACHABLE_LAYOUT", "export-page-unreachable-layout"],
    ["UNREACHABLE_NETWORK", "export-page-unreachable-network"],
    ["UNREACHABLE_UNKNOWN", "export-page-unreachable-unknown"],
  ] as const)(
    "blocks and marks EXPORT_FAILED when the export page is unreachable (%s)",
    (reachability, reason) => {
      const d = evaluateExportGuard({
        connection: bound(),
        session: "LOGGED_IN",
        currentFingerprintHash: fingerprintHash(FAKE_RAW_IDENTITY),
        exportPageReachability: reachability,
      });
      expect(d.allow).toBe(false);
      expect(d.nextStatus).toBe("EXPORT_FAILED");
      expect(d.reasonCategory).toBe(reason);
    },
  );

  it("never leaks raw store/account identity in any returned decision", () => {
    const reachabilities = [
      "REACHABLE",
      "UNREACHABLE_AUTH",
      "UNREACHABLE_LAYOUT",
      "UNREACHABLE_NETWORK",
      "UNREACHABLE_UNKNOWN",
    ] as const;
    const sessions = ["LOGGED_IN", "LOGGED_OUT", "AUTH_CHALLENGE"] as const;
    const currents = [fingerprintHash(FAKE_RAW_IDENTITY), fingerprintHash(OTHER_RAW_IDENTITY), null];

    for (const session of sessions) {
      for (const exportPageReachability of reachabilities) {
        for (const currentFingerprintHash of currents) {
          const d = evaluateExportGuard({
            connection: bound(),
            session,
            currentFingerprintHash,
            exportPageReachability,
          });
          const serialized = JSON.stringify(d);
          expect(serialized).not.toContain(FAKE_RAW_IDENTITY);
          expect(serialized).not.toContain(OTHER_RAW_IDENTITY);
          // The display name is also identity-adjacent and must not appear.
          expect(serialized).not.toContain("내 테스트 연결");
        }
      }
    }
  });
});
