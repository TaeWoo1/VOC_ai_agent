// NAVER Guided Connection (G3) — pure guided-journey state machine.
//
// A total, DOM-free reducer over sanitized `GuidedEvent`s. Design invariants, each pinned by a
// test in `state.test.ts` and traceable to `docs/slices/naver-guided-connection.md`:
//   • completed ⇐ registered ∧ tested ∧ synced ONLY (§12). No event jumps to completed.
//   • the seller's decisions (login, path, account/store, issuance, consent) cannot be skipped (§17.2).
//   • unknown/low-confidence evidence fails closed to `unsupported_state`, never "proceed" (§17.3).
//   • milestones persist across regressions so resume restores safe progress (§13).
//   • it holds no secret, selector, url, or account id — only phase/actor/reason/milestone/path flags.
//
// Discovery/reuse/recovery front (§discovery): the journey starts at `check_saved_credential`, not the
// browser gate — a returning seller with a stored key reuses it (no re-entry, no agent/login friction)
// and goes straight to the connection test. Only when there is no stored key does the browser gate run,
// then a three-path fork (existing app / unknown / new). An existing-app seller is NEVER auto-nudged
// into issuing a second app.
import type { ConnectionTestStatus } from "../types";
import type {
  GuidedActor,
  GuidedConnectionState,
  GuidedEvent,
  GuidedFailureReason,
  GuidedMilestones,
  GuidedPath,
  GuidedPhase,
  NaverSessionSignal,
  NaverSessionSource,
} from "./types";

const NO_MILESTONES: GuidedMilestones = { registered: false, tested: false, synced: false };

/** The static actor for each phase (§6 actor boundary). */
const ACTOR_BY_PHASE: Record<GuidedPhase, GuidedActor> = {
  check_saved_credential: "SELLEROPS_AUTOMATED",
  readiness_checking: "SELLEROPS_AUTOMATED",
  agent_unavailable: "USER_REQUIRED",
  renderer_unavailable: "USER_REQUIRED",
  naver_login_required: "USER_REQUIRED",
  naver_reconnect_required: "USER_REQUIRED",
  application_path_choice: "USER_REQUIRED",
  application_status_unknown: "USER_REQUIRED",
  account_store_choice_required: "USER_REQUIRED",
  application_issuance: "USER_REQUIRED",
  credential_issued: "SELLEROPS_GUIDED",
  sellerops_credential_entry: "USER_REQUIRED",
  existing_credential_entry: "USER_REQUIRED",
  credential_recovery_required: "USER_REQUIRED",
  credential_registration: "SELLEROPS_AUTOMATED",
  connection_testing: "SELLEROPS_AUTOMATED",
  permission_review_required: "USER_REQUIRED",
  call_environment_mismatch: "USER_REQUIRED",
  first_order_sync: "SELLEROPS_AUTOMATED",
  completed: "SELLEROPS_AUTOMATED",
  review_export_readiness: "SELLEROPS_GUIDED",
  recoverable_ui_drift: "USER_REQUIRED",
  unsupported_state: "USER_REQUIRED",
  terminal_failure: "USER_REQUIRED",
};

/** Readiness-gate phases: only here does a `READINESS` signal (re-)derive the gate. Past the
 *  gate, regressions arrive as explicit `AGENT_LOST` / `NAVER_LOGGED_OUT` / `NAVER_RECONNECT_REQUIRED`
 *  events (§13). */
const GATE_PHASES: ReadonlySet<GuidedPhase> = new Set<GuidedPhase>([
  "readiness_checking",
  "agent_unavailable",
  "renderer_unavailable",
  "naver_login_required",
  "naver_reconnect_required",
]);

/**
 * Phases where a live NAVER **browser** session is actually in use — the gate plus the API-center
 * discovery/issuance walk (B4). A NAVER session drop regresses ONLY from here; once the seller has moved
 * on to typing credentials, the remaining steps are backend calls and `completed` is durable, so a
 * browser-session change there is a no-op (login is never assumed permanent). Credential entry and recovery
 * are past the value-reading point, so — like the original `sellerops_credential_entry` — they are NOT
 * session-sensitive.
 */
const SESSION_SENSITIVE_PHASES: ReadonlySet<GuidedPhase> = new Set<GuidedPhase>([
  "readiness_checking",
  "agent_unavailable",
  "renderer_unavailable",
  "naver_login_required",
  "naver_reconnect_required",
  "application_path_choice",
  "application_status_unknown",
  "account_store_choice_required",
  "application_issuance",
  "credential_issued",
]);

