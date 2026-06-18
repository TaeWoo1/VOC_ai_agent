/**
 * Pure connection lifecycle helpers. Every function is a pure transform — it
 * takes the current connection (and an explicit `now` ISO timestamp, for
 * determinism) and returns a NEW connection. No I/O, no clock reads, no browser.
 *
 * Identity safety: the only identity-bearing value any helper accepts is an
 * already-computed fingerprint HASH (see `fingerprintHash`). Raw store/account
 * names, URLs, and PII never enter the model.
 */

import { createHash } from "node:crypto";
import type {
  CollectorConnection,
  FingerprintSourceCategory,
  Platform,
  ReauthReasonCategory,
} from "./types";

/** Short, id-safe slug per platform — used as the profile-name prefix. */
const PLATFORM_PROFILE_SLUG: Record<Platform, string> = {
  NAVER_SMARTSTORE: "naver",
};

/**
 * Deterministic browser-profile dir name for a connection. Derived ONLY from the
 * platform slug and the connectionId — never from a raw store/account name — so
 * the same connection always maps to the same isolated profile, and the name
 * leaks no identity. Shape: `naver-${connectionId}`.
 */
export function profileNameForConnection(connectionId: string, platform: Platform): string {
  return `${PLATFORM_PROFILE_SLUG[platform]}-${connectionId}`;
}

/**
 * One-way fingerprint hash for a store/account identity token. The raw token is
 * consumed here and never returned or stored; only the hex digest leaves this
 * function. Callers store the digest in `boundStoreFingerprintHash` and compare
 * the current selection's digest against it. SHA-256, hex.
 */
export function fingerprintHash(rawIdentityToken: string): string {
  return createHash("sha256").update(rawIdentityToken, "utf8").digest("hex");
}

export interface CreatePendingConnectionInput {
  connectionId: string;
  platform: Platform;
  /** Label the user typed for this connection (their own words, not from NAVER). */
  userProvidedDisplayName: string;
  /** ISO timestamp; passed in for deterministic, testable output. */
  now: string;
}

/**
 * Create a freshly-pending connection at the start of onboarding (status
 * PENDING_USER_LOGIN). No fingerprint is bound yet; the profile name is derived
 * deterministically from the id.
 */
export function createPendingConnection(input: CreatePendingConnectionInput): CollectorConnection {
  return {
    connectionId: input.connectionId,
    platform: input.platform,
    profileName: profileNameForConnection(input.connectionId, input.platform),
    connectionStatus: "PENDING_USER_LOGIN",
    boundStoreFingerprintHash: null,
    fingerprintSourceCategory: null,
    userProvidedDisplayName: input.userProvidedDisplayName,
    createdAt: input.now,
    lastVerifiedAt: null,
    lastExportAttemptAt: null,
    lastExportResult: null,
    reauthRequiredReason: null,
  };
}

export interface BindConnectionInput {
  /** Already-hashed store identity (see `fingerprintHash`) — never a raw value. */
  fingerprintHash: string;
  fingerprintSourceCategory: FingerprintSourceCategory;
  /** ISO timestamp of the verification that produced this binding. */
  now: string;
}

/**
 * Bind a verified connection to a store fingerprint (status CONNECTED). Stores
 * ONLY the hash and its source category; clears any prior re-auth reason and
 * records the verification time.
 */
export function bindConnectionToFingerprint(
  connection: CollectorConnection,
  input: BindConnectionInput,
): CollectorConnection {
  return {
    ...connection,
    connectionStatus: "CONNECTED",
    boundStoreFingerprintHash: input.fingerprintHash,
    fingerprintSourceCategory: input.fingerprintSourceCategory,
    lastVerifiedAt: input.now,
    reauthRequiredReason: null,
  };
}

/**
 * Mark a connection as needing re-authentication (status NEEDS_REAUTH). The
 * binding (fingerprint hash + category) is PRESERVED across re-auth — only the
 * status and the sanitized reason category change.
 */
export function markNeedsReauth(
  connection: CollectorConnection,
  reason: ReauthReasonCategory,
): CollectorConnection {
  return {
    ...connection,
    connectionStatus: "NEEDS_REAUTH",
    reauthRequiredReason: reason,
  };
}

/**
 * Mark a connection as account-mismatched (status ACCOUNT_MISMATCH): the store
 * selected now differs from the bound fingerprint, so export is blocked until the
 * user re-selects the intended store. The bound hash is PRESERVED (it remains the
 * source of truth); this is not a re-auth condition, so the re-auth reason is
 * cleared.
 */
export function markAccountMismatch(connection: CollectorConnection): CollectorConnection {
  return {
    ...connection,
    connectionStatus: "ACCOUNT_MISMATCH",
    reauthRequiredReason: null,
  };
}
