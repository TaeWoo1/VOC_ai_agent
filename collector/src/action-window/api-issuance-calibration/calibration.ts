/**
 * **API-center multi-surface selector calibration — the PURE safety-decision core.**
 *
 * This module is where every sanitization and acceptance rule for live selector calibration lives, so the
 * rules are testable offline and there is ONE place a reviewer must trust. The live CLI
 * (`src/cli/calibrate-api-center.ts`) and the in-page scripts (`calibration-inpage.ts`) only *gather* a raw,
 * structural capture of an element the operator hovered; this module decides what — if anything — may be kept,
 * and splits it into a SANITIZED candidate (safe to log / document) and a RAW artifact entry (gitignored,
 * owner-only, for later code adoption after an independent security review).
 *
 * **Hard invariants enforced here (see the offline tests + guard):**
 *  - A target is adoptable ONLY when its candidate selector matches EXACTLY ONE element (`matchCount === 1`).
 *    `0` ⇒ `unresolved_none`, `≥2` ⇒ `unresolved_multiple`. Never guess.
 *  - **No value ever.** The raw capture must carry only STRUCTURE (tag/role/type, ancestry tag chain, sibling
 *    position, bounding box, attribute NAMES + attribute VALUES used solely to build a selector). It must NOT
 *    carry element text/value; the in-page scripts never read `.value`/`.textContent`/`.innerHTML`. This module
 *    additionally **fail-closes** any attribute VALUE that looks like a credential/identifier (email, UUID,
 *    numeric account id, secret-like token, JWT): such an attribute is dropped from the selector, and if the
 *    selector then cannot be built safely the target is left unresolved.
 *  - **Credential area = position only.** For the `credentials` target the value input / readonly value element
 *    is EXCLUDED from selector building (it carries the Secret); only a container/label/control position is
 *    kept. A Secret display/copy button is captured as a position, never pressed.
 *  - **Sanitized ≠ raw.** The sanitized candidate carries booleans / closed-vocab enums / buckets / an opaque
 *    structural hash / a match count — never a raw selector, attribute value, id, or text. The raw selector +
 *    attribute values live ONLY in the gitignored artifact entry.
 *
 * Pure: no I/O, no browser, no wall-clock (uses `node:crypto` only for a deterministic structural hash).
 */
import { createHash } from "node:crypto";
import type { IssuanceTarget } from "../api-issuance/issuance-driver";

/** The five observation surfaces walked in one calibration session (maps onto where each target lives). */
export const CALIBRATION_STAGES = ["app_list", "app_detail", "api_group", "credentials", "return_path"] as const;
export type CalibrationStage = (typeof CALIBRATION_STAGES)[number];

/** The five highlightable controls a Phase-B highlight driver needs (same set as `IssuanceTarget`). */
export const CALIBRATION_TARGET_KINDS: readonly IssuanceTarget[] = ["create_app", "open_app", "api_group", "credentials", "return"];

/** Closed vocabulary — anything outside each set is recorded as the safe fallback, never the raw string. */
export const ALLOWED_TAGS = ["a", "button", "input", "select", "textarea", "label", "span", "div", "li", "td", "th", "section", "nav", "form", "summary", "details", "p", "h1", "h2", "h3"] as const;
export const ALLOWED_ROLES = ["button", "link", "tab", "row", "gridcell", "cell", "menuitem", "textbox", "combobox", "listitem", "heading", "none"] as const;
export const ALLOWED_INPUT_TYPES = ["text", "email", "tel", "number", "url", "search", "password", "checkbox", "radio", "submit", "button", "none"] as const;
const OTHER = "other";

function inVocab(value: string | undefined, vocab: readonly string[], fallback = OTHER): string {
  return value !== undefined && (vocab as readonly string[]).includes(value) ? value : fallback;
}

/* ────────────────────────────── sensitive-value detection (fail-closed) ────────────────────────────── */

