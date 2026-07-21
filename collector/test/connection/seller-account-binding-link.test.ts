/**
 * The registry↔account link: the `seller-account-binding/v1` fingerprint, and the schema-2 record that
 * carries it (including reading a schema-1 record written before the field existed).
 */
import { describe, it, expect } from "vitest";
import {
  MAX_SELLER_ACCOUNT_ID_LENGTH,
  isWellFormedSellerAccountId,
  sellerAccountFingerprint,
} from "../../src/connection/seller-account-fingerprint";
import { channelReviewIdFingerprint } from "../../src/action-window/reply-submission/review-id-fingerprint";
import {
  CONNECTION_SCHEMA_VERSION,
  SUPPORTED_CONNECTION_SCHEMA_VERSIONS,
  parseConnectionRecord,
  toConnectionRecord,
} from "../../src/connection/record";
import {
  bindConnectionToSellerAccount,
  createPendingConnection,
} from "../../src/connection/connection";

const ACCOUNT = "11111111-2222-3333-4444-555555555555";

describe("sellerAccountFingerprint", () => {
  it("is a stable lowercase 64-hex digest", () => {
    const fp = sellerAccountFingerprint(ACCOUNT)!;
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
    expect(sellerAccountFingerprint(ACCOUNT)).toBe(fp);
    expect(fp).not.toContain(ACCOUNT);
  });

  it("is domain-separated from review-id-fingerprint/v1, so digests cannot be confused", () => {
    // Same input, two contracts: the digests must not collide.
    expect(sellerAccountFingerprint(ACCOUNT)).not.toBe(channelReviewIdFingerprint(ACCOUNT));
  });

  it("returns null rather than digesting a malformed id", () => {
    for (const bad of ["", " ", "has space", "tab\there", "x".repeat(MAX_SELLER_ACCOUNT_ID_LENGTH + 1), "한글"]) {
      expect(sellerAccountFingerprint(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(sellerAccountFingerprint(null)).toBeNull();
    expect(sellerAccountFingerprint(undefined)).toBeNull();
  });

  it("accepts an id exactly at the ceiling", () => {
    const atLimit = "a".repeat(MAX_SELLER_ACCOUNT_ID_LENGTH);
    expect(isWellFormedSellerAccountId(atLimit)).toBe(true);
    expect(sellerAccountFingerprint(atLimit)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("connection record schema 3", () => {
  const pending = createPendingConnection({
    connectionId: "conn-1",
    platform: "NAVER_SMARTSTORE",
    userProvidedDisplayName: "alias",
    now: "2026-07-20T00:00:00.000Z",
  });

  it("starts unlinked and round-trips the link once bound", () => {
    expect(pending.boundSellerAccountFingerprint).toBeNull();
    const linked = bindConnectionToSellerAccount(pending, sellerAccountFingerprint(ACCOUNT)!);
    const parsed = parseConnectionRecord(JSON.parse(JSON.stringify(toConnectionRecord(linked))));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.connection.boundSellerAccountFingerprint).toBe(sellerAccountFingerprint(ACCOUNT));
    // Linking an account is bookkeeping, not a verification — status must be untouched.
    expect(parsed.connection.connectionStatus).toBe(pending.connectionStatus);
  });

  it("writes the current version and accepts every supported version", () => {
    expect(CONNECTION_SCHEMA_VERSION).toBe(3);
    expect(SUPPORTED_CONNECTION_SCHEMA_VERSIONS).toEqual([1, 2, 3]);
    expect(toConnectionRecord(pending).schemaVersion).toBe(3);
  });

  it("never honours a session identity on a record below v3, even if one is present", () => {
    // Same rule one version up: v2 could not legitimately carry these fields, so a value there can only
    // have been written by hand — and it would assert a session binding the schema never supported.
    const forged = {
      ...toConnectionRecord(pending),
      schemaVersion: 2,
      boundSessionIdentityFingerprint: "f".repeat(64),
      boundShopDisplayName: "Some Shop",
    };
    const parsed = parseConnectionRecord(forged);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.connection.boundSessionIdentityFingerprint).toBeNull();
    expect(parsed.connection.boundShopDisplayName).toBeNull();
  });

  it("reads a schema-1 record written before the field existed, as UNLINKED", () => {
    const v1 = { ...toConnectionRecord(pending), schemaVersion: 1 } as Record<string, unknown>;
    delete v1.boundSellerAccountFingerprint;
    const parsed = parseConnectionRecord(v1);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // Absent must mean "not bound" — never inferred, never back-filled.
    expect(parsed.connection.boundSellerAccountFingerprint).toBeNull();
  });

  it("never honours an account link on a schema-1 record, even if one is present", () => {
    // v1 could not legitimately carry the field, so a value there can only have been written by hand.
    const forged = { ...toConnectionRecord(pending), schemaVersion: 1, boundSellerAccountFingerprint: "f".repeat(64) };
    const parsed = parseConnectionRecord(forged);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.connection.boundSellerAccountFingerprint).toBeNull();
  });

  it("rejects a schema-2 record that is MISSING the field, rather than defaulting it", () => {
    const v2 = { ...toConnectionRecord(pending) } as Record<string, unknown>;
    delete v2.boundSellerAccountFingerprint;
    expect(parseConnectionRecord(v2)).toEqual({
      ok: false,
      errorCategory: "missing-or-wrong-type-field",
    });
  });

  it("rejects a wrong-typed link and an unknown version with fixed categories only", () => {
    expect(
      parseConnectionRecord({ ...toConnectionRecord(pending), boundSellerAccountFingerprint: 42 }),
    ).toEqual({ ok: false, errorCategory: "missing-or-wrong-type-field" });
    expect(parseConnectionRecord({ ...toConnectionRecord(pending), schemaVersion: 4 })).toEqual({
      ok: false,
      errorCategory: "unknown-schema-version",
    });
    expect(parseConnectionRecord({ ...toConnectionRecord(pending), schemaVersion: "3" })).toEqual({
      ok: false,
      errorCategory: "unknown-schema-version",
    });
  });
});
