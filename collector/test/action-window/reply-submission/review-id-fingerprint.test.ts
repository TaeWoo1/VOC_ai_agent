/**
 * `review-id-fingerprint/v1` — the collector side of the shared golden-vector proof. The SAME
 * `contracts/review-id-fingerprint/v1/golden-vectors.json` is loaded by the Java `ReviewIdFingerprintTest`
 * and (in the browser rung) by the in-page port; all three passing is the cross-language equivalence proof.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  MAX_CHANNEL_REVIEW_ID_LENGTH,
  canonicalizeChannelReviewId,
  channelReviewIdFingerprint,
  isWellFormedChannelReviewId,
} from "../../../src/action-window/reply-submission/review-id-fingerprint";
import { reviewBodyFingerprint } from "../../../src/action-window/reply-submission/review-body-fingerprint";

const HERE = dirname(fileURLToPath(import.meta.url));
interface Vector {
  name: string;
  raw: string;
  canonical: string;
  wellFormed: boolean;
  fingerprint: string | null;
}
export const REVIEW_ID_VECTORS = JSON.parse(
  readFileSync(resolve(HERE, "../../../../contracts/review-id-fingerprint/v1/golden-vectors.json"), "utf8"),
) as { spec: string; cases: Vector[] };

describe("review-id-fingerprint/v1 — shared synthetic golden vectors", () => {
  it("loads the v1 spec vectors", () => {
    expect(REVIEW_ID_VECTORS.spec).toBe("review-id-fingerprint/v1");
    expect(REVIEW_ID_VECTORS.cases.length).toBeGreaterThanOrEqual(12);
  });

  it("the vector file is ASCII-only, so no port can be broken by transport mangling", () => {
    const raw = readFileSync(
      resolve(HERE, "../../../../contracts/review-id-fingerprint/v1/golden-vectors.json"),
      "utf8",
    );
    const exotic = [...raw].filter((c) => {
      const cp = c.codePointAt(0)!;
      return cp !== 0x0a && (cp < 0x20 || cp > 0x7e);
    });
    expect(exotic).toEqual([]);
  });

  for (const c of REVIEW_ID_VECTORS.cases) {
    it(`canonicalizes '${c.name}' to the golden form`, () => {
      expect(canonicalizeChannelReviewId(c.raw)).toBe(c.canonical);
    });
    it(`classifies '${c.name}' well-formedness as ${c.wellFormed}`, () => {
      expect(isWellFormedChannelReviewId(canonicalizeChannelReviewId(c.raw))).toBe(c.wellFormed);
    });
    it(`fingerprints '${c.name}' to the golden value`, () => {
      if (c.fingerprint === null) {
        expect(channelReviewIdFingerprint(c.raw)).toBeNull();
      } else {
        expect(c.fingerprint).toMatch(/^[0-9a-f]{64}$/);
        expect(channelReviewIdFingerprint(c.raw)).toBe(c.fingerprint);
      }
    });
  }
});

describe("review-id-fingerprint/v1 — the properties the locator depends on", () => {
  const vector = (name: string) => REVIEW_ID_VECTORS.cases.find((c) => c.name === name)!;

  it("every padding/zero-width/BOM variant of one id collapses to a single digest", () => {
    const variants = [
      "naver-10-digit",
      "ascii-space-padded",
      "newline-padded",
      "ideographic-space-padded",
      "nbsp-padded",
      "zero-width-inside",
      "bom-prefixed",
    ].map((n) => channelReviewIdFingerprint(vector(n).raw));
    expect(new Set(variants).size).toBe(1);
    expect(variants[0]).not.toBeNull();
  });

  it("NFD and NFC spellings of the same id are the same identity", () => {
    expect(channelReviewIdFingerprint(vector("nfd-normalizes-to-nfc").raw)).toBe(
      channelReviewIdFingerprint(vector("nfc-equivalent").raw),
    );
  });

  it("a malformed id yields null, never a digest — garbage can never be matched", () => {
    for (const name of ["empty", "whitespace-only", "internal-space", "control-char", "too-long-121"]) {
      expect(channelReviewIdFingerprint(vector(name).raw)).toBeNull();
    }
    expect(channelReviewIdFingerprint(null)).toBeNull();
    expect(channelReviewIdFingerprint(undefined)).toBeNull();
  });

  it("EVERY pinned whitespace code point has its own vector, and all collapse to one digest", () => {
    // Without a vector per code point, a port that silently dropped one from its class would still pass.
    const pinned = [
      0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0020, 0x0085, 0x00a0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003,
      0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
    ];
    const base = vector("naver-10-digit").fingerprint;
    for (const cp of pinned) {
      const name = `ws-u${cp.toString(16).padStart(4, "0")}-padded`;
      const c = REVIEW_ID_VECTORS.cases.find((v) => v.name === name);
      expect(c, `missing vector ${name}`).toBeDefined();
      expect(c!.fingerprint, name).toBe(base);
      expect(channelReviewIdFingerprint(c!.raw), name).toBe(base);
    }
  });

  it("the length boundary is exactly the persisted column width", () => {
    expect(MAX_CHANNEL_REVIEW_ID_LENGTH).toBe(120);
    expect(channelReviewIdFingerprint("9".repeat(120))).not.toBeNull();
    expect(channelReviewIdFingerprint("9".repeat(121))).toBeNull();
  });

  it("is domain-separated from the review-BODY fingerprint for the same input", () => {
    const id = "1234567890";
    expect(channelReviewIdFingerprint(id)).not.toBe(reviewBodyFingerprint(id));
  });

  it("is deterministic across calls (module-level regex state cannot leak between invocations)", () => {
    const first = channelReviewIdFingerprint("  1234567890  ");
    const second = channelReviewIdFingerprint("  1234567890  ");
    const third = channelReviewIdFingerprint("  1234567890  ");
    expect(first).toBe(second);
    expect(second).toBe(third);
  });
});
