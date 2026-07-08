/**
 * **Action Window protocol — v1 (normative TypeScript surface).**
 *
 * One normative contract consumed by BOTH the SellerOps frontend and the Local Agent runtime.
 * The language-neutral source of truth is `./schema.json` (also the basis for future Java DTOs);
 * this module mirrors it for TypeScript consumers. A mechanical consistency test asserts the
 * enum arrays here equal the `enum` arrays in `schema.json`, so the two representations cannot drift.
 *
 * **Transport (see README §8).** Action Window messages are a *nested* contract with their OWN
 * version (`ACTION_WINDOW_PROTOCOL_VERSION`), carried inside the existing Local Agent Bridge v1
 * transport as opaque command/event payloads. This is purely additive: it does not change the
 * meaning of any existing Bridge message and does not force a Bridge major-version bump.
 *
 * **Scope.** Pure types + pure validators. NO Chrome, overlay, DOM detection, user-click observation,
 * download detection, React, backend persistence, or live commerce behavior.
 *
 * **Privacy invariant (README §6).** Every value that crosses this boundary is an enum, a boolean,
 * a count, an opaque id, or concise human-facing copy (`title`/`instruction`). Never a selector,
 * arbitrary page text, raw account/connection id, frame/page URL, CDP target id, local absolute
 * path, credential, token, cookie, session content, or downloaded review content.
 */

export const ACTION_WINDOW_PROTOCOL_VERSION = 1;

/* ────────────────────────────── Normative enums ────────────────────────────── */

/** Persisted Run status. `IDLE` is intentionally absent — it is a UI-only scenario (no active Run). */
export const RUN_STATUSES = [
  "PREPARING",
  "RUNNING",
  "WAITING_FOR_HUMAN",
  "PAUSED",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const STEP_STATUSES = [
  "PENDING",
  "PREPARING",
  "READY",
  "AWAITING_USER",
  "OBSERVING",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "SKIPPED",
] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

export const EXECUTION_MODES = ["AUTOMATIC", "HUMAN_ACTION", "FILE_IMPORT", "UNAVAILABLE"] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];

export const BLOCKER_CODES = [
  "LOGIN_REQUIRED",
  "UI_DRIFT",
  "TARGET_NOT_FOUND",
  "TARGET_AMBIGUOUS",
  "SESSION_EXPIRED",
  "UNSUPPORTED_STATE",
  "DOWNLOAD_TIMEOUT",
  "ARTIFACT_INVALID",
] as const;
export type BlockerCode = (typeof BLOCKER_CODES)[number];

export const COMMAND_TYPES = [
  "START_RUN",
  "PAUSE_RUN",
  "RESUME_RUN",
  "CANCEL_RUN",
  "FIND_CURRENT_STEP",
  "SWITCH_TO_MANUAL",
  "REQUEST_STEP_RECHECK",
  "SET_GUIDANCE_ENABLED",
] as const;
export type CommandType = (typeof COMMAND_TYPES)[number];

