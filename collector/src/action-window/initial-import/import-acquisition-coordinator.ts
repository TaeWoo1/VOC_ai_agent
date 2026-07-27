/**
 * **Import acquisition coordinator — the live-boot seam that puts the Acquisition Supervisor in front of the
 * initial-review-import runtime. OBSERVE-ONLY, FE-free, owns no durable or pure state.**
 *
 * The pure `contracts/acquisition/v1` seam and the `AcquisitionSupervisor` coordinator answer two questions —
 * "how is `(channel × REVIEW)` acquired?" and "may the Agent start, or ask the seller for one thing?" — but
 * until now nothing in the live import boot called them. This module is that wiring. It sits between the boot
 * (`cli/local-agent.ts`) and the `ImportSegmentHost`, and it connects the four session-readiness probe moments
 * to the one runtime that actually drives a marketplace session:
 *
 *  - **AGENT_START** — {@link onAgentStart}, at boot. The seller center tab does not exist yet (it opens when
 *    the seller asks to be connected), so the channel is honestly `UNOBSERVED_EXTERNAL`, never a guessed READY.
 *  - **BEFORE_WORK** — {@link admitSegment}, immediately before a run is assembled. It resolves the plan,
 *    selects the bound adapter, and records the supervisor's decision. Admission is gated ONLY on adapter
 *    availability (see below), and a usable pre-work reading later lands here as `BEFORE_WORK`.
 *  - **SESSION_FAILURE** — {@link observeSurfaceReading}, when a run's `prepareSurface` reports a session that
 *    cannot carry work (login/expired). That is literally "a unit of work failed in a way that implicates the
 *    session", which is what the reason means.
 *  - **MANUAL_RECHECK** — {@link observeSurfaceReading} again, when a later run's reading comes back usable
 *    AFTER a prior not-ready one: the seller said they fixed it and retried.
 *
 * ## Admission is probe-permissive on purpose
 *
 * {@link admitSegment} refuses a run for exactly one reason: there is no bound adapter for `(channel × REVIEW)`
 * (`adapterId === "NONE"` / not integrated → the supervisor's `HOLD_UNSUPPORTED`). It does NOT refuse on a
 * stale not-ready readiness, and it must not: the ONLY thing that refreshes a channel's readiness is a run's
 * own `prepareSurface`, so refusing a run because the last reading was `LOGIN_REQUIRED` would make the session
 * un-recoverable — the seller could log in and never get a run that re-checks. The run's own PREPARE is the
 * fresh session gate and it fails closed (`import-engine.block` → recoverable FAILED) when the session is not
 * usable, surfacing the readiness contract's exactly-one action as the single human checkpoint. The supervisor
 * decision is recorded here for observability; the engine enforces the session hold.
 *
 * ## What it does not own
 *
 * No durable truth (the backend owns plan/segment/coverage and channel-connection health), no pure phase or
 * readiness state (the kernel and the `SessionReadinessProjector` own those). It is a thin Adapter-layer
 * coordinator, which is why the whole thing is offline-testable with no browser and no network. A source guard
 * pins that it imports no FE.
 */
import { log } from "../../log";
import type { SurfaceProbeResult } from "../engine";
import { AcquisitionSupervisor, type AcquisitionAdapterId } from "../acquisition-supervisor";
import { NAVER_CHANNEL_CODE, SessionReadinessProbe, SessionReadinessProjector } from "./session-readiness";
import type { AcquisitionCapability, SupervisorDecision } from "../../../../contracts/acquisition/v1/index";
import type {
  ReadinessAction,
  ReadinessProbeReason,
  SessionReadinessState,
} from "../../../../contracts/session-readiness/v1/index";

/** The one capability the initial-review-import carrier acquires. This carrier only ever imports reviews. */
export const IMPORT_CAPABILITY: AcquisitionCapability = "REVIEW";

/**
 * A sink for a readiness observation the coordinator just recorded, so the boot can persist it (durable
 * backend readiness). Sanitized: state + probe moment only — the account is resolved server-side from the
 * opaque launch ref the boot holds, never passed here. Best-effort by contract: an implementation must never
 * throw in a way that could fail a run (the coordinator calls it fire-and-forget).
 */
export type ReadinessReport = (state: SessionReadinessState, reason: ReadinessProbeReason) => void;

/**
 * The admission a coordinator returns for a segment — the sanitized shape the host consults. Enums only: an
 * admit boolean, the supervisor decision kind, and the bound adapter id. There is nowhere in it for a token,
 * account, ref, or date.
 */
export interface SegmentAdmission {
  readonly admit: boolean;
  readonly decision: SupervisorDecision["kind"];
  readonly adapter: AcquisitionAdapterId;
}

