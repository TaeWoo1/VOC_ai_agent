/**
 * **Review-import journey — the full upper-journey reducer (v1).**
 *
 * This extends the segment-entry decision (`./index`) to the WHOLE onboarding journey: auth, account/channel,
 * agent pairing, the marketplace session, plan creation, and the per-segment launch/run/complete loop through
 * to plan completion or abandonment. Like the segment-entry kernel it is PURE — no I/O, no logging, no network,
 * no browser, no clock — and is type-checked under `contracts/tsconfig.json` (no DOM, no Node).
 *
 * ## What it is for
 *
 * It is the phase authority the LangGraph shadow graph runs on: fed the journey events a run actually produces,
 * it computes the expected `JourneyPhase`. It decides nothing the runtime obeys and it holds no identity — the
 * events carry only booleans and enums, never an org, account, plan, segment, ref, date, URL, or path. The
 * existing `ImportSegmentEngine` is unchanged and owns the WITHIN-segment stages; this reducer treats one
 * segment run as a single opaque phase (`SEGMENT_RUNNING`).
 *
 * ## Determinism under a messy event stream
 *
 * Real events arrive duplicated, late, and out of order. Every transition is GUARDED on the current phase: an
 * event that does not apply to where the journey is resolves to `NONE` and leaves the phase untouched. So a
 * duplicated completion, a stale launch, or a reordered pairing cannot move the phase twice or backwards — the
 * reducer is a deterministic, idempotent-per-phase function of (state, event). The guards are deliberately
 * CAUSAL, not confluent: an event whose precondition has not been reached yet is dropped rather than buffered,
 * so a genuinely out-of-causal-order stream (an account resolve before its auth) settles differently — which is
 * correct, because in reality those events are causally ordered. Determinism is per step; ordering that matters
 * is the ordering reality already imposes.
 */

/** The milestones of the whole journey. One segment RUN is a single phase; its internal stages stay in the engine. */
export type JourneyPhase =
  | "START"
  | "AUTH_VERIFYING"
  | "AUTH_FAILED"
  | "ACCOUNT_READY"
  | "ACCOUNT_BLOCKED"
  | "AGENT_CONNECTING"
  | "AGENT_CONNECTED"
  | "AGENT_REFUSED"
  | "MARKETPLACE_SESSION"
  | "PLAN_RANGE"
  | "PLAN_READY"
  | "SEGMENT_RUNNING"
  | "SEGMENT_DONE"
  | "SEGMENT_FAILED"
  | "PLAN_COMPLETE"
  | "ABANDONED";

/**
 * The observable journey events, each carrying only sanitized primitives. A projector in the runtime maps real
 * signals (a view status, a bridge pairing result, an account lookup) to these — never the other way round.
 */
export type JourneyEvent =
  | { readonly type: "AUTH_PRESENTED"; readonly orgExists: boolean }
  | { readonly type: "ACCOUNT_RESOLVED"; readonly connected: boolean; readonly channelMatches: boolean }
  | { readonly type: "AGENT_PAIRING_REQUESTED" }
  | { readonly type: "AGENT_PAIRING_RESOLVED"; readonly approved: boolean }
  | { readonly type: "AGENT_CARRIER_ATTACHED"; readonly carrierMatches: boolean }
  | { readonly type: "MARKETPLACE_SURFACE_OPENED" }
  | { readonly type: "PLAN_RANGE_OPENED" }
  | { readonly type: "PLAN_CREATED" }
  | { readonly type: "SEGMENT_LAUNCH_DECIDED"; readonly hosted: boolean }
  | { readonly type: "SEGMENT_RUN_COMPLETED"; readonly covered: boolean }
  | { readonly type: "SEGMENT_RUN_FAILED" }
  | { readonly type: "NEXT_SEGMENT_AVAILABLE"; readonly hasRemaining: boolean }
  | { readonly type: "PLAN_ABANDONED" };

