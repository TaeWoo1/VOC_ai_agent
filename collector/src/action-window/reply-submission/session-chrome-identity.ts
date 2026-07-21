/**
 * `seller-session-identity/v1` — the COMPOSITE seller-center session identity.
 *
 * Identity is the pair `(normalizedUserId, normalizedShopName)`, and it is a pair on
 * purpose. Either half alone is a known false-match generator:
 *  - a user id alone matches every shop that user owns — the fail-open shape that got
 *    the url-path source and the store-agnostic-constant source deleted;
 *  - a shop name alone is not unique across sellers, and is trivially chosen by anyone
 *    registering a shop.
 * So there is no API here that fingerprints one field. `compositeSessionFingerprint`
 * requires both and returns `null` if either is missing or malformed.
 *
 * WHY THIS READS PAGE TEXT AT ALL, having removed text sources three times: those were
 * SEARCHES — a marker word looked for across a scope, where no selector reliably
 * separates chrome from content on a page that renders reviews. This is a READ of two
 * specific fields from two pinned, tight containers, with a length bound and a
 * structural content-region exclusion. A search finds whatever an attacker writes; a
 * bounded read of a container that must contain nothing else does not. The bound is
 * what makes the difference, and it is enforced in `chrome-identity-inpage.ts`.
 *
 * SEPARATOR: the two fields are joined with U+001F (UNIT SEPARATOR), and a user id
 * may not contain whitespace or control characters — so `("ab","c")` and `("a","bc")`
 * cannot collide.
 *
 * HONEST LIMITATION: this is leak hygiene, not secrecy. A shop name is public and a
 * seller id is low-entropy, so the digest conceals little from anyone holding the file.
 * What it does is keep the raw pair out of records and logs.
 *
 * Pure — no fs, no browser, no network, no clock.
 */

import { createHash, timingSafeEqual } from "node:crypto";

export const MAX_USER_ID_LENGTH = 80;
export const MAX_SHOP_NAME_LENGTH = 120;

const DOMAIN = "seller-session-identity/v1\n";
const FIELD_SEPARATOR = "\u001f";

// Same pinned class the review-id contract uses, kept identical so one normalization
// story covers the runtime rather than two that drift.
const WHITESPACE_CLASS =
  "\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const ZERO_WIDTH = new RegExp("[\\u200b\\u200c\\u200d\\ufeff]", "gu");
const WHITESPACE_RUN = new RegExp(`[${WHITESPACE_CLASS}]+`, "gu");
const ANY_WHITESPACE = new RegExp(`[${WHITESPACE_CLASS}]`, "u");
const CONTROL = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f]", "u");

/**
 * Shared canonicalization: NFC, drop zero-width characters, collapse every whitespace
 * run to one space, trim. A shop name legitimately contains spaces, so runs are
 * collapsed rather than removed — `"My  Shop"` and `"My Shop"` are the same shop, and
 * treating them as different would produce a MISMATCH on a correct session.
 */
function canonicalize(raw: string | null | undefined): string {
  return (raw ?? "")
    .normalize("NFC")
    .replace(ZERO_WIDTH, "")
    .replace(WHITESPACE_RUN, " ")
    .trim();
}

/** A user id: non-empty, bounded, no whitespace, no control characters. */
export function normalizeUserId(raw: string | null | undefined): string | null {
  const value = canonicalize(raw);
  if (value.length === 0 || value.length > MAX_USER_ID_LENGTH) return null;
  if (ANY_WHITESPACE.test(value) || CONTROL.test(value)) return null;
  return value;
}

/** A shop name: non-empty, bounded, no control characters. Internal spaces are fine. */
export function normalizeShopName(raw: string | null | undefined): string | null {
  const value = canonicalize(raw);
  if (value.length === 0 || value.length > MAX_SHOP_NAME_LENGTH) return null;
  if (CONTROL.test(value)) return null;
  return value;
}

export interface NormalizedSessionIdentity {
  userId: string;
  shopName: string;
}

