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
import type { ScopeEvidenceWire } from "../scope-evidence";
import type { ScopeMatch } from "../../naver/export-scope-match";
import type { ImportSurfaceFacts } from "../../naver/import-guidance-plan";
import type { GuidancePanelState } from "../guidance-panel";
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

  /**
   * Take the annotation off whatever is currently highlighted.
   *
   * Exists because of a live defect, not for symmetry (proof record, finding 12): when the scope gate stopped
   * the 2026-07-25 run, the previous step's highlight stayed on the date field the seller had just left. It
   * read as "still waiting for this" on a run that had stopped 30 seconds earlier, and the operator kept
   * changing a date no barrier was watching. A stopped run must not keep pointing at a control.
   */
  clearTargetHighlight(): Promise<void>;

  /**
   * Does {@code target} ALREADY hold the date this segment needs?
   *
   * The other live defect (finding 13). The date barrier advances on a value CHANGE — deliberately, because
   * treating focus or blur as "they acted" would pass the barrier on an unset field. The cost is that a field
   * already holding the right value can never satisfy it: re-picking the same date produces no change. That is
   * not a corner case — the current-month segment's end date defaults to today — and the 2026-07-25 run had to
   * set a deliberately wrong date and correct it afterwards. So the engine asks first and SKIPS the step,
   * rather than asking the seller to fake a change.
   *
   * Reads the control's value IN-PROCESS and returns only a boolean, exactly as {@link readSelectedScope}
   * does: the value never reaches a log, the wire, or disk.
   */
  isTargetPrefilled(target: ImportTarget, required: RequiredRange): Promise<boolean>;

  /**
   * Render (or, with {@code null}, remove) the SellerOps guidance panel in the marketplace page.
   *
   * The state arrives fully worded — the runtime assembles it from the frontend's pack and authors no
   * sentence of its own (see `../guidance-copy.ts`). This is what makes the journey completable without
   * looking back at the SellerOps window.
   */
  renderGuidance(state: GuidancePanelState | null): Promise<void>;

  /**
   * The seller's last press on that panel, or null.
   *
   * A press on OUR panel, never on a marketplace control — the same class of event as satisfying a barrier.
   * Take-once: an intent left set would replay as a stream of rechecks.
   */
  takeGuidanceIntent(): Promise<string | null>;

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

  /**
   * Hand the validated artifact to the ingest path bound to this run's launch ref.
   *
   * The scope evidence is PASSED IN by the session from the engine's single record — the driver does not
   * derive it. This is what keeps the value the backend records identical to the value the engine holds.
   */
  ingest(artifactRef: string, scopeEvidence: ScopeEvidenceWire): Promise<IngestResult>;

  /** Remove every annotation. Must be safe to call twice and on a half-built run. */
  cleanup(): Promise<void>;

  /**
   * **Guided Acquisition Reliability — resolve when the marketplace window closes.**
   *
   * Optional. A driver that owns a real window (the live NAVER driver) resolves this promise when the seller
   * closes it, so the session can park the run on `SURFACE_CLOSED` instead of re-arming an observation on a
   * dead page forever. A driver with no window (every scripted test driver) omits it, and the session watches
   * nothing — behaviour for those drivers is byte-identical. Resolves at most once per opened window.
   */
  whenSurfaceClosed?(): Promise<void>;
}

/*
 * **There is no `ImportDiscoveryDriver` any more, and its absence is a product decision.**
 *
 * Until 2026-07-26 a run PRECEDED the plan: it drove the seller through NAVER's own date pickers to find how
 * far back the marketplace would let them reach, and the plan was built from that. The 2026-07-25 live run
 * established that NAVER's review calendar restricts nothing — there was no limit to discover — so the
 * choreography was asking the seller a question about a constraint that does not exist (proof record,
 * finding 16).
 *
 * The product owner reframed it: how far back to import is the SELLER's choice, made once in SellerOps
 * (end date = today, they pick the start month, and they confirm the period and how many monthly segments it
 * becomes before anything is created). That needs no marketplace interaction at all, so the run, its engine,
 * its session, and this driver role were removed rather than left unreachable. What remains here is the one
 * choreography that genuinely needs the marketplace: guiding ONE planned segment to a downloaded file.
 */
