/**
 * The read-only store-identity diagnostic: what it reports, what it refuses to conclude, and the invariant
 * that no raw value survives into its output.
 */
import { describe, it, expect } from "vitest";
import {
  DIAGNOSTIC_FINGERPRINT_CHARS,
  summariseStoreIdentity,
} from "../../../src/action-window/reply-submission/store-identity-diagnostic";
import { fingerprintHash } from "../../../src/connection/connection";
import type { AccountIdHit } from "../../../src/action-window/reply-submission/session-account-identity";

const ROOTS = ["__NEXT_DATA__", "inline-json"];

describe("summariseStoreIdentity — what the page exposed", () => {
  it("reports a single-valued key with its roots and a truncated fingerprint", () => {
    const d = summariseStoreIdentity(
      [
        { key: "channelNo", value: "100200300", root: "__NEXT_DATA__" },
        { key: "channelNo", value: "100200300", root: "inline-json" },
      ],
      ROOTS,
      false,
    );
    expect(d.observations).toHaveLength(1);
    const o = d.observations[0]!;
    expect(o.key).toBe("channelNo");
    expect(o.roots).toEqual(["__NEXT_DATA__", "inline-json"]);
    expect(o.distinctValueCount).toBe(1);
    expect(o.conflicting).toBe(false);
    expect(o.truncatedFingerprint).toBe(
      fingerprintHash("channelNo=100200300").slice(0, DIAGNOSTIC_FINGERPRINT_CHARS),
    );
    expect(d.candidateKeys).toEqual(["channelNo"]);
    expect(d.foundStableCandidate).toBe(true);
  });

  it("reports a conflicting key as unusable, and gives it NO fingerprint", () => {
    const d = summariseStoreIdentity(
      [
        { key: "mallNo", value: "111111", root: "__NEXT_DATA__" },
        { key: "mallNo", value: "222222", root: "__NEXT_DATA__" },
      ],
      ROOTS,
      false,
    );
    const o = d.observations[0]!;
    expect(o.conflicting).toBe(true);
    expect(o.distinctValueCount).toBe(2);
    // Fingerprinting one of two values would suggest a stability the evidence does not show.
    expect(o.truncatedFingerprint).toBeNull();
    expect(d.candidateKeys).toEqual([]);
    expect(d.conflictingKeys).toEqual(["mallNo"]);
    expect(d.foundStableCandidate).toBe(false);
  });

  it("keeps the two independent, so one bad key does not hide a good one", () => {
    const d = summariseStoreIdentity(
      [
        { key: "channelNo", value: "100200300", root: "__NEXT_DATA__" },
        { key: "sellerNo", value: "1", root: "__NEXT_DATA__" },
        { key: "mallNo", value: "111111", root: "__NEXT_DATA__" },
        { key: "mallNo", value: "222222", root: "__NEXT_DATA__" },
      ],
      ROOTS,
      false,
    );
    expect(d.candidateKeys).toEqual(["channelNo"]);
    expect(d.conflictingKeys).toEqual(["mallNo"]);
    // `sellerNo: "1"` fails the shared value shape, so it is invisible here exactly as it would be to the
    // real chooser — reporting it would send the operator to pin something that could never work.
    expect(d.observations.map((o) => o.key)).toEqual(["channelNo", "mallNo"]);
  });

  it("ignores keys outside the allow-list", () => {
    const d = summariseStoreIdentity([{ key: "notAnIdKey", value: "100200300" }], ROOTS, false);
    expect(d.observations).toEqual([]);
    expect(d.foundStableCandidate).toBe(false);
  });
});