const RE_EMAIL = /@/;
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RE_NUMERIC_ID = /^\d{4,}$/; // a bare long number = an internal account/store/order id
const RE_JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/; // header.payload.sig
/** A long, mixed-case-or-digit random-looking token = secret-like. Deliberately conservative (fail-closed). */
function looksSecretLike(v: string): boolean {
  if (v.length < 16) return false;
  const hasLetter = /[A-Za-z]/.test(v);
  const hasDigit = /\d/.test(v);
  const mostlyTokenChars = /^[A-Za-z0-9_\-.:/+=]+$/.test(v);
  return mostlyTokenChars && hasLetter && hasDigit;
}

/**
 * True when a string looks like a credential or a raw identifier and must NEVER be kept (even in the gitignored
 * artifact). Fail-closed: when in doubt, treat as sensitive.
 */
export function looksSensitive(value: string): boolean {
  const v = value.trim();
  if (v.length === 0) return false;
  if (v.length > 64) return true; // an over-long attribute value is not a stable selector token
  return RE_EMAIL.test(v) || RE_UUID.test(v) || RE_NUMERIC_ID.test(v) || RE_JWT.test(v) || looksSecretLike(v);
}

/* ────────────────────────────── raw capture (from the in-page script) ────────────────────────────── */

/** One stable attribute considered for a selector. `value` is RAW and screened here before anything keeps it. */
export interface RawAttribute {
  name: string; // e.g. "id", "class", "data-testid", "role", "aria-label"
  value: string;
}

/**
 * The RAW structural capture the in-page hotkey handler produces for the hovered element. STRUCTURE ONLY — the
 * in-page script never reads `.value` / `.textContent` / `.innerHTML`; attribute VALUES here are only the ones
 * used to build a selector, and are screened by {@link sanitizeCapture} before anything is retained.
 */
export interface RawTargetCapture {
  targetKind: IssuanceTarget;
  tagName: string;
  role?: string;
  inputType?: string;
  /** The element is a readonly / value-bearing field (a place a value is DISPLAYED). Excluded from selectors. */
  isReadOnly: boolean;
  /** The element is (or is inside) a credential value control (password/masked/Secret field). Excluded. */
  isCredentialValueElement: boolean;
  /** Ancestor tag-name chain (structure only, nearest-first). No values. */
  ancestryTags: string[];
  siblingIndex: number;
  siblingCount: number;
  boundingBox: { x: number; y: number; w: number; h: number };
  /** Candidate stable attributes (raw values, screened here). */
  stableAttributes: RawAttribute[];
  /** A selector the in-page script built from the stable attributes (raw; screened + match-counted here). */
  candidateSelector: string;
  /** How many elements that candidate selector matches on the page (the in-page script counted; never clicked). */
  matchCount: number;
  /** Viewport size, for coarse bounding-box bucketing. */
  viewport: { w: number; h: number };
}

/* ────────────────────────────── sanitized output (safe to log/document) ────────────────────────────── */

export type CalibrationResolution = "resolved" | "unresolved_none" | "unresolved_multiple" | "excluded_credential_value";
export type CalibrationConfidence = "high" | "medium" | "low";

export interface SanitizedTargetCandidate {
  targetKind: IssuanceTarget;
  tagName: string; // closed vocab or "other"
  role: string; // closed vocab or "other"
  inputType: string; // closed vocab or "none"
  ancestryTags: string[]; // tag names only (structure); each mapped through the tag vocab
  ancestryDepth: number;
  siblingPosition: "only" | "first" | "middle" | "last";
  boundingBoxBucket: { xBucket: "left" | "center" | "right"; yBucket: "top" | "middle" | "bottom"; sizeBucket: "small" | "medium" | "large" };
  hasStableId: boolean;
  hasStableTestAttr: boolean; // data-testid / data-* / aria present (presence only)
  /** Opaque 16-hex hash of the structural shape (tag + ancestry + sibling position). Never a selector. */
  structuralSignature: string;
  matchCount: number;
  resolution: CalibrationResolution;
  confidence: CalibrationConfidence;
}

