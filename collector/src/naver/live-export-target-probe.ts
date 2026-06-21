/**
 * Read-only LIVE export-target probe — PURE decision + bounded polling core (browser-free).
 *
 * Why this exists: the HTML-only `evaluateExportTargetReadiness` returned a STABLE
 * `EXPORT_TARGET_EMPTY` across the full readiness window on the real NAVER surface, yet the
 * operator confirmed the same default review page DOES download reviews in another browser. A
 * stable empty reading that contradicts external reality is the signature of a FALSE-POSITIVE
 * marker match: NAVER's SPA ships a HIDDEN empty-state placeholder ("검색 결과가 없습니다") in the
 * static `page.content()` HTML that the regex matches regardless of visibility, while the real
 * review rows render in a live grid / iframe / shadow root the static HTML doesn't reflect.
 *
 * This module asks the RENDERED page instead of the static HTML: are there ACTUALLY-VISIBLE
 * review rows? Is an empty-state placeholder ACTUALLY visible (not merely present-but-hidden)?
 * It is the pure core — it never touches a browser. The real read-only DOM/frame/visibility
 * reads are injected via `readSignalsFn` (implemented in `live-export-target-probe-reads.ts`),
 * so this loop is unit-tested against fakes with zero Playwright, exactly like
 * `export-target-readiness-stable.ts`.
 *
 * Rules (read-only; ambiguity is never confident):
 *  - As soon as a check sees ≥1 VISIBLE row → `LIVE_ROWS_PRESENT` immediately (rendered rows are
 *    the definitive answer — reviews exist; a still-hydrating grid is given the rest of the window
 *    to paint at least one row).
 *  - Window expires with no visible row: a genuinely-visible empty placeholder → `LIVE_EMPTY_VISIBLE`;
 *    otherwise → `LIVE_TARGET_UNKNOWN` (SPA still hydrating, virtualized-but-unpainted, or rows in a
 *    shadow / cross-origin frame we couldn't read). Conservative default — never a confident empty.
 *  - A transient read error is ignored (skip the cycle, keep polling); if EVERY read failed, the
 *    result is `LIVE_TARGET_UNKNOWN` with all-none buckets.
 *
 * SAFETY: this slice is DIAGNOSTIC-ONLY — the probe NEVER changes a gate decision and NEVER adds a
 * click. Every field emitted is a fixed enum, a coarse count bucket, or a boolean (no raw HTML /
 * text / selector / id / count); a hostile-fixture test and a source-guard test assert this.
 */
import type { CountBucket } from "./export-probe";
import type { PwPage } from "../profile";

/**
 * Raw scalar signals gathered from the rendered page by the injected reader — summed across the
 * main frame and every readable child frame. Internal; reduced to buckets/booleans before output.
 */
export interface RawLiveProbeSignals {
  /** Count of ACTUALLY-VISIBLE candidate review rows (a lower bound under virtualization). */
  visibleRowCount: number;
  /** An empty-state placeholder is GENUINELY visible somewhere (not merely present-in-HTML). */
  visibleEmptyState: boolean;
  /** A table / grid / list container is present and visible (rendered grid vs un-rendered SPA shell). */
  visibleGridLikeSurface: boolean;
  /** Total frames on the page (main + children). */
  frameTotal: number;
  /** Frames actually read (skips detached / cross-origin / navigating frames). */
  framesChecked: number;
}

/** The ONLY shape ever returned — all fields enum / coarse bucket / boolean / derived count. */
export type LiveExportTargetProbe = {
  decision: "LIVE_ROWS_PRESENT" | "LIVE_EMPTY_VISIBLE" | "LIVE_TARGET_UNKNOWN";
  visibleRowCountBucket: CountBucket;
  visibleEmptyState: boolean;
  visibleGridLikeSurface: boolean;
  frameCountBucket: CountBucket;
  checkedFramesBucket: CountBucket;
  checks: number;
  elapsedMs: number;
};

