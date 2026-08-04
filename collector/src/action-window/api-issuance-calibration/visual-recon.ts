/**
 * **API-center VISUAL RECON — the PURE safety-decision core.**
 *
 * Visual recon is a *different* calibration strategy from the hotkey model in `./calibration.ts`: instead of
 * the operator hovering one element and pressing a hotkey, SellerOps captures a **redacted screenshot** of the
 * real API-center screen the operator navigated to, plus a sanitized structural summary, and a HUMAN reviewer
 * (Claude) reads that redacted image + limited structure to identify the target control and later propose a
 * selector candidate. This module is where every rule that keeps that capture safe lives, so a reviewer has ONE
 * place to trust. The live CLI (`src/cli/capture-api-center-visual.ts`) and the in-page scripts
 * (`./visual-recon-inpage.ts`) only *gather* — this module decides:
 *
 *  1. **May a screenshot be taken at all?** ({@link verifyRedaction} → {@link mayScreenshot}.) The in-page
 *     redaction pass draws opaque overlays over every sensitive region and reports how many sensitive elements
 *     it DETECTED vs how many it COVERED. This module **fails closed**: unless every detected sensitive element
 *     (per category, across every frame) is fully covered by an intact opaque overlay, `mayScreenshot` is
 *     `false` and the CLI must NOT screenshot. A malformed / missing report is a HALT, never a pass.
 *  2. **What may the sanitized summary carry?** ({@link sanitizeVisualSummary}.) Only closed-vocab roles/tags,
 *     coarse bounding-box buckets, structural signatures, presence booleans, and integer counts — NEVER a raw
 *     selector, attribute value, element text, field value, or URL. Attribute values are screened through the
 *     frozen {@link looksSensitive} gate before even a boolean is derived from them.
 *  3. **May a proposed selector be adopted?** ({@link evaluateSelectorCandidate}.) The five adoption conditions
 *     (the screenshot target and the structural candidate are the same control; exactly one match; no
 *     dependence on an account/credential value; a text selector uses only a FIXED UI label, never user data;
 *     never position-only). Adoption itself — writing selectors into product code / flipping
 *     `SELECTORS_CALIBRATED` — is a SEPARATE, explicitly-authorized step this module never performs.
 *
 * **Credentials are never a selector target.** The Client ID / Application ID / Secret VALUE (and its field) is
 * always redacted and is excluded from selector building — only the section label / container / display-or-copy
 * control POSITION may ever be identified, and the value stays hidden even from the reviewer.
 *
 * Pure: no I/O, no browser, no wall-clock (uses `node:crypto` only via the reused structural hash).
 */
import {
  ALLOWED_INPUT_TYPES,
  ALLOWED_ROLES,
  ALLOWED_TAGS,
  looksSensitive,
  structuralSignature,
  type CalibrationResolution,
  type RawAttribute,
} from "./calibration";
import { countBucket, observeFrom, type ApiCenterPageCategory, type ApiCenterSignals, type ApiCenterStructuralCensus, type ApiCenterUrlCategory, type CountBucket } from "../../cli/observe-api-center";

/* ────────────────────────────── the four recon screens ────────────────────────────── */

/**
 * The four API-center screens visual recon covers, in the natural onboarding order. Distinct from the hotkey
 * calibrator's `CALIBRATION_STAGES` (which carried an `app_detail_anchor` capture stage): visual recon captures
 * a redacted image of each SCREEN, so the unit is the screen, not a per-element anchor.
 */
export const VISUAL_RECON_SCREENS = ["app_list", "app_detail", "api_group", "credentials"] as const;
export type VisualReconScreen = (typeof VISUAL_RECON_SCREENS)[number];

/**
 * The API center presents these four screens across just TWO real pages: the applications LIST, and a single
 * application DETAIL page whose credential section and API-group section are the SAME page at different scroll
 * positions (operator-confirmed live). So `app_detail` / `api_group` / `credentials` are VIEWPORT CHECKPOINTS of
 * one `application_detail` page — the operator navigates once and then just scrolls — while `app_list` is its own
 * page. This drives the operator instruction (navigate to a new page vs. scroll within the same page) and keeps
 * the recon honest about how many real page loads there are. `VISUAL_RECON_SCREENS` (and the manifest) are
 * unchanged; this is grouping metadata only.
 */