/**
 * Normalize the pair. Returns `null` if EITHER field is missing or malformed — there
 * is deliberately no way to get a partial identity out of this module.
 *
 * IT ALSO REFUSES A PAIR WHOSE HALVES ARE EQUAL, and that check is load-bearing rather
 * than defensive. `specsCollide` compares selector *strings*, so two textually different
 * selectors that happen to resolve to the SAME element pass it — e.g. an operator whose
 * shop-name click lands on the header account chip, where the two controls sit adjacent.
 * The result reads as a perfectly stable identity and identifies nothing: it is a
 * composite of one value with itself, it MATCHes forever, and because the binding is
 * permanent it would also write the **user id** into `boundShopDisplayName`, which is the
 * one field this milestone treats as non-sensitive and prints. Selector-layer checks
 * cannot close that (they compare locations); a value-layer check can, so it lives here,
 * where every caller — bind, verify, and every barrier — must pass through it.
 */
export function normalizeSessionIdentity(
  rawUserId: string | null | undefined,
  rawShopName: string | null | undefined,
): NormalizedSessionIdentity | null {
  const userId = normalizeUserId(rawUserId);
  const shopName = normalizeShopName(rawShopName);
  if (userId === null || shopName === null) return null;
  if (userId === shopName) return null;
  return { userId, shopName };
}

/**
 * Domain-separated SHA-256 of the composite, lowercase hex. `null` when the pair is
 * not well-formed, so a caller cannot bind or compare a digest of garbage.
 */
export function compositeSessionFingerprint(
  rawUserId: string | null | undefined,
  rawShopName: string | null | undefined,
): string | null {
  const identity = normalizeSessionIdentity(rawUserId, rawShopName);
  if (identity === null) return null;
  return createHash("sha256")
    .update(DOMAIN + identity.userId + FIELD_SEPARATOR + identity.shopName, "utf8")
    .digest("hex");
}

/** Constant-time digest comparison; the page supplies one side. */
export function fingerprintsEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** The three answers the preflight may give. Nothing else may proceed to review lookup. */
export type ChromeIdentityVerdict = "MATCH" | "MISMATCH" | "UNAVAILABLE";

export type ChromeIdentityReason =
  | "ok"
  | "no-binding"
  | "no-selectors"
  | "selector-source-changed"
  | "selectors-collide"
  | "user-id-unreadable"
  | "shop-name-unreadable"
  | "composite-differs"
  // The active page is not a seller-center origin, so no read through it can mean anything. Produced by
  // the caller's origin gate rather than by the comparison below, which never sees a URL.
  | "off-seller-center"
  // The two calibrated fields read the SAME value. Distinct from `selectors-collide`, which compares
  // selector strings: two different selectors can resolve to one element, and only the values show it.
  | "identity-not-composite";

export interface ChromeIdentityVerification {
  verdict: ChromeIdentityVerdict;
  reason: ChromeIdentityReason;
  /**
   * The shop name read from the page THIS run. Non-sensitive by explicit product-owner
   * decision — it is the shop's own public name — and it is what lets an operator see
   * a rename for what it is instead of an unexplained mismatch.
   */
  observedShopName: string | null;
  /** The shop name stored at bind time, when a binding exists. */
  boundShopDisplayName: string | null;
  /**
   * True when the observed shop name differs from the one stored at bind time.
   *
   * NAMED FOR WHAT IT IS, after a reviewer caught the previous name (`looksLikeRename`)
   * asserting something the runtime cannot know. There is no stored user id — the
   * composite is one-way — so this says NOTHING about whether the account is the same.
   * It is true for a rename AND for a login as an entirely different seller. It selects
   * which QUESTION the operator is asked; it is never evidence for the answer.
   */
  shopNameDiffers: boolean;
  /** Digest of the selector specs in force this run; `null` when none are calibrated. */
  currentSelectorSpecFingerprint: string | null;
  /** Digest of the specs recorded at bind time. */
  boundSelectorSpecFingerprint: string | null;
  /** True when the calibrated specs would read the same element for both fields. */
  selectorsCollide: boolean;
}

