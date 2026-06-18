/**
 * Minimal, pure onboarding/export workflow steps composed from the lower-level
 * connection helpers, guard, and applier. No I/O, no clock reads, no browser, no
 * logging. Each step takes an explicit `now` and returns a NEW connection.
 *
 * These steps encode the human-driven flow from `docs/connection-onboarding.md`:
 * the collector verifies and binds, it never selects an account/store for the
 * user. `completeManualAccountSelection` is the boundary where the human has
 * already chosen the target — this code only records that choice as a hash.
 */

import { bindConnectionToFingerprint } from "./connection";
import { evaluateExportGuard, type ExportGuardDecision, type ExportGuardInput } from "./guard";
import { applyGuardDecision } from "./apply";
import type { CollectorConnection, FingerprintSourceCategory } from "./types";

/**
 * After a valid login/session but BEFORE the user has manually selected the
 * intended NAVER account/store. Moves to PENDING_ACCOUNT_SELECTION and records the
 * verification time. Binds nothing — no fingerprint, no identity.
 */
export function markPendingAccountSelection(
  connection: CollectorConnection,
  now: string,
): CollectorConnection {
  return {
    ...connection,
    connectionStatus: "PENDING_ACCOUNT_SELECTION",
    lastVerifiedAt: now,
  };
}

/**
 * Record that the user has MANUALLY selected the intended NAVER commerce
 * account/store. The collector never auto-selects; this only binds the choice the
 * human made. Stores only the fingerprint hash + source category, plus the
 * user-facing SellerOps alias (`userProvidedDisplayName`) — never a raw NAVER
 * store/account name. Status becomes CONNECTED.
 *
 * Note: `userProvidedDisplayName` is, by contract, a label the USER typed for
 * their own reference. It is the only free-form string accepted here and must not
 * be populated with scraped NAVER identity.
 */
export function completeManualAccountSelection(
  connection: CollectorConnection,
  fingerprintHash: string,
  fingerprintSourceCategory: FingerprintSourceCategory,
  userProvidedDisplayName: string,
  now: string,
): CollectorConnection {
  const bound = bindConnectionToFingerprint(connection, {
    fingerprintHash,
    fingerprintSourceCategory,
    now,
  });
  return { ...bound, userProvidedDisplayName };
}

export interface PreparedExportAttempt {
  decision: ExportGuardDecision;
  nextConnection: CollectorConnection;
}

/**
 * Pure pre-flight for an export: evaluate the drift guard and fold its decision
 * onto the connection. Returns both the decision and the next connection. No side
 * effects — it neither runs an export nor mutates the input connection. The caller
 * decides whether to proceed based on `decision.allow`.
 */
export function prepareExportAttempt(
  connection: CollectorConnection,
  guardInput: Omit<ExportGuardInput, "connection">,
  now: string,
): PreparedExportAttempt {
  const decision = evaluateExportGuard({ connection, ...guardInput });
  const nextConnection = applyGuardDecision(connection, decision, now);
  return { decision, nextConnection };
}