/** The RAW artifact entry — gitignored, owner-only. Holds the actual selector for later code adoption. */
export interface RawArtifactEntry {
  targetKind: IssuanceTarget;
  /** The safe selector (built only from screened, non-sensitive attributes). */
  selector: string;
  /** The retained stable attributes (sensitive ones already dropped). */
  attributes: RawAttribute[];
  matchCount: number;
  structuralSignature: string;
}

export interface SanitizeResult {
  sanitized: SanitizedTargetCandidate;
  /** Present ONLY when a safe, resolved, non-credential-value selector was retained; else null (gitignored sink). */
  raw: RawArtifactEntry | null;
}

/* ────────────────────────────── bucketing + signature ────────────────────────────── */

function siblingPosition(index: number, count: number): SanitizedTargetCandidate["siblingPosition"] {
  if (count <= 1) return "only";
  if (index <= 0) return "first";
  if (index >= count - 1) return "last";
  return "middle";
}

function boxBucket(box: RawTargetCapture["boundingBox"], vp: RawTargetCapture["viewport"]): SanitizedTargetCandidate["boundingBoxBucket"] {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const xBucket = vp.w <= 0 ? "center" : cx < vp.w / 3 ? "left" : cx < (2 * vp.w) / 3 ? "center" : "right";
  const yBucket = vp.h <= 0 ? "middle" : cy < vp.h / 3 ? "top" : cy < (2 * vp.h) / 3 ? "middle" : "bottom";
  const area = box.w * box.h;
  const sizeBucket = area < 2500 ? "small" : area < 40000 ? "medium" : "large";
  return { xBucket, yBucket, sizeBucket };
}

/** Deterministic opaque 16-hex hash of the STRUCTURAL shape only (never a value/selector). */
export function structuralSignature(tagName: string, ancestryTags: readonly string[], index: number, count: number): string {
  const shape = JSON.stringify([inVocab(tagName, ALLOWED_TAGS), ancestryTags.map((t) => inVocab(t, ALLOWED_TAGS)), siblingPosition(index, count)]);
  return createHash("sha256").update(shape).digest("hex").slice(0, 16);
}

/* ────────────────────────────── the acceptance / sanitization gate ────────────────────────────── */

/** Attribute names that may seed a selector (presence + screened value). Everything else is ignored. */
const SELECTOR_ATTR_NAMES = ["id", "data-testid", "data-test", "data-cy", "data-qa", "aria-label", "name", "role", "class"];

function screenAttributes(attrs: readonly RawAttribute[]): { safe: RawAttribute[]; droppedSensitive: boolean } {
  const safe: RawAttribute[] = [];
  let droppedSensitive = false;
  for (const a of attrs) {
    if (!SELECTOR_ATTR_NAMES.includes(a.name)) continue;
    if (looksSensitive(a.value)) {
      droppedSensitive = true; // never keep a sensitive value, even in the gitignored artifact
      continue;
    }
    safe.push(a);
  }
  return { safe, droppedSensitive };
}

/**
 * Decide what may be kept for one hovered element. Always returns a sanitized candidate; returns a raw artifact
 * entry ONLY when a safe, resolved, non-credential-value selector survived screening.
 */
