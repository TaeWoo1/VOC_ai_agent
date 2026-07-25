/**
 * **What the DOM side must provide for one guided import segment.**
 *
 * The engine owns the choreography and every decision; this interface owns nothing but observation and
 * annotation. Two invariants it exists to make structural:
 *
 *  1. **There is no click, type, submit, export or consent method here.** The seller performs every
 *     marketplace action. A driver that could press the export control would make the Action Window
 *     pattern a matter of remembering not to call it.
 *  2. **Raw dates never leave `readSelectedScope`.** The implementation reads the date controls' actual
 *     values in-process and returns a THREE-VALUE verdict. That keeps the existing OPERATOR-LOCAL rule on
 *     `naver-live-driver.readExportScope` intact: the values are never logged, persisted or transported.
 *
 * The targets are parameterized rather than one method per control because the sequence is data
 * ({@link ImportGuidanceStage}), and a per-control method set would have to be kept in lockstep with it by
 * hand.
 */
import type { RangeControlProbe } from "../../naver/available-range-discovery";
import type { ScopeMatch } from "../../naver/export-scope-match";
import type { ImportSurfaceFacts } from "../../naver/import-guidance-plan";
import type {
  ArtifactValidateResult,
  DownloadDetectResult,
  IngestResult,
  LocateResult,
  SurfaceProbeResult,
} from "../engine";

/** A control the runtime may highlight and then watch. Never a selector — a semantic role. */
export type ImportTarget = "start_date" | "end_date" | "apply_range" | "export" | "consent";

export const IMPORT_TARGETS: readonly ImportTarget[] = [
  "start_date",
  "end_date",
  "apply_range",
  "export",
  "consent",
];

/** The window this segment must cover. ISO `YYYY-MM-DD`, resolved server-side from the launch ref. */
export interface RequiredRange {
  start: string;
  end: string;
}

export interface ImportProbeDriver {
  /**
   * Is the seller on a usable review-management surface? A bare `false` maps to `UNSUPPORTED_STATE`;
   * a result carrying a `blockerCode` reports the semantic cause the seller can act on.
   */
  prepareSurface(): Promise<boolean | SurfaceProbeResult>;

  /**
   * What this surface requires — notably whether a separate search/apply control must be pressed. Read
   * ONCE, before any step is published, because it fixes the step plan for the whole run.
   */
  readSurfaceFacts(): Promise<ImportSurfaceFacts>;

  /** How many candidates match {@code target}, and the opaque signature of the one (if exactly one). */
  locateTarget(target: ImportTarget): Promise<LocateResult>;

  /**
   * Annotate the target read-only and RE-VALIDATE the match while doing it. Returning the locate result
   * again is the anti-drift check the reply runtime established: if the unique match changed between
   * locate and highlight, fail closed rather than highlight the wrong control.
   */
  highlightTarget(target: ImportTarget): Promise<LocateResult>;

  /** Arm observation of the seller's own action on {@code target}. Never performs it. */
  armTargetObserve(target: ImportTarget): Promise<void>;

  /** Resolve true when the seller acted on {@code target}. */
  waitForTargetAction(target: ImportTarget): Promise<boolean>;

  /**
   * Compare what is selected on screen against {@code required}, in-process.
   *
   * Returns only the verdict. `UNREADABLE` is a first-class answer, not an error: fewer than two
   * readable dates must never be reported as a MISMATCH, because "we could not read it" and "it is
   * wrong" lead to opposite obligations.
   */
  readSelectedScope(required: RequiredRange): Promise<ScopeMatch>;

  /** Observe whether the seller's clicks produced a download. Never triggers one. */
  detectDownload(): Promise<DownloadDetectResult>;

  validateArtifact(artifactRef: string): Promise<ArtifactValidateResult>;

  /** Hand the validated artifact to the ingest path bound to this run's launch ref. */
  ingest(artifactRef: string): Promise<IngestResult>;

  /** Remove every annotation. Must be safe to call twice and on a half-built run. */
  cleanup(): Promise<void>;
}

/** The historical range a discovery run established. Dates, because the range IS this run's product. */
export interface DiscoveredRange {
  start: string;
  end: string;
}

/**
 * **What the DOM side must provide for a range-DISCOVERY run.**
 *
 * The run that precedes the plan: it answers "how far back does this marketplace currently let this seller
 * reach?", so the monthly segments are planned from what exists rather than a period the seller guessed.
 *
 * It reuses the segment driver's observation surface for the two date controls — same locate, same
 * highlight, same barrier — because it is literally the same two controls, and a second implementation of
 * that choreography would be a second thing to keep correct. What is new is only reading BOUNDS, reading
 * the selected VALUES, and reporting the result.
 *
 * ## The one place dates deliberately leave the driver, and why that is not a leak
 *
 * `readSelectedScope` on the segment driver returns a verdict precisely so a seller's dates stay in-process.
 * {@link readSelectedRange} returns the dates themselves — because here they are not incidental page content,
 * they are the run's OUTPUT: the backend stores them as the plan's range and the frontend shows the seller
 * "가져올 수 있는 기간". The rule that survives is the one that matters: they go to the SERVER over the
 * account's own authenticated channel and are never logged, never persisted locally, and never put on the
 * Action Window wire (no v2 event or view payload carries a date; only `copyParams` does, for a window the
 * server itself resolved).
 */
export interface ImportDiscoveryDriver
  extends Pick<
    ImportProbeDriver,
    "prepareSurface" | "locateTarget" | "highlightTarget" | "armTargetObserve" | "waitForTargetAction" | "cleanup"
  > {
  /** What the range controls DECLARE as reachable — bounds, not the current selection. */
  readRangeControls(): Promise<RangeControlProbe>;

  /**
   * The dates currently selected on screen, or null when fewer than two are readable.
   *
   * Null is a first-class answer: "we could not read it" and "the seller chose nothing" both mean the run
   * must not report a range, and inventing one here would be indistinguishable downstream from a measured
   * value.
   */
  readSelectedRange(): Promise<DiscoveredRange | null>;

  /**
   * Report the established range to the server, which creates the plan over it and spends the ticket.
   *
   * `evidence` is passed rather than derived because only the engine knows which path produced the range,
   * and the server refuses to default it — a machine read and a human's confirmation must never be
   * relabelled as each other. Returns false on refusal; the engine fails the run rather than claiming a plan
   * exists.
   */
  reportDiscoveredRange(range: DiscoveredRange, evidence: "MACHINE_DISCOVERED" | "OPERATOR_CONFIRMED"): Promise<boolean>;
}
