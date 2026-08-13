/**
 * **What a credential handoff is allowed to say about the values it moved.** Every export here takes a secret and
 * returns something that is not one.
 *
 * The rule this implements is `docs/coupang_credential_handoff_v1.md` §8: a run's record carries a status, a
 * coarse shape, and a salted digest — never a value, and never a substring of one.
 *
 * Imports `node:crypto` and nothing else, so it is testable without a browser, a backend, or a network.
 */
import { createHmac, randomBytes } from "node:crypto";

/** Coarse length bands. Exact lengths are omitted on principle rather than on threat: they are free to omit. */
export const CREDENTIAL_LENGTH_BUCKETS = ["empty", "short_1_15", "medium_16_39", "long_40_plus"] as const;
export type CredentialLengthBucket = (typeof CREDENTIAL_LENGTH_BUCKETS)[number];

/**
 * The character alphabet a value uses. Coarse and closed — enough to notice that a field which should be a hex
 * key arrived holding Korean prose (i.e. that the locator read a label, not a value), and not enough to
 * reconstruct anything.
 */
export const CREDENTIAL_CHAR_CLASSES = ["hex_lower", "hex_upper", "alnum", "alnum_symbol", "other"] as const;
export type CredentialCharClass = (typeof CREDENTIAL_CHAR_CLASSES)[number];

/** One field's value-free shape. This is the whole of what a log, a record, or a status file may carry. */
export interface CredentialFieldEvidence {
  readonly key: string;
  readonly present: boolean;
  readonly lengthBucket: CredentialLengthBucket;
  readonly charClass: CredentialCharClass;
  /** First 12 hex of the per-run salted digest — see {@link CredentialDigestSalt}. */
  readonly digest: string;
}

export function credentialLengthBucket(value: string): CredentialLengthBucket {
  const n = value.length;
  if (n === 0) return "empty";
  if (n <= 15) return "short_1_15";
  if (n <= 39) return "medium_16_39";
  return "long_40_plus";
}

export function credentialCharClass(value: string): CredentialCharClass {
  if (value.length === 0) return "other";
  if (/^[0-9a-f]+$/.test(value)) return "hex_lower";
  if (/^[0-9A-F]+$/.test(value)) return "hex_upper";
  if (/^[0-9A-Za-z]+$/.test(value)) return "alnum";
  if (/^[0-9A-Za-z._:@/+=-]+$/.test(value)) return "alnum_symbol";
  return "other";
}

/**
 * **A per-run digest key, held in memory and never written anywhere.**
 *
 * An unsalted hash of 업체코드 is an enumeration oracle: the vendor code is short, structured, and low-entropy, so
 * anyone holding a candidate list can invert a plain SHA-256 of it offline. Salting per run removes that and
 * costs the digest only the property it was never supposed to have — being comparable across runs.
 *
 * What the digest is FOR, therefore: telling three values apart from each other inside one run, and referring to
 * one of them later in that run without carrying it. The backend cannot compute it and is never asked to.
 */
export class CredentialDigestSalt {
  private readonly salt: Buffer;

  private constructor(salt: Buffer) {
    this.salt = salt;
  }

  /** A fresh 32-byte CSPRNG salt. One per run; there is deliberately no way to supply or persist one. */
  static forRun(): CredentialDigestSalt {
    return new CredentialDigestSalt(randomBytes(32));
  }

  /** Test seam: a fixed salt, so a digest assertion is deterministic. Never reachable from production code. */
  static forTest(seed: string): CredentialDigestSalt {
    return new CredentialDigestSalt(Buffer.from(seed, "utf8"));
  }

  /** `credential-handoff-digest/v1` — first 12 hex of HMAC-SHA256(salt, value). */
  digest(value: string): string {
    return createHmac("sha256", this.salt).update(value, "utf8").digest("hex").slice(0, 12);
  }
}

/**
 * Reduce one field to what may be recorded about it. The value is consumed and not retained: nothing on the
 * returned object is derived from it except the four declared, non-invertible facts.
 */
export function credentialFieldEvidence(
  key: string,
  value: string,
  salt: CredentialDigestSalt,
): CredentialFieldEvidence {
  return {
    key,
    present: value.length > 0,
    lengthBucket: credentialLengthBucket(value),
    charClass: credentialCharClass(value),
    digest: salt.digest(value),
  };
}

/**
 * Reduce a whole secrets map, in a stable key order so two records of the same handoff compare line by line.
 *
 * Takes the map and returns evidence; it deliberately does NOT return the map, so a caller cannot accidentally
 * carry the plaintext forward by holding the result of the reduction.
 */
export function credentialEvidenceFor(
  secrets: Readonly<Record<string, string>>,
  salt: CredentialDigestSalt,
): readonly CredentialFieldEvidence[] {
  return Object.keys(secrets)
    .sort()
    .map((key) => credentialFieldEvidence(key, secrets[key] ?? "", salt));
}

/**
 * **Do the values look like three DIFFERENT things?** A locator that resolved every label to the same cell would
 * be caught in-page by the collision check; this catches the other shape of the same fault — three cells that
 * happen to hold identical text, which no real credential triple does.
 *
 * Compares digests, not values, so the check itself carries nothing.
 */
export function credentialFieldsDistinct(evidence: readonly CredentialFieldEvidence[]): boolean {
  return new Set(evidence.map((e) => e.digest)).size === evidence.length;
}