/** The public actor for a phase — exported so the UI never re-derives it. */
export function actorFor(phase: GuidedPhase): GuidedActor {
  return ACTOR_BY_PHASE[phase];
}

function state(
  phase: GuidedPhase,
  milestones: GuidedMilestones,
  failureReason: GuidedFailureReason | null = null,
  sessionSource: NaverSessionSource = "none",
  path: GuidedPath = "unknown",
): GuidedConnectionState {
  return { phase, actor: ACTOR_BY_PHASE[phase], failureReason, milestones, sessionSource, path };
}

export const INITIAL_STATE: GuidedConnectionState = state("check_saved_credential", NO_MILESTONES);

/**
 * Compose the seller's login attestation with any live detection into one signal + its provenance (B4).
 * **Live detection always wins when present** — a detected `reconnect_required`/`logged_out` can never be
 * attested past (fail-closed), and a detected `logged_in` outranks attestation — so the two can never
 * conflict. With no detection available (the offline G3-A/B path), the seller's attestation is used.
 */
export function resolveNaverSession(
  attested: boolean,
  detected: NaverSessionSignal | null,
): { signal: NaverSessionSignal; source: NaverSessionSource } {
  if (detected !== null) return { signal: detected, source: "detected" };
  if (attested) return { signal: "logged_in", source: "attested" };
  return { signal: "unknown", source: "none" };
}

/** Derive the readiness-gate phase from a sanitized readiness signal, fail-closed. On success the gate
 *  hands off to the three-path fork (`application_path_choice`), NOT straight to issuance. */
function deriveReadiness(
  ev: Extract<GuidedEvent, { type: "READINESS" }>,
  prevPhase: GuidedPhase,
  milestones: GuidedMilestones,
  path: GuidedPath,
): GuidedConnectionState {
  if (!ev.agentPaired) return state("agent_unavailable", milestones, "AGENT_UNAVAILABLE", "none", path);
  if (!ev.rendererAvailable) return state("renderer_unavailable", milestones, "RENDERER_UNAVAILABLE", "none", path);
  if (ev.naverSession === "reconnect_required") {
    return state("naver_reconnect_required", milestones, "RECONNECT_REQUIRED", ev.sessionSource, path);
  }
  if (ev.naverSession === "logged_out" || ev.naverSession === "unknown") {
    return state("naver_login_required", milestones, "NAVER_LOGIN_REQUIRED", ev.sessionSource, path);
  }
  if (prevPhase === "naver_reconnect_required" && ev.sessionSource !== "detected") {
    return state("naver_reconnect_required", milestones, "RECONNECT_REQUIRED", "detected", path);
  }
  return state("application_path_choice", milestones, null, ev.sessionSource, path);
}

/** The credential-entry phase for a given path: an existing/saved-app seller re-enters at the EXISTING
 *  entry (framed as reusing their app), a new-app seller at the issuance-entry. */
function entryPhaseFor(path: GuidedPath): GuidedPhase {
  return path === "existing" || path === "saved" ? "existing_credential_entry" : "sellerops_credential_entry";
}

/** Map a non-SUCCESS `test-connection` result to the next safe phase (§12, §5). */
function afterTestFailure(
  status: Exclude<ConnectionTestStatus, "SUCCESS">,
  reasonCode: string | null,
  milestones: GuidedMilestones,
  path: GuidedPath,
): GuidedConnectionState {
  const entry = entryPhaseFor(path);
  const cleared = { ...milestones, tested: false };
  if (status === "NOT_CONFIGURED") return state(entry, cleared, "NOT_CONFIGURED", "none", path);
  if (status === "UNSUPPORTED") return state("unsupported_state", cleared, "TEST_UNSUPPORTED", "none", path);
  // status === "FAILED": branch on the safe reason code.
  if (reasonCode === "INVALID_CREDENTIAL") return state(entry, cleared, "INVALID_CREDENTIAL", "none", path);
  // Distinct user states (§5). These reason codes are MODELED but not emitted by the current backend —
  // classifying insufficient-permission vs a call-environment/IP mismatch needs live NAVER recon (G3-C,
  // §4/§20-2). Fail-closed: only an explicit code routes here; an unclassified failure is a transient retry.
  if (reasonCode === "PERMISSION_INSUFFICIENT") {
    return state("permission_review_required", cleared, "PERMISSION_INSUFFICIENT", "none", path);
  }
  if (reasonCode === "CALL_ENVIRONMENT_MISMATCH") {
    return state("call_environment_mismatch", cleared, "CALL_ENVIRONMENT_MISMATCH", "none", path);
  }
  const reason: GuidedFailureReason =
    reasonCode === "PROVIDER_UNAVAILABLE" ? "PROVIDER_UNAVAILABLE" : "TEMPORARY_PROVIDER_ERROR";
  return state("connection_testing", cleared, reason, "none", path);
}

