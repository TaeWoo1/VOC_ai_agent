import { dirname, resolve } from "node:path";

/**
 * Pure helper for the `probe-same-session` continuation sentinel.
 *
 * The probe can't rely on a terminal Enter keypress (the Bash tool's stdin does not
 * reliably deliver it), so it waits for a SENTINEL FILE instead. This module is the single
 * source of truth for that file's path: the probe derives it (to clear, poll, and clean
 * up) and the operator-facing "ready" command derives the same path (to create it). Pure
 * and import-safe — it launches nothing — so it can be unit-tested without triggering the
 * CLI's `void main()`.
 */

/** Fixed sentinel filename. No run-id: the probe runs exactly once at a time. */
export const SENTINEL_FILENAME = "probe-same-session.ready";

/**
 * Resolve the absolute sentinel path next to the collector's status file, so it lands in
 * the same `.status/` directory the rest of the live layer uses (and honours a
 * `COLLECTOR_STATUS_FILE` override). Pass `cfg.statusFile`.
 */
export function sentinelPathFor(statusFile: string): string {
  return resolve(dirname(resolve(statusFile)), SENTINEL_FILENAME);
}
