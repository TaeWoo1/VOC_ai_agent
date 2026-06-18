/**
 * Sanitized account-signal capture boundary.
 *
 * This is the thin seam a FUTURE live Playwright boundary will fill from a
 * logged-in seller-center page. It deliberately does NOT accept a Playwright Page,
 * raw HTML, page text, a screenshot, or a raw URL — only a small `AccountSignalSnapshot`
 * of named, already-extracted structural candidates. It gates on the authenticated
 * seller context, then normalizes each candidate through the SAME shared rule the
 * adapter uses (`normalizeCandidateToken`: trim, drop empty, reject URL-with-query/
 * hash so query tokens never become identity), and emits `AccountFingerprintRawSignals`
 * ready for `toAccountFingerprintInput`.
 *
 * SAFETY CONTRACT: raw candidate values flow only into the emitted rawSignals
 * (the working value the extractor consumes, then `fingerprintHash`); they are
 * never logged. `sanitizedAccountSignalSummary` is the log-safe view — counts/
 * categories/booleans only. Browser-free and fs-free; fully offline-testable.
 */

import {
  normalizeCandidateToken,
  type AccountFingerprintRawSignals,
} from "./account-fingerprint-adapter";
import type { CandidateCountBucket } from "./account-fingerprint";
import type { FingerprintSourceCategory } from "../connection/types";
import type { UrlCategory } from "./session-probe";

/** Sanitized snapshot a future Playwright boundary produces — never a Page/HTML/text. */
export interface AccountSignalSnapshot {
  urlCategory: UrlCategory;
  loggedInSignal: boolean;
  sellerShellSignal: boolean;
  commerceIdTextCandidate?: string | null;
  storeUrlPathCandidate?: string | null;
  accountScopeTextCandidate?: string | null;
}

export type CaptureFailureReason = "not-logged-in" | "missing-seller-shell" | "unknown";

export type AccountSignalCaptureResult =
  | { ok: true; rawSignals: AccountFingerprintRawSignals }
  | { ok: false; reasonCategory: CaptureFailureReason };

/**
 * Capture sanitized fingerprint signals from a structural snapshot.
 *  - not logged in / not on seller-center → `not-logged-in`
 *  - seller shell not confirmed → `missing-seller-shell`
 *  - otherwise → normalized rawSignals (candidates trimmed; empty / URL-with-
 *    query|hash candidates dropped to null)
 */
export function captureAccountSignals(snapshot: AccountSignalSnapshot): AccountSignalCaptureResult {
  if (!snapshot.loggedInSignal || snapshot.urlCategory !== "seller-center") {
    return { ok: false, reasonCategory: "not-logged-in" };
  }
  if (!snapshot.sellerShellSignal) {
    return { ok: false, reasonCategory: "missing-seller-shell" };
  }
  return {
    ok: true,
    rawSignals: {
      urlCategory: snapshot.urlCategory,
      loggedInSignal: snapshot.loggedInSignal,
      sellerShellSignal: snapshot.sellerShellSignal,
      commerceIdCandidate: normalizeCandidateToken(snapshot.commerceIdTextCandidate),
      storeUrlPathCandidate: normalizeCandidateToken(snapshot.storeUrlPathCandidate),
      accountScopeCandidate: normalizeCandidateToken(snapshot.accountScopeTextCandidate),
    },
  };
}

export interface SanitizedAccountSignalSummary {
  urlCategory: UrlCategory;
  loggedInSignal: boolean;
  sellerShellSignal: boolean;
  candidateCount: CandidateCountBucket;
  sourceCategoriesPresent: FingerprintSourceCategory[];
}

const SNAPSHOT_FIELDS: ReadonlyArray<{
  key: keyof AccountSignalSnapshot;
  sourceCategory: FingerprintSourceCategory;
}> = [
  { key: "commerceIdTextCandidate", sourceCategory: "commerce-id" },
  { key: "storeUrlPathCandidate", sourceCategory: "store-url-path" },
  { key: "accountScopeTextCandidate", sourceCategory: "account-scope" },
];

function candidateCountBucket(n: number): CandidateCountBucket {
  if (n <= 0) return "none";
  if (n === 1) return "one";
  if (n <= 3) return "few";
  return "many";
}

/**
 * Log-safe summary of a snapshot: which signals/categories are present after
 * normalization. Counts/categories/booleans only — never a raw token.
 */
export function sanitizedAccountSignalSummary(
  snapshot: AccountSignalSnapshot,
): SanitizedAccountSignalSummary {
  const present = SNAPSHOT_FIELDS.filter(
    ({ key }) => normalizeCandidateToken(snapshot[key] as string | null | undefined) !== null,
  );
  return {
    urlCategory: snapshot.urlCategory,
    loggedInSignal: snapshot.loggedInSignal,
    sellerShellSignal: snapshot.sellerShellSignal,
    candidateCount: candidateCountBucket(present.length),
    sourceCategoriesPresent: present.map((f) => f.sourceCategory),
  };
}