describe("summariseStoreIdentity — trust of the SOURCE is part of the success test", () => {
  it("does not call an inline-json-only key a stable candidate", () => {
    // Inline page markup is weaker evidence than real SPA state. The success criterion says "from a trusted
    // source", so a key seen only there must not read as success — it is still reported as evidence.
    const d = summariseStoreIdentity(
      [{ key: "storeId", value: "SOMEVALUE", root: "inline-json" }],
      ["inline-json"],
      false,
    );
    expect(d.candidateKeys).toEqual(["storeId"]);
    expect(d.trustedCandidateKeys).toEqual([]);
    expect(d.foundStableCandidate).toBe(false);
  });

  it("does not call a key with NO root attribution a stable candidate", () => {
    const d = summariseStoreIdentity([{ key: "channelNo", value: "100200300" }], [], false);
    expect(d.trustedCandidateKeys).toEqual([]);
    expect(d.foundStableCandidate).toBe(false);
  });

  it("accepts a key seen in an SPA state root", () => {
    const d = summariseStoreIdentity(
      [
        { key: "channelNo", value: "100200300", root: "__NEXT_DATA__" },
        { key: "storeId", value: "SOMEVALUE", root: "inline-json" },
      ],
      ["__NEXT_DATA__", "inline-json"],
      false,
    );
    expect(d.trustedCandidateKeys).toEqual(["channelNo"]);
    expect(d.foundStableCandidate).toBe(true);
  });

  it("survives a null/odd root from an untrusted page instead of killing the run", () => {
    // A TypeError here would end a 15-minute operator wait with no record written.
    const hostile = [
      { key: "channelNo", value: "100200300", root: null },
      { key: "mallNo", value: "AB99", root: 7 },
    ] as unknown as Parameters<typeof summariseStoreIdentity>[0];
    expect(() => summariseStoreIdentity(hostile, [], false)).not.toThrow();
    expect(summariseStoreIdentity(hostile, [], false).foundStableCandidate).toBe(false);
  });
});

describe("summariseStoreIdentity — it refuses to over-conclude", () => {
  it("does not claim a stable candidate when the walk was truncated", () => {
    // A ceiling may have hidden a SECOND value for a key that looks single-valued here.
    const hits: AccountIdHit[] = [{ key: "channelNo", value: "100200300", root: "__NEXT_DATA__" }];
    expect(summariseStoreIdentity(hits, ROOTS, false).foundStableCandidate).toBe(true);
    const truncated = summariseStoreIdentity(hits, ROOTS, true);
    expect(truncated.truncated).toBe(true);
    expect(truncated.foundStableCandidate).toBe(false);
    // The observation is still reported — the operator needs the evidence, just not the conclusion.
    expect(truncated.candidateKeys).toEqual(["channelNo"]);
  });

  it("reports nothing found rather than an empty success", () => {
    const d = summariseStoreIdentity([], [], false);
    expect(d.observations).toEqual([]);
    expect(d.candidateKeys).toEqual([]);
    expect(d.foundStableCandidate).toBe(false);
  });
});

describe("summariseStoreIdentity — no raw value survives", () => {
  it("carries key names, root labels and digest prefixes, never a value", () => {
    const VALUE = "STORE_VALUE_CANARY";
    const d = summariseStoreIdentity(
      [
        { key: "channelNo", value: VALUE, root: "__NEXT_DATA__" },
        { key: "mallNo", value: "AA", root: "__NEXT_DATA__" },
        { key: "mallNo", value: "BB", root: "__NEXT_DATA__" },
      ],
      ROOTS,
      false,
    );
    const serialized = JSON.stringify(d);
    expect(serialized).not.toContain(VALUE);
    expect(serialized).not.toContain(fingerprintHash(`channelNo=${VALUE}`));
    // Key names and root labels are NAVER's own field names and global variable names — not identity.
    expect(serialized).toContain("channelNo");
    expect(serialized).toContain("__NEXT_DATA__");
  });

  it("truncates the digest to a COMPARISON handle — which is not the same as a redaction", () => {
    const d = summariseStoreIdentity(
      [{ key: "channelNo", value: "100200300", root: "__NEXT_DATA__" }],
      ROOTS,
      false,
    );
    const fp = d.observations[0]!.truncatedFingerprint!;
    expect(fp).toHaveLength(DIAGNOSTIC_FINGERPRINT_CHARS);
    // The only property that matters and the only one asserted: it shares a prefix with the digest a real
    // binding would store, so a second run against another store is directly comparable. Length says
    // NOTHING about recoverability — the key name is printed beside it and the value space is small, so a
    // reviewer brute-forced the full 9-digit space in minutes. What protects the value is the 0600 local
    // record, not the truncation.
    expect(fingerprintHash("channelNo=100200300").startsWith(fp)).toBe(true);
  });
});
