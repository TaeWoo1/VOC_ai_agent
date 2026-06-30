import { dirname, resolve } from "node:path";
import type { SessionVerdict } from "../naver/session-verdict";
import type { ExportScopeCategory } from "./esm-frame-scan";
import type { CountBucket, EsmExportLayoutHint } from "./esm-review-probe";
import type { DomSettleResult, SanitizedEsmReviewClassification } from "./esm-review-live-scan";

/**
 * Pure scheduling + row-shaping for the keep-open ESM session-TTL probe.
 *
 * The probe keeps ONE persistent context open and runs the SHARED no-click
 * classification at T0, then after each configured offset (default 120 and 190 minutes).
 * This module owns only the deterministic parts — checkpoint offsets, the per-checkpoint
 * sanitized row, and the run loop driven by an INJECTED `sleep` + an INJECTED `classifyAt`
 * — so the schedule is unit-tested with a fake sleep and canned classifications, with no
 * real timers and no browser. It emits sanitized buckets / categories / booleans only.
 */

/** A sanitized checkpoint row — the only shape the probe table ever shows. */
export interface TtlCheckpointRow {
  label: string;
  sessionVerdict: SessionVerdict;
  allowlistConfigured: boolean;
  domSettle: DomSettleResult;
  manageFeedbackRouteLike: boolean;
  hasActionableExportCandidate: boolean;
  actionableScope: ExportScopeCategory;
  allowlistedFrameCount: CountBucket;
  skippedFrameCount: CountBucket;
  exportLayoutHint: EsmExportLayoutHint;
  asyncMarkerPresent: boolean;
  /** Sanitized stop reason — set when the session is no longer usable (verdict ≠ LOGGED_IN). */
  stop: string | null;
}

/** Exact key allow-list for one row — used by the offline no-leak test. */
export const TTL_CHECKPOINT_ROW_KEYS: ReadonlyArray<keyof TtlCheckpointRow> = [
  "label",
  "sessionVerdict",
  "allowlistConfigured",
  "domSettle",
  "manageFeedbackRouteLike",
  "hasActionableExportCandidate",
  "actionableScope",
  "allowlistedFrameCount",
  "skippedFrameCount",
  "exportLayoutHint",
  "asyncMarkerPresent",
  "stop",
];

/** Pure: project a shared classification onto the sanitized checkpoint row. */
export function toCheckpointRow(label: string, c: SanitizedEsmReviewClassification): TtlCheckpointRow {
  return {
    label,
    sessionVerdict: c.signals.sessionVerdict,
    allowlistConfigured: c.allowlistConfigured,
    domSettle: c.domSettle,
    manageFeedbackRouteLike: c.signals.manageFeedbackRouteLike,
    hasActionableExportCandidate: c.frameAware.hasActionableExportCandidate,
    actionableScope: c.frameAware.actionableScope,
    allowlistedFrameCount: c.frameAware.allowlistedFrameCount,
    skippedFrameCount: c.frameAware.skippedFrameCount,
    exportLayoutHint: c.signals.exportLayoutHint,
    asyncMarkerPresent: c.signals.asyncMarkerPresent,
    stop: c.signals.sessionVerdict === "LOGGED_IN" ? null : "session-not-logged-in",
  };
}

/** Default real-run checkpoints: T+2h and T+3h10m (T0 is implicit). */
export const DEFAULT_OFFSETS_MIN: ReadonlyArray<number> = [120, 190];
/** Optional extra checkpoint (T+4h) when `--t4h` is passed. */
export const T4H_OFFSET_MIN = 240;

/**
 * Pure: resolve the post-T0 checkpoint offsets (minutes) from argv. `--after-minutes a,b`
 * overrides the default `[120, 190]` (intended for short DEV dry-runs, e.g. `1,2`);
 * `--t4h` appends 240. Result is positive, de-duped, ascending. Malformed entries are
 * dropped; an empty/malformed `--after-minutes` falls back to the default.
 */
export function parseCheckpointOffsets(args: readonly string[]): number[] {
  let offsets = [...DEFAULT_OFFSETS_MIN];
  const idx = args.indexOf("--after-minutes");
  const inlineRaw = args.find((a) => a.startsWith("--after-minutes="));
  const raw = inlineRaw ? inlineRaw.slice("--after-minutes=".length) : idx >= 0 ? args[idx + 1] : undefined;
  if (raw !== undefined) {
    const parsed = raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => /^\d+$/.test(s))
      .map((s) => Number.parseInt(s, 10))
      .filter((n) => n > 0);
    if (parsed.length > 0) offsets = parsed;
  }
  if (args.includes("--t4h")) offsets.push(T4H_OFFSET_MIN);
  return [...new Set(offsets)].sort((a, b) => a - b);
}

