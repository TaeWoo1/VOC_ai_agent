/**
 * **Review-import journey — internal state contract (v1).**
 *
 * This is NOT an Action Window wire contract. Nothing here crosses the FE ↔ Runtime socket, and this module
 * is versioned SEPARATELY from `ACTION_WINDOW_TRANSPORT_VERSION` on purpose: it is the pure state/event/effect
 * kernel of the historical-review-import journey, extracted so the decision of "may this launch host a
 * segment run?" lives in one testable place instead of being tangled into the host's I/O and logging.
 *
 * ## Purity contract
 *
 * Everything in this module is a pure function of its inputs. No I/O, no logging, no network, no browser, no
 * clock. It is type-checked under `contracts/tsconfig.json`, which has neither DOM nor Node types, so anything
 * reachable from only one runtime is a portability bug this project catches. The caller (the collector's
 * `ImportSegmentHost`) owns the side effects — resolving scope over HTTP, the `building` concurrency flag,
 * minting/arming/assembling the run, and EVERY log line. This kernel only decides; the host acts and records.
 *
 * ## Scope of v1 — the segment-entry decision only
 *
 * The first extraction covers exactly the host's segment-entry judgment, in two phases around the one
 * unavoidable I/O (asking the server what a launch ref authorizes):
 *
 *  - Phase 1 (`START_RUN_RECEIVED`, pre-resolve): idempotent same-ref re-send, and the concurrent-start race.
 *  - Phase 2 (`SCOPE_RESOLVED`, post-resolve): scope kind, declared-vs-server kind agreement, required range,
 *    and channel match.
 *
 * The upstream frame parse (`importRefFromStartRun`) and the run assembly stay in the host. The wider journey
 * (auth, connect, plan, next-segment, completion) is deliberately out of v1 scope — see the migration plan
 * `docs/action-window-runtime/review-import-journey-langgraph-migration-plan.md`.
 */

// The full upper-journey reducer (auth → account → pairing → session → plan → segment loop → complete/abandon).
// Kept in its own module; the segment-entry decision below is one step within it.
export * from "./journey";

/** A marketplace channel code, e.g. the host's own driver channel or a ticket's authorized channel. */
export type ImportChannelCode = string;

/**
 * What the server says a launch ref authorizes. Identity-free by design — no plan or segment id.
 *
 * Structurally identical to the collector's `ResolvedLaunchScope`, so the host passes its resolved value
 * straight in without a mapping step, while this contract stays free of any collector import.
 */
export interface SegmentLaunchScope {
  /** What the ticket authorizes, as the SERVER reports it. Only `SEGMENT` is hostable. */
  readonly kind: string;
  readonly channelCode: ImportChannelCode;
  /** The window to guide, for a SEGMENT run. Empty on a DISCOVERY run, which has no window yet. */
  readonly requiredStart: string;
  readonly requiredEnd: string;
}

/** Which run kind the client SAYS it is starting, or null when it declared no intent (v1-compatible). */
export type DeclaredSegmentKind = "SEGMENT" | "DISCOVERY" | null;

/** The window a hosted segment run must guide and match. */
export interface SegmentRequiredRange {
  readonly start: string;
  readonly end: string;
}

/**
 * The host state the pre-resolve decision reads. No identity beyond the currently hosted ref, no I/O handles.
 */
export interface SegmentEntryState {
  /** The launch ref of the run currently hosted, or null when none is hosted yet. */
  readonly hostedRef: string | null;
  /** True while a start is mid-flight (resolve → assemble), so a racing start is deferred rather than doubled. */
  readonly building: boolean;
}

/** The two events the segment-entry decision responds to, one on each side of the scope resolve. */
export type SegmentEntryEvent =
  | {
      readonly type: "START_RUN_RECEIVED";
      /** The launch ref already parsed out of the START_RUN frame by the host (non-null). */
      readonly ref: string;
      readonly declaredKind: DeclaredSegmentKind;
    }
  | {
      readonly type: "SCOPE_RESOLVED";
      readonly ref: string;
      readonly declaredKind: DeclaredSegmentKind;
      /** What the server returned for `ref`. `null` means refused: spent, expired, wrong org, or never existed. */
      readonly scope: SegmentLaunchScope | null;
      /** The channel this agent's driver actually guides. */
      readonly hostChannelCode: ImportChannelCode;
    };

