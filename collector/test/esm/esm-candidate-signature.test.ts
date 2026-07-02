import { describe, expect, it } from "vitest";
import {
  buildCandidateSignatureRecord,
  candidateSignatureMatches,
  CANDIDATE_SIGNATURE_SCHEMA_VERSION,
  computeCandidateSignature,
  InMemoryCandidateSignatureStore,
  type CandidateShape,
  type CandidateSignatureRecord,
} from "../../src/esm/esm-candidate-signature";
import type { SanitizedAccountRef } from "../../src/connection/sync-state";

const SALT = "unit-test-salt";

const ACCOUNT: SanitizedAccountRef = {
  connectionId: "conn-esm-0001",
  boundStoreFingerprintHash: "hash-store-abc",
  fingerprintSourceCategory: "account-scope",
};

const APPROVED_SHAPE: CandidateShape = {
  category: "export-like",
  actionable: true,
  scope: "allowlisted-frame",
  labelShape: { tokenCountBucket: "few", script: "hangul", hasExportWord: true },
};

describe("esm-candidate-signature — compute / compare", () => {
  it("is deterministic and salted (same shape+salt → same sig; different salt → different sig)", () => {
    const a = computeCandidateSignature(APPROVED_SHAPE, SALT);
    const b = computeCandidateSignature(APPROVED_SHAPE, SALT);
    expect(a).toBe(b);
    expect(computeCandidateSignature(APPROVED_SHAPE, "other-salt")).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{32}$/); // salted one-way hex, no raw content
  });

  it("fails closed on an empty salt", () => {
    expect(() => computeCandidateSignature(APPROVED_SHAPE, "")).toThrow(/salt/i);
  });

  it("matches an identical live shape and REJECTS a same-count control swap", () => {
    const record = buildCandidateSignatureRecord(APPROVED_SHAPE, ACCOUNT, SALT, "2026-07-02T00:00:00Z");
    expect(candidateSignatureMatches(record, APPROVED_SHAPE, SALT)).toBe(true);

    // Same actionable count (still exactly one), but the control CHANGED — every
    // discriminating field must break the match (this is the whole point of §5a).
    const swaps: CandidateShape[] = [
      { ...APPROVED_SHAPE, category: "consent-like" },
      { ...APPROVED_SHAPE, actionable: false },
      { ...APPROVED_SHAPE, scope: "top-document" },
      { ...APPROVED_SHAPE, labelShape: { ...APPROVED_SHAPE.labelShape, hasExportWord: false } },
      { ...APPROVED_SHAPE, labelShape: { ...APPROVED_SHAPE.labelShape, tokenCountBucket: "many" } },
      { ...APPROVED_SHAPE, labelShape: { ...APPROVED_SHAPE.labelShape, script: "latin" } },
    ];
    for (const swap of swaps) {
      expect(candidateSignatureMatches(record, swap, SALT)).toBe(false);
    }
  });

  it("a schema-version bump on the stored record forces a re-approval (never matches)", () => {
    const record = buildCandidateSignatureRecord(APPROVED_SHAPE, ACCOUNT, SALT, "2026-07-02T00:00:00Z");
    const stale: CandidateSignatureRecord = { ...record, schemaVersion: CANDIDATE_SIGNATURE_SCHEMA_VERSION + 1 };
    expect(candidateSignatureMatches(stale, APPROVED_SHAPE, SALT)).toBe(false);
  });

  it("the record carries ONLY sanitized fields — no raw text / selector / label / URL / ID", () => {
    const record = buildCandidateSignatureRecord(APPROVED_SHAPE, ACCOUNT, SALT, "2026-07-02T00:00:00Z");
    expect(Object.keys(record).sort()).toEqual(["account", "approvedAt", "schemaVersion", "signature"]);
    expect(record.schemaVersion).toBe(CANDIDATE_SIGNATURE_SCHEMA_VERSION);
    // The serialized record must not leak the salt or any raw candidate wording.
    const serialized = JSON.stringify(record);
    expect(serialized.includes(SALT)).toBe(false);
    expect(serialized.includes("export-like")).toBe(false); // the coarse category is folded into the hash, not stored
    expect(serialized.includes("엑셀")).toBe(false);
    expect(record.account).toBe(ACCOUNT); // hash-only account ref, unchanged
  });
});

describe("esm-candidate-signature — in-memory store adapter (no real persistence)", () => {
  it("round-trips a record per account and returns null for an unknown account", async () => {
    const store = new InMemoryCandidateSignatureStore();
    expect(await store.load(ACCOUNT)).toBeNull();

    const record = buildCandidateSignatureRecord(APPROVED_SHAPE, ACCOUNT, SALT, "2026-07-02T00:00:00Z");
    await store.save(record);
    expect(await store.load(ACCOUNT)).toEqual(record);

    const other: SanitizedAccountRef = { ...ACCOUNT, connectionId: "conn-esm-0002" };
    expect(await store.load(other)).toBeNull(); // account-scoped isolation
  });

  it("save overwrites the record for the same account (re-approval replaces the prior signature)", async () => {
    const store = new InMemoryCandidateSignatureStore();
    const first = buildCandidateSignatureRecord(APPROVED_SHAPE, ACCOUNT, SALT, "2026-07-01T00:00:00Z");
    await store.save(first);
    const changed: CandidateShape = { ...APPROVED_SHAPE, labelShape: { ...APPROVED_SHAPE.labelShape, script: "latin" } };
    const second = buildCandidateSignatureRecord(changed, ACCOUNT, SALT, "2026-07-02T00:00:00Z");
    await store.save(second);
    expect(await store.load(ACCOUNT)).toEqual(second);
  });
});
