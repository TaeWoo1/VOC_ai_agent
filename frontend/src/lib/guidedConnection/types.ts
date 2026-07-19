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
  | "readiness_checking"
  | "agent_unavailable"
  | "renderer_unavailable"
  | "naver_login_required"
  | "naver_reconnect_required"
  | "account_store_choice_required"
  | "application_issuance"
  | "credential_issued"
  | "sellerops_credential_entry"
  | "credential_registration"
  | "connection_testing"
  | "first_order_sync"
  | "completed"
  | "review_export_readiness"
  | "recoverable_ui_drift"
  | "unsupported_state"
  | "terminal_failure";

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
