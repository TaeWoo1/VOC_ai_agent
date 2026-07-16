/**
 * **Operation Run domain (R3) — pure, serializable, no I/O.**
 *
 * The persisted representation of one Action Window Operation Run (canonical intent:
 * `docs/product-scope-v1.md` §1.7 — this module implements the runtime persistence, not new product
 * semantics). It re-authors the proven `collector/src/work/*` patterns for the Action Window engine:
 * a JSON-round-trip-safe record, a command-idempotency ledger that is NEVER positional, an ordered
 * append-only audit history, and "verification is the sole completion authority" preserved by
 * construction (the record is derived from the engine, which already enforces it).
 *
 * Restore policy lives here as pure planning (`planRestore`): a resumable run is re-entered ONLY
 * through the PAUSED barrier at a SAFE stage — the start of its active step's read-only automatic
 * chain — so restored progress is exactly the verified progress, never optimistic. COMPLETED and
 * CANCELLED runs are terminal-protected: they restore read-only and can never restart. A FAILED run
 * is resumable (it re-enters through the same fail-closed probes, zero clicks).
 *
 * Privacy: every field is an enum, boolean, count, dotted copy key, sanitized primitive copy param,
 * or opaque 16-hex ref — the same sanitization contract as the wire. The store additionally refuses
 * to persist any record where `findProhibitedFields` finds a violation.
 */
import {
  BLOCKER_CODES,
  findProhibitedFields,
  validateEventEnvelope,
  validateRunView,
  type ActionWindowRunView,
  type EventEnvelope,
  type ExecutionMode,
  type StepStatus,
} from "../../../contracts/action-window/v1/index";
import type { ActionWindowEngine, PersistedEngineState } from "./engine";
import { STEP_PLAN, type Stage, stageToStepStatus } from "./stages";

/**
 * Bump on any breaking change to the persisted record shape.
 * v2: the dummy downstream stage (`RUN_DUMMY_DOWNSTREAM`) was replaced by the real downstream chain
 * (`DETECT_DOWNLOAD` → `VALIDATE_ARTIFACT` → `INGEST_HANDOFF`), changing the persisted stage
 * vocabulary. v1 records no longer load (fail closed as `WRONG_SCHEMA_VERSION`) — the store was
 * dev-only synthetic runs, deliberately not migrated.
 */
export const OPERATION_RUN_SCHEMA_VERSION = 2;

/**
 * How a loaded record may re-enter execution. Computed at plan time from persisted state only.
 * - `RESUME_AT_CHECKPOINT` — interrupted before/at the human step: resume re-drives the read-only
 *   automatic chain (prepare → locate → highlight) back to `WAITING_FOR_HUMAN`.
 * - `RESUME_DOWNSTREAM` — verified but interrupted before downstream completed: resume re-runs the
 *   automatic downstream chain (detect → validate → ingest) from detection; ingestion is dedup-safe,
 *   so the re-run is idempotent.
 * - `RESUME_FROM_FAILURE` — the run failed closed: resume re-enters the same chain; if the cause
 *   persists it fails closed again.
 * - `TERMINAL` — COMPLETED/CANCELLED: restore is read-only; the run can never restart.
 */
export type ResumeState = "RESUME_AT_CHECKPOINT" | "RESUME_DOWNSTREAM" | "RESUME_FROM_FAILURE" | "TERMINAL";

/** One ordered task of the fixed step plan, with its persisted status. */
export interface OperationTask {
  stepNumber: number;
  stepId: string;
  copyKey: string;
  mode: ExecutionMode;
  status: StepStatus;
}

/** The single human-action checkpoint (step 2 of the plan). */
export interface HumanCheckpoint {
  stepId: string;
  copyKey: string;
  /** The run has reached (or passed) the checkpoint at least once. */
  reached: boolean;
  /** A user action was observed at the checkpoint (observation ≠ completion). */
  observed: boolean;
  /** Opaque 16-hex ref of the highlighted target. OMITTED (never null) until one is located. */
  targetRef?: string;
}

/**
 * The persisted Operation Run. `engine` is the full-fidelity restore state (ledger + ordered event
 * log included); `tasks`/`humanCheckpoint`/`resumeState`/`latestView` are derived projections stored
 * alongside it so a reader (or a future backend mirror) needs no engine to understand the run.
 */
export interface OperationRun {
  schemaVersion: number;
  runId: string;
  channelCode: string;
  revision: number;
  /** Highest emitted event sequence — the audit-ordering high-water mark. */
  sequence: number;
  executionMode: ExecutionMode;
  resumeState: ResumeState;
  tasks: readonly OperationTask[];
  humanCheckpoint: HumanCheckpoint;
  /** Latest sanitized View Model snapshot at persist time. */
  latestView: ActionWindowRunView;
  /** Full engine restore state; `engine.events` is the ordered audit history. */
  engine: PersistedEngineState;
}

