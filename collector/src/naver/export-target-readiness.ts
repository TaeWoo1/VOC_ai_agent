/**
 * Pure, sanitized EXPORT-TARGET readiness evaluator — browser-free.
 *
 * Why this exists: the export-click diagnostic proved that on a `LOGGED_IN` +
 * `SYNC_DOWNLOAD` page with a single Excel control, clicking it does NOT yield a
 * download — it surfaces a native "엑셀다운로드 대상인 리뷰가 없습니다" alert (there are
 * no reviews to export for the current condition). The page can already carry a
 * default ~1-week date range, so the earlier `selectedRangePresent` reading was a weak
 * proxy: the real blocker is usually that the current search/filter/date result has
 * ZERO exportable rows, not strictly a missing range. `decideCaptureGate` only proves a
 * single sync control EXISTS; it says nothing about whether there is anything to export.
 *
 * This module is the second, narrower gate: from the same sanitized page HTML, decide
 * whether the current result actually contains exportable review targets. The capture
 * path proceeds to the ONE click only on positive evidence (`READY`); every other shape
 * HALTS honestly before the click (no download, no upload, no `LAST_SUCCESS`), with a
 * distinguishable state. Ambiguity NEVER clicks — it returns `EXPORT_TARGET_UNKNOWN`.
 *
 * SAFETY CONTRACT (same as `export-classify.ts` / `export-click-signals.ts`): every
 * field emitted is a fixed category enum or a coarse count bucket. Counts that drive the
 * decision (parsed result-count, data-row count) are reduced to a bucket and never
 * emitted as exact numbers; no field copies a substring of the input. So
 * `JSON.stringify(evaluateExportTargetReadiness(html))` can never carry a store/account
 * /Commerce id, NAVER id, review text, raw URL, selector, label, or token. Asserted by
 * an offline hostile-fixture test.
 */
import type { CountBucket } from "./export-probe";
import { diagnosePreClickSignals } from "./export-click-signals";

/**
 * The ONLY shape ever returned. `READY` carries a coarse row bucket + the positive
 * reason; each `HALT` carries the honest `CollectorState` to record + a fixed reason.
 */
export type ExportTargetReadiness =
  | { decision: "READY"; rowCountBucket: CountBucket; reason: "positive_rows" | "positive_count" }
  | { decision: "HALT"; state: "EXPORT_TARGET_EMPTY"; reason: "zero_rows" | "empty_state" | "no_export_target" }
  | { decision: "HALT"; state: "EXPORT_DATE_RANGE_REQUIRED"; reason: "date_range_missing" }
  | { decision: "HALT"; state: "EXPORT_TARGET_UNKNOWN"; reason: "ambiguous" };

/** Exact set of keys any readiness result may carry — used by the offline allow-list test. */
export const EXPORT_TARGET_READINESS_KEYS: readonly string[] = ["decision", "rowCountBucket", "reason", "state"];

/**
 * Which precedence rung of `evaluateExportTargetReadiness` actually fired. This is a
 * DIAGNOSTIC label — it never changes the decision, it only records the path taken. It exists
 * because the `reason` field alone cannot distinguish the two ways `empty_state` can arise: an
 * explicit empty MARKER (rung 1) vs. a labeled result-count of exactly 0 (rung 2). The Run-2
 * negative result turned on exactly that distinction — did an empty MARKER short-circuit the gate
 * before rows were ever counted, or did the surface fall through to `zero_rows`/`ambiguous`? A
 * read-only probe emitting this branch answers that from observed evidence instead of a guess.
 * It is a fixed enum — never any input text — so it is safe to emit in a sanitized probe.
 */
export type ExportTargetReadinessBranch =
  | "no_export_target_marker" // rung 1a — an explicit "…대상인 리뷰가 없습니다" export-empty notice
  | "empty_state_marker" // rung 1b — a generic "결과가 없습니다" empty placeholder
  | "labeled_count_positive" // rung 2  — a labeled result-count > 0
  | "labeled_count_zero" // rung 2  — a labeled result-count of exactly 0 (distinct from the marker)
  | "data_rows_present" // rung 3  — data rows counted in the static HTML
  | "results_container_zero_rows" // rung 4 — a results container exists but holds zero rows
  | "date_range_required" // rung 5  — a positive "pick a period" instruction, no selected range
  | "ambiguous_no_signal"; // rung 6  — nothing decidable (e.g. SPA rows not in static HTML)

/** The gate's decision plus the precedence rung that produced it. `readiness` is verbatim. */
export interface ExportTargetReadinessTrace {
  readiness: ExportTargetReadiness;
  branch: ExportTargetReadinessBranch;
}

