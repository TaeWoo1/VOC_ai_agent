/**
 * **Journey projection — real runtime signals → sanitized journey events. Pure.**
 *
 * The shadow graph runs on `JourneyEvent`s, never on runtime objects. This is the one-way map from the
 * sanitized signals the runtime already exposes (a view status, a pairing outcome, an account lookup, a
 * segment-entry decision) to those events. It is pure — no I/O, no logging, no browser — and it carries only
 * booleans and enums across: never an org, account, plan, segment, ref, date, URL, path, token, or page text.
 *
 * A signal that implies no journey transition (e.g. an intermediate RUNNING status) maps to `null`, which the
 * shadow drops. The map never invents a transition the runtime did not signal.
 */
import type { JourneyEvent, SegmentEntryEffect } from "../../../../contracts/review-import-journey/v1/index";
import type {
  ReadinessProbeReason,
  SessionReadinessState,
} from "../../../../contracts/session-readiness/v1/index";

/** The sanitized runtime signals the shadow observes. Each mirrors something the runtime already emits. */
export type JourneyObservation =
  | { readonly kind: "auth"; readonly orgExists: boolean }
  | { readonly kind: "account"; readonly connected: boolean; readonly channelMatches: boolean }
  | { readonly kind: "pairing_requested" }
  | { readonly kind: "pairing_resolved"; readonly approved: boolean }
  | { readonly kind: "carrier_attached"; readonly carrierMatches: boolean }
  | { readonly kind: "surface_opened" }
  | { readonly kind: "plan_range_opened" }
  | { readonly kind: "plan_created" }
  /** The segment-entry decision the host reached — only its EFFECT TYPE, never the ref/scope. */
  | { readonly kind: "segment_entry"; readonly effect: SegmentEntryEffect["type"] }
  /** A v2 run status the runtime published for the in-flight segment. */
  | { readonly kind: "run_status"; readonly status: string }
  | { readonly kind: "next_segment"; readonly hasRemaining: boolean }
  /**
   * A per-channel session-readiness reading. It is NOT a journey transition — the journey reducer does not
   * move on it — so it projects to `null` and the shadow drops it. It rides the same OBSERVE-ONLY projection
   * port purely so a readiness projector can be one more consumer of the same sanitized stream, with no FE.
   */
  | {
      readonly kind: "session_readiness";
      readonly channelCode: string;
      readonly state: SessionReadinessState;
      readonly reason: ReadinessProbeReason;
    }
  | { readonly kind: "abandoned" };

/**
 * The v2 RunStatus that means an IMPORT segment run ended in success — only `COMPLETED`. `OPERATOR_REPORTED`
 * is the honest terminal for a guided REPLY submission (no machine verifier), not a review import, so it is
 * deliberately not treated as an import completion here.
 */
const COMPLETED_STATUSES: ReadonlySet<string> = new Set(["COMPLETED"]);
/** v2 RunStatus values that mean the segment run has ended in failure. */
const FAILED_STATUSES: ReadonlySet<string> = new Set(["FAILED"]);

/**
 * Map one observation to a journey event, or `null` when it implies no transition.
 *
 * A `run_status` only produces an event at a TERMINAL status (completed/failed); intermediate statuses
 * (PREPARING, RUNNING, WAITING_FOR_HUMAN, PROCESSING, …) carry no journey transition — the launch already
 * moved the journey to SEGMENT_RUNNING — so they map to `null`. CANCELLED is left to the explicit abandon
 * signal rather than inferred here.
 */
export function projectJourneyEvent(obs: JourneyObservation): JourneyEvent | null {
  switch (obs.kind) {
    case "auth":
      return { type: "AUTH_PRESENTED", orgExists: obs.orgExists };
    case "account":
      return { type: "ACCOUNT_RESOLVED", connected: obs.connected, channelMatches: obs.channelMatches };
    case "pairing_requested":
      return { type: "AGENT_PAIRING_REQUESTED" };
    case "pairing_resolved":
      return { type: "AGENT_PAIRING_RESOLVED", approved: obs.approved };
    case "carrier_attached":
      return { type: "AGENT_CARRIER_ATTACHED", carrierMatches: obs.carrierMatches };
    case "surface_opened":
      return { type: "MARKETPLACE_SURFACE_OPENED" };
    case "plan_range_opened":
      return { type: "PLAN_RANGE_OPENED" };
    case "plan_created":
      return { type: "PLAN_CREATED" };
    case "segment_entry":
      // Only a decision to HOST begins a run; every refusal/ignore leaves the journey where it was.
      return { type: "SEGMENT_LAUNCH_DECIDED", hosted: obs.effect === "HOST_SEGMENT" };
    case "run_status": {
      if (COMPLETED_STATUSES.has(obs.status)) return { type: "SEGMENT_RUN_COMPLETED", covered: true };
      if (FAILED_STATUSES.has(obs.status)) return { type: "SEGMENT_RUN_FAILED" };
      return null;
    }
    case "next_segment":
      return { type: "NEXT_SEGMENT_AVAILABLE", hasRemaining: obs.hasRemaining };
    case "session_readiness":
      // Readiness is orthogonal to the journey phase — it never moves the reducer. A readiness projector
      // consumes it off the port directly; here it is a deliberate no-op so the shadow stays at divergence 0.
      return null;
    case "abandoned":
      return { type: "PLAN_ABANDONED" };
    default: {
      // Exhaustiveness: a missing kind is a compile error. An unknown observation (only reachable via an
      // `any`-typed caller) is DROPPED — never fabricated into an event that could move the shadow.
      const _exhaustive: never = obs;
      void _exhaustive;
      return null;
    }
  }
}
