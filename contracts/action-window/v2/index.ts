/**
 * **Action Window protocol — v2 (normative TypeScript surface).**
 *
 * A **side-by-side successor to v1**, added to admit ONE new capability: a guided, human-performed
 * review-reply **submission** (a marketplace-mutating action). v1 (`../v1`) is left untouched and all
 * persisted v1 export runs stay valid v1 records — there is no in-place edit and no migration. Export
 * continues on v1; reply-submission runs are v2 from birth. A consumer negotiates the contract version
 * per run.
 *
 * **What v2 adds on top of v1 (everything else is identical):**
 *  - a `REPLY_SUBMISSION` run intent + an opaque `submissionRef` on `START_RUN` (binds the run to an
 *    approved reply without ever carrying the reply text);
 *  - the two `INITIAL_REVIEW_IMPORT_*` intents (onboarding historical backfill) + their opaque
 *    `discoveryRef` / `importRef` bindings. These are read-only export choreography — the seller
 *    clicks every marketplace control and the run reaches the ordinary `COMPLETED` terminal — so they
 *    add no status. Their bindings resolve **server-side** to a seller account, plan, and segment, so
 *    no plan id, segment id, or date ever crosses this boundary; the required dates reach the seller
 *    as sanitized primitive `copyParams` under an FE-owned copy key, like any other step copy;
 *  - a terminal `OPERATOR_REPORTED` run/step status (a reply post has NO read-back verifier, so it can
 *    never reach `COMPLETED` — see `docs/action-window-runtime/contract-boundary.md` §2);
 *  - a `SUBMISSION_REPORTED` event + `RUN_OPERATOR_REPORTED` terminal event, both carrying **two
 *    separate fields** — `operatorOutcome` (what the operator reports) and `verification` (always
 *    `UNVERIFIED`; a `VERIFIED` value is reserved but unreachable without a read-back oracle).
 *
 * **The Runtime still never types or submits** — the seller submits; the Runtime highlights and
 * observes only. `SUBMISSION_ABORTED` is an operator *outcome*, not a runtime blocker.
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
 * **Copy ownership (README §6).** Runtime supplies semantic identifiers only — a sanitized
 * `channelCode`, dotted semantic copy keys (`runCopyKey` / step `copyKey`), and sanitized
 * *primitive* copy params. FE owns ALL final end-user copy and localization. Runtime never sends
 * final prose (`title`/`instruction`/`message`).
 *
 * **Privacy invariant (README §6).** Every value that crosses this boundary is an enum, a boolean,
 * a count, an opaque id, a semantic code, or a dotted copy key + sanitized primitive params. Never
 * final end-user prose, a selector, arbitrary page text, raw account/connection id, frame/page URL,
 * CDP target id, local absolute path, credential, token, cookie, session content, or downloaded
 * review content.
 */

export const ACTION_WINDOW_PROTOCOL_VERSION = 2;

/* ────────────────────────────── Normative enums ────────────────────────────── */

/**
 * Persisted Run status. `IDLE` is intentionally absent — it is a UI-only scenario (no active Run).
 * `OPERATOR_REPORTED` (v2) is the honest terminal for a guided reply submission: the operator reports
 * they acted, and there is no verifier, so it is distinct from `COMPLETED` and never claims completion.
 */
export const RUN_STATUSES = [
  "PREPARING",
  "RUNNING",
  "WAITING_FOR_HUMAN",
  "PAUSED",
  "PROCESSING",
  "COMPLETED",
  "OPERATOR_REPORTED",
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
  "OPERATOR_REPORTED",
  "FAILED",
  "SKIPPED",
] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

export const EXECUTION_MODES = ["AUTOMATIC_OPERATION", "ACTION_WINDOW", "FILE_IMPORT", "INTEGRATION_PENDING"] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];

