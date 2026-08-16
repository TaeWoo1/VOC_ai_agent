/**
 * `review-id-fingerprint/v1`, fourth port — the calibration tooling's own copy.
 *
 * Byte-identical to the Java, collector and in-page ports by construction, and PROVEN so on import:
 * `assertParity()` runs the committed golden vectors and throws if any digest disagrees. A tool that
 * fingerprinted differently would silently label reviews the harness could never match, and the
 * failure would look like "the operator labeled the wrong rows".
 *
 * `node:crypto` only. Never logs its input.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

// Pinned literally rather than JS `\s` — Java `(?U)\s` and JS `\s` disagree (U+0085 vs U+FEFF) and
// would diverge the ports. Exotic code points stay as `\u` escapes so this file remains ASCII.
const WHITESPACE_CLASS = "\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const TRIM = new RegExp(`^[${WHITESPACE_CLASS}]+|[${WHITESPACE_CLASS}]+$`, "gu");
const ANY_WHITESPACE = new RegExp(`[${WHITESPACE_CLASS}]`, "u");
const ZERO_WIDTH = new RegExp("[\\u200b\\u200c\\u200d\\ufeff]", "gu");
const CONTROL = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f]", "u");
const MAX_LENGTH = 120;
const DOMAIN = "review-id-fingerprint/v1\n";

export function canonicalize(raw) {
  return (raw ?? "").normalize("NFC").replace(ZERO_WIDTH, "").replace(TRIM, "");
}

export function isWellFormed(canonical) {
  return (
    canonical.length > 0 &&
    canonical.length <= MAX_LENGTH &&
    !ANY_WHITESPACE.test(canonical) &&
    !CONTROL.test(canonical)
  );
}

/** Lowercase 64-hex, or `null` for a malformed id — never a digest over garbage. */
export function reviewIdFingerprint(raw) {
  const canonical = canonicalize(raw);
  if (!isWellFormed(canonical)) return null;
  return createHash("sha256").update(DOMAIN + canonical, "utf8").digest("hex");
}

/**
 * The two ordering functions RUBRIC.md v2 sections 4.3 and 6.1 pin. Both are pure functions of the
 * fingerprint, which is what lets the sample and the split be re-derived from the database instead
 * of committed — nothing about which reviews a seller received has to leave the machine.
 */
export function sampleOrderKey(fingerprint) {
  return createHash("sha256").update(`review-eval-sample/v2\n${fingerprint}`, "utf8").digest("hex");
}

export function splitOf(fingerprint) {
  const digest = createHash("sha256").update(`review-eval-split/v2\n${fingerprint}`, "utf8").digest();
  return digest[0] % 2 === 0 ? "DEV" : "HOLDOUT";
}

/** Throws unless every committed golden vector reproduces. Called by both entry points. */
export function assertParity() {
  const vectors = JSON.parse(
    readFileSync(resolve(HERE, "../../contracts/review-id-fingerprint/v1/golden-vectors.json"), "utf8"),
  );
  for (const c of vectors.cases) {
    const actual = reviewIdFingerprint(c.raw);
    if (actual !== c.fingerprint) {
      throw new Error(`review-id-fingerprint parity FAILED on vector "${c.name}"`);
    }
  }
  return vectors.cases.length;
}
