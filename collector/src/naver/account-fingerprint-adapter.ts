/**
 * Pure adapter: sanitized structural page/probe signals → `AccountFingerprintInput`.
 *
 * The (future) live onboarding flow will read a small set of structural signals
 * off the logged-in seller-center page and hand them here. This module is the
 * ONLY place candidate raw tokens are shaped into the extractor's input — it does
 * NOT touch a browser, HTML, or the network. It takes already-extracted, named
 * candidate strings (commerce id / store url path / account scope), normalizes
 * them conservatively, and drops anything empty or URL-with-query-shaped.
 *
 * SAFETY CONTRACT:
 *  - Candidate tokens flow through only into `AccountFingerprintInput.accountContextCandidates`
 *    (the working value the extractor consumes, then `fingerprintHash`). They are
 *    never logged here.
 *  - `sanitizedAdapterSummary` is the log-safe view: counts/categories/booleans
 *    only — never a token.
 *  - A candidate that looks like a full URL carrying a query/hash is REJECTED
 *    (conservative) rather than parsed, so query tokens never become identity.
 *  - Browser-free and fs-free, so it is fully offline-unit-testable.
 */

import type {
  AccountContextCandidate,
  AccountFingerprintInput,
  CandidateCountBucket,
} from "./account-fingerprint";
import type { FingerprintSourceCategory } from "../connection/types";
import type { UrlCategory } from "./session-probe";

/** Sanitized structural signals — filled from a live page by the (future) CLI; tests pass it directly. */
export interface AccountFingerprintRawSignals {
  urlCategory: UrlCategory;
  loggedInSignal: boolean;
  sellerShellSignal: boolean;
  /** Named structural candidates; absent/empty/whitespace-only are ignored. */
  commerceIdCandidate?: string | null;
  storeUrlPathCandidate?: string | null;
  accountScopeCandidate?: string | null;
}

export interface SanitizedAdapterSummary {
  urlCategory: UrlCategory;
  loggedInSignal: boolean;
  sellerShellSignal: boolean;
  candidateCount: CandidateCountBucket;
  sourceCategoriesPresent: FingerprintSourceCategory[];
}

/**
 * Conservative token normalization. Returns the cleaned token, or null if the
 * candidate must be dropped:
 *  - null/undefined/empty/whitespace-only → null
 *  - looks like a full URL carrying a query (`?`) or hash (`#`) → null (rejected)
 * Otherwise: trimmed, case preserved, content otherwise untouched (no HTML/text
 * parsing). Internal whitespace is left as-is — these are expected to be compact
 * id/path tokens, and rewriting them could change identity.
 */
export function normalizeCandidateToken(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  // Reject anything carrying URL query/hash material — query tokens must never
  // become an identity fingerprint. (A bare path-like token with no ?/# is fine.)
  if (trimmed.includes("?") || trimmed.includes("#")) return null;
  return trimmed;
}

const CANDIDATE_FIELDS: ReadonlyArray<{
  key: keyof AccountFingerprintRawSignals;
  sourceCategory: FingerprintSourceCategory;
}> = [
  { key: "commerceIdCandidate", sourceCategory: "commerce-id" },
  { key: "storeUrlPathCandidate", sourceCategory: "store-url-path" },
  { key: "accountScopeCandidate", sourceCategory: "account-scope" },
];

/**
 * Pure: structural signals → `AccountFingerprintInput`. Preserves the
 * url/session/seller-shell signals and converts each present, valid candidate
 * field into a `{ sourceCategory, token }` entry. Dropped candidates (empty or
 * URL-with-query) simply do not appear.
 */
export function toAccountFingerprintInput(
  signals: AccountFingerprintRawSignals,
): AccountFingerprintInput {
  const accountContextCandidates: AccountContextCandidate[] = [];
  for (const { key, sourceCategory } of CANDIDATE_FIELDS) {
    const token = normalizeCandidateToken(signals[key] as string | null | undefined);
    if (token !== null) accountContextCandidates.push({ sourceCategory, token });
  }
  return {
    urlCategory: signals.urlCategory,
    loggedInSignal: signals.loggedInSignal,
    sellerShellSignal: signals.sellerShellSignal,
    accountContextCandidates,
  };
}

function candidateCountBucket(n: number): CandidateCountBucket {
  if (n <= 0) return "none";
  if (n === 1) return "one";
  if (n <= 3) return "few";
  return "many";
}

/**
 * Log-safe summary of an adapted input. Counts/categories/booleans only — never a
 * token. Accepts the adapter output (`AccountFingerprintInput`).
 */
export function sanitizedAdapterSummary(input: AccountFingerprintInput): SanitizedAdapterSummary {
  return {
    urlCategory: input.urlCategory,
    loggedInSignal: input.loggedInSignal,
    sellerShellSignal: input.sellerShellSignal,
    candidateCount: candidateCountBucket(input.accountContextCandidates.length),
    sourceCategoriesPresent: input.accountContextCandidates.map((c) => c.sourceCategory),
  };
}
