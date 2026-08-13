/**
 * **Does this WING account already have an Open API key?** Three answers, one of which is "I cannot tell".
 *
 * ## Why this exists
 *
 * A seller who already holds a key must not be walked through issuance again — the walk ends by asking them to
 * press the control that CREATES one, and a second key on an account that has one is a state change nobody
 * asked for. So the guided path needs a determination before it starts.
 *
 * ## Why the third answer is load-bearing
 *
 * This question has been asked before and answered wrongly. `wingIssuedStateFrom` returns
 * `NO_DISCRIMINATING_SIGNAL` because every sanitized page signal is identical between an issued account and a
 * no-key one — `credentialAnchorPresent` reads `true` on a confirmed no-key form, which is exactly the trap:
 * "I found something credential-shaped" is not "a key exists".
 *
 * What is different now is that the calibration measures the value CELL and one bit about it. A resolved cell
 * that is NON-EMPTY is a key on the screen. A resolved cell that is EMPTY is a screen with no key. Anything
 * that does not resolve is `UNKNOWN` — and `UNKNOWN` never starts an issuance, because guessing wrong in that
 * direction creates a credential.
 *
 * **`NO_KEY` requires a POSITIVE reading**, not a failure to find one. A missing label, an ambiguous column, a
 * mixed shape, a truncated scan, or a page that is not the open-API surface are all `UNKNOWN`. That asymmetry
 * is the whole design: the cost of a wrong `KEY_PRESENT` is a seller sent to a handoff that then refuses; the
 * cost of a wrong `NO_KEY` is a second real key on a live account.
 *
 * ## What it does NOT read
 *
 * No value. The classifier takes a census — an association enum, tag names, integers, and the one non-emptiness
 * bit — and returns an enum. There is no path here that touches 업체코드 / Access Key / Secret Key.
 */
import {
  credentialCellsResolved,
  type CredentialCellCensus,
  type CredentialCellRefusal,
} from "./coupang-wing-credential-cells";

export const COUPANG_CREDENTIAL_STATES = [
  /** Cells resolved, and they are empty. A credential table with nothing in it. Issuance is the right path. */
  "NO_KEY",
  /** Cells resolved and hold something. Skip issuance; the seller's key already exists. */
  "KEY_PRESENT",
  /** The screen did not resolve. Fail closed: never issue, never claim a key. */
  "UNKNOWN",
] as const;
export type CoupangCredentialState = (typeof COUPANG_CREDENTIAL_STATES)[number];

export interface CoupangCredentialStateReading {
  readonly state: CoupangCredentialState;
  /** The census refusal that produced `UNKNOWN`, or `OK` when the cells resolved. Never page text. */
  readonly reason: CredentialCellRefusal;
  /** Which field the refusal was about, when the census named one. An id from the contract. */
  readonly field?: string;
}

/**
 * Classify the account's key state from a value-free census.
 *
 * `requireNonEmpty` is deliberately OFF for the resolution check here: this classifier needs to tell an empty
 * cell from an unresolved one, and `credentialCellsResolved`'s own `CELL_EMPTY` refusal would collapse the two
 * into a single failure. So it asks for structural resolution first, then reads the bit itself.
 */
export function coupangCredentialStateFrom(
  census: CredentialCellCensus,
  requestedIds: readonly string[],
): CoupangCredentialStateReading {
  const structural = credentialCellsResolved(census, requestedIds, false);
  if (!structural.ok) {
    return { state: "UNKNOWN", reason: structural.reason, ...(structural.id ? { field: structural.id } : {}) };
  }
  // Every cell resolved. Now the one bit, and it must be present on ALL of them: a census taken without the
  // non-emptiness capability answers `undefined`, which is "not measured" and not "empty".
  const bits = requestedIds.map((id) => census.readings.find((r) => r.id === id)?.cellNonEmpty);
  if (bits.some((b) => typeof b !== "boolean")) {
    return { state: "UNKNOWN", reason: "CELL_EMPTY" };
  }
  if (bits.every((b) => b === true)) return { state: "KEY_PRESENT", reason: "OK" };
  if (bits.every((b) => b === false)) return { state: "NO_KEY", reason: "OK" };
  // SOME full and some empty is not a state this screen should ever be in, and it is certainly not a licence to
  // issue. A partial credential means the reading is describing something other than a credential table.
  return { state: "UNKNOWN", reason: "CELL_EMPTY" };
}

/**
 * **May the guided issuance walk start?** Only on a positive `NO_KEY`.
 *
 * Stated as its own predicate rather than left to each call site's `!== "KEY_PRESENT"`, because that spelling
 * is the bug: it treats `UNKNOWN` as permission, and `UNKNOWN` is where a second key gets created.
 */
export function mayStartIssuance(state: CoupangCredentialState): boolean {
  return state === "NO_KEY";
}

/** **May the credential handoff be offered?** Only on a positive `KEY_PRESENT`. Same asymmetry, other side. */
export function mayOfferHandoff(state: CoupangCredentialState): boolean {
  return state === "KEY_PRESENT";
}
