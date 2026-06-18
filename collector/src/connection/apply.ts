/**
 * Pure appliers: fold a guard decision (and explicit export-attempt results) onto
 * a connection, producing a NEW connection. No I/O, no clock reads, no browser.
 *
 * Identity safety: these functions move only fixed status/category labels and
 * already-hashed values around. No raw store/account identity, raw fingerprint
 * source value, filename, row count, or raw error string ever enters the model.
 */

import { markAccountMismatch, markNeedsReauth } from "./connection";
import type {
  CollectorConnection,
  ExportResultCategory,
  GuardReasonCategory,
  ReauthReasonCategory,
} from "./types";
import type { ExportGuardDecision } from "./guard";

// Note: binding (`bindConnectionToFingerprint`) is intentionally NOT done here —
// it requires a freshly computed fingerprint hash + source category, which a
// guard decision does not (and must not) carry.

/** Narrow a guard reason to the re-auth subset (the only reasons NEEDS_REAUTH carries). */
function isReauthReason(reason: GuardReasonCategory): reason is ReauthReasonCategory {
  return (
    reason === "session-logged-out" ||
    reason === "auth-challenge" ||
    reason === "export-page-unreachable-auth"
  );
}

/**
 * Apply a pre-export guard decision to a connection, returning a new connection.
 * The input is never mutated. Mapping mirrors `evaluateExportGuard`:
 *   - allow / EXPORT_READY       → status EXPORT_READY, refresh `lastVerifiedAt`
 *   - NEEDS_REAUTH               → `markNeedsReauth` (binding preserved)
 *   - ACCOUNT_MISMATCH           → `markAccountMismatch` (bound hash preserved)
 *   - EXPORT_FAILED              → status EXPORT_FAILED, `lastExportResult` = EXPORT_FAILED
 *   - PENDING_ACCOUNT_SELECTION  → status PENDING_ACCOUNT_SELECTION (missing fp)
 * Only fixed categories are stored; no raw identity is read or written.
 */
export function applyGuardDecision(
  connection: CollectorConnection,
  decision: ExportGuardDecision,
  now: string,
): CollectorConnection {
  switch (decision.nextStatus) {
    case "EXPORT_READY":
      return { ...connection, connectionStatus: "EXPORT_READY", lastVerifiedAt: now };
    case "NEEDS_REAUTH":
      // The guard only ever pairs NEEDS_REAUTH with a re-auth reason category.
      return markNeedsReauth(
        connection,
        isReauthReason(decision.reasonCategory) ? decision.reasonCategory : "session-logged-out",
      );
    case "ACCOUNT_MISMATCH":
      return markAccountMismatch(connection);
    case "EXPORT_FAILED":
      return {
        ...connection,
        connectionStatus: "EXPORT_FAILED",
        lastExportResult: "EXPORT_FAILED",
      };
    case "PENDING_ACCOUNT_SELECTION":
      return { ...connection, connectionStatus: "PENDING_ACCOUNT_SELECTION" };
    // The guard never returns these, but the model permits them; keep the
    // connection unchanged rather than inventing a transition.
    case "PENDING_USER_LOGIN":
    case "CONNECTED":
      return connection;
  }
}

/**
 * Record an export attempt outcome on a connection (new connection returned).
 * Stores ONLY the attempt timestamp and a fixed result category — never a
 * filename, row count, store name, or raw error string.
 */
export function recordExportAttempt(
  connection: CollectorConnection,
  result: ExportResultCategory,
  now: string,
): CollectorConnection {
  return {
    ...connection,
    lastExportAttemptAt: now,
    lastExportResult: result,
  };
}
