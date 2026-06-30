/**
 * Composition layer for the ESM+ REVIEW capture harness's pre-delete inspection (Gate 4/5).
 *
 * The capture CLI (`cli/capture-esm-review.ts`) fires one supervised click, observes one
 * download, and hands the saved-but-not-yet-deleted xlsx to `saveAndInspectDownload`'s generic
 * `inspectFn` hook — which runs ONLY after the structural xlsx sniff passes and BEFORE the
 * delete-in-`finally`. This module owns what that hook computes and the stop precedence that
 * follows, so the CLI stays a thin Playwright shell and the wiring is unit-testable offline.
 *
 * Two opt-in flags compose here:
 *   - `--inspect-schema-shape` (Gate 4) → `schemaShape` via `summarizeSchemaShape(readWorkbookShape())`.
 *   - `--probe-row-shape` (Gate 5)      → `rowShape` via `summarizeRowShape(readWorkbookRowSample())`.
 * With neither flag, `buildCaptureInspectFn` returns `undefined` — no inspector runs and the
 * Gate 3 observe-and-discard path is byte-for-byte unchanged.
 *
 * STRICT NON-GOALS: no upload, no DB/status write, no scheduler/`manualSync`, no browser. Both
 * underlying summarisers emit SANITIZED shape only (hashes/buckets/categories/booleans, never a
 * raw cell/header/path) and hard-code `schemaMappingConfirmed:false` / `dedupKeyConfirmed:false`.
 * This module reads a quarantine file via the readers but emits no raw value and confirms nothing.
 */

import type { CaptureStop, FileStructure } from "./esm-capture-gate";
import { summarizeRowShape, type SanitizedRowShape } from "./esm-review-row-shape";
import { summarizeSchemaShape, type SanitizedSchemaShape } from "./esm-review-schema-shape";
import { readWorkbookRowSample, readWorkbookShape } from "./esm-review-xlsx-reader";

/** Default / bounds for the Gate-5 row sample size. Small cap to minimise PII exposure (Policy A). */
export const DEFAULT_ROW_SAMPLE_ROWS = 3;
export const MIN_ROW_SAMPLE_ROWS = 1;
export const MAX_ROW_SAMPLE_ROWS = 5;

/** The combined, fully-sanitized pre-delete inspection. Either field is null when its flag is off. */
export interface CaptureInspection {
  schemaShape: SanitizedSchemaShape | null;
  rowShape: SanitizedRowShape | null;
}

/** Clamp a requested row-sample size into `[MIN, MAX]`, defaulting non-finite input. */
export function clampRowSampleRows(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_ROW_SAMPLE_ROWS;
  return Math.min(MAX_ROW_SAMPLE_ROWS, Math.max(MIN_ROW_SAMPLE_ROWS, Math.trunc(n)));
}

/**
 * Pure: parse `--row-sample-rows N` (or `=N`) from argv. Returns the clamped count, or the
 * default (3) when absent or malformed. Accepts `--row-sample-rows 4` and `--row-sample-rows=4`.
 */
export function parseRowSampleRowsArg(args: readonly string[]): number {
  const FLAG = "--row-sample-rows";
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!;
    let raw: string | undefined;
    if (a === FLAG) raw = args[i + 1];
    else if (a.startsWith(`${FLAG}=`)) raw = a.slice(FLAG.length + 1);
    if (raw === undefined) continue;
    const t = raw.trim();
    if (!/^\d+$/.test(t)) return DEFAULT_ROW_SAMPLE_ROWS;
    return clampRowSampleRows(Number.parseInt(t, 10));
  }
  return DEFAULT_ROW_SAMPLE_ROWS;
}

/**
 * Build the pre-delete `inspectFn` for the save seam, composing the opt-in inspectors. Returns
 * `undefined` when BOTH flags are off (so the CLI passes no hook and the Gate 3 path is unchanged).
 * Each enabled inspector reads the still-present quarantine file and returns its sanitized shape;
 * the other field stays null.
 */
export function buildCaptureInspectFn(opts: {
  inspectSchemaShape: boolean;
  probeRowShape: boolean;
  rowSampleRows: number;
  salt: string | undefined;
}): ((path: string) => Promise<CaptureInspection>) | undefined {
  if (!opts.inspectSchemaShape && !opts.probeRowShape) return undefined;
  const rows = clampRowSampleRows(opts.rowSampleRows);
  return (path: string): Promise<CaptureInspection> => {
    const schemaShape = opts.inspectSchemaShape
      ? summarizeSchemaShape(readWorkbookShape(path), opts.salt)
      : null;
    const rowShape = opts.probeRowShape
      ? summarizeRowShape(readWorkbookRowSample(path, rows), opts.salt)
      : null;
    return Promise.resolve({ schemaShape, rowShape });
  };
}

/**
 * Pure: the post-inspection stop precedence. Structural failure wins, then each enabled inspector
 * fails CLOSED if its workbook was unreadable, then a failed delete is surfaced. Returns null when
 * the capture is valid. Mirrors the Gate 3/4 order with the Gate-5 row-shape branch inserted
 * before the delete check.
 */
export function deriveCaptureStop(input: {
  fileStructure: FileStructure;
  inspectSchemaShape: boolean;
  schemaShape: SanitizedSchemaShape | null;
  probeRowShape: boolean;
  rowShape: SanitizedRowShape | null;
  deleteFailed: boolean;
}): CaptureStop | null {
  if (input.fileStructure === "unrecognized") return "unrecognized-format";
  if (input.inspectSchemaShape && (input.schemaShape === null || !input.schemaShape.workbookReadable)) {
    return "schema-inspect-failed";
  }
  if (input.probeRowShape && (input.rowShape === null || !input.rowShape.workbookReadable)) {
    return "row-shape-inspect-failed";
  }
  if (input.deleteFailed) return "delete-failed";
  return null;
}
