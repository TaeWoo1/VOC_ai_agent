// NAVER Guided Connection (G3) — pure guided-journey state machine.
//
// A total, DOM-free reducer over sanitized `GuidedEvent`s. Design invariants, each pinned by a
// test in `state.test.ts` and traceable to `docs/slices/naver-guided-connection.md`:
//   • completed ⇐ registered ∧ tested ∧ synced ONLY (§12). The ONLY event that reaches `completed`
//     directly is `RESUME_FROM_CAPABILITY{completed:true}`, and only because a read-only backend snapshot
//     already proved a prior first sync succeeded — it re-runs nothing. No in-journey event skips ahead.
//   • the seller's decisions (path, account/store, issuance, consent) cannot be skipped (§17.2).
//   • unknown/low-confidence evidence fails closed to `unsupported_state`, never "proceed" (§17.3).
//   • milestones persist across regressions so resume restores safe progress (§13).
//   • it holds no secret, selector, url, or account id — only phase/actor/reason/milestone/path flags.
//
// **Local-Agent-free initial connection (product decision 2026-07-31).** There is NO readiness gate:
// the NAVER API *order* connection completes with no bridge/renderer/NAVER-login step. `check_saved_credential`
// hands straight to the three-path fork (`application_path_choice`) when there is no stored key, or reuses a
// stored key and goes to the connection test. The Local Agent is required only later for REVIEW_IMPORT setup,
// which lives on a separate track (the review-export page) — never here. An existing-app seller is NEVER
// auto-nudged into issuing a second app.
import type { ConnectionTestStatus } from "../types";
import type {
  GuidedActor,
  GuidedConnectionState,
  GuidedEvent,
  GuidedFailureReason,
  GuidedMilestones,
  GuidedPath,
  GuidedPhase,
} from "./types";

const NO_MILESTONES: GuidedMilestones = { registered: false, tested: false, synced: false };