export type VisualReconPage = "application_list" | "application_detail";
export interface VisualReconCheckpoint {
  screen: VisualReconScreen;
  page: VisualReconPage;
  /** "page" = a distinct page load; "viewport_checkpoint" = the same page as the previous checkpoint, scrolled. */
  kind: "page" | "viewport_checkpoint";
  /** Operator guidance: open/navigate to a new page, or scroll to the section on the SAME page (no navigation). */
  navigation: "navigate" | "scroll_same_page";
}
export const VISUAL_RECON_CHECKPOINTS: readonly VisualReconCheckpoint[] = [
  { screen: "app_list", page: "application_list", kind: "page", navigation: "navigate" },
  { screen: "app_detail", page: "application_detail", kind: "page", navigation: "navigate" },
  { screen: "api_group", page: "application_detail", kind: "viewport_checkpoint", navigation: "scroll_same_page" },
  { screen: "credentials", page: "application_detail", kind: "viewport_checkpoint", navigation: "scroll_same_page" },
];
/** The checkpoint metadata for a screen (defaults to a standalone page if — impossibly — unmapped). */
export function checkpointFor(screen: VisualReconScreen): VisualReconCheckpoint {
  return VISUAL_RECON_CHECKPOINTS.find((c) => c.screen === screen) ?? { screen, page: "application_list", kind: "page", navigation: "navigate" };
}

export type VisualReconScopeResult = { ok: true; screens: VisualReconScreen[] } | { ok: false; reason: string };

/**
 * Resolve a per-run visual-recon capture SCOPE from a comma-separated request, fail-closed. A scoped recon
 * lets one investigation capture only the screens it needs (e.g. the app usage-state check needs `app_list` +
 * `app_detail`, not `api_group` / `credentials`) — strictly NARROWER than the full fixed set, never wider.
 *
 * <ul>
 *   <li>Absent / empty ⇒ the FULL fixed set (`VISUAL_RECON_SCREENS`) — backward-compatible with an unscoped run.</li>
 *   <li>Every requested token must be a known screen; ANY unknown token fails closed (never silently dropped,
 *       never over-captures a screen outside the fixed set).</li>
 *   <li>The result is returned in the canonical registry order and de-duplicated, so the manifest and the
 *       capture loop agree on the exact screens regardless of the order/duplication the request was written in.</li>
 * </ul>
 *
 * This is the SINGLE source both the approval-manifest gate and the capture CLI resolve their scope through, so a
 * manifest can never declare a set the capture would not honor (or vice-versa).
 */
export function resolveVisualReconScope(raw: string | undefined | null): VisualReconScopeResult {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { ok: true, screens: [...VISUAL_RECON_SCREENS] };
  const requested = trimmed.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  if (requested.length === 0) return { ok: true, screens: [...VISUAL_RECON_SCREENS] };
  const known = VISUAL_RECON_SCREENS as readonly string[];
  const unknown = requested.filter((s) => !known.includes(s));
  if (unknown.length > 0) return { ok: false, reason: `unknown visual-recon screen(s): ${unknown.join(", ")}` };
  // Canonical order + dedup: filter the fixed set by membership so app_list always precedes app_detail, etc.
  const screens = VISUAL_RECON_SCREENS.filter((s) => requested.includes(s));
  return { ok: true, screens };
}

/**
 * Whether `screens` is a valid, NON-EMPTY, canonical-ordered subset of the fixed recon set (the shape the
 * manifest gate accepts). Canonical-ordered means it equals `VISUAL_RECON_SCREENS` filtered by membership —
 * so no unknown screen, no duplicate, and no re-ordering can slip through.
 */
