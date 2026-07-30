/**
 * Metadata-only logger for the agent runtime, modelled on the collector's `log.ts`.
 *
 * The orchestration layer handles seller-owned inquiry content (title / body / reply
 * comments) in memory. That content must never reach a log line. `safeMeta` enforces
 * this two ways: it drops any key whose name looks secret-ish or content-ish, and it
 * collapses every non-scalar to a bare type tag so a nested object can't smuggle a
 * field through. Callers are still expected to pass only sanitized fields (enums,
 * booleans, counts, ids) — this is defence in depth, and the no-leak sweep in the
 * tests pins it.
 */

/** Keys we never log the value of — secrets and free-text content alike. */
const FORBIDDEN_KEY = /token|password|cookie|authorization|secret|credential|session|title|comment|body|details|author|snippet|email|phone|address|order|payload|text|content|candidate|draft|proposal/i;

export interface LogRecord {
  readonly ts: string;
  readonly event: string;
  readonly meta: Record<string, unknown>;
}

let sink: LogRecord[] | null = null;

/** Start capturing log records in memory (tests). Returns the live array. */
export function getLogSink(): LogRecord[] {
  if (!sink) sink = [];
  return sink;
}

/** Stop capturing and clear (tests). */
export function clearLogSink(): void {
  sink = null;
}

/** A scalar is safe to log verbatim; everything else collapses to a type tag. */
function isScalar(v: unknown): v is string | number | boolean {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

/** Drop forbidden keys, collapse non-scalars. Never throws. */
export function safeMeta(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (FORBIDDEN_KEY.test(k)) continue;
    out[k] = isScalar(v) ? v : `<${Array.isArray(v) ? "array" : typeof v}>`;
  }
  return out;
}

/** Emit one sanitized record. Goes to the in-memory sink when capturing, else stdout. */
export function log(event: string, meta: Record<string, unknown> = {}): void {
  const record: LogRecord = { ts: new Date().toISOString(), event, meta: safeMeta(meta) };
  if (sink) {
    sink.push(record);
    return;
  }
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(record));
}
