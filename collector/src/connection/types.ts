/**
 * Connection model for SellerOps NAVER collector onboarding.
 *
 * A "connection" is the durable binding between a SellerOps account and ONE NAVER
 * commerce account/store, backed by an isolated browser profile. This module is
 * pure types only — no I/O, no browser, no backend. See
 * `docs/connection-onboarding.md` for the product flow these types encode.
 *
 * Privacy invariant: a connection NEVER stores raw store/account identity. Only a
 * one-way fingerprint *hash* (`boundStoreFingerprintHash`) and a coarse source
 * *category* (`fingerprintSourceCategory`) are retained, so the drift guard can
 * answer "is the selected store the bound one?" without holding identity or PII.
 */

/** Source platform. Only NAVER SmartStore is modeled in this slice. */
export type Platform = "NAVER_SMARTSTORE";

/**
 * Connection-level status surfaced to the SellerOps user. Sits above the
 * run-level `CollectorState` in `../status.ts`.
 */
export type ConnectionStatus =
  | "PENDING_USER_LOGIN"
  | "PENDING_ACCOUNT_SELECTION"
  | "CONNECTED"
  | "NEEDS_REAUTH"
  | "ACCOUNT_MISMATCH"
  | "EXPORT_READY"
  | "EXPORT_FAILED";

/**
 * Coarse category describing WHAT a store fingerprint was derived from — a label,
 * never the raw value. Mirrors `docs/connection-onboarding.md`.
 */
export type FingerprintSourceCategory = "commerce-id" | "store-url-path" | "account-scope";

/** Sanitized reason a connection needs re-authentication. Category only. */
export type ReauthReasonCategory =
  | "session-logged-out"
  | "auth-challenge"
  | "export-page-unreachable-auth";

/** Sanitized summary of the last export attempt. Category only — never raw data. */
export type ExportResultCategory = "EXPORT_READY" | "EXPORT_FAILED" | "BLOCKED";

/**
 * A SellerOps ↔ NAVER connection. Field set aligns with
 * `docs/connection-onboarding.md`. All identity-bearing fields are hashes or
 * coarse categories — never raw store/account names, URLs, or PII.
 */
export interface CollectorConnection {
  /** Stable id for this SellerOps ↔ NAVER connection. */
  connectionId: string;
  platform: Platform;
  /** Isolated browser-profile dir name bound to this connection (id-derived). */
  profileName: string;
  connectionStatus: ConnectionStatus;
  /** Hash of the bound store identity; null until binding completes. */
  boundStoreFingerprintHash: string | null;
  /** Coarse category of the bound fingerprint's source; null until bound. */
  fingerprintSourceCategory: FingerprintSourceCategory | null;
  /**
   * `seller-session-identity/v1` digest of the composite `(userId, shopName)` read
   * from the seller-center chrome; null until bound. This is the PRIMARY session
   * identity — the SPA-state store key remains as a future fallback, not a
   * prerequisite.
   */
  boundSessionIdentityFingerprint: string | null;
  /**
   * The shop name as displayed at bind time. Stored in CLEAR by explicit
   * product-owner decision: it is the shop's own public name, and it is what turns an
   * otherwise unexplained MISMATCH into a visible "the shop was renamed". Distinct
   * from `userProvidedDisplayName`, which the operator types and this never touches.
   */
  boundShopDisplayName: string | null;
  /**
   * Digest of the selector SPECS that produced the bound identity. A binding is only
   * meaningful together with the selectors it was read through, so a later run whose
   * specs differ is comparing something else and must fail closed rather than answer.
   */
  boundSelectorSpecFingerprint: string | null;
  /**
   * Fingerprint of the SellerOps seller-account id this connection serves; null
   * until the account link is bound. See `seller-account-fingerprint.ts` for why a
   * digest and not the raw id. This is what lets a reply request bundle resolve to
   * exactly one connection by DATA rather than by an operator assertion per run.
   */
  boundSellerAccountFingerprint: string | null;
  /** Human-friendly label the USER typed — not scraped from NAVER. */
  userProvidedDisplayName: string;
  /** ISO timestamp of creation. */
  createdAt: string;
  /** ISO timestamp of last successful session + reachability verification. */
  lastVerifiedAt: string | null;
  /** ISO timestamp of the last export attempt. */
  lastExportAttemptAt: string | null;
  /** Sanitized result category of the last export. */
  lastExportResult: ExportResultCategory | null;
  /** Coarse reason category when status is NEEDS_REAUTH; null otherwise. */
  reauthRequiredReason: ReauthReasonCategory | null;
}

/** Session verification signal — reuses the run-level session state vocabulary. */
export type { SessionState } from "../status";

/**
 * Reachability of the review/export page, classified by cause so the guard can
 * distinguish an auth problem (→ re-auth) from a layout/network problem (→ fail).
 */
export type ExportPageReachability =
  | "REACHABLE"
  | "UNREACHABLE_AUTH"
  | "UNREACHABLE_LAYOUT"
  | "UNREACHABLE_NETWORK"
  | "UNREACHABLE_UNKNOWN";

/**
 * Sanitized reason category for a guard decision. Every value is a fixed label —
 * a guard decision can be logged wholesale without leaking identity.
 */
export type GuardReasonCategory =
  | "ok"
  | "session-logged-out"
  | "auth-challenge"
  | "bound-fingerprint-missing"
  | "current-fingerprint-missing"
  | "fingerprint-mismatch"
  | "export-page-unreachable-auth"
  | "export-page-unreachable-layout"
  | "export-page-unreachable-network"
  | "export-page-unreachable-unknown";
