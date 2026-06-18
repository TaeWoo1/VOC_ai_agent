/**
 * Pre-export account-drift guard — pure decision logic run before EVERY export.
 *
 * The guiding rule (see `docs/connection-onboarding.md`): identity must be
 * positively proven before any export. A missing or mismatched fingerprint is a
 * HARD BLOCK, never a warning. The guard takes only sanitized signals (a session
 * state, two fingerprint HASHES, and a reachability category) and returns a
 * decision whose every field is a fixed label — so a decision can be logged
 * wholesale without leaking store/account identity.
 */

import type {
  CollectorConnection,
  ConnectionStatus,
  ExportPageReachability,
  GuardReasonCategory,
  SessionState,
} from "./types";

export interface ExportGuardInput {
  /** The connection being checked (its `boundStoreFingerprintHash` may be null). */
  connection: CollectorConnection;
  /** Result of the seller-center session check. */
  session: SessionState;
  /** Hash of the store selected RIGHT NOW; null if it could not be resolved. */
  currentFingerprintHash: string | null;
  /** Reachability of the review/export page, classified by cause. */
  exportPageReachability: ExportPageReachability;
}

export interface ExportGuardDecision {
  /** Whether export may proceed. Only true for the all-clear path. */
  allow: boolean;
  /** The connection status this decision implies. */
  nextStatus: ConnectionStatus;
  /** Sanitized reason category — a fixed label, never raw identity. */
  reasonCategory: GuardReasonCategory;
}

/**
 * Evaluate the pre-export guard. Precedence is deliberate and matches the doc:
 *   1. session not logged in        → block, NEEDS_REAUTH
 *   2. bound fingerprint missing     → block, PENDING_ACCOUNT_SELECTION
 *   3. current fingerprint missing   → block, PENDING_ACCOUNT_SELECTION
 *   4. current ≠ bound               → block, ACCOUNT_MISMATCH
 *   5. export page unreachable (auth) → block, NEEDS_REAUTH
 *   6. export page unreachable (other)→ block, EXPORT_FAILED
 *   7. all clear                     → allow, EXPORT_READY
 */
export function evaluateExportGuard(input: ExportGuardInput): ExportGuardDecision {
  const block = (
    nextStatus: ConnectionStatus,
    reasonCategory: GuardReasonCategory,
  ): ExportGuardDecision => ({ allow: false, nextStatus, reasonCategory });

  // 1. Session must be valid first.
  if (input.session === "LOGGED_OUT") return block("NEEDS_REAUTH", "session-logged-out");
  if (input.session === "AUTH_CHALLENGE") return block("NEEDS_REAUTH", "auth-challenge");

  // 2/3. Identity must be present on BOTH sides before it can be compared. A
  // not-yet-bound connection or an unresolvable current selection sends the user
  // back to manual account selection — never a silent default store.
  if (input.connection.boundStoreFingerprintHash === null) {
    return block("PENDING_ACCOUNT_SELECTION", "bound-fingerprint-missing");
  }
  if (input.currentFingerprintHash === null) {
    return block("PENDING_ACCOUNT_SELECTION", "current-fingerprint-missing");
  }

  // 4. Positive identity match required.
  if (input.currentFingerprintHash !== input.connection.boundStoreFingerprintHash) {
    return block("ACCOUNT_MISMATCH", "fingerprint-mismatch");
  }

  // 5/6. Export page must be reachable; classify the failure cause.
  switch (input.exportPageReachability) {
    case "REACHABLE":
      break;
    case "UNREACHABLE_AUTH":
      return block("NEEDS_REAUTH", "export-page-unreachable-auth");
    case "UNREACHABLE_LAYOUT":
      return block("EXPORT_FAILED", "export-page-unreachable-layout");
    case "UNREACHABLE_NETWORK":
      return block("EXPORT_FAILED", "export-page-unreachable-network");
    case "UNREACHABLE_UNKNOWN":
      return block("EXPORT_FAILED", "export-page-unreachable-unknown");
  }

  // 7. Session ok + fingerprint matches + export page reachable.
  return { allow: true, nextStatus: "EXPORT_READY", reasonCategory: "ok" };
}