/** The restore plan for a loaded record: the exact state to reconstruct plus how it may resume. */
export interface RestorePlan {
  resumeState: ResumeState;
  state: PersistedEngineState;
  /** Set for resumable plans: the SAFE stage `pauseForRestore` parks behind the PAUSED barrier. */
  safeResumeStage: Stage | null;
}

const HUMAN_STEP = STEP_PLAN[1]!;

/** Pure resume classification from persisted engine state. */
export function resumeStateFor(state: PersistedEngineState): ResumeState {
  if (state.stage === "COMPLETE" || state.stage === "CANCELLED") return "TERMINAL";
  if (state.stage === "FAILED") return "RESUME_FROM_FAILURE";
  if (state.activeStepIndex >= 3) return "RESUME_DOWNSTREAM";
  return "RESUME_AT_CHECKPOINT";
}

/**
 * The SAFE stage a resumable run re-enters at. Steps 1–2 restart their read-only automatic chain
 * from PREPARE_SESSION (a fresh process has no prepared surface, located target, or overlay — the
 * chain re-verifies all of it and lands back at the human checkpoint). Step 3 re-runs the automatic
 * downstream chain from DETECT_DOWNLOAD — always from detection, never mid-chain: a restarted
 * process must re-establish that the artifact exists before validating or ingesting anything.
 * Verified progress (`completedSteps`) is preserved either way.
 */
export function safeResumeStageFor(state: PersistedEngineState): Stage {
  return resumeStateFor(state) === "RESUME_DOWNSTREAM" ? "DETECT_DOWNLOAD" : "PREPARE_SESSION";
}

/** Per-task persisted status, derived from verified progress + the current stage. */
function taskStatusFor(stepNumber: number, state: PersistedEngineState): StepStatus {
  if (stepNumber <= state.completedSteps) return "COMPLETED";
  const effectiveStage: Stage = state.stage === "PAUSED" ? state.resumeStage ?? state.stage : state.stage;
  if (stepNumber === state.activeStepIndex) {
    if (state.stage === "FAILED") return "FAILED";
    if (state.stage === "CANCELLED") return "SKIPPED";
    return stageToStepStatus(effectiveStage);
  }
  if (stepNumber < state.activeStepIndex) return "COMPLETED";
  return state.stage === "CANCELLED" || state.stage === "FAILED" ? "SKIPPED" : "PENDING";
}

/** Project the persisted Operation Run from a live engine. Pure read — mutates nothing. */
export function operationRunFrom(engine: ActionWindowEngine): OperationRun {
  const state = engine.runState();
  const view = engine.view();
  const reached = state.events.some((e) => e.type === "HUMAN_ACTION_REQUIRED");
  return {
    schemaVersion: OPERATION_RUN_SCHEMA_VERSION,
    runId: state.runId,
    channelCode: state.channelCode,
    revision: state.revision,
    sequence: state.seq,
    executionMode: view.executionMode,
    resumeState: resumeStateFor(state),
    tasks: STEP_PLAN.map((meta) => ({
      stepNumber: meta.stepNumber,
      stepId: meta.stepId,
      copyKey: meta.copyKey,
      mode: meta.mode,
      status: taskStatusFor(meta.stepNumber, state),
    })),
    humanCheckpoint: {
      stepId: HUMAN_STEP.stepId,
      copyKey: HUMAN_STEP.copyKey,
      reached,
      observed: state.observed,
      ...(state.targetSig ? { targetRef: state.targetSig } : {}),
    },
    latestView: view,
    engine: state,
  };
}

/**
 * Plan the restore for a loaded record. Terminal runs restore EXACTLY as persisted (read-only —
 * their stage accepts no command, so accidental restart is structurally impossible). Resumable runs
 * restore as persisted and are then parked at PAUSED behind `pauseForRestore(safeResumeStage)`;
 * only an explicit `RESUME_RUN` command re-drives anything.
 */
export function planRestore(run: OperationRun): RestorePlan {
  const resumeState = resumeStateFor(run.engine);
  if (resumeState === "TERMINAL") {
    return { resumeState, state: run.engine, safeResumeStage: null };
  }
  return { resumeState, state: run.engine, safeResumeStage: safeResumeStageFor(run.engine) };
}

/* ────────────────────────────── allow-list parsing ────────────────────────────── */

export type OperationRunParseError =
  | "WRONG_SCHEMA_VERSION"
  | "NOT_AN_OBJECT"
  | "INVALID_FIELD"
  | "INVALID_EVENT"
  | "INVALID_VIEW"
  | "PROHIBITED_CONTENT";

export type OperationRunParseResult = { ok: true; run: OperationRun } | { ok: false; error: OperationRunParseError };

