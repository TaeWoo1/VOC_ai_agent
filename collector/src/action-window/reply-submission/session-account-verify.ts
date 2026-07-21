/**
 * Session seller/store verification — the MANDATORY preflight of the guided reply
 * session. Answers one question: *is the NAVER store open in this browser session
 * the store this SellerOps account is bound to?*
 *
 * WHAT IT DELIBERATELY DOES NOT DO:
 *  - It never compares the internal `sellerAccountId` to page text. The SellerOps
 *    account id means nothing on a NAVER page; matching it against anything visible
 *    would be a coincidence, not a proof.
 *  - It never treats the display name as evidence. `userProvidedDisplayName` is a
 *    label the OPERATOR typed for their own reference; it is carried so the operator
 *    knows which connection they are looking at, and is never compared.
 *  - It never resolves ambiguity by picking. Two connections claiming the same
 *    account, an unconfirmed seller shell, or an absent identity all fail CLOSED.
 *
 * WHY VERIFICATION IS CATEGORY-AWARE (the subtle part):
 * `boundStoreFingerprintHash` is a digest of exactly ONE token, and
 * `fingerprintSourceCategory` records which source produced it. A digest of a
 * `store-url-path` token compared against a `commerce-id` binding differs every
 * time — including on a perfectly correct session. So re-verification reads the
 * candidate for the BOUND category specifically:
 *   - bound category absent this run  → UNAVAILABLE (never MISMATCH)
 *   - present and equal               → MATCH
 *   - present and different           → MISMATCH
 * Calling a missing signal a mismatch would train the operator to ignore mismatches.
 *
 * SAFETY CONTRACT: no raw store token, no digest, no account id, and no URL appears
 * in the result. Every field is a fixed category, a boolean, or the operator's own
 * alias. Pure — no fs, no browser, no network, no clock.
 */

import { timingSafeEqual } from "node:crypto";
import { fingerprintHash } from "../../connection/connection";
import { sellerAccountFingerprint } from "../../connection/seller-account-fingerprint";
import { normalizeCandidateToken } from "../../naver/account-fingerprint-adapter";
import type { AccountFingerprintRawSignals } from "../../naver/account-fingerprint-adapter";
import type { CollectorConnection, FingerprintSourceCategory } from "../../connection/types";

/**
 * The four answers the preflight may give. Only `MATCH` allows the session to
 * continue to review lookup; the other three are terminal for this run.
 */
export type AccountVerdict = "MATCH" | "MISMATCH" | "UNAVAILABLE" | "NEEDS_BINDING";

/** Fixed reason categories. Never carry a raw value. */
export type AccountVerifyReason =
  | "ok"
  | "malformed-account-id"
  | "no-connection-for-account"
  | "multiple-connections-for-account"
  | "store-not-bound"
  | "not-logged-in"
  | "seller-shell-unconfirmed"
  | "bound-category-absent"
  | "fingerprint-differs";

/** Sanitized verification result — safe to log and to persist wholesale. */
export interface SessionAccountVerification {
  verdict: AccountVerdict;
  reason: AccountVerifyReason;
  /** The OPERATOR's own alias for the resolved connection; null when none resolved. */
  displayName: string | null;
  /** Resolved connection id (a local, non-identifying handle); null when none resolved. */
  connectionId: string | null;
  /** Which source the stored binding came from; null when not bound. */
  boundSourceCategory: FingerprintSourceCategory | null;
  /** Which candidate slots the live page populated this run. Diagnostics only. */
  observedSourceCategories: FingerprintSourceCategory[];
}

const CANDIDATE_BY_CATEGORY: Record<
  FingerprintSourceCategory,
  keyof Pick<
    AccountFingerprintRawSignals,
    "commerceIdCandidate" | "storeUrlPathCandidate" | "accountScopeCandidate"
  >
> = {
  "commerce-id": "commerceIdCandidate",
  "store-url-path": "storeUrlPathCandidate",
  "account-scope": "accountScopeCandidate",
};

const ALL_CATEGORIES: readonly FingerprintSourceCategory[] = [
  "commerce-id",
  "store-url-path",
  "account-scope",
];