/**
 * Run intent (v2). Selects the step plan. `EXPORT` is the v1 read chain; `REPLY_SUBMISSION` is the
 * guided, human-performed reply-post. Absent intent on `START_RUN` means `EXPORT` (v1-compatible).
 *
 * The two `INITIAL_REVIEW_IMPORT_*` intents are the onboarding historical backfill, split in two
 * because the first command has **no plan yet**:
 *  - `INITIAL_REVIEW_IMPORT_DISCOVERY` — find the historical range NAVER currently lets this seller
 *    reach, so the plan can be built from what is actually available rather than a guessed period. It
 *    carries a `discoveryRef` (no plan/segment exists to bind to).
 *  - `INITIAL_REVIEW_IMPORT_SEGMENT` — guide ONE already-planned monthly segment to a downloaded,
 *    ingested file. It carries an `importRef` bound server-side to that segment.
 *
 * Both are read-only export choreography — the seller clicks every marketplace control — so they reach
 * the ordinary `COMPLETED` terminal, unlike `REPLY_SUBMISSION`.
 */
export const RUN_INTENTS = [
  "EXPORT",
  "REPLY_SUBMISSION",
  "INITIAL_REVIEW_IMPORT_DISCOVERY",
  "INITIAL_REVIEW_IMPORT_SEGMENT",
] as const;
export type RunIntent = (typeof RUN_INTENTS)[number];

/**
 * Which opaque ref each intent MUST carry on `START_RUN` — and, by exclusion, which it must NOT.
 *
 * <p>One table instead of a per-intent branch: every ref is single-purpose (a `submissionRef` on an
 * import run, or an `importRef` on a reply run, is a wiring bug that would bind a run to the wrong
 * approved work), so "required for exactly this intent, prohibited for every other" is the rule for
 * all of them and is stated once. `EXPORT` maps to no ref — it binds to nothing.
 */
export const INTENT_REQUIRED_REF: Readonly<Record<RunIntent, "submissionRef" | "discoveryRef" | "importRef" | null>> = {
  EXPORT: null,
  REPLY_SUBMISSION: "submissionRef",
  INITIAL_REVIEW_IMPORT_DISCOVERY: "discoveryRef",
  INITIAL_REVIEW_IMPORT_SEGMENT: "importRef",
};

/** Every binding ref a `START_RUN` payload may carry (exactly one, chosen by intent). */
export const START_RUN_REF_KEYS = ["submissionRef", "discoveryRef", "importRef"] as const;

/**
 * What the operator reports happened at the submit barrier (v2). Kept SEPARATE from `verification`.
 * `SUBMISSION_ABORTED` is an operator outcome — a deliberate, benign end — NOT a runtime blocker.
 */
export const OPERATOR_OUTCOMES = ["OPERATOR_REPORTED_SUBMITTED", "SUBMISSION_ABORTED"] as const;
export type OperatorOutcome = (typeof OPERATOR_OUTCOMES)[number];

/**
 * What SellerOps actually confirmed (v2). Only `UNVERIFIED` is reachable — a reply post has no
 * read-back oracle. A `VERIFIED` value is deliberately reserved but not present, so nothing can claim
 * a verification that cannot happen.
 */
export const VERIFICATION_STATES = ["UNVERIFIED"] as const;
export type VerificationState = (typeof VERIFICATION_STATES)[number];

/**
 * Why a run stopped.
 *
 * <p>The last two are import-run additions, and both close a real hole rather than adding vocabulary:
 *
 * <ul>
 *   <li><b>{@code SCOPE_MISMATCH}</b> — the seller's selected date range does not agree with the segment
 *       being imported, so the run stops BEFORE the export control is highlighted. It needs its own code
 *       because the repair is specific: change the dates. Reported as {@code UNSUPPORTED_STATE} it would
 *       read as "this screen is not supported" and send the seller looking for the wrong thing, and
 *       reported as nothing at all it would let a file covering the wrong window be ingested as though it
 *       covered this segment. Recoverable — fixing the dates and re-checking is the normal repair, not a
 *       failed run.</li>
 *   <li><b>{@code INGEST_FAILED}</b> — present in v1 and deliberately absent from v2 until now, because
 *       v2 existed only for reply submission, which has nothing to ingest. An import run DOES ingest, so
 *       its terminal failure mode has to be expressible. Without it an ingest failure would have to
 *       masquerade as {@code ARTIFACT_INVALID} — blaming the seller's file for a server-side problem.</li>
 * </ul>
 */