export const EVENT_TYPES = [
  "RUN_STARTED",
  "RUN_STATUS_CHANGED",
  "STEP_READY",
  "HUMAN_ACTION_REQUIRED",
  "TARGET_HIGHLIGHTED",
  "USER_ACTION_OBSERVED",
  "DOWNLOAD_DETECTED",
  "STEP_COMPLETED",
  "RUN_BLOCKED",
  "RUN_COMPLETED",
  "RUN_FAILED",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/* ────────────────────────────── Envelopes & view model ────────────────────────────── */

export interface CommandEnvelope {
  protocolVersion: number;
  /** Idempotency key — replaying the same commandId must not double-apply. */
  commandId: string;
  /** Opaque run id (never a raw account/connection identity). */
  runId: string;
  /** Optimistic-concurrency guard — a command against an older revision is rejected. */
  expectedRevision: number;
  type: CommandType;
  payload?: CommandPayload;
}

export type CommandPayload =
  | { channel: string } // START_RUN
  | { enabled: boolean } // SET_GUIDANCE_ENABLED
  | Record<string, never>; // commands with no payload

export interface EventEnvelope {
  protocolVersion: number;
  /** De-dupe key — duplicates may be ignored by eventId. */
  eventId: string;
  runId: string;
  /** Monotonic within a Run — ordering/authority source (NOT the timestamp). */
  sequence: number;
  /** Current aggregate revision after this event. */
  revision: number;
  type: EventType;
  /** Opaque occurrence marker for display/staleness only; never parsed for elapsed-duration logic. */
  occurredAt: string;
  payload: EventPayload;
}

/** Sanitized event payload — a small bag of safe scalars. Concrete required keys are enforced per type. */
export interface EventPayload {
  status?: RunStatus;
  stepId?: string;
  stepNumber?: number;
  totalSteps?: number;
  stepStatus?: StepStatus;
  /** Opaque 16-hex signature of a located target — NEVER a selector. */
  targetRef?: string;
  observed?: boolean;
  /** Opaque 16-hex reference to a detected artifact — NEVER a filename/path. */
  artifactRef?: string;
  code?: BlockerCode;
  recoverable?: boolean;
}

export interface ActionWindowRunView {
  protocolVersion: number;
  runId: string;
  revision: number;

  channel: string;
  title: string;

  status: RunStatus;
  executionMode: ExecutionMode;

  currentStep?: {
    stepId: string;
    stepNumber: number; // 1-based
    totalSteps: number;
    title: string;
    instruction?: string;
    status: StepStatus;
  };

  guidanceEnabled: boolean;
  /** Supplied by Runtime; FE does not infer permissions. Subset of COMMAND_TYPES. */
  allowedCommands: CommandType[];

  blocker?: {
    code: BlockerCode;
    recoverable: boolean;
  };

  progress: {
    completedSteps: number;
    totalSteps: number;
  };

  updatedAt: string;
}

/* ────────────────────────────── Validation ────────────────────────────── */

export interface ValidationError {
  code: ValidationErrorCode;
  path: string;
}
export type ValidationResult = { ok: true } | { ok: false; errors: ValidationError[] };

export const VALIDATION_ERROR_CODES = [
  "UNSUPPORTED_PROTOCOL_VERSION",
  "MISSING_FIELD",
  "WRONG_TYPE",
  "UNKNOWN_ENUM",
  "CONSTRAINT_VIOLATION",
  "PROHIBITED_FIELD",
  "STALE_REVISION",
  "OUT_OF_ORDER",
] as const;
export type ValidationErrorCode = (typeof VALIDATION_ERROR_CODES)[number];

/** Keys that must never appear anywhere in a contract message (privacy boundary, README §6). */
export const PROHIBITED_KEYS: readonly string[] = [
  "selector",
  "xpath",
  "css",
  "url",
  "href",
  "frameUrl",
  "pageUrl",
  "cdpTargetId",
  "accountId",
  "connectionId",
  "filePath",
  "absolutePath",
  "path",
  "cookie",
  "cookies",
  "token",
  "credential",
  "credentials",
  "password",
  "sessionContent",
  "pageText",
  "reviewText",
  "reviewContent",
];

const REF_KEYS: readonly string[] = ["targetRef", "artifactRef"];
const HEX16 = /^[0-9a-f]{16}$/;
const ISO_LIKE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const URL_OR_ABS_PATH = /(^|["'\s])(https?:\/\/|wss?:\/\/|file:\/\/|\/Users\/|\/home\/|[A-Za-z]:\\)/;

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}
function err(code: ValidationErrorCode, path: string): ValidationError {
  return { code, path };
}

/**
 * Recursively flag prohibited content: prohibited keys, non-opaque `*Ref` values, and any string
 * value carrying a URL scheme or an absolute filesystem path. Returns errors (empty ⇒ clean).
 */
export function findProhibitedFields(value: unknown, path = "$"): ValidationError[] {
  const out: ValidationError[] = [];
  if (isRecord(value)) {
    for (const [k, v] of Object.entries(value)) {
      const childPath = `${path}.${k}`;
      if (PROHIBITED_KEYS.includes(k)) out.push(err("PROHIBITED_FIELD", childPath));
      if (REF_KEYS.includes(k) && !(typeof v === "string" && HEX16.test(v))) {
        out.push(err("PROHIBITED_FIELD", childPath)); // a ref must be an opaque 16-hex id, not raw content
      }
      out.push(...findProhibitedFields(v, childPath));
    }
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => out.push(...findProhibitedFields(v, `${path}[${i}]`)));
  } else if (typeof value === "string") {
    if (URL_OR_ABS_PATH.test(value)) out.push(err("PROHIBITED_FIELD", path));
  }
  return out;
}

/** Pure: are two Action Window protocol versions compatible? v1 is a single major — exact match. */
export function isActionWindowProtocolCompatible(a: number, b: number): boolean {
  return Number.isInteger(a) && a === b;
}

function checkEnvelopeCommon(obj: Record<string, unknown>): ValidationError[] {
  const e: ValidationError[] = [];
  if (typeof obj.protocolVersion !== "number") {
    e.push(err("MISSING_FIELD", "$.protocolVersion"));
  } else if (!isActionWindowProtocolCompatible(obj.protocolVersion, ACTION_WINDOW_PROTOCOL_VERSION)) {
    e.push(err("UNSUPPORTED_PROTOCOL_VERSION", "$.protocolVersion")); // fail closed on unknown versions
  }
  if (typeof obj.runId !== "string" || obj.runId.length === 0) e.push(err("MISSING_FIELD", "$.runId"));
  return e;
}

const COMMAND_PAYLOAD_REQUIRED: Partial<Record<CommandType, (p: Record<string, unknown>) => ValidationError[]>> = {
  START_RUN: (p) => (typeof p.channel === "string" && p.channel.length > 0 ? [] : [err("MISSING_FIELD", "$.payload.channel")]),
  SET_GUIDANCE_ENABLED: (p) => (typeof p.enabled === "boolean" ? [] : [err("MISSING_FIELD", "$.payload.enabled")]),
};

export function validateCommandEnvelope(input: unknown): ValidationResult {
  if (!isRecord(input)) return { ok: false, errors: [err("WRONG_TYPE", "$")] };
  const e = checkEnvelopeCommon(input);
  if (typeof input.commandId !== "string" || input.commandId.length === 0) e.push(err("MISSING_FIELD", "$.commandId"));
  if (!Number.isInteger(input.expectedRevision)) e.push(err("MISSING_FIELD", "$.expectedRevision"));
  if (typeof input.type !== "string" || !(COMMAND_TYPES as readonly string[]).includes(input.type)) {
    e.push(err("UNKNOWN_ENUM", "$.type"));
  } else {
    const need = COMMAND_PAYLOAD_REQUIRED[input.type as CommandType];
    if (need) e.push(...need(isRecord(input.payload) ? input.payload : {}));
  }
  e.push(...findProhibitedFields(input));
  return e.length ? { ok: false, errors: e } : { ok: true };
}

/** Required payload keys per event type + their enum/type checks. */
const EVENT_PAYLOAD_RULES: Record<EventType, (p: Record<string, unknown>) => ValidationError[]> = {
  RUN_STARTED: (p) => enumField(p, "status", RUN_STATUSES),
  RUN_STATUS_CHANGED: (p) => enumField(p, "status", RUN_STATUSES),
  STEP_READY: (p) => [...stringField(p, "stepId"), ...enumField(p, "stepStatus", STEP_STATUSES)],
  HUMAN_ACTION_REQUIRED: (p) => stringField(p, "stepId"),
  TARGET_HIGHLIGHTED: (p) => [...stringField(p, "stepId"), ...refField(p, "targetRef")],
  USER_ACTION_OBSERVED: (p) => [...stringField(p, "stepId"), ...boolField(p, "observed")],
  DOWNLOAD_DETECTED: (p) => [...stringField(p, "stepId"), ...refField(p, "artifactRef")],
  STEP_COMPLETED: (p) => stringField(p, "stepId"),
  RUN_BLOCKED: (p) => [...enumField(p, "code", BLOCKER_CODES), ...boolField(p, "recoverable")],
  RUN_COMPLETED: (p) => (p.status === "COMPLETED" ? [] : [err("CONSTRAINT_VIOLATION", "$.payload.status")]),
  RUN_FAILED: (p) => (p.code === undefined ? [] : enumField(p, "code", BLOCKER_CODES)),
};

function enumField(p: Record<string, unknown>, key: string, allowed: readonly string[]): ValidationError[] {
  if (p[key] === undefined) return [err("MISSING_FIELD", `$.payload.${key}`)];
  return allowed.includes(p[key] as string) ? [] : [err("UNKNOWN_ENUM", `$.payload.${key}`)];
}
function stringField(p: Record<string, unknown>, key: string): ValidationError[] {
  return typeof p[key] === "string" && (p[key] as string).length > 0 ? [] : [err("MISSING_FIELD", `$.payload.${key}`)];
}
function boolField(p: Record<string, unknown>, key: string): ValidationError[] {
  return typeof p[key] === "boolean" ? [] : [err("MISSING_FIELD", `$.payload.${key}`)];
}
function refField(p: Record<string, unknown>, key: string): ValidationError[] {
  return typeof p[key] === "string" && HEX16.test(p[key] as string) ? [] : [err("CONSTRAINT_VIOLATION", `$.payload.${key}`)];
}

export function validateEventEnvelope(input: unknown): ValidationResult {
  if (!isRecord(input)) return { ok: false, errors: [err("WRONG_TYPE", "$")] };
  const e = checkEnvelopeCommon(input);
  if (typeof input.eventId !== "string" || input.eventId.length === 0) e.push(err("MISSING_FIELD", "$.eventId"));
  if (!Number.isInteger(input.sequence) || (input.sequence as number) < 0) e.push(err("CONSTRAINT_VIOLATION", "$.sequence"));
  if (!Number.isInteger(input.revision) || (input.revision as number) < 0) e.push(err("CONSTRAINT_VIOLATION", "$.revision"));
  if (typeof input.occurredAt !== "string" || !ISO_LIKE.test(input.occurredAt)) e.push(err("WRONG_TYPE", "$.occurredAt"));
  if (typeof input.type !== "string" || !(EVENT_TYPES as readonly string[]).includes(input.type)) {
    e.push(err("UNKNOWN_ENUM", "$.type"));
  } else {
    const payload = isRecord(input.payload) ? input.payload : {};
    if (!isRecord(input.payload)) e.push(err("MISSING_FIELD", "$.payload"));
    e.push(...EVENT_PAYLOAD_RULES[input.type as EventType](payload));
  }
  e.push(...findProhibitedFields(input));
  return e.length ? { ok: false, errors: e } : { ok: true };
}

export function validateRunView(input: unknown): ValidationResult {
  if (!isRecord(input)) return { ok: false, errors: [err("WRONG_TYPE", "$")] };
  const e = checkEnvelopeCommon(input);
  if (!Number.isInteger(input.revision)) e.push(err("MISSING_FIELD", "$.revision"));
  for (const k of ["channel", "title", "updatedAt"]) {
    if (typeof input[k] !== "string" || (input[k] as string).length === 0) e.push(err("MISSING_FIELD", `$.${k}`));
  }
  if (!(RUN_STATUSES as readonly string[]).includes(input.status as string)) e.push(err("UNKNOWN_ENUM", "$.status"));
  if (!(EXECUTION_MODES as readonly string[]).includes(input.executionMode as string)) e.push(err("UNKNOWN_ENUM", "$.executionMode"));
  if (typeof input.guidanceEnabled !== "boolean") e.push(err("MISSING_FIELD", "$.guidanceEnabled"));

  // allowedCommands ⊆ COMMAND_TYPES
  if (!Array.isArray(input.allowedCommands)) {
    e.push(err("MISSING_FIELD", "$.allowedCommands"));
  } else if (!input.allowedCommands.every((c) => (COMMAND_TYPES as readonly string[]).includes(c as string))) {
    e.push(err("UNKNOWN_ENUM", "$.allowedCommands"));
  }

  // progress
  const progress = isRecord(input.progress) ? input.progress : undefined;
  if (!progress || !Number.isInteger(progress.completedSteps) || !Number.isInteger(progress.totalSteps)) {
    e.push(err("MISSING_FIELD", "$.progress"));
  } else if ((progress.completedSteps as number) > (progress.totalSteps as number)) {
    e.push(err("CONSTRAINT_VIOLATION", "$.progress.completedSteps"));
  }

  // currentStep
  const step = isRecord(input.currentStep) ? input.currentStep : undefined;
  if (step) {
    if (typeof step.stepId !== "string" || step.stepId.length === 0) e.push(err("MISSING_FIELD", "$.currentStep.stepId"));
    if (!Number.isInteger(step.stepNumber) || (step.stepNumber as number) < 1) e.push(err("CONSTRAINT_VIOLATION", "$.currentStep.stepNumber"));
    if (!Number.isInteger(step.totalSteps)) e.push(err("MISSING_FIELD", "$.currentStep.totalSteps"));
    if (typeof step.title !== "string" || step.title.length === 0) e.push(err("MISSING_FIELD", "$.currentStep.title"));
    if (!(STEP_STATUSES as readonly string[]).includes(step.status as string)) e.push(err("UNKNOWN_ENUM", "$.currentStep.status"));
    if (progress && Number.isInteger(step.totalSteps) && (step.totalSteps as number) !== (progress.totalSteps as number)) {
      e.push(err("CONSTRAINT_VIOLATION", "$.currentStep.totalSteps")); // must agree with progress.totalSteps
    }
    if (Number.isInteger(step.stepNumber) && Number.isInteger(step.totalSteps) && (step.stepNumber as number) > (step.totalSteps as number)) {
      e.push(err("CONSTRAINT_VIOLATION", "$.currentStep.stepNumber"));
    }
  }

  // blocker
  const blocker = isRecord(input.blocker) ? input.blocker : undefined;
  if (input.blocker !== undefined && !blocker) e.push(err("WRONG_TYPE", "$.blocker"));
  if (blocker) {
    if (!(BLOCKER_CODES as readonly string[]).includes(blocker.code as string)) e.push(err("UNKNOWN_ENUM", "$.blocker.code"));
    if (typeof blocker.recoverable !== "boolean") e.push(err("MISSING_FIELD", "$.blocker.recoverable"));
  }

  // cross-field semantics
  if (input.status === "COMPLETED" && blocker) e.push(err("CONSTRAINT_VIOLATION", "$.blocker")); // COMPLETED cannot expose an active blocker
  if (input.status === "WAITING_FOR_HUMAN") {
    const hasHumanContext = input.executionMode === "HUMAN_ACTION" && step?.status === "AWAITING_USER";
    if (!hasHumanContext) e.push(err("CONSTRAINT_VIOLATION", "$.status")); // WAITING_FOR_HUMAN requires a human-action context
  }

  e.push(...findProhibitedFields(input));
  return e.length ? { ok: false, errors: e } : { ok: true };
}

/* ────────────────────────────── Idempotency & ordering helpers ────────────────────────────── */

/** A command whose expectedRevision is behind the current aggregate revision is stale ⇒ reject. */
export function isStaleCommand(expectedRevision: number, currentRevision: number): boolean {
  return expectedRevision < currentRevision;
}
/** Replaying a commandId already applied is a no-op (idempotent). */
export function isDuplicateCommand(commandId: string, applied: ReadonlySet<string>): boolean {
  return applied.has(commandId);
}
/** Duplicate event by id ⇒ ignorable. */
export function isDuplicateEvent(eventId: string, seen: ReadonlySet<string>): boolean {
  return seen.has(eventId);
}
/** Within a Run, sequence must strictly increase; anything ≤ last seen is out of order / duplicate. */
export function isOutOfOrderEvent(sequence: number, lastSequence: number): boolean {
  return sequence <= lastSequence;
}