export function isCanonicalVisualReconSubset(screens: readonly string[]): boolean {
  if (screens.length === 0) return false;
  const canonical = VISUAL_RECON_SCREENS.filter((s) => (screens as readonly string[]).includes(s));
  return canonical.length === screens.length && canonical.every((s, i) => s === screens[i]);
}

/** A read-only fixed-label match result: how many elements a fixed NAVER-label probe matched (value-free). */
export interface FixedLabelMatch {
  /** A stable, sanitized target id — never a selector, never user data. */
  targetId: string;
  /** Live `count` of elements whose role + accessible name equals the fixed label (integer only). */
  matchCount: number;
}

/* ────────────────────────────── redaction categories + report ────────────────────────────── */

/**
 * The closed vocabulary of sensitive regions the in-page pass must cover BEFORE any screenshot. Every category
 * is redacted by drawing an opaque overlay over the element's box; fixed UI labels are deliberately NOT in this
 * set, so the reviewer still sees the page's structure/labels while every value/identity is hidden.
 *  - `form_field`       — every `input` / `textarea` / `select` (its typed or displayed value).
 *  - `password`         — `input[type=password]` (masked, still covered).
 *  - `readonly_or_code` — `[readonly]` / `[disabled]` inputs, `code`, `pre` (where issued values are shown).
 *  - `credential_area`  — a container whose accessible name mentions a secret / client-id (Application ID /
 *                         Client ID / Secret value area), by ATTRIBUTE only — never by reading the value.
 *  - `copy_linked`      — a value box tied to a "복사/copy" control (the thing a copy button would copy).
 *  - `identity_text`    — a leaf whose TEXT matches an email / long numeric id / secret-like token (detected in
 *                         page, NEVER emitted — only counted). Catches stray account/store identifiers.
 *  - `chrome_region`    — the site header / banner / account nav / footer (logged-in account + store name).
 */
export const REDACTION_CATEGORIES = [
  "form_field",
  "password",
  "readonly_or_code",
  "credential_area",
  "copy_linked",
  "identity_text",
  "chrome_region",
] as const;
export type RedactionCategory = (typeof REDACTION_CATEGORIES)[number];

/** Per-category integer counts. In-page fills these; this module never trusts a field it did not expect. */
export type RedactionCounts = Record<RedactionCategory, number>;

/**
 * The `identity_text` redaction POLICY — the one category driven by a TEXT match. It covers what is genuinely
 * identifying/sensitive: the operator ACCOUNT handle, an API-call IP, and any long credential/token/secret
 * string. It deliberately does NOT cover a PUBLIC store name or a general (Korean-prose) app description —
 * neither carries an ASCII identifier pattern, so both stay visible for the reviewer.
 *
 * Single source of truth: the in-page redaction script builds its regexes from these same sources, and
 * {@link isIdentityTextToRedact} is the Node-side predicate a unit test exercises directly.
 */
export const IDENTITY_REDACT_PATTERN_SOURCES: readonly string[] = [
  "[^\\s@]+@[^\\s@]+\\.[^\\s@]+", // email
  "\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}", // IPv4 (e.g. an API-call IP)
  "\\d{6,}", // a long numeric id
  "(?=[A-Za-z0-9_-]*\\d)[A-Za-z0-9_-]{12,}", // a long credential/token/secret/client-id (12+ chars incl. a digit)
  "[A-Za-z][A-Za-z0-9]{2,}\\d{2,}", // a login-id-like account handle (letters then ≥2 digits)
  "[\\uAC00-\\uD7A3A-Za-z0-9_.\\-]{1,}\\s*님", // the logged-in account greeting "<id-or-name> 님" (Hangul or ASCII)
];

/**
 * Node-side mirror of the in-page `identity_text` decision: does this element's own text carry an
 * account/IP/credential identifier that must be redacted? A public store name or a general app description
 * (no ASCII identifier pattern) → `false`. Empty/oversized text → `false` (nothing to cover).
 */