export function sanitizeCapture(raw: RawTargetCapture): SanitizeResult {
  const tagName = inVocab(raw.tagName?.toLowerCase(), ALLOWED_TAGS);
  const role = inVocab(raw.role?.toLowerCase(), ALLOWED_ROLES);
  const inputType = inVocab(raw.inputType?.toLowerCase(), ALLOWED_INPUT_TYPES, "none");
  const ancestryTags = (raw.ancestryTags ?? []).map((t) => inVocab(t?.toLowerCase(), ALLOWED_TAGS));
  const { safe: safeAttrs, droppedSensitive } = screenAttributes(raw.stableAttributes ?? []);
  const sig = structuralSignature(raw.tagName ?? "", raw.ancestryTags ?? [], raw.siblingIndex, raw.siblingCount);

  const baseSanitized: Omit<SanitizedTargetCandidate, "resolution" | "confidence"> = {
    targetKind: raw.targetKind,
    tagName,
    role,
    inputType,
    ancestryTags,
    ancestryDepth: ancestryTags.length,
    siblingPosition: siblingPosition(raw.siblingIndex, raw.siblingCount),
    boundingBoxBucket: boxBucket(raw.boundingBox, raw.viewport),
    hasStableId: safeAttrs.some((a) => a.name === "id"),
    hasStableTestAttr: safeAttrs.some((a) => a.name.startsWith("data-") || a.name.startsWith("aria-")),
    structuralSignature: sig,
    matchCount: raw.matchCount,
  };

  // Credential VALUE element ⇒ excluded from selectors; only its position is kept. Never a raw selector.
  if (raw.targetKind === "credentials" && (raw.isCredentialValueElement || raw.isReadOnly || inputType === "password")) {
    return { sanitized: { ...baseSanitized, resolution: "excluded_credential_value", confidence: "low" }, raw: null };
  }

  // Adoptable only at exactly one match.
  const resolution: CalibrationResolution = raw.matchCount === 1 ? "resolved" : raw.matchCount <= 0 ? "unresolved_none" : "unresolved_multiple";

  if (resolution !== "resolved") {
    return { sanitized: { ...baseSanitized, resolution, confidence: "low" }, raw: null };
  }

  // Resolved: confidence from how strong the surviving selector is. A stable id / test attr with no dropped
  // sensitive value is HIGH; a class/name-only selector is MEDIUM; a dropped-sensitive selector is LOW and
  // withheld from the artifact (we do not persist a selector we had to strip).
  const strongAttr = safeAttrs.some((a) => a.name === "id" || a.name.startsWith("data-") || a.name === "aria-label");
  const confidence: CalibrationConfidence = droppedSensitive ? "low" : strongAttr ? "high" : safeAttrs.length > 0 ? "medium" : "low";

  // Retain a raw artifact entry ONLY when a safe selector survived (attributes remain after screening AND the
  // in-page-built selector carried no sensitive value). If screening dropped a value the selector relied on, or
  // no safe attribute remains, we keep the sanitized candidate but persist NO raw selector (fail-closed).
  const selectorSafe = safeAttrs.length > 0 && !looksSensitive(raw.candidateSelector) && !droppedSensitive;
  const rawEntry: RawArtifactEntry | null = selectorSafe
    ? { targetKind: raw.targetKind, selector: raw.candidateSelector, attributes: safeAttrs, matchCount: raw.matchCount, structuralSignature: sig }
    : null;

  return { sanitized: { ...baseSanitized, resolution, confidence }, raw: rawEntry };
}

/* ────────────────────────────── page signatures (sanitized) ────────────────────────────── */

import type { ApiCenterPageCategory, ApiCenterSignals } from "../../cli/observe-api-center";

/** A sanitized signature of one observed page — its category + the census signals + an opaque shape hash. */
export interface PageSignature {
  stage: CalibrationStage;
  pageCategory: ApiCenterPageCategory;
  signals: ApiCenterSignals;
  signatureHash: string;
  calibrationPending: true;
}

export function pageSignature(stage: CalibrationStage, pageCategory: ApiCenterPageCategory, signals: ApiCenterSignals): PageSignature {
  const shape = JSON.stringify([stage, pageCategory, signals]);
  return { stage, pageCategory, signals, signatureHash: createHash("sha256").update(shape).digest("hex").slice(0, 16), calibrationPending: true };
}

/** The sanitized session summary (safe to document). Raw selectors live only in the gitignored artifact. */
export interface CalibrationSummary {
  pages: PageSignature[];
  targets: SanitizedTargetCandidate[];
  resolvedCount: number;
  unresolvedCount: number;
}

export function summarize(pages: readonly PageSignature[], targets: readonly SanitizedTargetCandidate[]): CalibrationSummary {
  const resolvedCount = targets.filter((t) => t.resolution === "resolved").length;
  return { pages: [...pages], targets: [...targets], resolvedCount, unresolvedCount: targets.length - resolvedCount };
}
