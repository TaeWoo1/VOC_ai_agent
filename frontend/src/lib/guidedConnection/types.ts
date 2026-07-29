// NAVER Guided Connection (G3) — guided-journey state vocabulary.
//
// This is the FE-owned *onboarding-journey* state, NOT the Action Window *run* contract
// (that stays runtime-owned; see frontend/CLAUDE.md). It follows the semantic states of
// `docs/slices/naver-guided-connection.md` §8 and the actor boundary of §6, and consumes
// only sanitized signals — pairing phase + backend API result codes. It never carries a
// selector, raw URL, account/store id, or a Client Secret (§11, §17.4). Pure & DOM-free so
// it is unit-tested in the node-env Vitest setup.
import type { ConnectionTestStatus } from "../types";

/**
 * Coarse semantic journey phase (§8). The issuance sub-steps (application_list /
 * application_creation / permission_review / final_user_confirmation) are folded into one
 * user-driven `application_issuance` because v1 does NOT detect them live (live DOM detection
 * is deferred to G3-C, §9); the seller advances them. `completed` is the §8 success terminal
 * (③ registration + ④ test + ⑤ sync all met). `review_export_readiness` is the v1 handoff to
 * the existing Action Window export track (§0 ratification) — it never collects reviews here.
 */
export type GuidedPhase =
  // Discovery front (before the browser gate): reuse a stored key with no re-entry when possible.
  | "check_saved_credential"
  | "readiness_checking"
  | "agent_unavailable"
  | "renderer_unavailable"
  | "naver_login_required"
  | "naver_reconnect_required"
  // Three-path fork: reuse an existing app, or issue a new one only when there is none.
  | "application_path_choice"
  | "application_status_unknown"
  | "account_store_choice_required"
  | "application_issuance"
  | "credential_issued"
  | "sellerops_credential_entry"
  | "existing_credential_entry"
  | "credential_recovery_required"
  | "delete_reissue_confirm"
  | "credential_registration"
  | "connection_testing"
  // Distinct connection-test failure states (§5). permission/call-environment are MODELED but routed to
  // only by an explicit backend reason code — the current backend cannot classify them, so they stay
  // fail-closed pending live NAVER recon (G3-C, §4/§20-2); nothing guesses its way into them.
  | "permission_review_required"
  | "call_environment_mismatch"
  | "first_order_sync"
  | "completed"
  | "review_export_readiness"
  | "recoverable_ui_drift"
  | "unsupported_state"
  | "terminal_failure";

/**
 * Which onboarding path the seller is on (§discovery). `saved` = a stored key was found (reuse without
 * re-entry); `existing` = an app exists at NAVER but SellerOps has no key (enter it); `new` = no app,
 * issue one; `unknown` = existence not yet determined. Threaded through the reducer so a failure returns
 * the seller to the RIGHT entry (existing vs new) and never nudges an existing-app seller into issuance.
 */
export type GuidedPath = "unknown" | "saved" | "new" | "existing";

/** Actor boundary (§6). Automation is confined to deterministic/local concerns; login, 2FA,
 *  account/store selection, consent, and the Client Secret are always the seller's. */
export type GuidedActor =
  | "USER_REQUIRED"
  | "SELLEROPS_AUTOMATED"
  | "SELLEROPS_GUIDED"
  | "SUPERVISED_ACTION"
  | "UNSUPPORTED";

/** Sanitized failure reason — safe machine codes only, never a raw provider body/stack (§12). */
export type GuidedFailureReason =
  | "AGENT_UNAVAILABLE"
  | "RENDERER_UNAVAILABLE"
  | "NAVER_LOGIN_REQUIRED"
  | "RECONNECT_REQUIRED"
  | "INVALID_CREDENTIAL"
  | "PERMISSION_INSUFFICIENT"
  | "CALL_ENVIRONMENT_MISMATCH"
  | "SECRET_UNRECOVERABLE"
  | "TEMPORARY_PROVIDER_ERROR"
  | "PROVIDER_UNAVAILABLE"
  | "TEST_UNSUPPORTED"
  | "NOT_CONFIGURED"
  | "SYNC_FAILED"
  | "UI_DRIFT"
  | "UNKNOWN_STATE";

/** The three completion milestones — `completed` is reachable ONLY when all are true (§12). */
export interface GuidedMilestones {
  /** ③ credential registered to the backend Vault. */
  registered: boolean;
  /** ④ `test-connection` returned SUCCESS. */
  tested: boolean;
  /** ⑤ first order `sync` returned SUCCESS or PARTIAL (0-count still counts — §12). */
  synced: boolean;
}

