/**
 * Pure, no-click export-LAYOUT planner — SANITIZED.
 *
 * `review-export.ts` already exposes the pure classification pieces
 * (`classifyExportPage`, `findExportCandidates`, `buildTriggerSelectors`), but the
 * only runnable path that uses them — `runExport` — also CLICKS the trigger and
 * waits for a download. This module folds those existing pure pieces into a single
 * sanitized "what would we do" plan that a strict no-click classifier can print
 * WITHOUT ever clicking, downloading, or capturing.
 *
 * It is browser-free and side-effect-free: it imports only the pure string-in /
 * structured-out exports of `review-export.ts` (no `runExport`, no Playwright, no
 * fs/network). A purity source-guard test asserts this module can never reach a
 * click/download/save path.
 *
 * SAFETY CONTRACT (same as `export-probe.ts`): every field of `ExportActionPlan` is
 * a fixed category enum, a boolean, or a small bucketed count. Crucially, the raw
 * trigger SELECTORS produced by `buildTriggerSelectors` (which can embed element
 * ids / keyword text) are NEVER returned — only their COUNT is. So
 * `JSON.stringify(planExportAction(html))` can never contain a selector, id, label,
 * store/account/product/review datum, token, raw URL, or raw HTML. Asserted by an
 * offline hostile-fixture test.
 */
import type { CountBucket } from "./export-probe";
import {
  buildTriggerSelectors,
  classifyExportPage,
  findExportCandidates,
  type ExportPageKind,
} from "./review-export";

/** Outcome-named layout, aligned with the `ExportOutcome` vocabulary the run-state uses. */
export type ExportLayout = "SYNC_DOWNLOAD" | "ASYNC_JOB_DETECTED" | "LAYOUT_UNRECOGNIZED";

/** The ONLY shape ever printed by the planner. Every leaf is non-sensitive. */
export interface ExportActionPlan {
  /** 3-way layout classification — no click required to decide it. */
  layout: ExportLayout;
  /**
   * True iff at least one interactive, VISIBLE + ENABLED export control is present
   * (from `findExportCandidates`, which already excludes disabled/hidden controls).
   */
  hasActionableExportCandidate: boolean;
  /** Bucketed count of those actionable export candidates. */
  actionableExportCandidateCount: CountBucket;
  /**
   * Bucketed count of trigger selectors `runExport` WOULD try — COUNT ONLY. The raw
   * selector strings are deliberately never exposed (they can embed ids / keywords).
   */
  triggerSelectorCount: CountBucket;
  /** True iff an async download-center / job affordance is present (it wins over sync). */
  asyncMarkerPresent: boolean;
}

/** Exact set of keys the planner may emit — used by the offline allow-list test. */
export const EXPORT_ACTION_PLAN_KEYS: ReadonlyArray<keyof ExportActionPlan> = [
  "layout",
  "hasActionableExportCandidate",
  "actionableExportCandidateCount",
  "triggerSelectorCount",
  "asyncMarkerPresent",
];

/** Same bucket thresholds as `export-probe.ts` (kept local so this stays a pure leaf). */
function bucket(n: number): CountBucket {
  if (n <= 0) return "none";
  if (n === 1) return "one";
  if (n <= 5) return "few";
  if (n <= 20) return "some";
  return "many";
}

/** Map the internal `ExportPageKind` to the outcome-named, sanitized layout enum. */
function toLayout(kind: ExportPageKind): ExportLayout {
  switch (kind) {
    case "SYNC_DOWNLOAD":
      return "SYNC_DOWNLOAD";
    case "ASYNC_JOB":
      return "ASYNC_JOB_DETECTED";
    case "UNRECOGNIZED":
      return "LAYOUT_UNRECOGNIZED";
  }
}

/**
 * Pure: from the rendered top-document HTML, decide the export layout and the
 * sanitized action plan WITHOUT clicking anything. Reuses the existing pure
 * classifier/finders so the no-click path and `runExport` agree on what the page
 * is — they only differ in that this never acts on it.
 *
 * `asyncMarkerPresent` mirrors the async-wins precedence: `classifyExportPage`
 * returns `ASYNC_JOB` exactly when an `ASYNC_JOB_MARKERS` affordance is present, so
 * the boolean is derived from the same single source rather than re-scanned here.
 */
export function planExportAction(rawHtml: string): ExportActionPlan {
  const kind = classifyExportPage(rawHtml);
  const candidates = findExportCandidates(rawHtml); // already visible + enabled
  const triggerSelectors = buildTriggerSelectors(rawHtml); // counted, never emitted
  return {
    layout: toLayout(kind),
    hasActionableExportCandidate: candidates.length > 0,
    actionableExportCandidateCount: bucket(candidates.length),
    triggerSelectorCount: bucket(triggerSelectors.length),
    asyncMarkerPresent: kind === "ASYNC_JOB",
  };
}
