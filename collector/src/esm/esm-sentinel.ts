import { dirname, resolve } from "node:path";

/**
 * Pure helper for the ESM+ review no-click classifier's continuation sentinel.
 *
 * Like the NAVER probes, the ESM classifier can't rely on a terminal Enter keypress
 * (the Bash tool's stdin does not reliably deliver it), so it waits for a SENTINEL
 * FILE instead. This module is the single source of truth for that file's path: the
 * classifier derives it (to clear, poll, and clean up) and the operator-facing
 * "ready" signal creates the same path. Pure and import-safe — it launches nothing —
 * so it can be unit-tested without triggering any CLI's `void main()`.
 *
 * The filename is DISTINCT from the NAVER sentinel (`probe-same-session.ready`) so an
 * ESM classifier run can never be auto-continued by a stale NAVER sentinel, or
 * vice-versa.
 */

/** Fixed ESM sentinel filename. No run-id: the classifier runs exactly once at a time. */
export const ESM_SENTINEL_FILENAME = "classify-esm-review.ready";

/**
 * The operator's per-run "the requested marketplace tab is now selected" signal, DISTINCT from the
 * capture-ready sentinel so one can never satisfy the other. Created once by the operator after a
 * `MARKETPLACE_SELECTION_REQUIRED` prompt; the capture CLI consumes it once and re-inspects.
 */
export const ESM_MARKETPLACE_READY_FILENAME = "esm-marketplace-ready.ready";

/**
 * Resolve the absolute ESM sentinel path next to the collector's status file, so it
 * lands in the same `.status/` directory the rest of the live layer uses (and honours
 * a `COLLECTOR_STATUS_FILE` override). Pass `cfg.statusFile`.
 */
export function esmSentinelPathFor(statusFile: string): string {
  return resolve(dirname(resolve(statusFile)), ESM_SENTINEL_FILENAME);
}

/** The marketplace-ready signal path (same `.status/` dir as {@link esmSentinelPathFor}). */
export function esmMarketplaceReadyPathFor(statusFile: string): string {
  return resolve(dirname(resolve(statusFile)), ESM_MARKETPLACE_READY_FILENAME);
}