/** Why a segment entry was refused. Each maps to the host's existing, unchanged log key. */
export type SegmentEntryRefusal =
  | "scope_refused"
  | "wrong_kind"
  | "kind_mismatch"
  | "scope_incomplete"
  | "channel_mismatch";

/**
 * The decision the host must carry out. The host maps `REFUSE` to its existing log line and returns, and
 * `HOST_SEGMENT` to minting/arming/assembling the run — behaviour and log semantics are unchanged from the
 * pre-extraction host.
 */
export type SegmentEntryEffect =
  | { readonly type: "IGNORE_ALREADY_HOSTED" }
  | { readonly type: "IGNORE_BUSY" }
  | { readonly type: "RESOLVE_SCOPE"; readonly ref: string }
  | { readonly type: "REFUSE"; readonly reason: SegmentEntryRefusal }
  | {
      readonly type: "HOST_SEGMENT";
      readonly channelCode: ImportChannelCode;
      readonly required: SegmentRequiredRange;
    };

/**
 * Decide what to do with a segment-entry event. Pure, total, and fail-closed: any input that is not an
 * unambiguously hostable SEGMENT resolves to an ignore or a refusal, never to hosting.
 *
 * The guard order is preserved exactly from the host it was extracted from, because the FIRST failing check is
 * the one whose log line the host emits:
 *
 *  1. no scope        → the server refused the ref (all refusal causes answered identically on purpose);
 *  2. not a SEGMENT   → a DISCOVERY ticket (no discovery run exists as of 2026-07-26) or an unknown kind from
 *                       a newer server; both fail closed rather than guess at a choreography;
 *  3. kind disagree   → the client declared one kind while holding the other's ticket; running either side
 *                       would guide a run the frontend is not rendering or spend a ticket on unauthorized work;
 *  4. no window        → a segment run with no range has no gate to pass, which is what stops a file covering an
 *                       unknown period from being ingested as though it covered a planned one;
 *  5. channel disagree → the ticket authorizes a DIFFERENT marketplace from the one this agent drives (found on
 *                        2026-07-26, before it could happen: a plan/ticket for a non-NAVER account while only a
 *                        NAVER driver is present would have walked the seller through NAVER's export and ingested
 *                        it into the other channel's segment). The channel is a platform target, so an
 *                        unexpected one fails closed rather than being coerced to the one we happen to host.
 */
export function decideSegmentEntry(state: SegmentEntryState, event: SegmentEntryEvent): SegmentEntryEffect {
  switch (event.type) {
    case "START_RUN_RECEIVED": {
      // A replayed START_RUN for the run we are already hosting is idempotent — the session's own engine
      // answers it. Rebuilding would mint a second runId for one authorization.
      if (event.ref === state.hostedRef) return { type: "IGNORE_ALREADY_HOSTED" };
      // Two clients racing a start would otherwise build two sessions for one ticket.
      if (state.building) return { type: "IGNORE_BUSY" };
      return { type: "RESOLVE_SCOPE", ref: event.ref };
    }
    case "SCOPE_RESOLVED": {
      const { scope, declaredKind, hostChannelCode } = event;
      if (!scope) return { type: "REFUSE", reason: "scope_refused" };
      if (scope.kind !== "SEGMENT") return { type: "REFUSE", reason: "wrong_kind" };
      if (declaredKind !== null && declaredKind !== scope.kind) return { type: "REFUSE", reason: "kind_mismatch" };
      if (!scope.requiredStart || !scope.requiredEnd) return { type: "REFUSE", reason: "scope_incomplete" };
      if (scope.channelCode && scope.channelCode !== hostChannelCode) {
        return { type: "REFUSE", reason: "channel_mismatch" };
      }
      return {
        type: "HOST_SEGMENT",
        // The server's channel wins when present; the host's own channel is only the fallback for a scope that
        // named none (and which already passed the mismatch check above).
        channelCode: scope.channelCode || hostChannelCode,
        required: { start: scope.requiredStart, end: scope.requiredEnd },
      };
    }
    default: {
      // Exhaustiveness: a new event variant is a compile error here, not a silent fall-through.
      const unreachable: never = event;
      return unreachable;
    }
  }
}
