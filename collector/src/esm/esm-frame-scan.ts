import type { ExportCandidateVisibilitySummary } from "./esm-export-visibility";
import type { CountBucket, EsmUrlCategory } from "./esm-review-probe";

/**
 * Pure frame-aware export-scan AGGREGATOR — SANITIZED, browser-free, testable.
 *
 * Gate-2's second live run settled the DOM (`stable-no-networkidle`) yet still found
 * the top-document export candidates enabled-but-not-actionable. The leading
 * hypothesis: the real export control lives inside the page's single same-origin
 * (`seller-center`) iframe, which the top-document-only scan never enters.
 *
 * This module folds the **top document** plus each **child-frame** candidate-visibility
 * summary into one sanitized result, keeping the two scopes SEPARATE and reporting
 * only buckets / category enums. It mirrors the NAVER `summarizeFrameExportProbes`
 * pattern. It does the DECISION work; the live per-frame DOM read stays in the CLI and
 * passes only `ExportCandidateVisibilitySummary` counts + a coarse `EsmUrlCategory` per
 * frame — never a raw frame URL, selector, attribute, or any DOM text. So
 * `JSON.stringify(summarizeFrameAwareExportScan(x))` can never contain an identifier,
 * label, product name, review text, or token. Asserted by an offline test.
 *
 * FRAME-ORIGIN POLICY: a child frame is read only when it is SAME-ORIGIN, or when it
 * is cross-origin but its host is on an explicit, operator-configured **ESM-family
 * allowlist** (`frameHostAllowed`). Run #3 showed the review panel is a cross-origin
 * ESM-family iframe (same vendor, different subdomain), which a same-origin-only scan
 * cannot enter; the allowlist permits reading ONLY those trusted vendor origins,
 * read-only. Every other cross-origin frame, and any unreadable frame, is **skipped**
 * and recorded only as a sanitized bucket — we never reach into third-party content.
 * The allowlist is **fail-closed**: empty (default) → no cross-origin frame is read.
 */

/** Why a child frame's candidates are present, deliberately skipped, or unreadable. */
export type FrameScanResult = "read" | "skipped-cross-origin" | "blocked";

/** Which scope category holds the first actionable export candidate (if any). */
export type ExportScopeCategory =
  | "top-document"
  | "same-origin-frame"
  | "allowlisted-frame"
  | "none";

/**
 * Pure: is `frameUrl` an http(s) URL whose host equals — or is a dotted subdomain of —
 * an entry on the ESM-family allowlist? The allowlist holds HOSTNAMES (e.g.
 * `esmplus.com`), supplied by the operator via config and never hardcoded/guessed. The
 * dot-boundary subdomain check (`host.endsWith("." + entry)`) admits `sa2.esmplus.com`
 * for `esmplus.com` while rejecting `evil-esmplus.com`. Empty allowlist → always false
 * (fail-closed). Only the boolean is used by the caller; the raw URL/origin is never
 * emitted.
 */
export function frameHostAllowed(frameUrl: string, allowlist: readonly string[]): boolean {
  if (allowlist.length === 0) return false;
  let host: string;
  let protocol: string;
  try {
    const u = new URL(frameUrl);
    host = u.hostname.toLowerCase();
    protocol = u.protocol;
  } catch {
    return false;
  }
  if (protocol !== "http:" && protocol !== "https:") return false;
  if (host.length === 0) return false;
  return allowlist.some((raw) => {
    const entry = raw.trim().toLowerCase();
    if (entry.length === 0) return false;
    return host === entry || host.endsWith(`.${entry}`);
  });
}

/** Per-scope sanitized candidate counts, each bucketed. */
export interface ScopeCandidateBuckets {
  total: CountBucket;
  visible: CountBucket;
  enabled: CountBucket;
  actionable: CountBucket;
}

/** One child frame's sanitized scope probe. `candidates` is null unless it was read. */
export interface FrameScopeProbe {
  /** Coarse category of the frame's URL — never the raw URL. */
  frameUrlCategory: EsmUrlCategory;
  readResult: FrameScanResult;
  /** True iff this frame was treated as a cross-origin ESM-family allowlisted frame. */
  allowlisted: boolean;
  candidates: ScopeCandidateBuckets | null;
}