export const BLOCKER_CODES = [
  "LOGIN_REQUIRED",
  "UI_DRIFT",
  "TARGET_NOT_FOUND",
  "TARGET_AMBIGUOUS",
  "SESSION_EXPIRED",
  "UNSUPPORTED_STATE",
  "DOWNLOAD_TIMEOUT",
  "ARTIFACT_INVALID",
  "SCOPE_MISMATCH",
  "INGEST_FAILED",
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
  "SUBMISSION_REPORTED",
  "RUN_BLOCKED",
  "RUN_COMPLETED",
  "RUN_OPERATOR_REPORTED",
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
  // START_RUN — exactly one binding ref, selected by intent (see INTENT_REQUIRED_REF).
  | { channelCode: string; intent?: RunIntent; submissionRef?: string; discoveryRef?: string; importRef?: string }
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
  /** v2: what the operator reports at the submit barrier (kept separate from `verification`). */
  operatorOutcome?: OperatorOutcome;
  /** v2: what SellerOps confirmed — always `UNVERIFIED` for a reply post (no read-back). */
  verification?: VerificationState;
  /** v2: opaque 16-hex binding to an approved reply — NEVER the reply text or a review id. */
  submissionRef?: string;
  /** v2: opaque 16-hex binding to a range-discovery ticket — NEVER an account id or a date. */
  discoveryRef?: string;
  /** v2: opaque 16-hex binding to one planned import segment — NEVER a plan/segment id or a date. */
  importRef?: string;
}

/** Primitive, interpolation-safe copy parameter value (FE owns final copy). */
export type CopyParamValue = string | number | boolean;
export type CopyParams = Record<string, CopyParamValue>;

export interface ActionWindowRunView {
  protocolVersion: number;
  runId: string;
  revision: number;

  /** Sanitized stable channel identity (e.g. `esm_plus`), never a user-facing title. */
  channelCode: string;
  /** Dotted semantic copy key for the run headline; FE maps it to localized copy. */
  runCopyKey: string;
  runCopyParams?: CopyParams;

  status: RunStatus;
  executionMode: ExecutionMode;
  /** v2: the run's intent. Absent ⇒ EXPORT (v1-compatible). REPLY_SUBMISSION drives the guided post. */
  intent?: RunIntent;

