/**
 * **Pilot runtime — sanitized diagnostics export.**
 *
 * When a pilot seller says "it isn't working", support needs facts — but a diagnostics bundle a seller emails
 * out is the single highest-risk export the agent produces: get it wrong and it carries a cookie, a token, a
 * store id, or a raw URL off the machine. So the bundle is assembled from already-sanitized inputs (enums,
 * booleans, coarse counts, and the metadata-only log sink), and every string that survives is passed through
 * a defensive redactor that blanks anything shaped like a URL, a filesystem path, or a long token — even
 * though the logging contract already forbids those, because a diagnostics export is exactly where a single
 * leaked value does the most damage.
 *
 * The builder is pure (every fact is an input); the writer is a thin, separate fs step. Nothing here is
 * logged — a diagnostics file's path is shown to the seller on their own machine, never emitted to the wire.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { safeMeta, type LogEntry } from "../log";

/** The bundle schema id — versioned so a future support tool can read older exports. */
export const DIAGNOSTICS_SCHEMA = "sellerops-agent-diagnostics/v1";

/** Facts the caller gathers (all already sanitized). No raw identity, path, token, cookie, or URL. */
export interface DiagnosticInput {
  /** ISO timestamp for the export. */
  readonly now: string;
  readonly agent: { readonly version: string; readonly protocolVersion: number; readonly platform: string };
  readonly selfCheck: { readonly ok: boolean; readonly issues: readonly string[] };
  readonly lifecycle: { readonly lockRecovered: boolean; readonly ownedProcessCount: number };
  /** Bridge facts: the port is a non-secret local number; `paired` is a boolean, never a token. */
  readonly bridge: {
    readonly bound: boolean;
    readonly port: number;
    readonly originsConfigured: number;
    readonly paired: boolean;
  };
  /** The metadata-only log sink (already safeMeta'd). Capped + re-sanitized + redacted here. */
  readonly logTail: readonly LogEntry[];
  /** How many recent log entries to include (default 200). */
  readonly maxLogEntries?: number;
}

const DEFAULT_MAX_LOG_ENTRIES = 200;

/**
 * Defensive redaction for a surviving STRING value: blank anything shaped like a URL, an absolute filesystem
 * path (POSIX or Windows), or a long hex/base token run. The logging contract already keeps these out, so
 * this normally changes nothing — it is the last line before a value leaves the machine.
 */
export function redactSensitive(value: string): string {
  if (/https?:\/\//i.test(value)) return "[redacted-url]";
  // A JWT (three base64url segments) — before the generic token rule so it is labelled precisely.
  if (/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(value)) return "[redacted-token]";
  // Windows path anywhere in the string (not just anchored), plus UNC.
  if (/[A-Za-z]:\\/.test(value) || /\\\\/.test(value)) return "[redacted-path]";
  // POSIX absolute path — allowed to be preceded by whitespace or a delimiter (`=`, `:`, `(`, quotes).
  if (/(^|[\s=:("'])\/[^\s]+\/[^\s]+/.test(value)) return "[redacted-path]";
  // Long hex OR a long base64/token-shaped run (mixed alnum with url-safe chars) — cookies, opaque tokens.
  if (/[A-Fa-f0-9]{32,}/.test(value) || /[A-Za-z0-9_+/=-]{40,}/.test(value)) return "[redacted-token]";
  return value;
}

/** Re-sanitize one log entry's meta and redact its string values (defense-in-depth over the log sink). */
function scrubEntry(entry: LogEntry): LogEntry {
  const meta = safeMeta(entry.meta);
  const scrubbed: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    scrubbed[k] = typeof v === "string" ? redactSensitive(v) : v;
  }
  return { ts: entry.ts, level: entry.level, event: entry.event, meta: scrubbed };
}

/** The sanitized bundle, ready to serialize. Contains only enums/booleans/counts + a scrubbed log tail. */
export interface DiagnosticBundle {
  readonly schema: string;
  readonly generatedAt: string;
  readonly agent: DiagnosticInput["agent"];
  readonly selfCheck: DiagnosticInput["selfCheck"];
  readonly lifecycle: DiagnosticInput["lifecycle"];
  readonly bridge: DiagnosticInput["bridge"];
  readonly logTail: readonly LogEntry[];
}

/** Build the sanitized diagnostic bundle (pure). Caps the log tail to the most recent `maxLogEntries`. */
export function buildDiagnosticBundle(input: DiagnosticInput): DiagnosticBundle {
  const max = input.maxLogEntries ?? DEFAULT_MAX_LOG_ENTRIES;
  const tail = input.logTail.slice(-Math.max(0, max)).map(scrubEntry);
  return {
    schema: DIAGNOSTICS_SCHEMA,
    generatedAt: input.now,
    agent: input.agent,
    selfCheck: input.selfCheck,
    lifecycle: input.lifecycle,
    bridge: input.bridge,
    logTail: tail,
  };
}

/**
 * Turn an ISO timestamp into a filesystem-safe stamp (`2026-07-28T01-02-03-004Z`) so the export filename never
 * carries a `:` (illegal on Windows) yet stays sortable.
 */
export function diagnosticFileName(now: string): string {
  return `diagnostics-${now.replace(/[:.]/g, "-")}.json`;
}

/** Write the bundle to `dir/diagnostics-<stamp>.json` and return the path (shown locally, never logged). */
export function writeDiagnosticExport(dir: string, bundle: DiagnosticBundle): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, diagnosticFileName(bundle.generatedAt));
  writeFileSync(path, JSON.stringify(bundle, null, 2), "utf8");
  return path;
}
