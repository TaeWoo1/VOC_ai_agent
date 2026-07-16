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
 * explicit empty MARKER (rung 4) vs. a labeled result-count of exactly 0 (rung 5). The Run-2
 * negative result turned on exactly that distinction — did an empty MARKER short-circuit the gate
 * before rows were ever counted, or did the surface fall through to `zero_rows`/`ambiguous`? A
 * read-only probe emitting this branch answers that from observed evidence instead of a guess.
 * It is a fixed enum — never any input text — so it is safe to emit in a sanitized probe.
 */
export type ExportTargetReadinessBranch =
  | "no_export_target_marker" // rung 3 — an explicit "…대상인 리뷰가 없습니다" export-empty notice
  | "empty_state_marker" // rung 4 — a generic "결과가 없습니다" empty placeholder
  | "labeled_count_positive" // rung 1 — a labeled result-count > 0
  | "labeled_count_zero" // rung 5 — a labeled result-count of exactly 0 (distinct from the marker)
  | "data_rows_present" // rung 2 — data rows counted in the static HTML
  | "results_container_zero_rows" // rung 6 — a results container exists but holds zero rows
  | "date_range_required" // rung 7 — a positive "pick a period" instruction, no selected range
  | "ambiguous_no_signal"; // rung 8 — nothing decidable (e.g. SPA rows not in static HTML)

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
 * Pure: count body `<tr>` rows that are themselves an empty-state / no-export placeholder — the
 * conventional in-table "검색 결과가 없습니다" colspan row. `countDataRows` counts these as rows, but
 * they are NOT real data: they carry the very emptiness marker that says the result is empty. We
 * subtract them so a lone placeholder row can never masquerade as positive evidence that outranks
 * its own marker, while a genuinely populated grid (real rows beyond any placeholder) still wins.
 * Best-effort and coarse: only `<tbody>`-block rows are inspected (the common placeholder shape); a
 * placeholder rendered as a bare `role="row"` is not subtracted here and stays covered by the
 * fail-closed download step downstream.
 */
function countPlaceholderBodyRows(html: string): number {
  let placeholders = 0;
  for (const block of html.matchAll(TBODY_BLOCK_RE)) {
    const body = block[1] ?? "";
    // Segment the body into per-<tr> chunks (each chunk starts at a <tr>), then count the chunks
    // whose own text is an emptiness marker.
    for (const chunk of body.split(/(?=<tr[\s>])/i)) {
      if (!/<tr[\s>]/i.test(chunk)) continue; // non-global test — no lastIndex state
      if (anyMatch(NO_EXPORT_TARGET_MARKERS, chunk) || anyMatch(EMPTY_STATE_MARKERS, chunk)) {
        placeholders += 1;
      }
    }
  }
  return placeholders;
}

