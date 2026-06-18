import { describe, expect, it } from "vitest";
import { createPendingConnection, fingerprintHash } from "../../src/connection/connection";
import {
  completeManualAccountSelection,
  markPendingAccountSelection,
  prepareExportAttempt,
} from "../../src/connection/workflow";
import type { CollectorConnection } from "../../src/connection/types";

const NOW = "2026-06-18T00:00:00.000Z";
const T1 = "2026-06-18T01:00:00.000Z";
const T2 = "2026-06-18T02:00:00.000Z";
const FAKE_RAW_IDENTITY = "FAKE_STORE_홍길동테스트_0001";
const OTHER_RAW_IDENTITY = "FAKE_STORE_김철수테스트_9999";
const USER_ALIAS = "내 메인 스토어";

function pending(): CollectorConnection {
  return createPendingConnection({
    connectionId: "conn-wf-1",
    platform: "NAVER_SMARTSTORE",
    userProvidedDisplayName: "초기 별칭",
    now: NOW,
  });
}

function connected(): CollectorConnection {
  return completeManualAccountSelection(
    markPendingAccountSelection(pending(), T1),
    fingerprintHash(FAKE_RAW_IDENTITY),
    "commerce-id",
    USER_ALIAS,
    T2,
  );
}

describe("markPendingAccountSelection", () => {
  it("transitions to PENDING_ACCOUNT_SELECTION, updates lastVerifiedAt, binds nothing", () => {
    const c = markPendingAccountSelection(pending(), T1);
    expect(c.connectionStatus).toBe("PENDING_ACCOUNT_SELECTION");
    expect(c.lastVerifiedAt).toBe(T1);
    expect(c.boundStoreFingerprintHash).toBeNull();
    expect(c.fingerprintSourceCategory).toBeNull();
  });
});

describe("completeManualAccountSelection", () => {
  it("binds only hash/category + the user alias, and becomes CONNECTED", () => {
    const c = connected();
    expect(c.connectionStatus).toBe("CONNECTED");
    expect(c.boundStoreFingerprintHash).toBe(fingerprintHash(FAKE_RAW_IDENTITY));
    expect(c.fingerprintSourceCategory).toBe("commerce-id");
    expect(c.userProvidedDisplayName).toBe(USER_ALIAS);
    expect(c.lastVerifiedAt).toBe(T2);
  });

  it("stores no raw NAVER identity (only the hash and the explicit user alias)", () => {
    const c = connected();
    const serialized = JSON.stringify(c);
    // The raw store identity token must never appear.
    expect(serialized).not.toContain(FAKE_RAW_IDENTITY);
    // The only free-form string present is the user-provided alias, by contract.
    expect(serialized).toContain(USER_ALIAS);
  });
});

describe("prepareExportAttempt", () => {
  it("allows a matched connection → EXPORT_READY, no input mutation", () => {
    const before = connected();
    const snapshot = JSON.stringify(before);
    const { decision, nextConnection } = prepareExportAttempt(
      before,
      {
        session: "LOGGED_IN",
        currentFingerprintHash: fingerprintHash(FAKE_RAW_IDENTITY),
        exportPageReachability: "REACHABLE",
      },
      T2,
    );
    expect(decision.allow).toBe(true);
    expect(nextConnection.connectionStatus).toBe("EXPORT_READY");
    expect(JSON.stringify(before)).toBe(snapshot); // pure
  });

  it("blocks a fingerprint mismatch → ACCOUNT_MISMATCH", () => {
    const { decision, nextConnection } = prepareExportAttempt(
      connected(),
      {
        session: "LOGGED_IN",
        currentFingerprintHash: fingerprintHash(OTHER_RAW_IDENTITY),
        exportPageReachability: "REACHABLE",
      },
      T2,
    );
    expect(decision.allow).toBe(false);
    expect(nextConnection.connectionStatus).toBe("ACCOUNT_MISMATCH");
  });

  it.each(["LOGGED_OUT", "AUTH_CHALLENGE"] as const)("blocks %s → NEEDS_REAUTH", (session) => {
    const { decision, nextConnection } = prepareExportAttempt(
      connected(),
      {
        session,
        currentFingerprintHash: fingerprintHash(FAKE_RAW_IDENTITY),
        exportPageReachability: "REACHABLE",
      },
      T2,
    );
    expect(decision.allow).toBe(false);
    expect(nextConnection.connectionStatus).toBe("NEEDS_REAUTH");
  });

  it("never leaks raw identity through the decision", () => {
    const { decision } = prepareExportAttempt(
      connected(),
      {
        session: "LOGGED_IN",
        currentFingerprintHash: fingerprintHash(OTHER_RAW_IDENTITY),
        exportPageReachability: "UNREACHABLE_LAYOUT",
      },
      T2,
    );
    const serialized = JSON.stringify(decision);
    expect(serialized).not.toContain(FAKE_RAW_IDENTITY);
    expect(serialized).not.toContain(OTHER_RAW_IDENTITY);
    expect(serialized).not.toContain(USER_ALIAS);
  });
});
