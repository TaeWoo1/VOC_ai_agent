/**
 * `review-body-fingerprint/v1` — the collector side of the shared golden-vector proof. Loading the SAME
 * `contracts/review-fingerprint/v1/golden-vectors.json` that the Java `ReviewBodyFingerprintTest` loads, and
 * both passing, is the cross-language equivalence proof.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  normalizeForFingerprint,
  reviewBodyFingerprint,
} from "../../../src/action-window/reply-submission/review-body-fingerprint";

const HERE = dirname(fileURLToPath(import.meta.url));
interface Vector { name: string; raw: string; normalized: string; fingerprint: string }
const VECTORS = JSON.parse(
  readFileSync(resolve(HERE, "../../../../contracts/review-fingerprint/v1/golden-vectors.json"), "utf8"),
) as { spec: string; cases: Vector[] };

describe("review-body-fingerprint/v1 — shared synthetic golden vectors", () => {
  it("loads the v1 spec vectors", () => {
    expect(VECTORS.spec).toBe("review-body-fingerprint/v1");
    expect(VECTORS.cases.length).toBeGreaterThanOrEqual(8);
  });

  for (const c of VECTORS.cases) {
    it(`normalizes '${c.name}' to the golden form`, () => {
      expect(normalizeForFingerprint(c.raw)).toBe(c.normalized);
    });
    it(`fingerprints '${c.name}' to the golden hash`, () => {
      expect(c.fingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(reviewBodyFingerprint(c.raw)).toBe(c.fingerprint);
    });
  }

  it("CRLF and LF bodies fingerprint identically", () => {
    const crlf = VECTORS.cases.find((c) => c.name === "crlf")!;
    const lf = VECTORS.cases.find((c) => c.name === "lf-equiv-crlf")!;
    expect(reviewBodyFingerprint(crlf.raw)).toBe(reviewBodyFingerprint(lf.raw));
  });

  it("the PII case tokenizes volatile spans and no raw span survives normalization", () => {
    const pii = VECTORS.cases.find((c) => c.name === "pii-body")!;
    const norm = normalizeForFingerprint(pii.raw);
    for (const tok of ["[링크]", "[이메일]", "[전화번호]", "[번호]"]) expect(norm).toContain(tok);
    for (const raw of ["naver.me", "hong@test.com", "010-1234-5678", "02-345-6789", "1234567890"]) {
      expect(norm).not.toContain(raw);
    }
  });

  it("empty/whitespace-only input yields a valid 64-hex fingerprint", () => {
    expect(reviewBodyFingerprint("")).toMatch(/^[0-9a-f]{64}$/);
    expect(normalizeForFingerprint("   \n\t  ")).toBe("");
  });
});