/** Label for a post-T0 checkpoint at `offsetMin` minutes. */
export function checkpointLabel(offsetMin: number): string {
  return `T+${offsetMin}m`;
}

/** Default minutes to wait for the human login/navigation handoff BEFORE T0. */
export const DEFAULT_LOGIN_TIMEOUT_MIN = 30;
/** Upper bound on the login wait — generous, but never "wait forever". */
export const MAX_LOGIN_TIMEOUT_MIN = 240;

/**
 * Pure: resolve the initial login/navigation handoff timeout (minutes) from
 * `--login-timeout-min N` (or `=N`). This governs ONLY the pre-T0 sentinel wait — it does
 * NOT affect the checkpoint offsets (`parseCheckpointOffsets`). Missing or invalid (non-
 * integer, ≤ 0) → the safe default (30); values are clamped to `MAX_LOGIN_TIMEOUT_MIN` so
 * the probe never waits forever for login.
 */
export function parseLoginTimeoutMin(args: readonly string[]): number {
  const FLAG = "--login-timeout-min";
  const inline = args.find((a) => a.startsWith(`${FLAG}=`));
  const idx = args.indexOf(FLAG);
  const raw = inline ? inline.slice(FLAG.length + 1) : idx >= 0 ? args[idx + 1] : undefined;
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return DEFAULT_LOGIN_TIMEOUT_MIN;
  const n = Number.parseInt(raw.trim(), 10);
  if (n < 1) return DEFAULT_LOGIN_TIMEOUT_MIN;
  return Math.min(n, MAX_LOGIN_TIMEOUT_MIN);
}

/** Fixed JSONL filename for the gitignored incremental probe results (under `.status/`). */
export const ESM_TTL_RESULTS_FILENAME = "esm-session-ttl-probe.jsonl";

/**
 * Pure: resolve the incremental-results JSONL path next to the collector status file, so
 * it lands in the gitignored `.status/` dir (honours a `COLLECTOR_STATUS_FILE` override).
 * Pass `cfg.statusFile`. Path-only — no filesystem access here.
 */
export function esmTtlResultsPath(statusFile: string): string {
  return resolve(dirname(resolve(statusFile)), ESM_TTL_RESULTS_FILENAME);
}

/**
 * Pure run loop: classify at T0, then sleep the DELTA to each successive offset and
 * classify again, KEEPING the caller's context open (this loop never launches/closes a
 * browser — `classifyAt` reads the already-open page). Stops early when a checkpoint is
 * no longer logged in (`row.stop` set) so the probe does not sleep hours past expiry.
 *
 * `onCheckpoint` (if given) is awaited IMMEDIATELY after each row is produced — BEFORE the
 * next sleep — so the CLI can durably persist each checkpoint the moment it completes.
 * That makes a long run robust to interruption: if the process is killed during a later
 * sleep, every already-completed checkpoint has already been handed to `onCheckpoint`.
 *
 * `sleep`, `classifyAt`, and `onCheckpoint` are injected, so the schedule is deterministic
 * and testable with no real timers and no filesystem.
 */
export async function runTtlCheckpoints(opts: {
  offsetsMin: readonly number[];
  classifyAt: (label: string) => Promise<TtlCheckpointRow>;
  sleep: (ms: number) => Promise<void>;
  onCheckpoint?: (row: TtlCheckpointRow) => void | Promise<void>;
}): Promise<TtlCheckpointRow[]> {
  const rows: TtlCheckpointRow[] = [];
  const t0 = await opts.classifyAt("T0");
  rows.push(t0);
  await opts.onCheckpoint?.(t0);
  if (t0.stop) return rows;

  let prev = 0;
  for (const off of opts.offsetsMin) {
    await opts.sleep((off - prev) * 60_000);
    prev = off;
    const row = await opts.classifyAt(checkpointLabel(off));
    rows.push(row);
    await opts.onCheckpoint?.(row);
    if (row.stop) break;
  }
  return rows;
}
