// Shared validation primitives for the Action Window contract.
// Zero runtime dependencies; isomorphic (no Node/DOM globals). Written to satisfy
// both consumers' strict TS (frontend: noUnusedLocals/Parameters, lib ES2020;
// collector: noUncheckedIndexedAccess).

export type ValidationIssue = {
  /** dot/bracket path to the offending field, e.g. `currentStep.stepNumber`. */
  path: string;
  message: string;
};

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: ValidationIssue[] };

export function ok<T>(value: T): ParseResult<T> {
  return { ok: true, value };
}

export function fail<T>(issues: ValidationIssue[]): ParseResult<T> {
  return { ok: false, issues };
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function isString(v: unknown): v is string {
  return typeof v === "string";
}

export function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

export function isBoolean(v: unknown): v is boolean {
  return typeof v === "boolean";
}

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function isNonNegativeInteger(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

export function isPositiveInteger(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1;
}

/** Exhaustiveness guard — a missed union member becomes a compile error. */
export function assertNever(x: never): never {
  throw new Error(`Unexpected variant: ${String(x)}`);
}

// --- Copy-ownership & exact-schema primitives ------------------------------

/**
 * A stable semantic COPY KEY (e.g. `actionWindow.review.ready`) — a dotted
 * namespaced identifier, never a user-facing sentence. FE maps it to localized
 * product copy. The dotted-identifier shape lets FE safely distinguish a copy key
 * from final prose (which contains spaces / punctuation / non-identifier chars).
 */
export function isCopyKey(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+$/.test(v);
}

/**
 * A stable sanitized SEMANTIC CODE (channelCode / operationCode / stepCode) —
 * an opaque lowercase-ish token, never a user-facing title.
 */
export function isSemanticCode(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(v);
}

/** Primitive, interpolation-safe copy parameter value. */
export function isCopyParamValue(v: unknown): v is string | number | boolean {
  return typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v));
}

/**
 * Exact-schema guard: record any key not in `allowed` as an issue. Public
 * contract parsers fail closed on unknown fields rather than silently accepting
 * arbitrary extra properties (e.g. Runtime-authored `title` / `message` prose).
 */
export function rejectUnknownKeys(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  pathBase: string,
  issues: ValidationIssue[],
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      issues.push({
        path: pathBase ? `${pathBase}.${key}` : key,
        message: "unknown field (exact-schema, fail-closed)",
      });
    }
  }
}