export function isIdentityTextToRedact(text: string): boolean {
  if (typeof text !== "string" || text.length === 0 || text.length > 4000) return false;
  for (const src of IDENTITY_REDACT_PATTERN_SOURCES) {
    if (new RegExp(src).test(text)) return true;
  }
  return false;
}

/**
 * The RAW redaction report the in-page pass returns for ONE frame. Integers + booleans ONLY — it carries no
 * text, value, selector, or URL (the in-page pass reads text solely to DECIDE coverage and returns only counts).
 */
export interface RawRedactionReport {
  /** The frame had a `document.body` to redact (an `about:blank` sub-frame has none → nothing to cover). */
  bodyPresent: boolean;
  /** How many opaque overlays were drawn in this frame. */
  overlayCount: number;
  /** Every drawn overlay is still present + opaque + covers its target box (in-page geometry/opacity recheck). */
  integrityOk: boolean;
  /** How many sensitive elements were DETECTED per category. */
  detected: RedactionCounts;
  /** How many of those were fully COVERED per category (covered ≤ detected always). */
  covered: RedactionCounts;
}

export type RedactionHaltReason =
  | "MALFORMED_REPORT" // a missing / non-integer / negative count, or covered > detected → cannot trust it
  | "NO_FRAME_WITH_BODY" // not a single frame had a body to redact → nothing was actually inspected
  | "UNCOVERED_SENSITIVE" // at least one detected sensitive element was not covered (per-category check)
  | "OVERLAY_INTEGRITY_FAILED" // a drawn overlay is gone / transparent / no longer covering its target
  | "NO_OVERLAY_WHEN_SENSITIVE"; // sensitive elements detected but zero overlays drawn (redaction did not run)

export interface RedactionVerdict {
  status: "pass" | "halt";
  reasons: RedactionHaltReason[];
  totalDetected: number;
  totalCovered: number;
  overlayCount: number;
  /** Frames that reported a body (i.e. were actually inspected). */
  framesInspected: number;
}

function isNonNegInt(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}

/** Sum the per-category counts, treating a malformed field as a hard failure signalled by returning null. */
function sumCounts(counts: RedactionCounts | undefined): number | null {
  if (!counts || typeof counts !== "object") return null;
  let total = 0;
  for (const cat of REDACTION_CATEGORIES) {
    const v = (counts as Record<string, unknown>)[cat];
    if (!isNonNegInt(v)) return null;
    total += v;
  }
  return total;
}

/**
 * Decide — fail-closed — whether the page is fully redacted and a screenshot may be taken. Aggregates one report
 * per frame (top document + every child frame). A screenshot is allowed ONLY when, across every frame:
 *  - every report is well-formed (all category counts are non-negative integers, `covered ≤ detected`),
 *  - at least one frame actually had a body to inspect,
 *  - every detected sensitive element is covered — checked PER CATEGORY per frame, so one category's surplus can
 *    never mask another's shortfall,
 *  - every frame's overlay integrity holds, and
 *  - no frame detected sensitive elements while drawing zero overlays.
 * Any violation ⇒ `halt` (the CLI must not screenshot). An empty report list ⇒ halt (nothing was inspected).
 */