/** What the runtime is expected to be awaiting next — advisory only; the shadow observes, it never drives. */
export type JourneyEffect =
  | "NONE"
  | "AWAIT_ACCOUNT"
  | "AWAIT_PAIRING"
  | "AWAIT_LOGIN"
  | "AWAIT_PLAN"
  | "AWAIT_LAUNCH"
  | "AWAIT_SEGMENT_RESULT"
  | "OFFER_NEXT_SEGMENT"
  | "JOURNEY_COMPLETE"
  | "HALTED";

/** The reducer's whole state: just the phase. No identity, no counters that could leak a plan's shape. */
export interface JourneyState {
  readonly phase: JourneyPhase;
}

/** A phase plus what the runtime is expected to await there. */
export interface JourneyTransition {
  readonly phase: JourneyPhase;
  readonly effect: JourneyEffect;
}

export const INITIAL_JOURNEY_STATE: JourneyState = { phase: "START" };

/** The fail-closed / terminal-conclusion phases from which ordinary progress events are ignored. */
const HALTED_PHASES: ReadonlySet<JourneyPhase> = new Set<JourneyPhase>([
  "AUTH_FAILED",
  "ACCOUNT_BLOCKED",
  "AGENT_REFUSED",
  "PLAN_COMPLETE",
  "ABANDONED",
]);

/** A phase from which a fresh segment can be launched (the first one, a retry, or the next in the sequence). */
const LAUNCHABLE_PHASES: ReadonlySet<JourneyPhase> = new Set<JourneyPhase>([
  "PLAN_READY",
  "SEGMENT_DONE",
  "SEGMENT_FAILED",
]);

const STAY: (phase: JourneyPhase) => JourneyTransition = (phase) => ({ phase, effect: "NONE" });

/**
 * Compute the next phase and expected effect from the current phase and one event. Pure, total, and guarded:
 * an event that does not apply to the current phase returns `{ phase (unchanged), NONE }`.
 *
 * Fail-closed signals (a vanished org, an unconnected/channel-mismatched account, a refused pairing or carrier,
 * an abandon) always halt, and from a halted phase only the matching RETRY re-enters — everything else is a
 * no-op, so a late success frame can never resurrect a journey the operator already left.
 */
