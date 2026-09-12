/**
 * **The offline half of the WING seller-identity assertion** — digest the code the page printed, compare it
 * to the one the backend says this binding belongs to, and answer in three words.
 *
 * PD-4 (`docs/review_acquisition_aside_v2.md` §6): before a single review is read, the run must establish
 * that the authenticated browser is the store the seller connected. Not "probably" — the two must agree on a
 * **channel-native identifier**, and every other outcome is a stop.
 *
 * ## Three verdicts, and why `UNRESOLVED` is not `MISMATCH`
 *
 * - `MATCH` — exactly one code was on the screen and its digest equals the expected one.
 * - `MISMATCH` — a code was read and it is a different store. The browser is signed into someone else.
 * - `UNRESOLVED` — nothing was read, two different codes were, or the server sent no expectation. **We do not
 *   know**, and "we do not know" must not be reported as "it is wrong" any more than as "it is right": the
 *   repair differs (log in to the right store vs. tell us which store this binding is) and so does the blame.
 *
 * Both non-MATCH verdicts fail closed identically at the call site — no page is read — so the distinction
 * costs nothing operationally and is the difference between a message a seller can act on and one they cannot.
 *
 * ## The digest is a comparison device, not a privacy device — said out loud
 *
 * A vendor code is one letter and eight digits. Domain-separated SHA-256 over a space that small is
 * **enumerable**, exactly as `connection/seller-account-fingerprint.ts` warns about small identifier spaces.
 * It is used here because it lets the comparison happen without the raw code crossing a process boundary in
 * either direction, and because a digest cannot be mistaken for a credential by a later reader. It is NOT
 * claimed to conceal the code from anyone holding the digest. The raw code never leaves the machine, and the
 * expected digest travels only over the loopback backend the agent is already authenticated to.
 *
 * Pure: no fs, no browser, no network, no clock.
 */
import { createHash } from "node:crypto";
import type { WingIdentityReading } from "./wing-identity-inpage";

const DOMAIN = "coupang-wing-store-identity/v1\n";

/** Deliberately narrow: a compact printable token, not free text and not a sentence the page happened to hold. */
const WELL_FORMED = new RegExp("^[A-Za-z0-9._-]{4,40}$", "u");

export type WingStoreVerdict = "MATCH" | "MISMATCH" | "UNRESOLVED";

/** Domain-separated SHA-256 of a vendor code, lowercase hex. `null` for a malformed token — never a digest of garbage. */
export function wingStoreFingerprint(raw: string | null | undefined): string | null {
  const value = (raw ?? "").normalize("NFC").trim();
  if (!WELL_FORMED.test(value)) return null;
  return createHash("sha256").update(DOMAIN + value, "utf8").digest("hex");
}

export interface WingStoreAssertion {
  readonly verdict: WingStoreVerdict;
  /** Why, in one closed word — for the log line. Never a value. */
  readonly reason: "OK" | "NO_EXPECTATION" | "NOT_OBSERVED" | "AMBIGUOUS" | "MALFORMED" | "DIFFERENT_STORE";
  readonly observedCount: number;
}

/**
 * Compare what the page printed against what the binding expects.
 *
 * `expected` is the digest the backend derived from the sealed `vendor_id` of the account this
 * `acquisitionRef` resolved to. Absent ⇒ `UNRESOLVED`: a server that cannot say which store this is has not
 * given permission to read one.
 */
export function assertWingStore(expected: string | null | undefined, reading: WingIdentityReading): WingStoreAssertion {
  const want = (expected ?? "").trim().toLowerCase();
  if (want.length === 0) return { verdict: "UNRESOLVED", reason: "NO_EXPECTATION", observedCount: reading.values.length };
  if (reading.values.length === 0) return { verdict: "UNRESOLVED", reason: "NOT_OBSERVED", observedCount: 0 };
  if (reading.values.length > 1) return { verdict: "UNRESOLVED", reason: "AMBIGUOUS", observedCount: reading.values.length };
  const got = wingStoreFingerprint(reading.values[0]);
  if (got === null) return { verdict: "UNRESOLVED", reason: "MALFORMED", observedCount: 1 };
  if (got !== want) return { verdict: "MISMATCH", reason: "DIFFERENT_STORE", observedCount: 1 };
  return { verdict: "MATCH", reason: "OK", observedCount: 1 };
}