/** Phases that consume a `TEST_RESULT` (the test step + the two recoverable env failures that re-test). */
const TEST_RESULT_PHASES: ReadonlySet<GuidedPhase> = new Set<GuidedPhase>([
  "connection_testing",
  "permission_review_required",
  "call_environment_mismatch",
]);

/**
 * The reducer. Unmodeled (phase, event) pairs are a deliberate no-op — this is what prevents
 * skipping a step: e.g. a `SYNC_RESULT` while still in `check_saved_credential` changes nothing, so
 * `completed` can only be reached by walking the whole journey.
 */
export function guidedConnectionReducer(
  prev: GuidedConnectionState,
  event: GuidedEvent,
): GuidedConnectionState {
  const m = prev.milestones;
  const p = prev.path;

  // Global transitions valid from any phase.
  switch (event.type) {
    case "RESET":
      return INITIAL_STATE;
    case "AGENT_LOST":
      // Agent loss is runtime-liveness (the local agent process is gone), so it surfaces from anywhere.
      return state("agent_unavailable", m, "AGENT_UNAVAILABLE", "none", p);
    case "NAVER_LOGGED_OUT":
      // A NAVER browser-session drop matters only while a browser session is in use (B4). Past that
      // (credential entry onward, completed) it is a no-op — login is never assumed permanent.
      return SESSION_SENSITIVE_PHASES.has(prev.phase)
        ? state("naver_login_required", m, "NAVER_LOGIN_REQUIRED", "detected", p)
        : prev;
    case "NAVER_RECONNECT_REQUIRED":
      return SESSION_SENSITIVE_PHASES.has(prev.phase)
        ? state("naver_reconnect_required", m, "RECONNECT_REQUIRED", "detected", p)
        : prev;
    case "UI_DRIFT":
      return state("recoverable_ui_drift", m, "UI_DRIFT", "none", p);
    case "UNKNOWN_STATE":
      return state("unsupported_state", m, "UNKNOWN_STATE", "none", p);
    case "RESUME":
      // Recover from a fail-closed pause (drift/unsupported) to the furthest SAFE phase (§13).
      return resumeFromMilestones(m, p);
    default:
      break;
  }

  // Saved-credential check (the entry, before the browser gate).
  if (prev.phase === "check_saved_credential") {
    if (event.type === "SAVED_CREDENTIAL_CHECKED") {
      // A stored credential means registration already happened — reuse it: go straight to the test,
      // no re-entry, no agent/login gate (a backend auth check needs neither).
      return event.hasSavedCredential
        ? state("connection_testing", { ...m, registered: true }, null, "none", "saved")
        : state("readiness_checking", m, null, "none", p);
    }
    return prev;
  }

  if (event.type === "READINESS") {
    // Only advance/regress the gate while inside it; never clobber later journey progress.
    if (!GATE_PHASES.has(prev.phase)) return prev;
    const next = deriveReadiness(event, prev.phase, m, p);
    // Idempotent: an unchanged gate result returns the SAME reference, so a reactive effect can
    // re-dispatch READINESS on every bridge tick without looping (useReducer bails on identity).
    return next.phase === prev.phase &&
      next.failureReason === prev.failureReason &&
      next.sessionSource === prev.sessionSource
      ? prev
      : next;
  }

  // The three-path fork and the test-retry phases handle TEST_RESULT uniformly.
  if (TEST_RESULT_PHASES.has(prev.phase) && event.type === "TEST_RESULT") {
    if (event.status === "SUCCESS") return state("first_order_sync", { ...m, tested: true }, null, "none", p);
    return afterTestFailure(event.status, event.reasonCode, m, p);
  }

  switch (prev.phase) {
    case "application_path_choice":
      if (event.type === "APPLICATION_PATH") {
        // "have" reuses the existing app. Both "new" and "unknown" must FIRST verify the store has no app:
        // NAVER allows one app per store and offers no app-delete, so a store that already holds an app can
        // never issue a second — issuance is reachable only after an explicit app-absence check (§flow 6/7).
        if (event.choice === "have") return state("existing_credential_entry", m, null, "none", "existing");
        return state("application_status_unknown", m, null, "none", "unknown");
      }
      return prev;

    case "application_status_unknown":
      // The seller checked NAVER's application list themselves (§flow 7) and reports the result. An app
      // FOUND → forced reuse (never a second app); NONE found → the app-absence gate is cleared and only
      // then may issuance proceed.
      if (event.type === "APPLICATION_LIST_RESULT") {
        return event.found
          ? state("existing_credential_entry", m, null, "none", "existing")
          : state("account_store_choice_required", m, null, "none", "new");
      }
      return prev;

    case "account_store_choice_required":
      if (event.type === "ACCOUNT_STORE_RESOLVED") return state("application_issuance", m, null, "none", p);
      return prev;

    case "application_issuance":
      if (event.type === "ISSUANCE_COMPLETE") return state("credential_issued", m, null, "none", p);
      return prev;

    case "credential_issued":
      if (event.type === "BEGIN_CREDENTIAL_ENTRY") return state("sellerops_credential_entry", m, null, "none", p);
      return prev;

    case "sellerops_credential_entry":
      if (event.type === "SUBMIT_CREDENTIALS") return state("credential_registration", m, null, "none", p);
      return prev;

    case "existing_credential_entry":
      if (event.type === "SUBMIT_CREDENTIALS") return state("credential_registration", m, null, "none", p);
      // The seller has the app but cannot produce the Secret → recovery (never a forced new app, §flow 4).
      if (event.type === "SECRET_UNAVAILABLE") {
        return state("credential_recovery_required", m, "SECRET_UNRECOVERABLE", "none", p);
      }
      return prev;

    case "credential_recovery_required":
      // Recovery for a lost Secret is to obtain it again on the SAME existing app — re-view it, or reissue
      // it at NAVER (which rotates the store-wide Secret for every consumer). There is NO delete-then-recreate
      // path: NAVER provides no app-delete (live-confirmed 2026-07-29), and the store already holds its one app.
      if (event.type === "SECRET_RECHECKED") return state("existing_credential_entry", m, null, "none", p);
      return prev;

    case "credential_registration":
      if (event.type === "CREDENTIAL_REGISTERED") {
        return state("connection_testing", { ...m, registered: true }, null, "none", p);
      }
      if (event.type === "REGISTRATION_FAILED") {
        return state(entryPhaseFor(p), m, "INVALID_CREDENTIAL", "none", p);
      }
      return prev;

    case "first_order_sync":
      if (event.type === "SYNC_RESULT") {
        // 0-count SUCCESS is still success; only FAILED/RUNNING do not advance (§12).
        if (event.status === "SUCCESS" || event.status === "PARTIAL") {
          const milestones = { ...m, synced: true };
          return isComplete(milestones)
            ? state("completed", milestones, null, "none", p)
            : // Defensive: reaching sync without registered∧tested is structurally impossible,
              // but if it ever happened we fail closed rather than falsely claim completion.
              state("unsupported_state", milestones, "UNKNOWN_STATE", "none", p);
        }
        if (event.status === "FAILED") return state("first_order_sync", m, "SYNC_FAILED", "none", p);
      }
      return prev;

    case "completed":
      if (event.type === "CONTINUE_TO_REVIEW_EXPORT") return state("review_export_readiness", m, null, "none", p);
      return prev;

    default:
      return prev;
  }
}

/** True when all three completion milestones hold (§12). */
export function isComplete(milestones: GuidedMilestones): boolean {
  return milestones.registered && milestones.tested && milestones.synced;
}

/**
 * Resume to the safe phase implied by persisted milestones (§13): a refresh/reconnect restores
 * the furthest *safe* progress, never a claim beyond what was actually achieved. Readiness and the
 * saved-credential check must be re-established from scratch (agent/session/Vault are live), so
 * anything short of `registered` restarts at `check_saved_credential`.
 */
export function resumeFromMilestones(milestones: GuidedMilestones, path: GuidedPath = "unknown"): GuidedConnectionState {
  if (isComplete(milestones)) return state("completed", milestones, null, "none", path);
  if (milestones.registered && milestones.tested) return state("first_order_sync", milestones, null, "none", path);
  if (milestones.registered) return state("connection_testing", milestones, null, "none", path);
  return state("check_saved_credential", NO_MILESTONES);
}