// --- markers (presence-only; matched text is never returned) ------------------

/**
 * Phrasings specifically about the EXPORT having no target — the observed alert
 * ("…대상인 리뷰가 없습니다") and its kin. Distinguished from a generic empty list so the
 * halt reason can say `no_export_target` rather than `empty_state`.
 */
const NO_EXPORT_TARGET_MARKERS: readonly RegExp[] = [
  /대상.{0,8}리뷰가?\s*없/,
  /(?:다운로드|내보낼|내보낼\s*수|추출할|export).{0,16}(?:대상|내역|데이터).{0,8}없/i,
  /엑셀.{0,16}(?:대상|내역).{0,8}없/,
  /no\s+(?:data|records?|rows?)\s+to\s+export/i,
];

/**
 * Generic "the current result is empty" placeholders shown in/around the review list.
 * Liberal on purpose: a false EMPTY only HALTS (safe — no dead click), whereas a false
 * READY would click into nothing. We deliberately err toward halting.
 */
const EMPTY_STATE_MARKERS: readonly RegExp[] = [
  /(?:검색|조회)\s*결과가?\s*없/,
  /결과가?\s*없습니다/,
  /리뷰가?\s*(?:존재하지\s*)?없/,
  /(?:데이터|내역|항목)이?\s*없/,
  /표시할\s*(?:내용|데이터|항목|리뷰).{0,4}없/,
  /no\s+(?:results?|data|reviews?|records?|items?)\b/i,
  /\bempty\b/i,
];

/**
 * NARROW, positive "you must pick a period first" requirement. Deliberately NOT the broad
 * date-range markers (bare 시작일/종료일/조회기간 appear on every filtered page even when a
 * range IS selected) — using those would over-fire `EXPORT_DATE_RANGE_REQUIRED`. Only an
 * explicit instruction to choose/enter a range counts.
 */
const REQUIRED_RANGE_MARKERS: readonly RegExp[] = [
  /기간을?\s*(?:선택|설정|입력|지정)\s*(?:해|하|하여|해\s*주)/,
  /(?:조회|검색)\s*기간.{0,12}(?:필수|선택해|입력해|지정해|반드시)/,
  /기간.{0,8}반드시/,
  /select\s+(?:a\s+)?(?:date\s*range|period)/i,
  /(?:date\s*range|period)\s+(?:is\s+)?required/i,
];

