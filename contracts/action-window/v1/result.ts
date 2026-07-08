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