export function verifyRedaction(reports: readonly RawRedactionReport[]): RedactionVerdict {
  const reasons = new Set<RedactionHaltReason>();
  let totalDetected = 0;
  let totalCovered = 0;
  let overlayCount = 0;
  let framesInspected = 0;

  if (!Array.isArray(reports) || reports.length === 0) {
    return { status: "halt", reasons: ["NO_FRAME_WITH_BODY"], totalDetected: 0, totalCovered: 0, overlayCount: 0, framesInspected: 0 };
  }

  for (const r of reports) {
    if (!r || typeof r !== "object" || typeof r.bodyPresent !== "boolean" || typeof r.integrityOk !== "boolean" || !isNonNegInt(r.overlayCount)) {
      reasons.add("MALFORMED_REPORT");
      continue;
    }
    const det = sumCounts(r.detected);
    const cov = sumCounts(r.covered);
    if (det === null || cov === null) {
      reasons.add("MALFORMED_REPORT");
      continue;
    }
    // Per-category coverage: covered must never exceed detected, and must equal it (no uncovered residue).
    for (const cat of REDACTION_CATEGORIES) {
      const d = r.detected[cat];
      const c = r.covered[cat];
      if (c > d) {
        reasons.add("MALFORMED_REPORT");
      } else if (c < d) {
        reasons.add("UNCOVERED_SENSITIVE");
      }
    }
    if (!r.integrityOk) reasons.add("OVERLAY_INTEGRITY_FAILED");
    if (det > 0 && r.overlayCount === 0) reasons.add("NO_OVERLAY_WHEN_SENSITIVE");

    overlayCount += r.overlayCount;
    totalDetected += det;
    totalCovered += cov;
    if (r.bodyPresent) framesInspected += 1;
  }

  if (framesInspected === 0) reasons.add("NO_FRAME_WITH_BODY");

  const status: RedactionVerdict["status"] = reasons.size === 0 ? "pass" : "halt";
  return { status, reasons: [...reasons], totalDetected, totalCovered, overlayCount, framesInspected };
}

/**
 * The single authority the CLI must consult before `.screenshot(...)`. `true` ONLY on a clean `pass` verdict.
 * Keeping this a one-line pure predicate (never inlined in the CLI) means the "did redaction pass?" decision is
 * unit-tested in exactly one place and cannot drift.
 */
export function mayScreenshot(verdict: RedactionVerdict): boolean {
  return verdict.status === "pass";
}

/* ────────────────────────────── raw visual census (from the in-page sweep) ────────────────────────────── */

/**
 * One interactive/structural control the in-page census found on the screen. STRUCTURE ONLY — the in-page sweep
 * never reads `.value` / `.textContent` / `.innerHTML`; attribute VALUES here are only the selector-seed names
 * and are screened by {@link sanitizeVisualSummary} before anything (even a boolean) is derived from them.
 */
export interface RawVisualControl {
  tagName: string;
  role?: string;
  inputType?: string;
  ancestryTags: string[];
  siblingIndex: number;
  siblingCount: number;
  boundingBox: { x: number; y: number; w: number; h: number };
  viewport: { w: number; h: number };
  /** Candidate stable attributes (raw values, screened here — never persisted raw by this module). */
  stableAttributes: RawAttribute[];
  /** How many elements the strongest candidate selector matches (in-page `querySelectorAll(...).length`). */
  matchCount: number;
}

/** The RAW per-screen summary the in-page sweep returns (before sanitization). */
export interface RawVisualSummary {
  controls: RawVisualControl[];
  census: ApiCenterStructuralCensus;
}

/* ────────────────────────────── sanitized visual summary (safe for the reviewer) ────────────────────────────── */

/**
 * A sanitized control the reviewer may see: closed-vocab role/tag, coarse box bucket, sibling position, ancestry
 * TAG chain, presence booleans, an opaque structural hash, and a match count. NEVER a raw selector / value /
 * text. This is what lets the reviewer correlate a control in the redacted screenshot with a stable structure.
 */
export interface SanitizedVisualControl {
  tagName: string; // closed vocab or "other"
  role: string; // closed vocab or "other"
  inputType: string; // closed vocab or "none"
  ancestryTags: string[];
  ancestryDepth: number;
  siblingPosition: "only" | "first" | "middle" | "last";
  boundingBoxBucket: { xBucket: "left" | "center" | "right"; yBucket: "top" | "middle" | "bottom"; sizeBucket: "small" | "medium" | "large" };
  hasStableId: boolean;
  hasStableTestAttr: boolean; // data-* / aria-* present (presence only — never the value)
  structuralSignature: string; // opaque 16-hex structural hash (reused frozen hash)
  matchCount: number;
  /** Whether the strongest candidate would resolve uniquely (matchCount === 1). Sanitized preview only. */
  resolution: CalibrationResolution;
}

