// NAVER Guided Connection (G3) — guided-journey state vocabulary.
//
// This is the FE-owned *onboarding-journey* state, NOT the Action Window *run* contract
// (that stays runtime-owned; see frontend/CLAUDE.md). It follows the semantic states of
// `docs/slices/naver-guided-connection.md` §8 and the actor boundary of §6, and consumes
// only sanitized signals — backend API result codes. It never carries a selector, raw URL,
// account/store id, or a Client Secret (§11, §17.4). Pure & DOM-free so it is unit-tested in
// the node-env Vitest setup.
//
// **Local-Agent-free initial connection (product decision 2026-07-31).** The NAVER API *order*
// connection is completed with NO Local Agent: there is NO bridge/renderer/NAVER-login readiness
// gate. The seller issues/enters an Application ID + Secret, SellerOps registers → tests → runs the
// first order sync, all through backend calls. The Local Agent (pairing + NAVER seller-center login
// + Action Window) is required ONLY later, when setting up REVIEW_IMPORT — never to connect orders.
import type { ConnectionTestStatus } from "../types";

/**
 * Coarse semantic journey phase (§8). The issuance sub-steps (application_list /
 * application_creation / permission_review / final_user_confirmation) are folded into one
 * user-driven `application_issuance` because v1 does NOT detect them live (live DOM detection
 * is deferred to G3-C, §9); the seller advances them. `completed` is the §8 success terminal
 * (③ registration + ④ test + ⑤ sync all met). `review_export_readiness` is the v1 handoff to
 * the existing Action Window export track (§0 ratification) — it never collects reviews here.
 *
 * The journey has NO readiness gate: `check_saved_credential` hands straight to the three-path
 * fork (`application_path_choice`) when there is no stored key, or reuses the key and goes to the
 * test. Nothing here depends on the Local Agent.
 */
export type GuidedPhase =
  // Discovery front: reuse a stored key with no re-entry when possible.
  | "check_saved_credential"
  // Three-path fork: reuse an existing app, or issue a new one ONLY when the store verifiably has none.
  // A store that already holds an app is routed to reuse — NAVER allows one app per store and provides no
  // app-delete (live-confirmed 2026-07-29), so a "new" issuance is only reachable after an app-absence check.
  | "application_path_choice"
  | "application_status_unknown"
  | "account_store_choice_required"
  | "application_issuance"
  // The Action Window guided walkthrough for issuance: SellerOps highlights the control in a dedicated
  // NAVER API-center browser (via the Local Agent) and the seller performs every real click. This is the
  // ONLY place the Local Agent participates in the order connection; a `mode:"text"` fallback returns to
  // `application_issuance` (the static checklist), incl. when the Local Agent is unavailable.
  | "application_issuance_guided"
  | "credential_issued"
  | "sellerops_credential_entry"
  | "existing_credential_entry"
  | "credential_recovery_required"
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
 * re-entry); `existing` = an app exists at NAVER but SellerOps has no key (enter it); `new` = the store has
 * NO app (confirmed via the app-absence check) so one is issued; `unknown` = existence not yet determined.
 * Threaded through the reducer so a failure returns the seller to the RIGHT entry (existing vs new) and
 * never nudges an existing-app seller into issuance (which NAVER would block: one app per store, no delete).
 */
export type GuidedPath = "unknown" | "saved" | "new" | "existing";

/** Actor boundary (§6). Automation is confined to deterministic/local concerns; account/store
 *  selection, consent, and the Client Secret are always the seller's. */
export type GuidedActor =
  | "USER_REQUIRED"
  | "SELLEROPS_AUTOMATED"
  | "SELLEROPS_GUIDED"
  | "SUPERVISED_ACTION"
  | "UNSUPPORTED";

/** Sanitized failure reason — safe machine codes only, never a raw provider body/stack (§12). */
export type GuidedFailureReason =
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
  /** Which discovery path the seller is on (§discovery) — decides existing-vs-new entry on a failure. */
  path: GuidedPath;
}

/** Sync status vocabulary consumed from the backend `SyncRunView.status` (mapped by the caller). */
export type GuidedSyncStatus = "SUCCESS" | "PARTIAL" | "FAILED" | "RUNNING";

/**
 * Sanitized events that advance the journey. The credential/test/sync events wrap backend results.
 * There is deliberately NO event that jumps straight to `completed` — the seller's decisions (§17.2)
 * cannot be skipped. There is NO readiness/agent/session event: the order connection never depends on
 * the Local Agent.
 */
export type GuidedEvent =
  /**
   * Read-only resume from the backend capability snapshot on page load (§flow 1). Carries only derived
   * booleans — never a secret. `completed` (a prior first ORDER_SUMMARY sync actually succeeded) restores
   * the completed screen with NO re-test/re-sync; `syncing` (a first sync is currently RUNNING) restores the
   * in-progress sync screen so the page RESUMES OBSERVING the same run (poll only — never a re-test/re-sync,
   * never a second job); `credentialPresent` (a stored key, not yet completed) lands on the connection test
   * as a USER CTA (still no auto-run); none → the three-path fork. `completed` is the ONLY status that may
   * reach `completed` directly, and only because the backend read already proved it. `syncing` is optional
   * (absent ⇒ false) so callers/fixtures that predate progress-resume stay valid.
   */
  | { type: "RESUME_FROM_CAPABILITY"; credentialPresent: boolean; completed: boolean; syncing?: boolean }
  /** The seller's answer to "do you already have a NAVER API app?" (§discovery three-path fork). */
  | { type: "APPLICATION_PATH"; choice: "have" | "unknown" | "new" }
  /** The seller's self-check of NAVER's application list when they were unsure (§flow 7). */
  | { type: "APPLICATION_LIST_RESULT"; found: boolean }
  /** At existing-credential entry, the seller could not obtain the Secret → recovery (§flow 4). */
  | { type: "SECRET_UNAVAILABLE" }
  /**
   * From recovery, the seller now HAS the Secret again — either they re-viewed it, or they reissued it on
   * the SAME existing app (NAVER provides no app-delete; reissue is the only recovery). → back to entering it.
   */
  | { type: "SECRET_RECHECKED" }
  | { type: "ACCOUNT_STORE_RESOLVED" }
  /**
   * At `application_issuance`, the seller chooses HOW to issue: `guided` opens the Action Window guided
   * walkthrough (`application_issuance_guided`); `text` keeps the static checklist in place (a no-op at
   * `application_issuance`). From the guided walkthrough, `text` is the fallback back to the checklist —
   * including when the Local Agent is unavailable. It never carries a credential or an account id.
   */
  | { type: "APPLICATION_ISSUANCE_MODE"; mode: "guided" | "text" }
  | { type: "ISSUANCE_COMPLETE" }
  | { type: "BEGIN_CREDENTIAL_ENTRY" }
  | { type: "SUBMIT_CREDENTIALS" }
  | { type: "CREDENTIAL_REGISTERED" }
  | { type: "REGISTRATION_FAILED" }
  | { type: "TEST_RESULT"; status: ConnectionTestStatus; reasonCode: string | null }
  | { type: "SYNC_RESULT"; status: GuidedSyncStatus }
  | { type: "CONTINUE_TO_REVIEW_EXPORT" }
  | { type: "UI_DRIFT" }
  | { type: "UNKNOWN_STATE" }
  | { type: "RESUME" }
  | { type: "RESET" };