/** Which candidate slots the page actually populated (after the shared normalization). */
export function observedCategories(
  signals: AccountFingerprintRawSignals,
): FingerprintSourceCategory[] {
  return ALL_CATEGORIES.filter(
    (category) => normalizeCandidateToken(signals[CANDIDATE_BY_CATEGORY[category]]) !== null,
  );
}

/**
 * Constant-time digest comparison. The live page supplies one side of this
 * comparison, so a hostile page could otherwise probe the bound digest byte by byte
 * by measuring how long a rejection takes. Unequal lengths short-circuit — that
 * leaks only "not a 64-hex digest", which the page already knows it sent.
 */
export function digestsEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export interface VerifySessionAccountInput {
  /** SellerOps seller-account id from the reply request bundle. */
  sellerAccountId: string;
  /** Every connection in the local registry. */
  connections: readonly CollectorConnection[];
  /** Sanitized structural signals read from the live page this run. */
  signals: AccountFingerprintRawSignals;
}

function verification(
  verdict: AccountVerdict,
  reason: AccountVerifyReason,
  connection: CollectorConnection | null,
  signals: AccountFingerprintRawSignals,
): SessionAccountVerification {
  // FROZEN like the signals it was computed from. Every guard protected the verifier's INPUTS; a reviewer
  // then rewrote its OUTPUT (`{ ...baseVerification, verdict: "MATCH" }`) from page text with the whole
  // suite green — one level downstream of every pin, and strictly worse than reopening a gate.
  return Object.freeze({
    verdict,
    reason,
    displayName: connection?.userProvidedDisplayName ?? null,
    connectionId: connection?.connectionId ?? null,
    boundSourceCategory: connection?.fingerprintSourceCategory ?? null,
    observedSourceCategories: observedCategories(signals),
  });
}

/**
 * Verify the open session against the registry. Resolution is by DATA: exactly one
 * connection may carry this account's fingerprint. Zero means the link was never
 * bound (`NEEDS_BINDING` — the operator-confirmed binding step handles it); more
 * than one is a corrupt registry and fails closed rather than picking.
 */
export function verifySessionAccount(
  input: VerifySessionAccountInput,
): SessionAccountVerification {
  const { connections, signals } = input;

  const accountFingerprint = sellerAccountFingerprint(input.sellerAccountId);
  if (accountFingerprint === null) {
    return verification("UNAVAILABLE", "malformed-account-id", null, signals);
  }

  const linked = connections.filter(
    (c) =>
      c.boundSellerAccountFingerprint !== null &&
      digestsEqual(c.boundSellerAccountFingerprint, accountFingerprint),
  );
  if (linked.length === 0) {
    return verification("NEEDS_BINDING", "no-connection-for-account", null, signals);
  }
  if (linked.length > 1) {
    // Two connections claiming one account is a registry we cannot reason about.
    // Naming one of them would be a guess, so no connection is reported either.
    return verification("UNAVAILABLE", "multiple-connections-for-account", null, signals);
  }
  const connection = linked[0]!;

  // Gate on the coarse session context BEFORE reading identity, so a page we cannot
  // read can never be reported as a mismatch.
  //
  // Honest about what this is: the caller derives these from the URL class and whether
  // the page exposes SPA state — NOT from an authentication check. It is deliberately
  // weak, because every stronger signal available was text an attacker could write
  // (see the scope contract §4.2d). The real protection is that identity must be
  // PRESENT and must digest-equal the binding; a login page yields neither.
  if (!signals.loggedInSignal || signals.urlCategory !== "seller-center") {
    return verification("UNAVAILABLE", "not-logged-in", connection, signals);
  }
  if (!signals.sellerShellSignal) {
    return verification("UNAVAILABLE", "seller-shell-unconfirmed", connection, signals);
  }

  const boundCategory = connection.fingerprintSourceCategory;
  if (connection.boundStoreFingerprintHash === null || boundCategory === null) {
    return verification("NEEDS_BINDING", "store-not-bound", connection, signals);
  }

  const token = normalizeCandidateToken(signals[CANDIDATE_BY_CATEGORY[boundCategory]]);
  if (token === null) {
    // The bound source is not on this page today. That is missing evidence, not
    // contrary evidence — reporting MISMATCH here would be a lie.
    return verification("UNAVAILABLE", "bound-category-absent", connection, signals);
  }

  if (!digestsEqual(fingerprintHash(token), connection.boundStoreFingerprintHash)) {
    return verification("MISMATCH", "fingerprint-differs", connection, signals);
  }
  return verification("MATCH", "ok", connection, signals);
}