/** The sanitized per-screen artifact the reviewer reads alongside the redacted screenshot. No raw content. */
export interface SanitizedVisualSummary {
  screen: VisualReconScreen;
  pageCategory: ApiCenterPageCategory;
  signals: ApiCenterSignals;
  controls: SanitizedVisualControl[];
  redaction: {
    status: RedactionVerdict["status"];
    totalDetected: number;
    totalCovered: number;
    overlayCount: number;
    framesInspected: number;
    /** How each category was covered (detected/covered), aggregated across frames. Integers only. */
    categories: { category: RedactionCategory; detected: number; covered: number }[];
  };
  screenshot: {
    /** A redacted screenshot was written for this screen (only ever true when redaction PASSED). */
    taken: boolean;
    /** Coarse viewport buckets — never exact pixels. */
    widthBucket: CountBucket;
    heightBucket: CountBucket;
  };
  /** Read-only fixed-label probe results for this screen (value-free integer counts); empty if not probed. */
  labelMatchCounts: FixedLabelMatch[];
  /** Always true: these are unproven candidates awaiting reviewer adoption, never a proven detector. */
  calibrationPending: true;
}

function inVocab(value: string | undefined, vocab: readonly string[], fallback = "other"): string {
  return value !== undefined && (vocab as readonly string[]).includes(value) ? value : fallback;
}

function siblingPositionOf(index: number, count: number): SanitizedVisualControl["siblingPosition"] {
  if (count <= 1) return "only";
  if (index <= 0) return "first";
  if (index >= count - 1) return "last";
  return "middle";
}

function boxBucketOf(box: RawVisualControl["boundingBox"], vp: RawVisualControl["viewport"]): SanitizedVisualControl["boundingBoxBucket"] {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const xBucket = vp.w <= 0 ? "center" : cx < vp.w / 3 ? "left" : cx < (2 * vp.w) / 3 ? "center" : "right";
  const yBucket = vp.h <= 0 ? "middle" : cy < vp.h / 3 ? "top" : cy < (2 * vp.h) / 3 ? "middle" : "bottom";
  const area = box.w * box.h;
  const sizeBucket = area < 2500 ? "small" : area < 40000 ? "medium" : "large";
  return { xBucket, yBucket, sizeBucket };
}

/** Attribute names that may indicate a stable hook (presence only — the VALUE is screened, never emitted). */
const SELECTOR_ATTR_NAMES = ["id", "data-testid", "data-test", "data-cy", "data-qa", "aria-label", "name", "role", "class"];

/** The fixed shape of a visual-recon target id (`<group>.<name>`, lowercase snake) — the only `targetId` emitted. */
const TARGET_ID_SHAPE = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

function sanitizeControl(raw: RawVisualControl): SanitizedVisualControl {
  const tagName = inVocab(raw.tagName?.toLowerCase(), ALLOWED_TAGS);
  const role = inVocab(raw.role?.toLowerCase(), ALLOWED_ROLES);
  const inputType = inVocab(raw.inputType?.toLowerCase(), ALLOWED_INPUT_TYPES, "none");
  const ancestryTags = (raw.ancestryTags ?? []).map((t) => inVocab(t?.toLowerCase(), ALLOWED_TAGS));
  // Screen attribute VALUES through the frozen sensitive-value gate; only a NON-sensitive value contributes a
  // presence boolean. A sensitive-looking id/name (e.g. a UUID app id) never even flips a boolean on.
  const safeAttrs = (raw.stableAttributes ?? []).filter((a) => SELECTOR_ATTR_NAMES.includes(a.name) && !looksSensitive(a.value));
  const matchCount = isNonNegInt(raw.matchCount) ? raw.matchCount : 0;
  const resolution: CalibrationResolution = matchCount === 1 ? "resolved" : matchCount <= 0 ? "unresolved_none" : "unresolved_multiple";
  return {
    tagName,
    role,
    inputType,
    ancestryTags,
    ancestryDepth: ancestryTags.length,
    siblingPosition: siblingPositionOf(raw.siblingIndex, raw.siblingCount),
    boundingBoxBucket: boxBucketOf(raw.boundingBox, raw.viewport),
    hasStableId: safeAttrs.some((a) => a.name === "id"),
    hasStableTestAttr: safeAttrs.some((a) => a.name.startsWith("data-") || a.name.startsWith("aria-")),
    structuralSignature: structuralSignature(raw.tagName ?? "", raw.ancestryTags ?? [], raw.siblingIndex, raw.siblingCount),
    matchCount,
    resolution,
  };
}