export interface VerifyChromeIdentityInput {
  /** Read from the pinned account/header container this run. */
  observedUserId: string | null;
  /** Read from the pinned shop/sidebar container this run. */
  observedShopName: string | null;
  /** The stored composite digest, or `null` when nothing is bound yet. */
  boundCompositeFingerprint: string | null;
  /** The stored shop display name, or `null` when nothing is bound yet. */
  boundShopDisplayName: string | null;
  /**
   * Digest of the selector specs in force THIS run, or `null` when none are calibrated.
   * A binding is only meaningful together with the selectors it was read through.
   */
  currentSelectorSpecFingerprint: string | null;
  /** Digest of the specs recorded at bind time. */
  boundSelectorSpecFingerprint: string | null;
  /** True when the calibrated specs would read the same element for both fields. */
  selectorsCollide: boolean;
}

/**
 * Compare the session against the binding.
 *
 * Ordering is deliberate: an unreadable field is `UNAVAILABLE`, never `MISMATCH`.
 * Missing evidence and contrary evidence are different facts, and reporting the first
 * as the second trains an operator to wave mismatches through.
 */
export function verifyChromeIdentity(
  input: VerifyChromeIdentityInput,
): ChromeIdentityVerification {
  const observedShopName = normalizeShopName(input.observedShopName);
  const userId = normalizeUserId(input.observedUserId);

  const base = {
    observedShopName,
    boundShopDisplayName: input.boundShopDisplayName,
    currentSelectorSpecFingerprint: input.currentSelectorSpecFingerprint,
    boundSelectorSpecFingerprint: input.boundSelectorSpecFingerprint,
    selectorsCollide: input.selectorsCollide,
    shopNameDiffers: false,
  };

  // SOURCE CHANGE, checked before anything is compared. Reading the same page through
  // different selectors can yield a different pair, so comparing across a spec change is
  // comparing two things that were never comparable — and a MISMATCH there would send
  // the operator hunting an account problem that does not exist.
  if (input.currentSelectorSpecFingerprint === null) {
    return { verdict: "UNAVAILABLE", reason: "no-selectors", ...base };
  }
  if (input.selectorsCollide) {
    // Both fields reading one element yields a composite of a value with itself, which
    // looks perfectly stable and identifies nothing.
    return { verdict: "UNAVAILABLE", reason: "selectors-collide", ...base };
  }
  if (
    input.boundSelectorSpecFingerprint !== null &&
    input.boundSelectorSpecFingerprint !== input.currentSelectorSpecFingerprint
  ) {
    return { verdict: "UNAVAILABLE", reason: "selector-source-changed", ...base };
  }
  if (userId === null) {
    return { verdict: "UNAVAILABLE", reason: "user-id-unreadable", ...base };
  }
  if (observedShopName === null) {
    return { verdict: "UNAVAILABLE", reason: "shop-name-unreadable", ...base };
  }
  // VALUE-LEVEL collision, which `selectorsCollide` above cannot see. That check compares selector
  // STRINGS; two different strings can resolve to the same element — an operator whose shop-name click
  // lands on the adjacent header account chip produces exactly that. The result would be a composite of
  // one value with itself: perfectly stable, permanently MATCHing, and identifying nothing. It would also
  // record the USER ID as `boundShopDisplayName`, the one field this milestone prints and treats as
  // non-sensitive.
  if (userId === observedShopName) {
    return { verdict: "UNAVAILABLE", reason: "identity-not-composite", ...base };
  }
  if (input.boundCompositeFingerprint === null) {
    return { verdict: "UNAVAILABLE", reason: "no-binding", ...base };
  }

  const observed = compositeSessionFingerprint(userId, observedShopName);
  if (observed !== null && fingerprintsEqual(observed, input.boundCompositeFingerprint)) {
    return { verdict: "MATCH", reason: "ok", ...base };
  }

  // ONLY that the shop name differs. A rename and a different seller produce exactly the
  // same evidence here, and pretending otherwise is how an operator gets told a
  // falsehood immediately before a permanent, un-undoable write.
  const shopNameDiffers =
    input.boundShopDisplayName !== null && input.boundShopDisplayName !== observedShopName;

  return { verdict: "MISMATCH", reason: "composite-differs", ...base, shopNameDiffers };
}

/** True only for the one verdict that may proceed to review lookup. */
export function mayProceedAfterChromeIdentity(v: ChromeIdentityVerification): boolean {
  return v.verdict === "MATCH";
}