export function reduceJourney(state: JourneyState, event: JourneyEvent): JourneyTransition {
  const phase = state.phase;

  // Abandon wins from anywhere that is still live.
  if (event.type === "PLAN_ABANDONED") {
    return HALTED_PHASES.has(phase) ? STAY(phase) : { phase: "ABANDONED", effect: "HALTED" };
  }

  switch (event.type) {
    case "AUTH_PRESENTED": {
      // Only meaningful before an account is established, and as the retry out of AUTH_FAILED.
      if (phase === "START" || phase === "AUTH_VERIFYING" || phase === "AUTH_FAILED") {
        return event.orgExists
          ? { phase: "AUTH_VERIFYING", effect: "AWAIT_ACCOUNT" }
          : { phase: "AUTH_FAILED", effect: "HALTED" };
      }
      return STAY(phase);
    }
    case "ACCOUNT_RESOLVED": {
      if (phase === "AUTH_VERIFYING" || phase === "ACCOUNT_BLOCKED") {
        return event.connected && event.channelMatches
          ? { phase: "ACCOUNT_READY", effect: "AWAIT_PAIRING" }
          : { phase: "ACCOUNT_BLOCKED", effect: "HALTED" };
      }
      return STAY(phase);
    }
    case "AGENT_PAIRING_REQUESTED": {
      if (phase === "ACCOUNT_READY" || phase === "AGENT_REFUSED") {
        return { phase: "AGENT_CONNECTING", effect: "AWAIT_PAIRING" };
      }
      return STAY(phase);
    }
    case "AGENT_PAIRING_RESOLVED": {
      if (phase === "AGENT_CONNECTING") {
        return event.approved
          ? { phase: "AGENT_CONNECTING", effect: "AWAIT_PAIRING" } // approved; still awaiting the carrier attach
          : { phase: "AGENT_REFUSED", effect: "HALTED" };
      }
      return STAY(phase);
    }
    case "AGENT_CARRIER_ATTACHED": {
      if (phase === "AGENT_CONNECTING") {
        return event.carrierMatches
          ? { phase: "AGENT_CONNECTED", effect: "AWAIT_LOGIN" }
          : { phase: "AGENT_REFUSED", effect: "HALTED" };
      }
      return STAY(phase);
    }
    case "MARKETPLACE_SURFACE_OPENED": {
      if (phase === "AGENT_CONNECTED") return { phase: "MARKETPLACE_SESSION", effect: "AWAIT_PLAN" };
      return STAY(phase);
    }
    case "PLAN_RANGE_OPENED": {
      if (phase === "AGENT_CONNECTED" || phase === "MARKETPLACE_SESSION") {
        return { phase: "PLAN_RANGE", effect: "AWAIT_PLAN" };
      }
      return STAY(phase);
    }
    case "PLAN_CREATED": {
      if (phase === "PLAN_RANGE" || phase === "MARKETPLACE_SESSION") {
        return { phase: "PLAN_READY", effect: "AWAIT_LAUNCH" };
      }
      return STAY(phase);
    }
    case "SEGMENT_LAUNCH_DECIDED": {
      // A hosted launch begins a run; a refused/ignored launch (decideSegmentEntry said no) changes nothing.
      if (event.hosted && LAUNCHABLE_PHASES.has(phase)) {
        return { phase: "SEGMENT_RUNNING", effect: "AWAIT_SEGMENT_RESULT" };
      }
      return STAY(phase);
    }
    case "SEGMENT_RUN_COMPLETED": {
      if (phase === "SEGMENT_RUNNING") {
        // `covered` distinguishes a real completion from a completion-without-coverage; both leave the run and
        // offer the next segment (coverage is the backend's conclusion, not a journey branch here).
        return { phase: "SEGMENT_DONE", effect: "OFFER_NEXT_SEGMENT" };
      }
      return STAY(phase);
    }
    case "SEGMENT_RUN_FAILED": {
      if (phase === "SEGMENT_RUNNING") return { phase: "SEGMENT_FAILED", effect: "AWAIT_LAUNCH" };
      return STAY(phase);
    }
    case "NEXT_SEGMENT_AVAILABLE": {
      if (phase === "SEGMENT_DONE" || phase === "SEGMENT_FAILED") {
        return event.hasRemaining
          ? { phase: "PLAN_READY", effect: "AWAIT_LAUNCH" }
          : { phase: "PLAN_COMPLETE", effect: "JOURNEY_COMPLETE" };
      }
      return STAY(phase);
    }
    default: {
      // Exhaustiveness: a missing event variant is a compile error here. At runtime an unknown (only reachable
      // via an `any`-typed caller) is a FAIL-SAFE no-op — keep the current phase rather than corrupt it.
      const _exhaustive: never = event;
      void _exhaustive;
      return STAY(phase);
    }
  }
}

/** Apply one event and return only the next state (drops the advisory effect). */
export function applyJourney(state: JourneyState, event: JourneyEvent): JourneyState {
  return { phase: reduceJourney(state, event).phase };
}

/** Fold a whole event sequence from the initial state — the shadow graph's replay in one pure call. */
export function reduceJourneySequence(
  events: readonly JourneyEvent[],
  from: JourneyState = INITIAL_JOURNEY_STATE,
): JourneyState {
  return events.reduce(applyJourney, from);
}

/** Whether a phase is a fail-closed halt or a terminal conclusion (no ordinary progress leaves it). */
export function isHaltedPhase(phase: JourneyPhase): boolean {
  return HALTED_PHASES.has(phase);
}