/** Aggregate per-category detected/covered across every frame's report (integers only). */
function aggregateCategories(reports: readonly RawRedactionReport[]): { category: RedactionCategory; detected: number; covered: number }[] {
  return REDACTION_CATEGORIES.map((category) => {
    let detected = 0;
    let covered = 0;
    for (const r of reports) {
      const d = r?.detected?.[category];
      const c = r?.covered?.[category];
      if (isNonNegInt(d)) detected += d;
      if (isNonNegInt(c)) covered += c;
    }
    return { category, detected, covered };
  });
}

/**
 * Build the sanitized per-screen summary from the raw census + the redaction verdict + the per-frame reports.
 * `screenshotTaken` MUST be the CLI's real outcome (only ever true when {@link mayScreenshot} was true) — this
 * module records it but never itself takes a screenshot. Nothing raw survives: controls are sanitized, the page
 * category comes from the frozen `observeFrom`, and only integer redaction counts are echoed.
 */
export function sanitizeVisualSummary(input: {
  screen: VisualReconScreen;
  urlCategory: ApiCenterUrlCategory;
  raw: RawVisualSummary;
  reports: readonly RawRedactionReport[];
  verdict: RedactionVerdict;
  screenshotTaken: boolean;
  viewport: { w: number; h: number };
  /** Raw fixed-label probe results (from the in-page probe). Coerced to value-free integer counts here. */
  labelMatches?: readonly { targetId: string; matchCount: number }[];
}): SanitizedVisualSummary {
  const obs = observeFrom(input.urlCategory, input.raw.census);
  // `targetId` is the one verbatim string channel in the summary, so screen it like every other emitted string:
  // it must have our fixed `<group>.<name>` snake shape AND pass the sensitive-value gate. A page that tampered
  // with the probe's output to smuggle a page-derived string (e.g. a credential fragment) is dropped here.
  // `matchCount` is coerced to a non-negative int.
  const labelMatchCounts: FixedLabelMatch[] = (input.labelMatches ?? [])
    .filter((m) => typeof m?.targetId === "string" && TARGET_ID_SHAPE.test(m.targetId) && !looksSensitive(m.targetId))
    .map((m) => ({ targetId: m.targetId, matchCount: isNonNegInt(m.matchCount) ? m.matchCount : 0 }));
  return {
    screen: input.screen,
    pageCategory: obs.pageCategory,
    signals: obs.signals,
    controls: (input.raw.controls ?? []).map(sanitizeControl),
    redaction: {
      status: input.verdict.status,
      totalDetected: input.verdict.totalDetected,
      totalCovered: input.verdict.totalCovered,
      overlayCount: input.verdict.overlayCount,
      framesInspected: input.verdict.framesInspected,
      categories: aggregateCategories(input.reports),
    },
    screenshot: {
      // Defence in depth: a screenshot is only ever recorded as taken when the verdict actually passed.
      taken: input.screenshotTaken && mayScreenshot(input.verdict),
      widthBucket: countBucket(input.viewport.w),
      heightBucket: countBucket(input.viewport.h),
    },
    labelMatchCounts,
    calibrationPending: true,
  };
}

/* ────────────────────────────── selector-candidate adoption gate ────────────────────────────── */

/**
 * A selector a reviewer proposes AFTER studying the redacted screenshot + a narrow structural inspection. The
 * booleans are the reviewer's attestations about how the selector was derived. This module does not adopt it —
 * it only decides whether it is ELIGIBLE for a later, separately-authorized adoption step.
 */
