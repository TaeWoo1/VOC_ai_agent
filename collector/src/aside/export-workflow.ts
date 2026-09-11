/**
 * **A bounded export workflow — the closed vocabulary the Aside provider can execute.**
 *
 * This is deliberately NOT a browser-automation language. A workflow can open ONE entry page, refuse on
 * authentication signals, assert ONE store identity, run a short list of `FILL` / `SELECT` / `CLICK` /
 * `WAIT_FOR` steps, optionally read the selected range back, and click ONE export control whose download is
 * awaited. There is no `EVALUATE`, no `NAVIGATE`, no free-form script, no loop, no conditional. A NAVER
 * workflow (M3) is an instance of this shape; nothing NAVER-specific lives here (M2).
 *
 * Every action step is executed through the same fail-closed primitive (`export-runtime.ts`): the runtime
 * counts candidates first and acts only on exactly one. The workflow cannot ask for anything else.
 */
import type { ExecutionStage, ExecutionWorkflowRef } from "../action-window/initial-import/execution-provider";

export const EXPORT_STEP_KINDS = ["FILL", "SELECT", "CLICK", "WAIT_FOR"] as const;
export type ExportStepKind = (typeof EXPORT_STEP_KINDS)[number];

/** Values a `FILL`/`SELECT` step may carry: a literal, or one of the two required-window tokens. */
export const REQUIRED_START_TOKEN = "$REQUIRED_START" as const;
export const REQUIRED_END_TOKEN = "$REQUIRED_END" as const;

/** Which of the provider's coarse stages a step belongs to, for failure attribution. */
export type ExportStepStage = Extract<ExecutionStage, "NAVIGATE" | "SCOPE" | "EXPORT">;
export const EXPORT_STEP_STAGES: readonly ExportStepStage[] = ["NAVIGATE", "SCOPE", "EXPORT"];

export interface ExportStep {
  kind: ExportStepKind;
  /** A locator selector. Provider-local: never logged, never on the wire. */
  selector: string;
  /** Required for `FILL`/`SELECT`; forbidden for `CLICK`/`WAIT_FOR`. */
  value?: string;
  stage: ExportStepStage;
}

export interface ExportIdentityRead {
  selector: string;
  read: "TEXT" | "ATTRIBUTE";
  attribute?: string;
}

export interface ExportScopeReadback {
  /** Selector of the control holding the selected start date (read via `inputValue`). */
  start: string;
  end: string;
}

export interface ExportWorkflow {
  ref: ExecutionWorkflowRef;
  /** The one page this workflow opens. Provider-local: never logged. */
  entryUrl: string;
  /** Selectors whose presence (count > 0) means a person must authenticate first. */
  authSignals: readonly string[];
  /** Where the store identity is read from. Required: a workflow that asserts no identity can never succeed (PD-4). */
  identity: ExportIdentityRead;
  steps: readonly ExportStep[];
  /** When present, the runtime reads the selected range back and MATCH ⇒ `MACHINE_MATCHED`; absent ⇒ `OPERATOR_CONFIRMED`. */
  scopeReadback: ExportScopeReadback | null;
  /** The one control whose click produces the download. */
  exportSelector: string;
  downloadTimeoutMs: number;
  /** Bound for `WAIT_FOR` steps. */
  stepTimeoutMs: number;
}

export type WorkflowValidationError =
  | "REF_INVALID"
  | "ENTRY_URL_INVALID"
  | "IDENTITY_INVALID"
  | "STEP_KIND_UNKNOWN"
  | "STEP_SELECTOR_INVALID"
  | "STEP_VALUE_INVALID"
  | "STEP_STAGE_INVALID"
  | "EXPORT_SELECTOR_INVALID"
  | "READBACK_INVALID"
  | "TIMEOUT_INVALID";

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0 && !/[\r\n]/.test(v);
}

/**
 * Pure structural validation. A workflow that fails here is never sent to Aside. The checks are about SHAPE
 * (closed enums, non-empty selectors, values only where the kind takes one) — the runtime's own count-assert
 * decides whether a selector is usable on the actual page.
 */
export function validateExportWorkflow(w: ExportWorkflow): WorkflowValidationError[] {
  const errors: WorkflowValidationError[] = [];
  if (!w.ref || !nonEmptyString(w.ref.id) || !Number.isInteger(w.ref.version) || w.ref.version < 1) errors.push("REF_INVALID");
  if (!nonEmptyString(w.entryUrl) || !/^https?:\/\//.test(w.entryUrl)) errors.push("ENTRY_URL_INVALID");
  if (
    !w.identity ||
    !nonEmptyString(w.identity.selector) ||
    (w.identity.read !== "TEXT" && w.identity.read !== "ATTRIBUTE") ||
    (w.identity.read === "ATTRIBUTE" && !nonEmptyString(w.identity.attribute))
  ) {
    errors.push("IDENTITY_INVALID");
  }
  for (const step of w.steps ?? []) {
    if (!(EXPORT_STEP_KINDS as readonly string[]).includes(step.kind)) errors.push("STEP_KIND_UNKNOWN");
    if (!nonEmptyString(step.selector)) errors.push("STEP_SELECTOR_INVALID");
    const takesValue = step.kind === "FILL" || step.kind === "SELECT";
    if (takesValue ? typeof step.value !== "string" : step.value !== undefined) errors.push("STEP_VALUE_INVALID");
    if (!EXPORT_STEP_STAGES.includes(step.stage)) errors.push("STEP_STAGE_INVALID");
  }
  if (!nonEmptyString(w.exportSelector)) errors.push("EXPORT_SELECTOR_INVALID");
  if (w.scopeReadback !== null && (!nonEmptyString(w.scopeReadback?.start) || !nonEmptyString(w.scopeReadback?.end))) {
    errors.push("READBACK_INVALID");
  }
  if (!Number.isFinite(w.downloadTimeoutMs) || w.downloadTimeoutMs <= 0 || !Number.isFinite(w.stepTimeoutMs) || w.stepTimeoutMs <= 0) {
    errors.push("TIMEOUT_INVALID");
  }
  return errors;
}

/** Substitute the two required-window tokens. Literal values pass through untouched. */
export function resolveStepValue(value: string, required: { start: string; end: string }): string {
  if (value === REQUIRED_START_TOKEN) return required.start;
  if (value === REQUIRED_END_TOKEN) return required.end;
  return value;
}
