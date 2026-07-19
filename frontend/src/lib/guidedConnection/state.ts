// NAVER Guided Connection (G3) — pure guided-journey state machine.
//
// A total, DOM-free reducer over sanitized `GuidedEvent`s. Design invariants, each pinned by a
// test in `state.test.ts` and traceable to `docs/slices/naver-guided-connection.md`:
//   • completed ⇐ registered ∧ tested ∧ synced ONLY (§12). No event jumps to completed.
//   • the seller's decisions (login, account/store, issuance, consent) cannot be skipped (§17.2).
//   • unknown/low-confidence evidence fails closed to `unsupported_state`, never "proceed" (§17.3).
//   • milestones persist across regressions so resume restores safe progress (§13).
//   • it holds no secret, selector, url, or account id — only phase/actor/reason/milestone flags.
import type { ConnectionTestStatus } from "../types";
import type {
  GuidedActor,
  GuidedConnectionState,
  GuidedEvent,
  GuidedFailureReason,
  GuidedMilestones,
  GuidedPhase,
  NaverSessionSignal,
  NaverSessionSource,
} from "./types";

const NO_MILESTONES: GuidedMilestones = { registered: false, tested: false, synced: false };

/** The static actor for each phase (§6 actor boundary). */
const ACTOR_BY_PHASE: Record<GuidedPhase, GuidedActor> = {
  readiness_checking: "SELLEROPS_AUTOMATED",
  agent_unavailable: "USER_REQUIRED",
  renderer_unavailable: "USER_REQUIRED",
  naver_login_required: "USER_REQUIRED",
  naver_reconnect_required: "USER_REQUIRED",
  account_store_choice_required: "USER_REQUIRED",
  application_issuance: "USER_REQUIRED",
  credential_issued: "SELLEROPS_GUIDED",
  sellerops_credential_entry: "USER_REQUIRED",
  credential_registration: "SELLEROPS_AUTOMATED",
  connection_testing: "SELLEROPS_AUTOMATED",
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
 * issuance walk (B4). A NAVER session drop (logged-out / reconnect-required) regresses ONLY from here;
 * once the seller has moved on to typing credentials, the remaining steps are backend calls and
 * `completed` is durable, so a browser-session change there is a no-op (login is never assumed permanent).
 */
const SESSION_SENSITIVE_PHASES: ReadonlySet<GuidedPhase> = new Set<GuidedPhase>([
  "readiness_checking",
  "agent_unavailable",
  "renderer_unavailable",
  "naver_login_required",
  "naver_reconnect_required",
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
): GuidedConnectionState {
  return { phase, actor: ACTOR_BY_PHASE[phase], failureReason, milestones, sessionSource };
}

export const INITIAL_STATE: GuidedConnectionState = state("readiness_checking", NO_MILESTONES);

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

/** Derive the readiness-gate phase from a sanitized readiness signal, fail-closed. */
function deriveReadiness(
  ev: Extract<GuidedEvent, { type: "READINESS" }>,
  prevPhase: GuidedPhase,
  milestones: GuidedMilestones,
): GuidedConnectionState {
  if (!ev.agentPaired) return state("agent_unavailable", milestones, "AGENT_UNAVAILABLE");
  if (!ev.rendererAvailable) return state("renderer_unavailable", milestones, "RENDERER_UNAVAILABLE");
  // reconnect_required is first-class (B4) — the dedicated-profile session expired / a cold launch did not
  // inherit it. Recoverable, distinct from never-logged-in.
  if (ev.naverSession === "reconnect_required") {
    return state("naver_reconnect_required", milestones, "RECONNECT_REQUIRED", ev.sessionSource);
  }
  // logged_out AND unknown both fail closed to "log in first" — we never assume a live session.
  if (ev.naverSession === "logged_out" || ev.naverSession === "unknown") {
    return state("naver_login_required", milestones, "NAVER_LOGIN_REQUIRED", ev.sessionSource);
  }
  // logged_in: a DETECTED reconnect can only be cleared by DETECTION — a bare attestation cannot bypass a
  // live-observed reconnect (B4 non-conflict). So hold reconnect until a detected logged_in arrives.
  if (prevPhase === "naver_reconnect_required" && ev.sessionSource !== "detected") {
    return state("naver_reconnect_required", milestones, "RECONNECT_REQUIRED", "detected");
  }
  return state("account_store_choice_required", milestones, null, ev.sessionSource);
}

/** Map a non-SUCCESS `test-connection` result to the next safe phase (§12). */
function afterTestFailure(
  status: Exclude<ConnectionTestStatus, "SUCCESS">,
  reasonCode: string | null,
  milestones: GuidedMilestones,
): GuidedConnectionState {
  if (status === "NOT_CONFIGURED") {
    // No credential on file — the seller must (re-)enter it.
    return state("sellerops_credential_entry", { ...milestones, tested: false }, "NOT_CONFIGURED");
  }
  if (status === "UNSUPPORTED") {
    return state("unsupported_state", { ...milestones, tested: false }, "TEST_UNSUPPORTED");
  }
  // status === "FAILED": branch on the safe reason code.
  if (reasonCode === "INVALID_CREDENTIAL") {
    return state("sellerops_credential_entry", { ...milestones, tested: false }, "INVALID_CREDENTIAL");
  }
  const reason: GuidedFailureReason =
    reasonCode === "PROVIDER_UNAVAILABLE" ? "PROVIDER_UNAVAILABLE" : "TEMPORARY_PROVIDER_ERROR";
  // Transient — stay on the test step so the seller can retry.
  return state("connection_testing", { ...milestones, tested: false }, reason);
}

/**
 * The reducer. Unmodeled (phase, event) pairs are a deliberate no-op — this is what prevents
 * skipping a step: e.g. a `SYNC_RESULT` while still in `readiness_checking` changes nothing, so
 * `completed` can only be reached by walking the whole journey.
 */
export function guidedConnectionReducer(
  prev: GuidedConnectionState,
  event: GuidedEvent,
): GuidedConnectionState {
  const m = prev.milestones;

  // Global transitions valid from any phase.
  switch (event.type) {
    case "RESET":
      return INITIAL_STATE;
    case "AGENT_LOST":
      // Agent loss is runtime-liveness (the local agent process is gone), so it surfaces from anywhere.
      return state("agent_unavailable", m, "AGENT_UNAVAILABLE");
    case "NAVER_LOGGED_OUT":
      // A NAVER browser-session drop matters only while a browser session is in use (B4). Past that
      // (credential entry onward, completed) it is a no-op — login is never assumed permanent.
      return SESSION_SENSITIVE_PHASES.has(prev.phase)
        ? state("naver_login_required", m, "NAVER_LOGIN_REQUIRED", "detected")
        : prev;
    case "NAVER_RECONNECT_REQUIRED":
      // Dedicated-profile session expired / not inherited — first-class + recoverable, session-scoped.
      return SESSION_SENSITIVE_PHASES.has(prev.phase)
        ? state("naver_reconnect_required", m, "RECONNECT_REQUIRED", "detected")
        : prev;
    case "UI_DRIFT":
      return state("recoverable_ui_drift", m, "UI_DRIFT");
    case "UNKNOWN_STATE":
      return state("unsupported_state", m, "UNKNOWN_STATE");
    case "RESUME":
      // Recover from a fail-closed pause (drift/unsupported) to the furthest SAFE phase (§13).
      return resumeFromMilestones(m);
    default:
      break;
  }

  if (event.type === "READINESS") {
    // Only advance/regress the gate while inside it; never clobber later journey progress.
    if (!GATE_PHASES.has(prev.phase)) return prev;
    const next = deriveReadiness(event, prev.phase, m);
    // Idempotent: an unchanged gate result returns the SAME reference, so a reactive effect can
    // re-dispatch READINESS on every bridge tick without looping (useReducer bails on identity).
    return next.phase === prev.phase &&
      next.failureReason === prev.failureReason &&
      next.sessionSource === prev.sessionSource
      ? prev
      : next;
  }

  switch (prev.phase) {
    case "account_store_choice_required":
      if (event.type === "ACCOUNT_STORE_RESOLVED") return state("application_issuance", m);
      return prev;

    case "application_issuance":
      if (event.type === "ISSUANCE_COMPLETE") return state("credential_issued", m);
      return prev;

    case "credential_issued":
      if (event.type === "BEGIN_CREDENTIAL_ENTRY") return state("sellerops_credential_entry", m);
      return prev;

    case "sellerops_credential_entry":
      if (event.type === "SUBMIT_CREDENTIALS") return state("credential_registration", m);
      return prev;

    case "credential_registration":
      if (event.type === "CREDENTIAL_REGISTERED") {
        return state("connection_testing", { ...m, registered: true });
      }
      if (event.type === "REGISTRATION_FAILED") {
        return state("sellerops_credential_entry", m, "INVALID_CREDENTIAL");
      }
      return prev;

    case "connection_testing":
      if (event.type === "TEST_RESULT") {
        if (event.status === "SUCCESS") return state("first_order_sync", { ...m, tested: true });
        return afterTestFailure(event.status, event.reasonCode, m);
      }
      return prev;

    case "first_order_sync":
      if (event.type === "SYNC_RESULT") {
        // 0-count SUCCESS is still success; only FAILED/RUNNING do not advance (§12).
        if (event.status === "SUCCESS" || event.status === "PARTIAL") {
          const milestones = { ...m, synced: true };
          return isComplete(milestones)
            ? state("completed", milestones)
            : // Defensive: reaching sync without registered∧tested is structurally impossible,
              // but if it ever happened we fail closed rather than falsely claim completion.
              state("unsupported_state", milestones, "UNKNOWN_STATE");
        }
        if (event.status === "FAILED") return state("first_order_sync", m, "SYNC_FAILED");
      }
      return prev;

    case "completed":
      if (event.type === "CONTINUE_TO_REVIEW_EXPORT") return state("review_export_readiness", m);
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
 * the furthest *safe* progress, never a claim beyond what was actually achieved. Readiness must
 * be re-established from scratch (agent/session are live), so anything short of `registered`
 * restarts at the gate.
 */
export function resumeFromMilestones(milestones: GuidedMilestones): GuidedConnectionState {
  if (isComplete(milestones)) return state("completed", milestones);
  if (milestones.registered && milestones.tested) return state("first_order_sync", milestones);
  if (milestones.registered) return state("connection_testing", milestones);
  return state("readiness_checking", NO_MILESTONES);
}
