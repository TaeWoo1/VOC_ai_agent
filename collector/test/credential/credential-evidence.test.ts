/**
 * What a handoff is allowed to SAY about the values it moved. Every case here is the same question from a
 * different angle: can the record be inverted back to a secret.
 */
import { describe, expect, it } from "vitest";
import {
  CredentialDigestSalt,
  credentialCharClass,
  credentialEvidenceFor,
  credentialFieldEvidence,
  credentialFieldsDistinct,
  credentialLengthBucket,
} from "../../src/credential/credential-evidence";

const VENDOR = "V-00099";
const ACCESS = "8f2c1ab4d5e6f70819a2b3c4d5e6f708";
const SECRET = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4";
const TRIPLE = { vendor_id: VENDOR, access_key: ACCESS, secret_key: SECRET };

describe("the coarse shape", () => {
  it("buckets a length instead of reporting one", () => {
    expect(credentialLengthBucket("")).toBe("empty");
    expect(credentialLengthBucket(VENDOR)).toBe("short_1_15");
    expect(credentialLengthBucket(ACCESS)).toBe("medium_16_39");
    expect(credentialLengthBucket(SECRET)).toBe("long_40_plus");
  });

  it("classifies the alphabet, and answers `other` for prose", () => {
    expect(credentialCharClass(ACCESS)).toBe("hex_lower");
    expect(credentialCharClass(ACCESS.toUpperCase())).toBe("hex_upper");
    expect(credentialCharClass("Vendor00099")).toBe("alnum");
    expect(credentialCharClass(VENDOR)).toBe("alnum_symbol");
    // The point of having this at all: noticing that a field which should hold a key arrived holding a LABEL.
    expect(credentialCharClass("업체코드")).toBe("other");
  });
});

describe("the digest is salted per run, and that is the whole point", () => {
  it("is 12 hex characters and nothing recognisable", () => {
    const d = CredentialDigestSalt.forTest("salt-a").digest(VENDOR);
    expect(d).toMatch(/^[0-9a-f]{12}$/);
    expect(d).not.toContain(VENDOR);
  });

  it("differs between runs for the SAME value — so it is not a cross-run identifier", () => {
    // 업체코드 is short and structured. An unsalted hash of it is invertible by anyone with a candidate list;
    // this is the property that removes that, and it is worth an explicit test rather than a comment.
    const a = CredentialDigestSalt.forTest("salt-a").digest(VENDOR);
    const b = CredentialDigestSalt.forTest("salt-b").digest(VENDOR);
    expect(a).not.toBe(b);
  });

  it("is stable WITHIN a run — which is what makes it useful for telling three values apart", () => {
    const salt = CredentialDigestSalt.forTest("salt-a");
    expect(salt.digest(VENDOR)).toBe(salt.digest(VENDOR));
    expect(salt.digest(VENDOR)).not.toBe(salt.digest(ACCESS));
  });

  it("a fresh run salt is not the test salt, and two runs do not share one", () => {
    expect(CredentialDigestSalt.forRun().digest(VENDOR)).not.toBe(CredentialDigestSalt.forRun().digest(VENDOR));
  });
});

describe("the evidence record", () => {
  const salt = CredentialDigestSalt.forTest("salt-a");

  it("carries no value, in any field, for any of the three", () => {
    const serialized = JSON.stringify(credentialEvidenceFor(TRIPLE, salt));
    for (const secret of [VENDOR, ACCESS, SECRET]) expect(serialized).not.toContain(secret);
  });

  it("carries no SUBSTRING of a value either — the digest is not a prefix", () => {
    const serialized = JSON.stringify(credentialEvidenceFor(TRIPLE, salt));
    for (const secret of [VENDOR, ACCESS, SECRET]) {
      for (let n = 4; n <= secret.length; n++) expect(serialized).not.toContain(secret.slice(0, n));
    }
  });

  it("is ordered by key, so two records of one handoff compare line by line", () => {
    expect(credentialEvidenceFor(TRIPLE, salt).map((e) => e.key)).toEqual(["access_key", "secret_key", "vendor_id"]);
  });

  it("names each field and its shape", () => {
    expect(credentialFieldEvidence("access_key", ACCESS, salt)).toMatchObject({
      key: "access_key",
      present: true,
      lengthBucket: "medium_16_39",
      charClass: "hex_lower",
    });
  });
});

describe("three cells holding one string are not three credentials", () => {
  const salt = CredentialDigestSalt.forTest("salt-a");

  it("distinct values pass", () => {
    expect(credentialFieldsDistinct(credentialEvidenceFor(TRIPLE, salt))).toBe(true);
  });

  it("a repeated value fails — the shape a locator that read one cell three times produces", () => {
    const same = { vendor_id: ACCESS, access_key: ACCESS, secret_key: ACCESS };
    expect(credentialFieldsDistinct(credentialEvidenceFor(same, salt))).toBe(false);
  });

  it("compares digests, so the check itself carries nothing", () => {
    const evidence = credentialEvidenceFor(TRIPLE, salt);
    credentialFieldsDistinct(evidence);
    expect(JSON.stringify(evidence)).not.toContain(ACCESS);
  });
});