  currentStep?: {
    stepId: string;
    stepNumber: number; // 1-based
    totalSteps: number;
    /** Dotted semantic copy key for the step; FE maps it to localized copy. */
    copyKey: string;
    copyParams?: CopyParams;
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
  // Runtime-authored end-user prose — FE owns all copy (localize via copy keys).
  "title",
  "instruction",
  "message",
  "html",
  "displayText",
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

const REF_KEYS: readonly string[] = ["targetRef", "artifactRef", "submissionRef", "discoveryRef", "importRef"];
const HEX16 = /^[0-9a-f]{16}$/;
/** A dotted semantic copy key (e.g. `actionWindow.review.ready`) — never final prose. */
const COPY_KEY = /^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+$/;
/** A sanitized semantic code (channelCode) — an opaque token, never a user-facing title. */
const SEMANTIC_CODE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
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

/** Copy params are a flat bag of sanitized primitives (FE interpolates them). No prose objects, no markup. */
function checkCopyParams(v: unknown, path: string): ValidationError[] {
  if (v === undefined) return [];
  if (!isRecord(v)) return [err("WRONG_TYPE", path)];
  const out: ValidationError[] = [];
  for (const [k, val] of Object.entries(v)) {
    const t = typeof val;
    if (t !== "string" && t !== "number" && t !== "boolean") {
      out.push(err("CONSTRAINT_VIOLATION", `${path}.${k}`));
    } else if (t === "string" && /[<>]/.test(val as string)) {
      out.push(err("PROHIBITED_FIELD", `${path}.${k}`)); // no markup in copy params
    }
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
  START_RUN: (p) => {
    const e: ValidationError[] = [];
    if (!(typeof p.channelCode === "string" && SEMANTIC_CODE.test(p.channelCode))) e.push(err("MISSING_FIELD", "$.payload.channelCode"));
    // intent is optional (absent ⇒ EXPORT); when present it must be a known intent.
    const known = p.intent === undefined || (RUN_INTENTS as readonly string[]).includes(p.intent as string);
    if (!known) e.push(err("UNKNOWN_ENUM", "$.payload.intent"));
    // Exactly one binding ref, chosen by intent: the one this intent requires must be a clean opaque
    // ref, and EVERY other ref must be absent. An unknown intent requires none, so all refs are
    // prohibited — a rejected intent can never smuggle a binding through.
    const required = known && p.intent !== undefined ? INTENT_REQUIRED_REF[p.intent as RunIntent] : null;
    for (const key of START_RUN_REF_KEYS) {
      if (key === required) {
        if (!(typeof p[key] === "string" && HEX16.test(p[key] as string))) e.push(err("CONSTRAINT_VIOLATION", `$.payload.${key}`));
      } else if (p[key] !== undefined) {
        e.push(err("CONSTRAINT_VIOLATION", `$.payload.${key}`)); // a ref belongs to exactly one intent
      }
    }
    return e;
  },
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
  // v2: the operator reports the outcome; verification is a SEPARATE, always-present field.
  SUBMISSION_REPORTED: (p) => [
    ...stringField(p, "stepId"),
    ...enumField(p, "operatorOutcome", OPERATOR_OUTCOMES),
    ...enumField(p, "verification", VERIFICATION_STATES),
  ],
  RUN_BLOCKED: (p) => [...enumField(p, "code", BLOCKER_CODES), ...boolField(p, "recoverable")],
  RUN_COMPLETED: (p) => (p.status === "COMPLETED" ? [] : [err("CONSTRAINT_VIOLATION", "$.payload.status")]),
  // v2: honest terminal — status is OPERATOR_REPORTED (never COMPLETED), with outcome + verification.
  RUN_OPERATOR_REPORTED: (p) => [
    ...(p.status === "OPERATOR_REPORTED" ? [] : [err("CONSTRAINT_VIOLATION", "$.payload.status")]),
    ...enumField(p, "operatorOutcome", OPERATOR_OUTCOMES),
    ...enumField(p, "verification", VERIFICATION_STATES),
  ],
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
  if (typeof input.updatedAt !== "string" || (input.updatedAt as string).length === 0) e.push(err("MISSING_FIELD", "$.updatedAt"));
  // Runtime supplies a sanitized channel CODE + a dotted copy KEY, never a user-facing title.
  if (typeof input.channelCode !== "string" || (input.channelCode as string).length === 0) {
    e.push(err("MISSING_FIELD", "$.channelCode"));
  } else if (!SEMANTIC_CODE.test(input.channelCode as string)) {
    e.push(err("CONSTRAINT_VIOLATION", "$.channelCode"));
  }
  if (typeof input.runCopyKey !== "string" || (input.runCopyKey as string).length === 0) {
    e.push(err("MISSING_FIELD", "$.runCopyKey"));
  } else if (!COPY_KEY.test(input.runCopyKey as string)) {
    e.push(err("CONSTRAINT_VIOLATION", "$.runCopyKey"));
  }
  e.push(...checkCopyParams(input.runCopyParams, "$.runCopyParams"));
  if (!(RUN_STATUSES as readonly string[]).includes(input.status as string)) e.push(err("UNKNOWN_ENUM", "$.status"));
  if (!(EXECUTION_MODES as readonly string[]).includes(input.executionMode as string)) e.push(err("UNKNOWN_ENUM", "$.executionMode"));
  if (input.intent !== undefined && !(RUN_INTENTS as readonly string[]).includes(input.intent as string)) e.push(err("UNKNOWN_ENUM", "$.intent"));
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
    if (typeof step.copyKey !== "string" || step.copyKey.length === 0) {
      e.push(err("MISSING_FIELD", "$.currentStep.copyKey"));
    } else if (!COPY_KEY.test(step.copyKey as string)) {
      e.push(err("CONSTRAINT_VIOLATION", "$.currentStep.copyKey"));
    }
    e.push(...checkCopyParams(step.copyParams, "$.currentStep.copyParams"));
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
  if (input.status === "OPERATOR_REPORTED" && blocker) e.push(err("CONSTRAINT_VIOLATION", "$.blocker")); // a reported terminal is not a blocked run
  if (input.status === "WAITING_FOR_HUMAN") {
    const hasHumanContext = input.executionMode === "ACTION_WINDOW" && step?.status === "AWAITING_USER";
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
