/**
 * **Acquisition supervisor — the channel-neutral selection + readiness-gate coordinator. OBSERVE-ONLY, FE-free.**
 *
 * The Agent runs pull-first. Session readiness (`initial-import/session-readiness`) answers "is this channel's
 * session usable?"; this coordinator answers the next two questions on top of it:
 *
 *  1. **How is `(channel × capability)` acquired?** — resolve it to an {@link ExecutionMode} from the
 *     {@link ACQUISITION_MATRIX}, which reflects the connector roadmap §4.1 living table. A capability §4.1
 *     has not verified is simply absent from the matrix, so it fails closed to `INTEGRATION_PENDING` — never
 *     a guessed mode.
 *  2. **May the Agent start, or ask the seller for one thing?** — read the channel's readiness from a
 *     {@link SessionReadinessProjector} and fold it with the plan via the pure `decideAcquisition`.
 *
 * It owns NO durable state (the backend owns plan/segment/ticket truth and channel-connection health) and NO
 * pure phase/readiness state (the kernel and the readiness projector own those). It is a thin Adapter-layer
 * coordinator: resolve → gate → (later) hand to the right vertical stack. That is why it is fully offline-
 * testable.
 *
 * ## Not yet driven by the live agent loop (deliberate boundary)
 *
 * This slice provides the resolve-and-decide seam and the adapter *selection*; it does NOT wire the supervisor
 * into the live boot (`buildInitialImportConfig` / `local-agent` call nothing here), run any live acquisition,
 * or persist anything. Binding a selected adapter id to a live driver, and calling readiness at the four probe
 * moments, run against a real marketplace session, so they are a separately-approved follow-up. See
 * `../../../contracts/acquisition/v1/README.md`.
 */
import { log } from "../log";
import { NAVER_CHANNEL_CODE, SessionReadinessProjector } from "./initial-import/session-readiness";
import {
  decideAcquisition,
  resolveAcquisition,
  type AcquisitionCapability,
  type AcquisitionPlan,
  type AcquisitionResolutionRow,
  type SupervisorDecision,
} from "../../../contracts/acquisition/v1/index";

/**
 * The `(channel × capability) → mode` matrix, reflecting the roadmap §4.1 living table (capability truth). It
 * is intentionally SMALL: only rows §4.1 records as a resolved method appear. Everything else is absent and
 * therefore `INTEGRATION_PENDING` (fail closed by omission) — the matrix never asserts a channel supports a
 * capability that §4.1 has not verified.
 *
 *  - NAVER · REVIEW → `ACTION_WINDOW` — the supervised export the collector's engine already drives (§4.1:
 *    "EXPORT(감독형) + MANUAL", live-verified Run 4). The MANUAL file-upload fallback is a separate concern
 *    (fallback ordering) deferred past this slice.
 *  - NAVER · ORDER_SUMMARY → `AUTOMATIC_OPERATION` / `PULL` — the official order API (§4.1: method = API,
 *    live-verified once). The mode reflects the *method*; operational-support and a built API adapter are
 *    separate axes, both still absent here (so a DISPATCH stays a decision, not a live run — see the boundary).
 *
 * REPLY_SUBMISSION and every other `(channel, capability)` are deliberately omitted → `INTEGRATION_PENDING`.
 */
export const ACQUISITION_MATRIX: readonly AcquisitionResolutionRow[] = [
  { channelCode: NAVER_CHANNEL_CODE, capability: "REVIEW", mode: "ACTION_WINDOW" },
  { channelCode: NAVER_CHANNEL_CODE, capability: "ORDER_SUMMARY", mode: "AUTOMATIC_OPERATION", delivery: "PULL" },
];

/**
 * Which channel adapter would run a plan. A sanitized id, not a driver: binding an id to a concrete (live)
 * driver happens at the deliberately-unwired live boundary (`naver-acquisition-adapter.ts` supplies the NAVER
 * factory). `NONE` means no adapter is available for this `(channel, mode)` in this build — the honest answer
 * for an `AUTOMATIC_OPERATION` plan whose API adapter is not built, or any `INTEGRATION_PENDING` plan.
 */
export type AcquisitionAdapterId = "NAVER_ACTION_WINDOW_IMPORT" | "NONE";

/**
 * Select the adapter id for a plan. The only adapter this build actually has is the NAVER Action Window import
 * engine; everything else resolves to `NONE` (no fake capability). Pure — no readiness, no I/O.
 */
export function selectAdapterId(plan: AcquisitionPlan): AcquisitionAdapterId {
  if (plan.channelCode === NAVER_CHANNEL_CODE && plan.capability === "REVIEW" && plan.mode === "ACTION_WINDOW") {
    return "NAVER_ACTION_WINDOW_IMPORT";
  }
  return "NONE";
}

/**
 * A thin coordinator over a readiness projector and the acquisition matrix. Holds no durable or pure state; it
 * only reads the latest readiness the projector recorded and folds it with a resolved plan.
 */
export class AcquisitionSupervisor {
  constructor(
    private readonly readiness: SessionReadinessProjector,
    private readonly matrix: readonly AcquisitionResolutionRow[] = ACQUISITION_MATRIX,
  ) {}

  /** How `(channel × capability)` is acquired — a plan, or an `INTEGRATION_PENDING` plan if unresolved. */
  plan(channelCode: string, capability: AcquisitionCapability): AcquisitionPlan {
    return resolveAcquisition(channelCode, capability, this.matrix);
  }

  /**
   * Resolve the plan, read the channel's (and optional account slot's) latest readiness, and decide. The
   * account slot is passed through to the projector so two accounts on one channel never gate as one; it is
   * NOT logged, matching the readiness probe's discipline.
   */
  decide(channelCode: string, capability: AcquisitionCapability, accountKey?: string): SupervisorDecision {
    const plan = this.plan(channelCode, capability);
    const readiness = this.readiness.current(channelCode, accountKey).state;
    const decision = decideAcquisition(readiness, plan);
    // Sanitized: a channel-code enum plus enums. The account slot is deliberately not logged; the keys also
    // avoid the logger's forbidden substrings, so nothing here is dropped or leaked.
    log("acquisition_decision", {
      channelCode,
      capability,
      mode: plan.mode,
      decision: decision.kind,
    });
    return decision;
  }

  /** The adapter id that would run a `(channel × capability)`, or `NONE`. Selection only — no live binding. */
  selectAdapterId(channelCode: string, capability: AcquisitionCapability): AcquisitionAdapterId {
    return selectAdapterId(this.plan(channelCode, capability));
  }
}