/** The ONLY shape printed by the frame-aware scan. Every leaf is non-sensitive. */
export interface FrameAwareExportScan {
  /** Bucketed total frame count (top document + child frames). */
  frameCount: CountBucket;
  /** Coarse, deduped, sorted categories of the child-frame URLs. */
  frameUrlCategories: EsmUrlCategory[];
  /** Bucketed count of child frames skipped (cross-origin) or unreadable (blocked). */
  skippedFrameCount: CountBucket;
  /** Bucketed count of cross-origin ESM-family frames admitted via the allowlist. */
  allowlistedFrameCount: CountBucket;
  /** The top (main) document's per-scope candidate buckets. */
  topDocument: ScopeCandidateBuckets;
  /** One entry per child frame (the top document is reported separately, above). */
  frames: FrameScopeProbe[];
  /** Aggregate: true iff SOME scope (top OR a read same-origin frame) is actionable. */
  hasActionableExportCandidate: boolean;
  /** Which scope category holds the actionable candidate(s): top first, else frame, else none. */
  actionableScope: ExportScopeCategory;
}

/** Exact set of top-level keys — used by the offline allow-list test. */
export const FRAME_AWARE_EXPORT_SCAN_KEYS: ReadonlyArray<keyof FrameAwareExportScan> = [
  "frameCount",
  "frameUrlCategories",
  "skippedFrameCount",
  "allowlistedFrameCount",
  "topDocument",
  "frames",
  "hasActionableExportCandidate",
  "actionableScope",
];

/** Exact set of per-child-frame keys — used by the offline allow-list test. */
export const FRAME_SCOPE_PROBE_KEYS: ReadonlyArray<keyof FrameScopeProbe> = [
  "frameUrlCategory",
  "readResult",
  "allowlisted",
  "candidates",
];

function bucket(n: number): CountBucket {
  if (n <= 0) return "none";
  if (n === 1) return "one";
  if (n <= 5) return "few";
  if (n <= 20) return "some";
  return "many";
}

function toScopeBuckets(s: ExportCandidateVisibilitySummary): ScopeCandidateBuckets {
  return {
    total: bucket(s.total),
    visible: bucket(s.visible),
    enabled: bucket(s.enabled),
    actionable: bucket(s.actionable),
  };
}

/** A read frame whose summary reports ≥1 actionable candidate. */
function frameIsActionable(f: {
  readResult: FrameScanResult;
  summary: ExportCandidateVisibilitySummary | null;
}): boolean {
  return f.readResult === "read" && f.summary !== null && f.summary.actionable > 0;
}

/**
 * Pure: fold the top document + per-child-frame candidate summaries into one sanitized
 * frame-aware result. `frameCount` buckets the total frames (top + children);
 * `actionableScope` reports the top document FIRST (so an actionable top-doc control is
 * never masked by a frame), then a same-origin frame, else none. No field copies input
 * text — see the SAFETY CONTRACT above.
 */
export function summarizeFrameAwareExportScan(input: {
  topDocument: ExportCandidateVisibilitySummary;
  frames: Array<{
    frameUrlCategory: EsmUrlCategory;
    readResult: FrameScanResult;
    allowlisted: boolean;
    summary: ExportCandidateVisibilitySummary | null;
  }>;
}): FrameAwareExportScan {
  const { topDocument, frames } = input;

  const categories = new Set<EsmUrlCategory>();
  for (const f of frames) categories.add(f.frameUrlCategory);

  const skipped = frames.filter((f) => f.readResult !== "read").length;
  const allowlistedCount = frames.filter((f) => f.allowlisted).length;
  const topActionable = topDocument.actionable > 0;
  // The first actionable frame decides whether the scope is a same-origin or an
  // allowlisted (cross-origin ESM-family) frame — the top document still wins overall.
  const firstActionableFrame = frames.find(frameIsActionable);

  const actionableScope: ExportScopeCategory = topActionable
    ? "top-document"
    : firstActionableFrame
      ? firstActionableFrame.allowlisted
        ? "allowlisted-frame"
        : "same-origin-frame"
      : "none";

  return {
    frameCount: bucket(frames.length + 1),
    frameUrlCategories: [...categories].sort(),
    skippedFrameCount: bucket(skipped),
    allowlistedFrameCount: bucket(allowlistedCount),
    topDocument: toScopeBuckets(topDocument),
    frames: frames.map((f) => ({
      frameUrlCategory: f.frameUrlCategory,
      readResult: f.readResult,
      allowlisted: f.allowlisted,
      candidates: f.readResult === "read" && f.summary !== null ? toScopeBuckets(f.summary) : null,
    })),
    hasActionableExportCandidate: topActionable || firstActionableFrame !== undefined,
    actionableScope,
  };
}
