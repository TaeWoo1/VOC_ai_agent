import { describe, expect, it } from "vitest";
import {
  bindConnectionToFingerprint,
  createPendingConnection,
  fingerprintHash,
} from "../../src/connection/connection";
import {
  CONNECTION_SCHEMA_VERSION,
  parseConnectionRecord,
  roundTripConnectionRecord,
  toConnectionRecord,
} from "../../src/connection/record";
import type { CollectorConnection } from "../../src/connection/types";

const NOW = "2026-06-18T00:00:00.000Z";
const FAKE_RAW_IDENTITY = "FAKE_STORE_홍길동테스트_0001";
const ATTACKER = "<script>steal('PII_홍길동_010-0000-0000')</script>";

function bound(): CollectorConnection {
  return bindConnectionToFingerprint(
    createPendingConnection({
      connectionId: "conn-record-1",
      platform: "NAVER_SMARTSTORE",
      userProvidedDisplayName: "기록 테스트 연결",
      now: NOW,
    }),
    {
      fingerprintHash: fingerprintHash(FAKE_RAW_IDENTITY),
      fingerprintSourceCategory: "commerce-id",
      now: NOW,
    },
  );
}

describe("toConnectionRecord", () => {
  it("produces a JSON-safe object with schemaVersion and no functions", () => {
    const rec = toConnectionRecord(bound());
    expect(rec.schemaVersion).toBe(CONNECTION_SCHEMA_VERSION);
    // JSON-safe: survives a stringify/parse identical.
    const reparsed = JSON.parse(JSON.stringify(rec));
    expect(reparsed).toEqual(rec);
    // No function-valued fields.
    for (const v of Object.values(rec)) {
      expect(typeof v).not.toBe("function");
    }
  });
});

describe("parseConnectionRecord", () => {
  it("round-trips a valid connection unchanged", () => {
    const c = bound();
    const result = parseConnectionRecord(toConnectionRecord(c));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.connection).toEqual(c);
    // And the convenience round-trip helper agrees.
    expect(roundTripConnectionRecord(c)).toEqual(c);
  });

  it("drops unknown extra keys on parse", () => {
    const rec = { ...toConnectionRecord(bound()), sneaky: ATTACKER };
    const result = parseConnectionRecord(rec);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(JSON.stringify(result.connection)).not.toContain(ATTACKER);
      expect("sneaky" in result.connection).toBe(false);
    }
  });

  it.each([
    ["non-object", 42, "not-an-object"],
    ["null", null, "not-an-object"],
    ["array", [], "not-an-object"],
  ] as const)("rejects %s with a sanitized category", (_label, input, expected) => {
    const result = parseConnectionRecord(input);
    expect(result).toEqual({ ok: false, errorCategory: expected });
  });

  it("rejects an unknown schema version", () => {
    const rec = { ...toConnectionRecord(bound()), schemaVersion: 999 };
    expect(parseConnectionRecord(rec)).toEqual({ ok: false, errorCategory: "unknown-schema-version" });
  });

  it.each([
    ["platform", "unknown-platform"],
    ["connectionStatus", "unknown-status"],
    ["fingerprintSourceCategory", "unknown-fingerprint-source-category"],
    ["reauthRequiredReason", "unknown-reauth-reason"],
    ["lastExportResult", "unknown-export-result"],
  ] as const)("rejects an unknown %s value", (field, expected) => {
    const rec = { ...toConnectionRecord(bound()), [field]: ATTACKER };
    expect(parseConnectionRecord(rec)).toEqual({ ok: false, errorCategory: expected });
  });

  it("rejects a missing/mistyped required field", () => {
    const rec = { ...toConnectionRecord(bound()), connectionId: 12345 };
    expect(parseConnectionRecord(rec)).toEqual({
      ok: false,
      errorCategory: "missing-or-wrong-type-field",
    });
  });

  it("never echoes attacker-controlled raw values in the error result", () => {
    // Every *rejecting* field (enums + schemaVersion), fed an attacker string,
    // must yield only a category. (Free-form fields like connectionId legitimately
    // accept any string, so they are not rejection cases.)
    const fields = [
      "platform",
      "connectionStatus",
      "fingerprintSourceCategory",
      "reauthRequiredReason",
      "lastExportResult",
      "schemaVersion",
    ];
    for (const field of fields) {
      const rec = { ...toConnectionRecord(bound()), [field]: ATTACKER };
      const result = parseConnectionRecord(rec);
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain(ATTACKER);
      expect(JSON.stringify(result)).not.toContain("PII_홍길동");
    }
  });

  it("does not leak the bound fingerprint's raw source identity in any record", () => {
    const rec = toConnectionRecord(bound());
    expect(JSON.stringify(rec)).not.toContain(FAKE_RAW_IDENTITY);
    // The stored fingerprint is the hash, not the raw token.
    expect(rec.boundStoreFingerprintHash).toBe(fingerprintHash(FAKE_RAW_IDENTITY));
  });
});