/** The static actor for each phase (§6 actor boundary). */
const ACTOR_BY_PHASE: Record<GuidedPhase, GuidedActor> = {
  check_saved_credential: "SELLEROPS_AUTOMATED",
  application_path_choice: "USER_REQUIRED",
  application_status_unknown: "USER_REQUIRED",
  account_store_choice_required: "USER_REQUIRED",
  application_issuance: "USER_REQUIRED",
  // The Action Window: SellerOps highlights the control step-by-step, the seller performs every real click.
  application_issuance_guided: "SUPERVISED_ACTION",
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

/** The public actor for a phase — exported so the UI never re-derives it. */
export function actorFor(phase: GuidedPhase): GuidedActor {
  return ACTOR_BY_PHASE[phase];
}

function state(
  phase: GuidedPhase,
  milestones: GuidedMilestones,
  failureReason: GuidedFailureReason | null = null,
  path: GuidedPath = "unknown",
): GuidedConnectionState {
  return { phase, actor: ACTOR_BY_PHASE[phase], failureReason, milestones, path };
}

export const INITIAL_STATE: GuidedConnectionState = state("check_saved_credential", NO_MILESTONES);

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
  if (status === "NOT_CONFIGURED") return state(entry, cleared, "NOT_CONFIGURED", path);
  if (status === "UNSUPPORTED") return state("unsupported_state", cleared, "TEST_UNSUPPORTED", path);
  // status === "FAILED": branch on the safe reason code.
  if (reasonCode === "INVALID_CREDENTIAL") return state(entry, cleared, "INVALID_CREDENTIAL", path);
  // Distinct user states (§5). These reason codes are MODELED but not emitted by the current backend —
  // classifying insufficient-permission vs a call-environment/IP mismatch needs live NAVER recon (G3-C,
  // §4/§20-2). Fail-closed: only an explicit code routes here; an unclassified failure is a transient retry.
  if (reasonCode === "PERMISSION_INSUFFICIENT") {
    return state("permission_review_required", cleared, "PERMISSION_INSUFFICIENT", path);
  }
  if (reasonCode === "CALL_ENVIRONMENT_MISMATCH") {
    return state("call_environment_mismatch", cleared, "CALL_ENVIRONMENT_MISMATCH", path);
  }
  const reason: GuidedFailureReason =
    reasonCode === "PROVIDER_UNAVAILABLE" ? "PROVIDER_UNAVAILABLE" : "TEMPORARY_PROVIDER_ERROR";
  return state("connection_testing", cleared, reason, path);
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
    case "UI_DRIFT":
      return state("recoverable_ui_drift", m, "UI_DRIFT", p);
    case "UNKNOWN_STATE":
      return state("unsupported_state", m, "UNKNOWN_STATE", p);
    case "RESUME":
      // Recover from a fail-closed pause (drift/unsupported) to the furthest SAFE phase (§13).
      return resumeFromMilestones(m, p);
    default:
      break;
  }

  // Read-only resume from the backend capability snapshot (the journey entry). No external NAVER call, no
  // test, no sync happens here — the reducer only maps the persisted facts the page already read to a phase.
  if (prev.phase === "check_saved_credential") {
    if (event.type === "RESUME_FROM_CAPABILITY") {
      if (event.completed) {
        // A prior first ORDER_SUMMARY sync already succeeded (backend-verified) — restore the completed
        // screen directly. This is the sole sanctioned jump to `completed`; it re-runs nothing, and the
        // completed screen re-reads capability/health read-only. Never reached without the backend proof.
        return state("completed", { registered: true, tested: true, synced: true }, null, "saved");
      }
      if (event.credentialPresent) {
        // A stored key exists but the connection was never completed. Land on the connection test as a
        // USER-triggered step (registered milestone only) — the page does NOT auto-run it on load, so a
        // refresh never mints a token or a sync job; the seller presses the CTA to verify.
        return state("connection_testing", { ...m, registered: true }, null, "saved");
      }
      // No stored key → the three-path fork, no agent/login gate.
      return state("application_path_choice", m, null, "unknown");
    }
    return prev;
  }

  // The three-path fork and the test-retry phases handle TEST_RESULT uniformly.
  if (TEST_RESULT_PHASES.has(prev.phase) && event.type === "TEST_RESULT") {
    if (event.status === "SUCCESS") return state("first_order_sync", { ...m, tested: true }, null, p);
    return afterTestFailure(event.status, event.reasonCode, m, p);
  }

  switch (prev.phase) {
    case "application_path_choice":
      if (event.type === "APPLICATION_PATH") {
        // "have" reuses the existing app. Both "new" and "unknown" must FIRST verify the store has no app:
        // NAVER allows one app per store and offers no app-delete, so a store that already holds an app can
        // never issue a second — issuance is reachable only after an explicit app-absence check (§flow 6/7).
        if (event.choice === "have") return state("existing_credential_entry", m, null, "existing");
        return state("application_status_unknown", m, null, "unknown");
      }
      return prev;

    case "application_status_unknown":
      // The seller checked NAVER's application list themselves (§flow 7) and reports the result. An app
      // FOUND → forced reuse (never a second app); NONE found → the app-absence gate is cleared and only
      // then may issuance proceed.
      if (event.type === "APPLICATION_LIST_RESULT") {
        return event.found
          ? state("existing_credential_entry", m, null, "existing")
          : state("account_store_choice_required", m, null, "new");
      }
      return prev;

    case "account_store_choice_required":
      if (event.type === "ACCOUNT_STORE_RESOLVED") return state("application_issuance", m, null, p);
      return prev;

    case "application_issuance":
      // The seller may switch the issuance INTO the Action Window guided walkthrough. `mode:"text"` here is
      // a deliberate no-op — the static checklist already renders in place — so the only effect is entering
      // the guided phase. The completion event is identical on both paths (guidance finished → enter credential).
      if (event.type === "APPLICATION_ISSUANCE_MODE" && event.mode === "guided") {
        return state("application_issuance_guided", m, null, p);
      }
      if (event.type === "ISSUANCE_COMPLETE") return state("credential_issued", m, null, p);
      return prev;

    case "application_issuance_guided":
      // Guidance finished (COMPLETED) → the same credential-entry hand-off as the text path; the guided
      // walkthrough never reads or stores a credential itself. `mode:"text"` is the fallback back to the
      // static checklist (incl. when the Local Agent is unavailable). Anything else is a no-op.
      if (event.type === "ISSUANCE_COMPLETE") return state("credential_issued", m, null, p);
      if (event.type === "APPLICATION_ISSUANCE_MODE" && event.mode === "text") {
        return state("application_issuance", m, null, p);
      }
      return prev;

    case "credential_issued":
      if (event.type === "BEGIN_CREDENTIAL_ENTRY") return state("sellerops_credential_entry", m, null, p);
      return prev;

    case "sellerops_credential_entry":
      if (event.type === "SUBMIT_CREDENTIALS") return state("credential_registration", m, null, p);
      return prev;

    case "existing_credential_entry":
      if (event.type === "SUBMIT_CREDENTIALS") return state("credential_registration", m, null, p);
      // The seller has the app but cannot produce the Secret → recovery (never a forced new app, §flow 4).
      if (event.type === "SECRET_UNAVAILABLE") {
        return state("credential_recovery_required", m, "SECRET_UNRECOVERABLE", p);
      }
      return prev;

    case "credential_recovery_required":
      // Recovery for a lost Secret is to obtain it again on the SAME existing app — re-view it, or reissue
      // it at NAVER (which rotates the store-wide Secret for every consumer). There is NO delete-then-recreate
      // path: NAVER provides no app-delete (live-confirmed 2026-07-29), and the store already holds its one app.
      if (event.type === "SECRET_RECHECKED") return state("existing_credential_entry", m, null, p);
      return prev;

    case "credential_registration":
      if (event.type === "CREDENTIAL_REGISTERED") {
        return state("connection_testing", { ...m, registered: true }, null, p);
      }
      if (event.type === "REGISTRATION_FAILED") {
        return state(entryPhaseFor(p), m, "INVALID_CREDENTIAL", p);
      }
      return prev;

    case "first_order_sync":
      if (event.type === "SYNC_RESULT") {
        // 0-count SUCCESS is still success; only FAILED/RUNNING do not advance (§12).
        if (event.status === "SUCCESS" || event.status === "PARTIAL") {
          const milestones = { ...m, synced: true };
          return isComplete(milestones)
            ? state("completed", milestones, null, p)
            : // Defensive: reaching sync without registered∧tested is structurally impossible,
              // but if it ever happened we fail closed rather than falsely claim completion.
              state("unsupported_state", milestones, "UNKNOWN_STATE", p);
        }
        if (event.status === "FAILED") return state("first_order_sync", m, "SYNC_FAILED", p);
      }
      return prev;

    case "completed":
      if (event.type === "CONTINUE_TO_REVIEW_EXPORT") return state("review_export_readiness", m, null, p);
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
 * the furthest *safe* progress, never a claim beyond what was actually achieved. The saved-credential
 * check must be re-established from scratch (the Vault is live), so anything short of `registered`
 * restarts at `check_saved_credential`.
 */
export function resumeFromMilestones(milestones: GuidedMilestones, path: GuidedPath = "unknown"): GuidedConnectionState {
  if (isComplete(milestones)) return state("completed", milestones, null, path);
  if (milestones.registered && milestones.tested) return state("first_order_sync", milestones, null, path);
  if (milestones.registered) return state("connection_testing", milestones, null, path);
  return state("check_saved_credential", NO_MILESTONES);
}
