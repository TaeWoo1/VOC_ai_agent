/**
 * Pure, sanitized NAVER account/store fingerprint extractor.
 *
 * Used during connection onboarding AFTER the human has manually logged in,
 * cleared any 2FA/CAPTCHA, and manually selected the intended NAVER commerce
 * account/store. The collector never auto-selects — this module only verifies the
 * authenticated seller context and extracts a STABLE identity token, which the
 * caller immediately hashes (`fingerprintHash`) and binds to the SellerOps
 * connection (`completeManualAccountSelection`).
 *
 * SAFETY CONTRACT:
 *  - The raw identity token appears in exactly ONE place: the `rawIdentityToken`
 *    field of a successful result. It is the working value the caller passes
 *    straight into `fingerprintHash` — it must never be logged or persisted raw.
 *  - Failure results carry ONLY a fixed `reasonCategory` — never any input value.
 *  - `sanitizedFingerprintSummary` is the log-safe view: booleans/categories/
 *    bucketed counts only, never the token.
 *  - This module is browser-free and fs-free: it takes a plain structured input
 *    (already-extracted candidates), not a Playwright page or HTML, so it is
 *    fully offline-unit-testable.
 */

import type { FingerprintSourceCategory } from "../connection/types";
import type { UrlCategory } from "./session-probe";

/** A candidate identity token plus the category of where it was read from. */
export interface AccountContextCandidate {
  sourceCategory: FingerprintSourceCategory;
  /** Raw stable identity token (e.g. a commerce id). Never logged; hashed by caller. */
  token: string;
}

/** Plain structured input — filled from a live page by the (future) CLI; tests pass it directly. */
export interface AccountFingerprintInput {
  urlCategory: UrlCategory;
  loggedInSignal: boolean;
  sellerShellSignal: boolean;
  accountContextCandidates: AccountContextCandidate[];
}

export type FingerprintUnresolvableReason =
  | "not-logged-in"
  | "missing-seller-context"
  | "ambiguous-seller-context"
  | "unknown";

export type AccountFingerprintResult =
  | { resolvable: true; rawIdentityToken: string; sourceCategory: FingerprintSourceCategory }
  | { resolvable: false; reasonCategory: FingerprintUnresolvableReason };

export type CandidateCountBucket = "none" | "one" | "few" | "many";

/** Log-safe summary: never contains a token. */
export interface SanitizedFingerprintSummary {
  resolvable: boolean;
  reasonCategory?: FingerprintUnresolvableReason;
  sourceCategory?: FingerprintSourceCategory;
  distinctCandidateCount: CandidateCountBucket;
}

// Strongest → weakest stable identifier. Used only to pick a deterministic source
// label when several candidates carry the SAME token under different labels.
const SOURCE_PRECEDENCE: readonly FingerprintSourceCategory[] = [
  "commerce-id",
  "store-url-path",
  "account-scope",
];

function strongerSource(
  a: FingerprintSourceCategory,
  b: FingerprintSourceCategory,
): FingerprintSourceCategory {
  return SOURCE_PRECEDENCE.indexOf(a) <= SOURCE_PRECEDENCE.indexOf(b) ? a : b;
}

function distinctByCategoryAndToken(
  candidates: readonly AccountContextCandidate[],
): AccountContextCandidate[] {
  const seen = new Map<string, AccountContextCandidate>();
  for (const c of candidates) {
    const key = JSON.stringify([c.sourceCategory, c.token]);
    if (!seen.has(key)) seen.set(key, c);
  }
  return [...seen.values()];
}

function candidateCountBucket(n: number): CandidateCountBucket {
  if (n <= 0) return "none";
  if (n === 1) return "one";
  if (n <= 3) return "few";
  return "many";
}

/**
 * Pure extraction. Precedence:
 *   1. Not an authenticated seller context (not logged in / not seller-center) → `not-logged-in`.
 *   2. Logged in + seller-center but the seller shell isn't confirmed → `unknown` (conservative).
 *   3. No candidate → `missing-seller-context`.
 *   4. Exactly one distinct (or several collapsing to a single token) → resolvable.
 *   5. Distinct, conflicting tokens → `ambiguous-seller-context`.
 * Prefers conservative failure over guessing.
 */
export function extractAccountFingerprint(
  input: AccountFingerprintInput,
): AccountFingerprintResult {
  if (!input.loggedInSignal || input.urlCategory !== "seller-center") {
    return { resolvable: false, reasonCategory: "not-logged-in" };
  }
  // Authenticated + on seller-center, but the seller shell could not be confirmed:
  // don't guess an identity from a half-rendered page.
  if (!input.sellerShellSignal) {
    return { resolvable: false, reasonCategory: "unknown" };
  }

  const distinct = distinctByCategoryAndToken(input.accountContextCandidates);
  if (distinct.length === 0) {
    return { resolvable: false, reasonCategory: "missing-seller-context" };
  }

  // Distinct identity is keyed by TOKEN — the same token under different source
  // labels is the same store (same hash), so it is safe to resolve deterministically.
  const distinctTokens = new Set(distinct.map((c) => c.token));
  if (distinctTokens.size > 1) {
    return { resolvable: false, reasonCategory: "ambiguous-seller-context" };
  }

  const token = distinct[0]!.token;
  const sourceCategory = distinct
    .map((c) => c.sourceCategory)
    .reduce((best, cur) => strongerSource(best, cur));
  return { resolvable: true, rawIdentityToken: token, sourceCategory };
}

/**
 * Log-safe summary of an extraction. Contains only categories/booleans/bucketed
 * counts — never the raw token. Use this (not the result) for any logging.
 */
export function sanitizedFingerprintSummary(
  input: AccountFingerprintInput,
  result: AccountFingerprintResult,
): SanitizedFingerprintSummary {
  const distinctCandidateCount = candidateCountBucket(
    distinctByCategoryAndToken(input.accountContextCandidates).length,
  );
  if (result.resolvable) {
    return { resolvable: true, sourceCategory: result.sourceCategory, distinctCandidateCount };
  }
  return { resolvable: false, reasonCategory: result.reasonCategory, distinctCandidateCount };
}