/**
 * ⚠ A plain array typed `readonly Stage[]` accepts a SUBSET, so omitting a new stage here compiles
 * cleanly and fails at runtime — and not loudly: `saveOperationRun` re-parses on write and throws, from
 * inside the session's drive chain, where the throw is swallowed into `fatalCleanup`. The run would park
 * in memory with nothing on disk and no error anywhere. A test asserts this list covers every `Stage`.
 */
const STAGES: readonly Stage[] = [
  "PREPARE_SESSION",
  "OPEN_TARGET_SURFACE",
  "LOCATE_TARGET",
  "HIGHLIGHT_TARGET",
  "WAIT_FOR_USER_ACTION",
  "VERIFY_TRANSITION",
  "DETECT_DOWNLOAD",
  "VALIDATE_ARTIFACT",
  "INGEST_HANDOFF",
  "AWAIT_SESSION_RECOVERY",
  "COMPLETE",
  "FAILED",
  "CANCELLED",
  "PAUSED",
];
const RESUME_STATES: readonly ResumeState[] = [
  "RESUME_AT_CHECKPOINT",
  "RESUME_DOWNSTREAM",
  "RESUME_FROM_FAILURE",
  "TERMINAL",
];

function isStage(v: unknown): v is Stage {
  return typeof v === "string" && (STAGES as readonly string[]).includes(v);
}
function isNonNegativeInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}
function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function parseEngineState(input: unknown): PersistedEngineState | null {
  if (typeof input !== "object" || input === null) return null;
  const s = input as Record<string, unknown>;
  const blocker = s.blocker;
  const blockerOk =
    blocker === null ||
    (typeof blocker === "object" &&
      blocker !== null &&
      (BLOCKER_CODES as readonly string[]).includes((blocker as Record<string, unknown>).code as string) &&
      typeof (blocker as Record<string, unknown>).recoverable === "boolean");
  if (
    typeof s.runId !== "string" ||
    typeof s.channelCode !== "string" ||
    typeof s.runCopyKey !== "string" ||
    typeof s.guidanceEnabled !== "boolean" ||
    typeof s.started !== "boolean" ||
    !isStage(s.stage) ||
    !(s.resumeStage === null || isStage(s.resumeStage)) ||
    !isNonNegativeInt(s.activeStepIndex) ||
    !isNonNegativeInt(s.revision) ||
    !(s.targetSig === null || typeof s.targetSig === "string") ||
    typeof s.observed !== "boolean" ||
    !blockerOk ||
    !isNonNegativeInt(s.completedSteps) ||
    !isNonNegativeInt(s.seq) ||
    !isStringArray(s.appliedCommandIds) ||
    !Array.isArray(s.events)
  ) {
    return null;
  }
  return input as PersistedEngineState;
}

/**
 * Strict allow-list parse of a persisted record: schema version, field types, contract-valid events
 * (each validated, sequence strictly ascending and gapless) and view, and a prohibited-content scan.
 * A record that fails any check is rejected whole — a corrupt or tampered store never half-loads.
 */
export function parseOperationRun(input: unknown): OperationRunParseResult {
  if (typeof input !== "object" || input === null) return { ok: false, error: "NOT_AN_OBJECT" };
  const r = input as Record<string, unknown>;
  if (r.schemaVersion !== OPERATION_RUN_SCHEMA_VERSION) return { ok: false, error: "WRONG_SCHEMA_VERSION" };

  const engine = parseEngineState(r.engine);
  if (!engine) return { ok: false, error: "INVALID_FIELD" };
  if (
    typeof r.runId !== "string" ||
    r.runId !== engine.runId ||
    typeof r.channelCode !== "string" ||
    !isNonNegativeInt(r.revision) ||
    !isNonNegativeInt(r.sequence) ||
    typeof r.executionMode !== "string" ||
    !(typeof r.resumeState === "string" && (RESUME_STATES as readonly string[]).includes(r.resumeState)) ||
    !Array.isArray(r.tasks) ||
    typeof r.humanCheckpoint !== "object" ||
    r.humanCheckpoint === null ||
    typeof r.latestView !== "object" ||
    r.latestView === null
  ) {
    return { ok: false, error: "INVALID_FIELD" };
  }

  let lastSeq = 0;
  for (const e of engine.events) {
    if (validateEventEnvelope(e).ok !== true) return { ok: false, error: "INVALID_EVENT" };
    const seq = (e as EventEnvelope).sequence;
    if (seq !== lastSeq + 1) return { ok: false, error: "INVALID_EVENT" }; // audit order is gapless
    lastSeq = seq;
  }
  if (lastSeq !== engine.seq) return { ok: false, error: "INVALID_EVENT" };
  if (validateRunView(r.latestView).ok !== true) return { ok: false, error: "INVALID_VIEW" };
  if (findProhibitedFields(input).length > 0) return { ok: false, error: "PROHIBITED_CONTENT" };

  return { ok: true, run: input as OperationRun };
}