export interface GuidedConnectionState {
  phase: GuidedPhase;
  actor: GuidedActor;
  /** Present only when the current phase reflects a recoverable/blocking failure. */
  failureReason: GuidedFailureReason | null;
  milestones: GuidedMilestones;
  /** Where the current NAVER-session-derived phase came from (B4 — makes readiness source explicit). */
  sessionSource: NaverSessionSource;
  /** Which discovery path the seller is on (§discovery) — decides existing-vs-new entry on a failure. */
  path: GuidedPath;
}

/**
 * Coarse NAVER session signal (§8 evidence enum, aligned with the collector `SessionVerdict`). `unknown`
 * is treated fail-closed. `reconnect_required` = the dedicated-profile session expired / a cold launch did
 * not inherit it (the G3-C.1 outcome) — a first-class, recoverable state, NOT a login-never-happened.
 */
export type NaverSessionSignal = "unknown" | "logged_in" | "logged_out" | "reconnect_required";

/**
 * Provenance of a NAVER session signal (B4). `detected` = observed live (bridge/probe) and authoritative;
 * `attested` = the seller asserted they logged in (used only when no live detection is available);
 * `none` = neither. Detection outranks attestation so the two can never conflict (see `resolveNaverSession`).
 */
export type NaverSessionSource = "detected" | "attested" | "none";

/** Sync status vocabulary consumed from the backend `SyncRunView.status` (mapped by the caller). */
export type GuidedSyncStatus = "SUCCESS" | "PARTIAL" | "FAILED" | "RUNNING";

/**
 * Sanitized events that advance the journey. Readiness signals come from the bridge/session;
 * the credential/test/sync events wrap backend results. There is deliberately NO event that
 * jumps straight to `completed` — the seller's decisions (§17.2) cannot be skipped.
 */
export type GuidedEvent =
  | {
      type: "READINESS";
      agentPaired: boolean;
      rendererAvailable: boolean;
      naverSession: NaverSessionSignal;
      /** Provenance of `naverSession` (B4). A detected reconnect can never be cleared by attestation. */
      sessionSource: NaverSessionSource;
    }
  /** Result of the Vault saved-credential check (§flow 1). true → reuse the stored key without re-entry. */
  | { type: "SAVED_CREDENTIAL_CHECKED"; hasSavedCredential: boolean }
  /** The seller's answer to "do you already have a NAVER API app?" (§discovery three-path fork). */
  | { type: "APPLICATION_PATH"; choice: "have" | "unknown" | "new" }
  /** The seller's self-check of NAVER's application list when they were unsure (§flow 7). */
  | { type: "APPLICATION_LIST_RESULT"; found: boolean }
  /** At existing-credential entry, the seller could not obtain the Secret → recovery (§flow 4). */
  | { type: "SECRET_UNAVAILABLE" }
  /** From recovery, the seller re-checked and found the Secret → back to entering it. */
  | { type: "SECRET_RECHECKED" }
  /** From recovery, the seller opts into the last-resort delete-then-reissue path (§flow 8). */
  | { type: "BEGIN_DELETE_REISSUE" }
  /** The seller confirmed no other program uses the app → proceed to fresh issuance (§flow 9). */
  | { type: "CONFIRM_NO_OTHER_PROGRAM" }
  /** The seller backed out of delete-then-reissue → return to recovery (§flow 8 cancel). */
  | { type: "CANCEL_DELETE_REISSUE" }
  | { type: "ACCOUNT_STORE_RESOLVED" }
  | { type: "ISSUANCE_COMPLETE" }
  | { type: "BEGIN_CREDENTIAL_ENTRY" }
  | { type: "SUBMIT_CREDENTIALS" }
  | { type: "CREDENTIAL_REGISTERED" }
  | { type: "REGISTRATION_FAILED" }
  | { type: "TEST_RESULT"; status: ConnectionTestStatus; reasonCode: string | null }
  | { type: "SYNC_RESULT"; status: GuidedSyncStatus }
  | { type: "CONTINUE_TO_REVIEW_EXPORT" }
  | { type: "NAVER_LOGGED_OUT" }
  | { type: "NAVER_RECONNECT_REQUIRED" }
  | { type: "AGENT_LOST" }
  | { type: "UI_DRIFT" }
  | { type: "UNKNOWN_STATE" }
  | { type: "RESUME" }
  | { type: "RESET" };