/** Exact set of keys any probe result may carry — used by the offline allow-list test. */
export const LIVE_EXPORT_TARGET_PROBE_KEYS: readonly string[] = [
  "decision",
  "visibleRowCountBucket",
  "visibleEmptyState",
  "visibleGridLikeSurface",
  "frameCountBucket",
  "checkedFramesBucket",
  "checks",
  "elapsedMs",
];

export interface LiveExportTargetProbeDeps {
  timeoutMs: number;
  intervalMs: number;
  /** Injected read-only reader — returns sanitized scalars only, never raw nodes/text/selectors. */
  readSignalsFn: (page: PwPage) => Promise<RawLiveProbeSignals>;
  /** Injectable for deterministic, instant tests. */
  sleepFn?: (ms: number) => Promise<void>;
}

/** Same bucket thresholds as the sibling probe modules (kept local so this stays a pure leaf). */
function bucket(n: number): CountBucket {
  if (n <= 0) return "none";
  if (n === 1) return "one";
  if (n <= 5) return "few";
  if (n <= 20) return "some";
  return "many";
}

const NO_SIGNALS: RawLiveProbeSignals = {
  visibleRowCount: 0,
  visibleEmptyState: false,
  visibleGridLikeSurface: false,
  frameTotal: 0,
  framesChecked: 0,
};
const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Pure: map the rendered-page signals to a decision. Visible rows win (reviews exist); else a
 * genuinely-visible empty placeholder is a real empty; else ambiguous (never a confident empty).
 */
export function decideLiveProbe(signals: RawLiveProbeSignals): LiveExportTargetProbe["decision"] {
  if (signals.visibleRowCount > 0) return "LIVE_ROWS_PRESENT";
  if (signals.visibleEmptyState) return "LIVE_EMPTY_VISIBLE";
  return "LIVE_TARGET_UNKNOWN";
}

/** Reduce raw scalar signals + loop counters to the sanitized result shape. */
function build(
  decision: LiveExportTargetProbe["decision"],
  signals: RawLiveProbeSignals,
  checks: number,
  elapsedMs: number,
): LiveExportTargetProbe {
  return {
    decision,
    visibleRowCountBucket: bucket(signals.visibleRowCount),
    visibleEmptyState: signals.visibleEmptyState,
    visibleGridLikeSurface: signals.visibleGridLikeSurface,
    frameCountBucket: bucket(signals.frameTotal),
    checkedFramesBucket: bucket(signals.framesChecked),
    checks,
    elapsedMs,
  };
}

/**
 * Poll the rendered page read-only across the bounded window, returning early ONLY when a visible
 * review row appears. At timeout, decide from the last observed signals (visible-empty vs ambiguous).
 * Never acts on the page — all reads come through the injected `readSignalsFn`.
 */
export async function probeLiveExportTargetReadiness(
  page: PwPage,
  deps: LiveExportTargetProbeDeps,
): Promise<LiveExportTargetProbe> {
  const sleep = deps.sleepFn ?? realSleep;
  const maxChecks = Math.max(1, Math.ceil(deps.timeoutMs / deps.intervalMs));
  let last: RawLiveProbeSignals | null = null;

  for (let i = 0; i < maxChecks; i += 1) {
    let signals: RawLiveProbeSignals | null = null;
    try {
      signals = await deps.readSignalsFn(page);
    } catch {
      signals = null; // transient/detached read → skip this cycle, keep polling
    }

    if (signals !== null) {
      last = signals;
      if (signals.visibleRowCount > 0) {
        // A rendered, visible row is the definitive answer — reviews exist.
        return build("LIVE_ROWS_PRESENT", signals, i + 1, i * deps.intervalMs);
      }
    }

    if (i < maxChecks - 1) await sleep(deps.intervalMs);
  }

  // Window expired with no visible row. If every read failed, stay conservatively UNKNOWN.
  const elapsedMs = (maxChecks - 1) * deps.intervalMs;
  if (last === null) return build("LIVE_TARGET_UNKNOWN", NO_SIGNALS, maxChecks, elapsedMs);
  return build(decideLiveProbe(last), last, maxChecks, elapsedMs);
}