/** A results container exists at all (table / grid / list-grid), regardless of row count. */
const RESULTS_CONTAINER_MARKERS: readonly RegExp[] = [
  /<tbody[\s>]/i,
  /<table[\s>]/i,
  /role\s*=\s*["'](?:grid|table|rowgroup)["']/i,
];

/** Labeled result-count, e.g. "총 128건" / "전체 1,234 개" — tolerates one tag around the number. */
const RESULT_COUNT_RE =
  /(?:총|전체|검색\s*결과)\s*(?:<[^>]+>\s*)?([\d,]+)\s*(?:<[^>]+>\s*)?(?:건|개|행)/;
const TBODY_BLOCK_RE = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/gi;
const TR_RE = /<tr[\s>]/gi;
const ROLE_ROW_RE = /role\s*=\s*["']row["']/gi;
const ROLE_COLHEADER_RE = /role\s*=\s*["']columnheader["']/gi;

const stripComments = (html: string): string => html.replace(/<!--[\s\S]*?-->/g, " ");
const anyMatch = (markers: readonly RegExp[], s: string): boolean => markers.some((re) => re.test(s));
const countMatches = (re: RegExp, html: string): number => (html.match(re) ?? []).length;

/** Same bucket thresholds as the sibling probe modules (kept local so this stays a pure leaf). */
function bucket(n: number): CountBucket {
  if (n <= 0) return "none";
  if (n === 1) return "one";
  if (n <= 5) return "few";
  if (n <= 20) return "some";
  return "many";
}

/** Pure: parse a labeled result-count to an integer, or null when none is present. Never emitted. */
function parseResultCount(html: string): number | null {
  const m = RESULT_COUNT_RE.exec(html);
  if (!m || m[1] === undefined) return null;
  const n = Number.parseInt(m[1].replace(/,/g, ""), 10);
  return Number.isNaN(n) ? null : n;
}

/**
 * Pure: count data rows present in the static HTML — body `<tr>` inside `<tbody>` blocks,
 * plus role-grid `role="row"` rows minus a header row. Best-effort and intentionally
 * coarse; an SPA that renders rows client-side yields 0 here, which routes to a
 * conservative UNKNOWN halt rather than a blind click.
 */
function countDataRows(html: string): number {
  let bodyRows = 0;
  for (const block of html.matchAll(TBODY_BLOCK_RE)) {
    bodyRows += countMatches(TR_RE, block[1] ?? "");
  }
  const roleRows = countMatches(ROLE_ROW_RE, html);
  const headerRows = countMatches(ROLE_COLHEADER_RE, html) > 0 ? 1 : 0;
  const gridRows = Math.max(0, roleRows - headerRows);
  return bodyRows + gridRows;
}

/**
 * Pure: decide whether the current export surface has exportable review targets.
 *
 * Precedence (conservative — ambiguity NEVER clicks):
 *  1. explicit no-export-target / generic empty-state marker → EXPORT_TARGET_EMPTY
 *  2. labeled result-count > 0 → READY (positive_count); a count of exactly 0 → EMPTY
 *  3. data rows present in the HTML → READY (positive_rows)
 *  4. a results container exists but has zero data rows → EXPORT_TARGET_EMPTY (zero_rows)
 *  5. a positive "must pick a period" marker AND no detectable selected range → DATE_RANGE_REQUIRED
 *  6. otherwise → EXPORT_TARGET_UNKNOWN (halt)
 */
export function evaluateExportTargetReadiness(rawHtml: string): ExportTargetReadiness {
  return traceExportTargetReadiness(rawHtml).readiness;
}

/**
 * Pure: the same decision as `evaluateExportTargetReadiness`, plus the precedence rung that
 * produced it (`branch`). Single source of truth — `evaluateExportTargetReadiness` is defined as
 * `traceExportTargetReadiness(rawHtml).readiness`, so the decision can never drift from the trace.
 * The read-only export-readiness probe emits this so a live run OBSERVES which rung fired instead
 * of inferring it from row-count proxies (the §8-11/Run-2 gap). The `branch` is a fixed enum and
 * carries no input text — safe to include in a sanitized probe.
 */
export function traceExportTargetReadiness(rawHtml: string): ExportTargetReadinessTrace {
  const html = stripComments(rawHtml);

  // 1) Explicit emptiness wins — the most likely, benign cause of the no-download alert.
  if (anyMatch(NO_EXPORT_TARGET_MARKERS, html)) {
    return {
      readiness: { decision: "HALT", state: "EXPORT_TARGET_EMPTY", reason: "no_export_target" },
      branch: "no_export_target_marker",
    };
  }
  if (anyMatch(EMPTY_STATE_MARKERS, html)) {
    return {
      readiness: { decision: "HALT", state: "EXPORT_TARGET_EMPTY", reason: "empty_state" },
      branch: "empty_state_marker",
    };
  }

  // 2) A labeled positive count is strong positive evidence; an explicit 0 is emptiness.
  const count = parseResultCount(html);
  if (count !== null) {
    if (count > 0) {
      return {
        readiness: { decision: "READY", rowCountBucket: bucket(count), reason: "positive_count" },
        branch: "labeled_count_positive",
      };
    }
    return {
      readiness: { decision: "HALT", state: "EXPORT_TARGET_EMPTY", reason: "empty_state" },
      branch: "labeled_count_zero",
    };
  }

  // 3) Data rows actually present in the static HTML.
  const dataRows = countDataRows(html);
  if (dataRows > 0) {
    return {
      readiness: { decision: "READY", rowCountBucket: bucket(dataRows), reason: "positive_rows" },
      branch: "data_rows_present",
    };
  }

  // 4) A results container exists but is empty → concretely zero rows.
  if (anyMatch(RESULTS_CONTAINER_MARKERS, html)) {
    return {
      readiness: { decision: "HALT", state: "EXPORT_TARGET_EMPTY", reason: "zero_rows" },
      branch: "results_container_zero_rows",
    };
  }

  // 5) Only a POSITIVE required-range instruction with no selected range is date-range-missing.
  //    Reuse the existing pre-click range reader rather than re-deriving the heuristic.
  const { selectedRangePresent } = diagnosePreClickSignals(rawHtml);
  if (anyMatch(REQUIRED_RANGE_MARKERS, html) && !selectedRangePresent) {
    return {
      readiness: { decision: "HALT", state: "EXPORT_DATE_RANGE_REQUIRED", reason: "date_range_missing" },
      branch: "date_range_required",
    };
  }

  // 6) Can't distinguish safely (e.g. SPA rows not in static HTML) → conservative halt, no click.
  return {
    readiness: { decision: "HALT", state: "EXPORT_TARGET_UNKNOWN", reason: "ambiguous" },
    branch: "ambiguous_no_signal",
  };
}
