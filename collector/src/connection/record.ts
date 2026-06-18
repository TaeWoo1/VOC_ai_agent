/**
 * Pure serialization + validation for `CollectorConnection`. No fs, no DB, no
 * env — just in-memory transforms between a connection and a JSON-safe record.
 *
 * Validation is allow-list only: every enum field must match a known label, and
 * every rejection returns a fixed sanitized error CATEGORY. Errors never echo the
 * offending raw value, so an attacker-controlled record cannot smuggle a string
 * (script, PII, identity) back out through a parse error.
 */

import type {
  CollectorConnection,
  ConnectionStatus,
  ExportResultCategory,
  FingerprintSourceCategory,
  Platform,
  ReauthReasonCategory,
} from "./types";

/** Current on-disk/record schema version. */
export const CONNECTION_SCHEMA_VERSION = 1 as const;

/** JSON-safe connection record: the connection fields plus a schema version. */
export interface ConnectionRecord extends CollectorConnection {
  schemaVersion: typeof CONNECTION_SCHEMA_VERSION;
}

/** Sanitized parse-failure categories. Never carry a raw offending value. */
export type ParseErrorCategory =
  | "not-an-object"
  | "missing-or-wrong-type-field"
  | "unknown-schema-version"
  | "unknown-platform"
  | "unknown-status"
  | "unknown-fingerprint-source-category"
  | "unknown-reauth-reason"
  | "unknown-export-result";

export type ParseConnectionResult =
  | { ok: true; connection: CollectorConnection }
  | { ok: false; errorCategory: ParseErrorCategory };

const PLATFORMS: readonly Platform[] = ["NAVER_SMARTSTORE"];
const STATUSES: readonly ConnectionStatus[] = [
  "PENDING_USER_LOGIN",
  "PENDING_ACCOUNT_SELECTION",
  "CONNECTED",
  "NEEDS_REAUTH",
  "ACCOUNT_MISMATCH",
  "EXPORT_READY",
  "EXPORT_FAILED",
];
const FINGERPRINT_SOURCE_CATEGORIES: readonly FingerprintSourceCategory[] = [
  "commerce-id",
  "store-url-path",
  "account-scope",
];
const REAUTH_REASONS: readonly ReauthReasonCategory[] = [
  "session-logged-out",
  "auth-challenge",
  "export-page-unreachable-auth",
];
const EXPORT_RESULTS: readonly ExportResultCategory[] = ["EXPORT_READY", "EXPORT_FAILED", "BLOCKED"];

/**
 * Serialize a connection to a JSON-safe record. The result is a plain data object
 * (no methods, no prototypes of note) carrying exactly the `CollectorConnection`
 * fields plus `schemaVersion`.
 */
export function toConnectionRecord(connection: CollectorConnection): ConnectionRecord {
  return {
    schemaVersion: CONNECTION_SCHEMA_VERSION,
    connectionId: connection.connectionId,
    platform: connection.platform,
    profileName: connection.profileName,
    connectionStatus: connection.connectionStatus,
    boundStoreFingerprintHash: connection.boundStoreFingerprintHash,
    fingerprintSourceCategory: connection.fingerprintSourceCategory,
    userProvidedDisplayName: connection.userProvidedDisplayName,
    createdAt: connection.createdAt,
    lastVerifiedAt: connection.lastVerifiedAt,
    lastExportAttemptAt: connection.lastExportAttemptAt,
    lastExportResult: connection.lastExportResult,
    reauthRequiredReason: connection.reauthRequiredReason,
  };
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}
function isStringOrNull(v: unknown): v is string | null {
  return v === null || typeof v === "string";
}

/**
 * Validate unknown input into a `CollectorConnection`. Allow-list only; unknown
 * platforms/statuses/categories and missing/mistyped fields are rejected with a
 * fixed `errorCategory`. The offending raw value is never included in the result.
 */
export function parseConnectionRecord(input: unknown): ParseConnectionResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, errorCategory: "not-an-object" };
  }
  const r = input as Record<string, unknown>;

  if (r.schemaVersion !== CONNECTION_SCHEMA_VERSION) {
    return { ok: false, errorCategory: "unknown-schema-version" };
  }

  // Required string fields.
  if (
    !isString(r.connectionId) ||
    !isString(r.profileName) ||
    !isString(r.userProvidedDisplayName) ||
    !isString(r.createdAt)
  ) {
    return { ok: false, errorCategory: "missing-or-wrong-type-field" };
  }
  // Nullable string fields.
  if (
    !isStringOrNull(r.boundStoreFingerprintHash) ||
    !isStringOrNull(r.lastVerifiedAt) ||
    !isStringOrNull(r.lastExportAttemptAt)
  ) {
    return { ok: false, errorCategory: "missing-or-wrong-type-field" };
  }

  // Enum fields (allow-list).
  if (!isString(r.platform) || !PLATFORMS.includes(r.platform as Platform)) {
    return { ok: false, errorCategory: "unknown-platform" };
  }
  if (!isString(r.connectionStatus) || !STATUSES.includes(r.connectionStatus as ConnectionStatus)) {
    return { ok: false, errorCategory: "unknown-status" };
  }
  if (
    r.fingerprintSourceCategory !== null &&
    (!isString(r.fingerprintSourceCategory) ||
      !FINGERPRINT_SOURCE_CATEGORIES.includes(
        r.fingerprintSourceCategory as FingerprintSourceCategory,
      ))
  ) {
    return { ok: false, errorCategory: "unknown-fingerprint-source-category" };
  }
  if (
    r.reauthRequiredReason !== null &&
    (!isString(r.reauthRequiredReason) ||
      !REAUTH_REASONS.includes(r.reauthRequiredReason as ReauthReasonCategory))
  ) {
    return { ok: false, errorCategory: "unknown-reauth-reason" };
  }
  if (
    r.lastExportResult !== null &&
    (!isString(r.lastExportResult) ||
      !EXPORT_RESULTS.includes(r.lastExportResult as ExportResultCategory))
  ) {
    return { ok: false, errorCategory: "unknown-export-result" };
  }

  // All checks passed — construct explicitly (drops any unknown extra keys).
  const connection: CollectorConnection = {
    connectionId: r.connectionId,
    platform: r.platform as Platform,
    profileName: r.profileName,
    connectionStatus: r.connectionStatus as ConnectionStatus,
    boundStoreFingerprintHash: r.boundStoreFingerprintHash,
    fingerprintSourceCategory: r.fingerprintSourceCategory as FingerprintSourceCategory | null,
    userProvidedDisplayName: r.userProvidedDisplayName,
    createdAt: r.createdAt,
    lastVerifiedAt: r.lastVerifiedAt,
    lastExportAttemptAt: r.lastExportAttemptAt,
    lastExportResult: r.lastExportResult as ExportResultCategory | null,
    reauthRequiredReason: r.reauthRequiredReason as ReauthReasonCategory | null,
  };
  return { ok: true, connection };
}

/**
 * Serialize then re-parse a connection. Returns the parsed connection on success.
 * Throws a SANITIZED error (category only — no raw values) if a valid connection
 * somehow fails to round-trip, which would indicate a serializer/validator drift.
 */
export function roundTripConnectionRecord(connection: CollectorConnection): CollectorConnection {
  const json = JSON.stringify(toConnectionRecord(connection));
  const parsed = parseConnectionRecord(JSON.parse(json));
  if (!parsed.ok) {
    throw new Error(`connection record round-trip failed: ${parsed.errorCategory}`);
  }
  return parsed.connection;
}