/**
 * Map a driver's port-visible surface reading (`prepareSurface`'s result) to a readiness state, or `null` when
 * the reading says nothing about session USABILITY.
 *
 * The live NAVER driver derives this coarse result from the same session-verdict machinery the readiness probe
 * would run, so this is a faithful (if coarser) re-projection, not a new classification:
 *
 *   - `true` / `{ ok: true }`                 → `READY`
 *   - `{ ok: false, blockerCode: "LOGIN_REQUIRED" }`  → `LOGIN_REQUIRED`
 *   - `{ ok: false, blockerCode: "SESSION_EXPIRED" }` → `EXPIRED`
 *   - `false` / `UNSUPPORTED_STATE` / no code → `null` — not a session-auth outcome. "Not on a usable review
 *     surface" is not a login/2FA/account state, and no single readiness action would repair it, so the
 *     coordinator says nothing and leaves the run's engine to own it (it fails the run terminally). Overwriting
 *     readiness with a guessed state here would mislabel a wrong-page as an auth problem.
 */
export function surfaceReadingToReadiness(res: boolean | SurfaceProbeResult): SessionReadinessState | null {
  if (res === true) return "READY";
  if (res === false) return null;
  if (res.ok) return "READY";
  switch (res.blockerCode) {
    case "LOGIN_REQUIRED":
      return "LOGIN_REQUIRED";
    case "SESSION_EXPIRED":
      return "EXPIRED";
    default:
      return null;
  }
}

export class ImportAcquisitionCoordinator {
  private readonly projector = new SessionReadinessProjector();
  private readonly supervisor: AcquisitionSupervisor;
  private readonly probe: SessionReadinessProbe;
  private readonly channelCode: string;
  private readonly boundAdapterId: AcquisitionAdapterId;
  private readonly report: ReadinessReport;

  constructor(channelCode: string = NAVER_CHANNEL_CODE, report: ReadinessReport = () => {}) {
    this.channelCode = channelCode;
    this.report = report;
    this.supervisor = new AcquisitionSupervisor(this.projector);
    this.probe = new SessionReadinessProbe(this.projector, channelCode);
    // Bound once, from the matrix: which adapter would run this carrier's (channel × REVIEW). For NAVER this
    // is `NAVER_ACTION_WINDOW_IMPORT`; for any channel §4.1 does not integrate it is `NONE`.
    this.boundAdapterId = this.supervisor.selectAdapterId(channelCode, IMPORT_CAPABILITY);
  }

  /** The adapter id bound for this carrier. The live boot binds `NAVER_ACTION_WINDOW_IMPORT` to a driver. */
  adapterId(): AcquisitionAdapterId {
    return this.boundAdapterId;
  }

  /** The channel's latest recorded readiness (sanitized). `UNOBSERVED_EXTERNAL` until a run has read it. */
  readiness(): SessionReadinessState {
    return this.projector.current(this.channelCode).state;
  }

  /** The single action to offer the seller for this channel right now — the readiness "exactly one thing". */
  singleAction(): ReadinessAction {
    return this.projector.singleAction(this.channelCode);
  }

  /**
   * AGENT_START — the agent came up. No marketplace tab exists at boot, so the channel is `UNOBSERVED_EXTERNAL`
   * (fail closed, never a guessed READY). The first run's PREPARE is what actually observes the session.
   */
  onAgentStart(): void {
    this.probe.probeUnobserved("AGENT_START");
  }

  /**
   * BEFORE_WORK — decide whether to start a run for `(channel × REVIEW)`. Gated ONLY on adapter availability
   * (see the module note on why it is probe-permissive). The supervisor decision is recorded for observability;
   * the sole admission block is "no bound adapter / not integrated".
   */
  admitSegment(): SegmentAdmission {
    const decision = this.supervisor.decide(this.channelCode, IMPORT_CAPABILITY);
    const admit = this.boundAdapterId !== "NONE";
    // Sanitized: enums only. `adapter`/`decision`/`admit` avoid the logger's forbidden substrings.
    log("acquisition_admit", { adapter: this.boundAdapterId, decision: decision.kind, admit });
    return { admit, decision: decision.kind, adapter: this.boundAdapterId };
  }

  /**
   * A run's session reading, from `prepareSurface`. Map it to readiness and project it under the faithful probe
   * reason (see the module note). Returns the projected state, or `null` when the reading says nothing about
   * session usability (the coordinator records nothing then). OBSERVE-ONLY: it never alters what the run sees.
   */
  observeSurfaceReading(res: boolean | SurfaceProbeResult): SessionReadinessState | null {
    const state = surfaceReadingToReadiness(res);
    if (state === null) return null;
    const prior = this.projector.current(this.channelCode).state;
    const reason: ReadinessProbeReason =
      state !== "READY"
        ? "SESSION_FAILURE"
        : prior === "READY" || prior === "UNOBSERVED_EXTERNAL"
          ? "BEFORE_WORK"
          : "MANUAL_RECHECK";
    this.probe.observeState(state, reason);
    // Persist the observation (durable backend readiness). Fire-and-forget: the reporter is best-effort and
    // must never fail a run — the run's own engine, not this, owns the session hold.
    this.report(state, reason);
    return state;
  }
}