/** Why a seller account did not resolve to exactly one connection. */
export type ConnectionResolution =
  | { ok: true; connection: CollectorConnection }
  | { ok: false; reason: "malformed-account-id" | "no-connection-for-account" | "multiple-connections-for-account" };

/**
 * Resolve the ONE connection a reply request bundle concerns, by seller-account
 * fingerprint. Extracted so the chrome-identity preflight can reuse it without also
 * inheriting the SPA-state store comparison, which is now a fallback rather than the
 * gate. Zero is "not linked yet"; more than one is a registry we cannot reason about,
 * and naming one of them would be a guess.
 */
export function resolveLinkedConnection(
  connections: readonly CollectorConnection[],
  sellerAccountId: string,
): ConnectionResolution {
  const accountFingerprint = sellerAccountFingerprint(sellerAccountId);
  if (accountFingerprint === null) return { ok: false, reason: "malformed-account-id" };
  const linked = connections.filter(
    (c) =>
      c.boundSellerAccountFingerprint !== null &&
      digestsEqual(c.boundSellerAccountFingerprint, accountFingerprint),
  );
  if (linked.length === 0) return { ok: false, reason: "no-connection-for-account" };
  if (linked.length > 1) return { ok: false, reason: "multiple-connections-for-account" };
  return { ok: true, connection: linked[0]! };
}

/** True only for the one verdict that may proceed to review lookup. */
export function mayProceedToReviewLookup(v: SessionAccountVerification): boolean {
  return v.verdict === "MATCH";
}

/** Why a re-verification is not equivalent to the preflight one. */
export type AccountDriftReason =
  | "verdict-changed"
  | "connection-changed"
  | "source-changed"
  | "evidence-changed";

export type AccountDriftCheck = { ok: true } | { ok: false; reason: AccountDriftReason };

/** A verification plus the key the live evidence actually came from this read. */
export interface AccountObservation {
  verification: SessionAccountVerification;
  /** `evidence.chosenKey` from the same read; `null` when nothing was chosen. */
  chosenKey: string | null;
}

/**
 * Compare the preflight verification with a later one taken at a barrier.
 *
 * A guided session spans minutes of operator activity, and a seller center can
 * switch stores in place — the preflight's `MATCH` says nothing about the session
 * three clicks later. This is the same TOCTOU discipline [D-036] applied to the row
 * identity, moved up to the account: verify again immediately before acting, and
 * treat ANY difference as a stop.
 *
 * Deliberately strict — it demands both still be `MATCH`, on the same connection,
 * from the same source category. A source change is not proof of a different store,
 * but it means the two verdicts rest on different evidence, and silently accepting
 * that would hide exactly the substitution this check exists to catch.
 */
export function assertAccountUnchanged(
  preflight: AccountObservation,
  current: AccountObservation,
): AccountDriftCheck {
  if (preflight.verification.verdict !== "MATCH" || current.verification.verdict !== "MATCH") {
    return { ok: false, reason: "verdict-changed" };
  }
  if (preflight.verification.connectionId !== current.verification.connectionId) {
    return { ok: false, reason: "connection-changed" };
  }
  if (preflight.verification.boundSourceCategory !== current.verification.boundSourceCategory) {
    return { ok: false, reason: "source-changed" };
  }
  // The check with real teeth. `boundSourceCategory` comes from the stored record
  // and so is nearly constant within a run; `chosenKey` is what the LIVE page
  // offered on each read. If the second verdict rests on a different field than the
  // first, the two are not the same observation, whatever they happen to agree on.
  if (preflight.chosenKey !== current.chosenKey) {
    return { ok: false, reason: "evidence-changed" };
  }
  return { ok: true };
}