/**
 * Pure: decide whether the current export surface has exportable review targets.
 *
 * Precedence — **positive row/count evidence outranks empty-state markers** (corrected from the
 * §8-14 live finding: a hidden/off-screen "검색 결과가 없습니다" placeholder coexists in the DOM with a
 * fully populated review grid; the old marker-first order HALTed a genuinely-exportable surface):
 *  1. labeled result-count > 0 → READY (positive_count) — an authoritative numeric counter
 *  2. real data rows present (rows beyond any in-table empty-state placeholder) → READY (positive_rows)
 *  3. explicit no-export-target notice → EXPORT_TARGET_EMPTY (no_export_target)
 *  4. generic empty-state placeholder → EXPORT_TARGET_EMPTY (empty_state)
 *  5. labeled result-count of exactly 0 → EXPORT_TARGET_EMPTY (empty_state)
 *  6. a results container exists but has zero data rows → EXPORT_TARGET_EMPTY (zero_rows)
 *  7. a positive "must pick a period" marker AND no detectable selected range → DATE_RANGE_REQUIRED
 *  8. otherwise → EXPORT_TARGET_UNKNOWN (halt)
 *
 * Still conservative: ambiguity NEVER clicks. A lone empty-state placeholder row is subtracted
 * before rung 2 (see `countPlaceholderBodyRows`), so the marker rungs (3–6) still HALT a genuinely
 * empty surface; only real data beyond the placeholder — or a positive labeled count — proceeds. A
 * false READY that clicks into nothing is caught fail-closed by download detection downstream.
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
  const count = parseResultCount(html);
  // Real data rows = counted rows minus any in-table empty-state placeholder row, so a lone
  // "검색 결과가 없습니다" colspan row can never outrank the very marker it carries.
  const realDataRows = Math.max(0, countDataRows(html) - countPlaceholderBodyRows(html));

  // 1) An authoritative labeled positive count is the strongest positive evidence — it outranks a
  //    coexisting empty-state placeholder (§8-14). (A count of exactly 0 is handled at rung 5.)
  if (count !== null && count > 0) {
    return {
      readiness: { decision: "READY", rowCountBucket: bucket(count), reason: "positive_count" },
      branch: "labeled_count_positive",
    };
  }

  // 2) A genuinely populated grid (real rows beyond any placeholder) outranks a coexisting
  //    empty-state marker — the §8-14 fix. The placeholder row itself is already excluded above.
  if (realDataRows > 0) {
    return {
      readiness: { decision: "READY", rowCountBucket: bucket(realDataRows), reason: "positive_rows" },
      branch: "data_rows_present",
    };
  }

  // 3) No positive evidence → an explicit no-export-target notice is the most specific emptiness.
  if (anyMatch(NO_EXPORT_TARGET_MARKERS, html)) {
    return {
      readiness: { decision: "HALT", state: "EXPORT_TARGET_EMPTY", reason: "no_export_target" },
      branch: "no_export_target_marker",
    };
  }
  // 4) …or a generic empty-state placeholder.
  if (anyMatch(EMPTY_STATE_MARKERS, html)) {
    return {
      readiness: { decision: "HALT", state: "EXPORT_TARGET_EMPTY", reason: "empty_state" },
      branch: "empty_state_marker",
    };
  }

  // 5) A labeled result-count of exactly 0 is an explicit emptiness statement.
  if (count !== null) {
    return {
      readiness: { decision: "HALT", state: "EXPORT_TARGET_EMPTY", reason: "empty_state" },
      branch: "labeled_count_zero",
    };
  }

  // 6) A results container exists but is empty → concretely zero rows.
  if (anyMatch(RESULTS_CONTAINER_MARKERS, html)) {
    return {
      readiness: { decision: "HALT", state: "EXPORT_TARGET_EMPTY", reason: "zero_rows" },
      branch: "results_container_zero_rows",
    };
  }

  // 7) Only a POSITIVE required-range instruction with no selected range is date-range-missing.
  //    Reuse the existing pre-click range reader rather than re-deriving the heuristic.
  //
  //    ⚠ DORMANT ON ANY GRID-BEARING SURFACE (D-025, recorded 2026-07-16 — do not "fix" by
  //    reordering). Reaching here needs a SEVEN-way conjunction: no labeled count (rungs 1+5), zero
  //    real rows (rung 2), no no-target notice (rung 3), no empty-state marker (rung 4 — whose
  //    /\bempty\b/i alone matches any `class="empty-notice"`), AND — the binding clause — NO
  //    results container at all (rung 6: no <table>/<tbody>/role=grid|table|rowgroup ANYWHERE).
  //    A review grid halts at rung 6 even at ZERO rows, so a real export surface never arrives
  //    here. Run 5 (§8-18) merely observed the rung-1 path; rung 6 is the structural bound.
  //    RETAINED, not deleted: a fail-closed HALT costs nothing dormant, it preserves the §8-14
  //    lineage, and `selectedRangePresent` is an UNPROVEN placeholder (never observed `true` on any
  //    surface; see `export-click-signals.ts` on why it may be structurally blind). Promoting this
  //    rung above rungs 1/2 would re-invert the §8-14 fix and would also silently disable the §8-11
  //    settle window, which treats this state as a trusted terminal halt (`export-surface-settle.ts`).
  //    `export-target-readiness.test.ts` locks the unreachability — a reorder trips it.
  const { selectedRangePresent } = diagnosePreClickSignals(rawHtml);
  if (anyMatch(REQUIRED_RANGE_MARKERS, html) && !selectedRangePresent) {
    return {
      readiness: { decision: "HALT", state: "EXPORT_DATE_RANGE_REQUIRED", reason: "date_range_missing" },
      branch: "date_range_required",
    };
  }

  // 8) Can't distinguish safely (e.g. SPA rows not in static HTML) → conservative halt, no click.
  return {
    readiness: { decision: "HALT", state: "EXPORT_TARGET_UNKNOWN", reason: "ambiguous" },
    branch: "ambiguous_no_signal",
  };
}