export interface SelectorCandidate {
  screen: VisualReconScreen;
  /** The proposed CSS selector (screened here — a sensitive-looking selector is refused). */
  selector: string;
  /** `querySelectorAll(selector).length` on the real screen. */
  matchCount: number;
  /** The redacted screenshot target and this structural candidate are the SAME control (reviewer attestation). */
  screenshotTargetConfirmed: boolean;
  /** The selector depends on an account / store / credential value (must be false to adopt). */
  dependsOnAccountOrCredential: boolean;
  /** The selector identifies only a POSITION (coordinate / nth-child index), not a stable structural hook. */
  positionOnly: boolean;
  /** The selector uses a text match (`:has-text` / label text). When true, `usesFixedLabelTextOnly` must hold. */
  usesTextMatch: boolean;
  /** Any text used is a FIXED UI label (e.g. "애플리케이션 등록"), never user/account/credential data. */
  usesFixedLabelTextOnly: boolean;
}

export type SelectorRejectReason =
  | "SCREENSHOT_TARGET_UNCONFIRMED"
  | "NOT_UNIQUE"
  | "DEPENDS_ON_ACCOUNT_OR_CREDENTIAL"
  | "POSITION_ONLY"
  | "TEXT_SELECTOR_NOT_FIXED_LABEL"
  | "SENSITIVE_SELECTOR"
  | "CREDENTIAL_VALUE_TARGET";

/**
 * Encode the five adoption conditions as a fail-closed gate. A candidate is adoptable ONLY when: the screenshot
 * target is confirmed to be the same control; it matches exactly one element; it does not depend on an
 * account/credential value; it is not position-only; and any text it uses is a fixed UI label. Additionally the
 * selector string itself is screened (a sensitive-looking selector is refused), and on the `credentials` screen
 * a selector that targets the value (rather than the label/section/control) is refused outright.
 *
 * This gate is the ENTRY condition for adoption — it never performs adoption and never flips `SELECTORS_CALIBRATED`.
 */
export function evaluateSelectorCandidate(c: SelectorCandidate): { adoptable: boolean; reasons: SelectorRejectReason[] } {
  const reasons: SelectorRejectReason[] = [];
  if (!c.screenshotTargetConfirmed) reasons.push("SCREENSHOT_TARGET_UNCONFIRMED");
  if (c.matchCount !== 1) reasons.push("NOT_UNIQUE");
  if (c.dependsOnAccountOrCredential) reasons.push("DEPENDS_ON_ACCOUNT_OR_CREDENTIAL");
  if (c.positionOnly) reasons.push("POSITION_ONLY");
  if (c.usesTextMatch && !c.usesFixedLabelTextOnly) reasons.push("TEXT_SELECTOR_NOT_FIXED_LABEL");
  if (selectorLooksSensitive(c.selector)) reasons.push("SENSITIVE_SELECTOR");
  // On the credentials screen the value field/box is never an adoptable target — only the section/label/control.
  if (c.screen === "credentials" && /secret|시크릿|client[-_ ]?id|password|value/i.test(c.selector)) reasons.push("CREDENTIAL_VALUE_TARGET");
  return { adoptable: reasons.length === 0, reasons };
}

/**
 * A selector is sensitive when it is empty, itself looks like a credential, targets a value attribute
 * (`[value=…]` binds to whatever is typed there), or EMBEDS a sensitive-looking quoted token (a UUID app id,
 * email, long id, secret). Checking quoted substrings — not just the whole string — catches a selector that
 * pins an element by an account/credential value even though the surrounding CSS looks innocuous.
 */
function selectorLooksSensitive(selector: string): boolean {
  if (typeof selector !== "string") return true;
  const sel = selector.trim();
  if (sel.length === 0) return true;
  if (looksSensitive(sel)) return true;
  if (/\[\s*value\s*=/i.test(sel)) return true; // pinning by a typed value
  for (const m of sel.matchAll(/["']([^"']+)["']/g)) {
    if (looksSensitive(m[1] ?? "")) return true;
  }
  return false;
}
