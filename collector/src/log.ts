/**
 * Metadata-only logger. The collector must never log secrets (tokens, cookies,
 * passwords) or raw payloads (review bodies, full HTTP bodies). `safeMeta` drops
 * secret-ish keys and collapses non-scalar values to a type tag, so a careless
 * caller cannot leak a body or a token value through the log. An in-memory sink
 * lets tests assert this discipline.
 */

const FORBIDDEN_KEY_SUBSTRINGS = [
  "token",
  "password",
  "passwd",
  "cookie",
  "authorization",
  "secret",
  "credential",
  "session",
];

export interface LogEntry {
  ts: string;
  level: string;
  event: string;
  meta: Record<string, unknown>;
}

const sink: LogEntry[] = [];

export function getLogSink(): readonly LogEntry[] {
  return sink;
}

export function clearLogSink(): void {
  sink.length = 0;
}

/** Keep only scalar values under non-secret keys. */
export function safeMeta(meta: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    const lower = key.toLowerCase();
    if (FORBIDDEN_KEY_SUBSTRINGS.some((f) => lower.includes(f))) continue;
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
      out[key] = value;
    } else {
      out[key] = `[${typeof value}]`;
    }
  }
  return out;
}

export function log(
  event: string,
  meta: Record<string, unknown> = {},
  level: "info" | "warn" | "error" = "info",
): void {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    event,
    meta: safeMeta(meta),
  };
  sink.push(entry);
  // eslint-disable-next-line no-console
  console.log(`[${entry.ts}] ${level} ${event} ${JSON.stringify(entry.meta)}`);
}
