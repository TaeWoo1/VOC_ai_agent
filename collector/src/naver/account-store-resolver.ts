/**
 * Pure, sanitized NAVER account/store selection RESOLVER core (no Playwright, no fs).
 *
 * The cold/warm gap (Milestones C–E) is the Commerce account/store selection screen
 * that a logged-in human hits repeatedly. This module decides — STRUCTURALLY, with NO
 * click — whether that screen can be resolved SAFELY for an already-logged-in human:
 * it acts only on an account/store-chooser / reconnect surface, matches candidates
 * against the operator's EXPECTED identity, and resolves ONLY when exactly one safe
 * match exists. Everything ambiguous halts. It never touches NAVER-ID login or 2FA —
 * those surfaces return a stop-and-ask kind.
 *
 * SAFETY / PRIVACY CONTRACT:
 *  - This file is browser-free and fs-free: it takes already-extracted structured
 *    candidates (a `RawSelectionSurface`), not a Playwright page or HTML, so it is
 *    fully offline-unit-testable (mirrors `account-fingerprint.ts`).
 *  - The ONLY log-safe view is `SanitizedSelectionSignals`: surface enum, count
 *    buckets, per-candidate {hashed text, source category, expected-match boolean},
 *    frame/popup booleans, decision kind. It never carries a raw store/account name,
 *    a channel/store id, a raw URL, raw HTML, a token, or a candidate label.
 *  - Raw candidate text / identity tokens live only inside `RawSelectionCandidate`
 *    (the input) and are hashed/dropped here — never echoed back. A hostile-fixture
 *    test asserts the sanitized output leaks none of a known PII/token set.
 *  - Conservative by construction: prefer halting over guessing (reuses the discipline
 *    of `extractAccountFingerprint`). Only `RESOLVED` ever authorizes a (single) click,
 *    performed by the separate live boundary — never here.
 */

import { createHash } from "node:crypto";
import type { FingerprintSourceCategory } from "../connection/types";
import type { CountBucket } from "./export-probe";
import type { SessionVerdict } from "./session-verdict";

/** Coarse surface category the live boundary resolves before calling the core. */
export type ResolverSurface =
  | "account-chooser"
  | "store-chooser"
  | "reconnect-continue"
  | "review-ready"
  | "login"
  | "auth-challenge"
  | "unknown";

/** A surface that carries selectable account/store candidates. */
const SELECTION_SURFACES: ReadonlySet<ResolverSurface> = new Set([
  "account-chooser",
  "store-chooser",
  "reconnect-continue",
]);

/**
 * One selection candidate, already structurally extracted from the live surface by the
 * boundary. `visibleText` and `identityToken` are RAW (the caller's working values) —
 * they are hashed/dropped in this module and never appear in any output.
 */
export interface RawSelectionCandidate {
  /** Raw stable store/channel token (commerce-id / store-url-path / account-scope), or null if unreadable. */
  identityToken: string | null;
  /** Where the token was read from; null when no stable token could be extracted. */
  sourceCategory: FingerprintSourceCategory | null;
  /** Raw card label — hashed here, NEVER emitted. */
  visibleText: string;
  /** Whether the candidate is an actionable (clickable) control. */
  clickable: boolean;
}

/** Raw structured surface — filled from a live page by the (future) boundary; tests pass it directly. */
export interface RawSelectionSurface {
  surface: ResolverSurface;
  candidates: RawSelectionCandidate[];
  /** Where the selection surface was found (frame/popup awareness; locating only, no content). */
  inTopDocument: boolean;
  inChildFrame: boolean;
  popupPagePresent: boolean;
  /** Salt for one-way candidate text / identity hashing (same scheme as the storage probe). */
  salt: string;
}

/** The operator's expected identity. Channel-code match is structural (no salt needed). */
export interface ExpectedIdentity {
  /** Expected Commerce channel code (defaults to `cfg.naverChannelCode`). */
  expectedChannelCode: string;
  /** Optional precomputed `sha256(salt + " " + token).slice(0,16)` for a stronger store match. */
  expectedStoreFingerprint?: string;
}

export type ResolverDecisionKind =
  | "ALREADY_READY"
  | "RESOLVED"
  | "AMBIGUOUS"
  | "NO_MATCH"
  | "LOGIN_REQUIRED"
  | "AUTH_CHALLENGE_REQUIRED"
  | "UNSUPPORTED_SURFACE";

export interface ResolverDecision {
  kind: ResolverDecisionKind;
  /** Index into `RawSelectionSurface.candidates` — set ONLY for `RESOLVED` (the one verified match). */
  clickCandidateIndex?: number;
  /** Content-free, operator-facing explanation. */
  detail: string;
}

/** Per-candidate sanitized view. Never the raw label/id. */
export interface SanitizedSelectionCandidate {
  textHash: string;
  identitySourceCategory: FingerprintSourceCategory | null;
  expectedMatch: boolean;
}

/** The ONLY shape ever printed/logged by the resolver. All fields are non-sensitive. */
export interface SanitizedSelectionSignals {
  surface: ResolverSurface;
  candidateCount: CountBucket;
  matchCount: CountBucket;
  candidates: SanitizedSelectionCandidate[];
  inTopDocument: boolean;
  inChildFrame: boolean;
  popupPagePresent: boolean;
  decisionKind: ResolverDecisionKind;
}

/** Allow-lists used by the no-leak test to assert no extra fields slip through. */
export const SANITIZED_SELECTION_SIGNAL_KEYS: readonly (keyof SanitizedSelectionSignals)[] = [
  "surface",
  "candidateCount",
  "matchCount",
  "candidates",
  "inTopDocument",
  "inChildFrame",
  "popupPagePresent",
  "decisionKind",
];
export const SANITIZED_SELECTION_CANDIDATE_KEYS: readonly (keyof SanitizedSelectionCandidate)[] = [
  "textHash",
  "identitySourceCategory",
  "expectedMatch",
];

/** Raw identity fields a live candidate card can carry (filled by the boundary's DOM scan). */
export interface RawCandidateIdentityFields {
  commerceId: string | null;
  storeUrlPath: string | null;
  accountScope: string | null;
}

/**
 * Pure: pick the STRONGEST available stable identity for a candidate. Precedence
 * (commerce-id > store-url-path > account-scope) matches `account-fingerprint`'s
 * `SOURCE_PRECEDENCE`. Returns a null token/category when nothing stable is readable,
 * which the decision tree treats as unverifiable (never guess).
 */
export function pickCandidateIdentity(
  fields: RawCandidateIdentityFields,
): { identityToken: string | null; sourceCategory: FingerprintSourceCategory | null } {
  if (fields.commerceId !== null && fields.commerceId.length > 0) {
    return { identityToken: fields.commerceId, sourceCategory: "commerce-id" };
  }
  if (fields.storeUrlPath !== null && fields.storeUrlPath.length > 0) {
    return { identityToken: fields.storeUrlPath, sourceCategory: "store-url-path" };
  }
  if (fields.accountScope !== null && fields.accountScope.length > 0) {
    return { identityToken: fields.accountScope, sourceCategory: "account-scope" };
  }
  return { identityToken: null, sourceCategory: null };
}

/** Coarse sub-surface hints, derived by the boundary from sanitized HTML markers (no raw text). */
export interface ReconnectSubMarkers {
  storeSelectMarkerPresent: boolean;
  accountSelectMarkerPresent: boolean;
}

/**
 * Pure: map the five-state `SessionVerdict` (plus coarse reconnect sub-markers) to the
 * resolver's surface enum. `LOGGED_IN` → review-ready, the two stop-and-ask auth states
 * map straight through, and a `RECONNECT_REQUIRED` interstitial is sub-labelled
 * store/account chooser when a marker says so, else the generic reconnect-continue card.
 */
export function resolverSurfaceFromVerdict(
  verdict: SessionVerdict,
  markers: ReconnectSubMarkers,
): ResolverSurface {
  switch (verdict) {
    case "LOGGED_IN":
      return "review-ready";
    case "AUTH_CHALLENGE_REQUIRED":
      return "auth-challenge";
    case "ACCOUNT_LOGIN_REQUIRED":
      return "login";
    case "UNKNOWN":
      return "unknown";
    case "RECONNECT_REQUIRED":
      if (markers.storeSelectMarkerPresent) return "store-chooser";
      if (markers.accountSelectMarkerPresent) return "account-chooser";
      return "reconnect-continue";
  }
}

/** Same bucket thresholds as `export-probe.ts` (kept local so this stays a pure leaf). */
function bucket(n: number): CountBucket {
  if (n <= 0) return "none";
  if (n === 1) return "one";
  if (n <= 5) return "few";
  if (n <= 20) return "some";
  return "many";
}

/** One-way hash; same scheme as the storage probe (`${salt} ${value}` → sha256 → 16 hex). */
function hashValue(salt: string, value: string): string {
  return createHash("sha256").update(`${salt} ${value}`).digest("hex").slice(0, 16);
}

/**
 * Pure: does this candidate match the operator's expected identity? A match is either
 *  - a structural channel-code match (a `commerce-id` token equal to the expected code), OR
 *  - a fingerprint match (the salted hash of the candidate token equals the expected
 *    store fingerprint, when one is configured).
 * A candidate with no readable token can never match (we never guess).
 */
export function candidateMatchesExpected(
  candidate: RawSelectionCandidate,
  expected: ExpectedIdentity,
  salt: string,
): boolean {
  if (candidate.identityToken === null) return false;
  const channelMatch =
    candidate.sourceCategory === "commerce-id" &&
    candidate.identityToken === expected.expectedChannelCode;
  const fingerprintMatch =
    expected.expectedStoreFingerprint !== undefined &&
    hashValue(salt, candidate.identityToken) === expected.expectedStoreFingerprint;
  return channelMatch || fingerprintMatch;
}

/**
 * Pure decision tree. Only `RESOLVED` ever authorizes a click; every other kind halts
 * for the runner to stop and ask the user. Conservative: an unverifiable sibling on a
 * selection surface downgrades even a single match to AMBIGUOUS — we never risk the
 * wrong store, and we never blind-click the first option.
 */
export function decideAccountStoreAction(
  raw: RawSelectionSurface,
  expected: ExpectedIdentity,
): ResolverDecision {
  switch (raw.surface) {
    case "review-ready":
      return { kind: "ALREADY_READY", detail: "already on the review export page; no resolution needed" };
    case "auth-challenge":
      return {
        kind: "AUTH_CHALLENGE_REQUIRED",
        detail: "auth challenge (2FA/CAPTCHA) — stop and ask the user; never automated",
      };
    case "login":
      return {
        kind: "LOGIN_REQUIRED",
        detail: "true NAVER-ID login required — stop and ask the user; never automated",
      };
    case "unknown":
      return { kind: "UNSUPPORTED_SURFACE", detail: "surface not recognized; halting" };
    case "account-chooser":
    case "store-chooser":
    case "reconnect-continue":
      break;
  }
  if (!SELECTION_SURFACES.has(raw.surface)) {
    // Defensive: any surface not handled above is unsupported.
    return { kind: "UNSUPPORTED_SURFACE", detail: "surface not resolvable; halting" };
  }

  // A selection surface with no readable clickable option = we could not read the chooser.
  const clickable = raw.candidates
    .map((candidate, index) => ({ candidate, index }))
    .filter((c) => c.candidate.clickable);
  if (clickable.length === 0) {
    return {
      kind: "UNSUPPORTED_SURFACE",
      detail: "selection surface with no readable clickable candidate; halting",
    };
  }

  const matches = clickable.filter((c) => candidateMatchesExpected(c.candidate, expected, raw.salt));
  // Any clickable candidate whose identity we cannot verify makes the set unsafe to act on.
  const anyUnverifiable = clickable.some(
    (c) => c.candidate.identityToken === null || c.candidate.sourceCategory === null,
  );

  if (matches.length > 1) {
    return { kind: "AMBIGUOUS", detail: "multiple candidates match the expected identity; halting" };
  }
  if (matches.length === 1) {
    if (anyUnverifiable) {
      return {
        kind: "AMBIGUOUS",
        detail: "one match but an unidentifiable sibling candidate exists; halting (never risk the wrong store)",
      };
    }
    return {
      kind: "RESOLVED",
      clickCandidateIndex: matches[0]!.index,
      detail: "exactly one verified candidate matches the expected identity; one safe click",
    };
  }
  // Zero matches.
  if (anyUnverifiable) {
    return {
      kind: "AMBIGUOUS",
      detail: "no match and at least one candidate identity is unreadable; halting (never guess)",
    };
  }
  return { kind: "NO_MATCH", detail: "candidates present but none matches the expected identity; halting" };
}

/**
 * Pure: the log-safe view of a surface + its decision. Hashes every candidate label,
 * buckets counts, and embeds the decision kind. This is the ONLY thing the live
 * boundary logs/prints — never the raw surface.
 */
export function classifyAccountStoreSurface(
  raw: RawSelectionSurface,
  expected: ExpectedIdentity,
): SanitizedSelectionSignals {
  const decision = decideAccountStoreAction(raw, expected);
  const matchingClickable = raw.candidates.filter(
    (c) => c.clickable && candidateMatchesExpected(c, expected, raw.salt),
  );
  return {
    surface: raw.surface,
    candidateCount: bucket(raw.candidates.length),
    matchCount: bucket(matchingClickable.length),
    candidates: raw.candidates.map((c) => ({
      textHash: hashValue(raw.salt, c.visibleText),
      identitySourceCategory: c.sourceCategory,
      expectedMatch: candidateMatchesExpected(c, expected, raw.salt),
    })),
    inTopDocument: raw.inTopDocument,
    inChildFrame: raw.inChildFrame,
    popupPagePresent: raw.popupPagePresent,
    decisionKind: decision.kind,
  };
}

// ---------------------------------------------------------------------------
// Report-only candidate SHAPE diagnostic (where might the stable identity live?)
//
// The first live no-click run found candidates whose identity was unreadable (the
// placeholder selectors matched nothing). This sanitized shape describes the STRUCTURE
// of each candidate card — tag/role categories, attribute-family presence booleans,
// bucketed counts, and an href CATEGORY — so we can locate where a stable channel/store
// identity actually lives WITHOUT ever exposing a value. The live boundary computes the
// raw shape in-page (booleans/counts/enums only); this pure helper just buckets the
// counts. It does not influence the resolver decision.
// ---------------------------------------------------------------------------

export type TagCategory = "button" | "a" | "input" | "li" | "div" | "span" | "other";
export type ClickableTagCategory = TagCategory | "none";
export type RoleCategory = "button" | "option" | "listitem" | "link" | "none" | "other";
export type HrefCategory =
  | "none"
  | "same-origin"
  | "naver-commerce"
  | "naver-login"
  | "external"
  | "other";

/** Raw structural shape read IN-PAGE — booleans / small counts / fixed enums ONLY (no values). */
export interface RawCandidateShape {
  tagCategory: TagCategory;
  roleCategory: RoleCategory;
  clickableTagCategory: ClickableTagCategory;
  hasHref: boolean;
  hasButton: boolean;
  hasAnchor: boolean;
  hasInput: boolean;
  hasRadio: boolean;
  hasImage: boolean;
  hasSvg: boolean;
  hasAriaLabel: boolean;
  hasTitleAttr: boolean;
  hasDataAttrs: boolean;
  hasDataAttrNameChannelLike: boolean;
  hasDataAttrNameStoreLike: boolean;
  hasDataAttrNameAccountLike: boolean;
  hasDataAttrNameCommerceLike: boolean;
  hasIdAttr: boolean;
  hasClassAttr: boolean;
  hasNameAttr: boolean;
  hasValueAttr: boolean;
  hasOnClickAttr: boolean;
  hasNestedLink: boolean;
  hasNestedButton: boolean;
  dataAttrCount: number;
  classTokenCount: number;
  childElementCount: number;
  linkCount: number;
  buttonCount: number;
  hrefCategory: HrefCategory;
  hrefPathSegmentCount: number;
}

/** Sanitized candidate shape: counts replaced by buckets, keyed to the candidate's index/hash. */
export interface SanitizedCandidateShape {
  candidateIndex: number;
  textHash: string;
  tagCategory: TagCategory;
  roleCategory: RoleCategory;
  clickableTagCategory: ClickableTagCategory;
  hasHref: boolean;
  hasButton: boolean;
  hasAnchor: boolean;
  hasInput: boolean;
  hasRadio: boolean;
  hasImage: boolean;
  hasSvg: boolean;
  hasAriaLabel: boolean;
  hasTitleAttr: boolean;
  hasDataAttrs: boolean;
  hasDataAttrNameChannelLike: boolean;
  hasDataAttrNameStoreLike: boolean;
  hasDataAttrNameAccountLike: boolean;
  hasDataAttrNameCommerceLike: boolean;
  hasIdAttr: boolean;
  hasClassAttr: boolean;
  hasNameAttr: boolean;
  hasValueAttr: boolean;
  hasOnClickAttr: boolean;
  hasNestedLink: boolean;
  hasNestedButton: boolean;
  dataAttrCountBucket: CountBucket;
  classTokenCountBucket: CountBucket;
  childElementCountBucket: CountBucket;
  linkCountBucket: CountBucket;
  buttonCountBucket: CountBucket;
  hrefCategory: HrefCategory;
  hrefPathSegmentCountBucket: CountBucket;
}

/** Allow-list of every key the sanitized candidate shape may emit (used by the no-leak test). */
export const SANITIZED_CANDIDATE_SHAPE_KEYS: readonly (keyof SanitizedCandidateShape)[] = [
  "candidateIndex",
  "textHash",
  "tagCategory",
  "roleCategory",
  "clickableTagCategory",
  "hasHref",
  "hasButton",
  "hasAnchor",
  "hasInput",
  "hasRadio",
  "hasImage",
  "hasSvg",
  "hasAriaLabel",
  "hasTitleAttr",
  "hasDataAttrs",
  "hasDataAttrNameChannelLike",
  "hasDataAttrNameStoreLike",
  "hasDataAttrNameAccountLike",
  "hasDataAttrNameCommerceLike",
  "hasIdAttr",
  "hasClassAttr",
  "hasNameAttr",
  "hasValueAttr",
  "hasOnClickAttr",
  "hasNestedLink",
  "hasNestedButton",
  "dataAttrCountBucket",
  "classTokenCountBucket",
  "childElementCountBucket",
  "linkCountBucket",
  "buttonCountBucket",
  "hrefCategory",
  "hrefPathSegmentCountBucket",
];

/**
 * Pure: turn a raw in-page candidate shape into the sanitized, bucketed view. Counts
 * become buckets; booleans/enums pass through; `candidateIndex` + the already-salted
 * `textHash` correlate it to the matching sanitized candidate. Carries NO raw value, so
 * it cannot leak — the input itself only ever holds booleans/counts/enums.
 */
export function buildCandidateShape(
  candidateIndex: number,
  textHash: string,
  raw: RawCandidateShape,
): SanitizedCandidateShape {
  return {
    candidateIndex,
    textHash,
    tagCategory: raw.tagCategory,
    roleCategory: raw.roleCategory,
    clickableTagCategory: raw.clickableTagCategory,
    hasHref: raw.hasHref,
    hasButton: raw.hasButton,
    hasAnchor: raw.hasAnchor,
    hasInput: raw.hasInput,
    hasRadio: raw.hasRadio,
    hasImage: raw.hasImage,
    hasSvg: raw.hasSvg,
    hasAriaLabel: raw.hasAriaLabel,
    hasTitleAttr: raw.hasTitleAttr,
    hasDataAttrs: raw.hasDataAttrs,
    hasDataAttrNameChannelLike: raw.hasDataAttrNameChannelLike,
    hasDataAttrNameStoreLike: raw.hasDataAttrNameStoreLike,
    hasDataAttrNameAccountLike: raw.hasDataAttrNameAccountLike,
    hasDataAttrNameCommerceLike: raw.hasDataAttrNameCommerceLike,
    hasIdAttr: raw.hasIdAttr,
    hasClassAttr: raw.hasClassAttr,
    hasNameAttr: raw.hasNameAttr,
    hasValueAttr: raw.hasValueAttr,
    hasOnClickAttr: raw.hasOnClickAttr,
    hasNestedLink: raw.hasNestedLink,
    hasNestedButton: raw.hasNestedButton,
    dataAttrCountBucket: bucket(raw.dataAttrCount),
    classTokenCountBucket: bucket(raw.classTokenCount),
    childElementCountBucket: bucket(raw.childElementCount),
    linkCountBucket: bucket(raw.linkCount),
    buttonCountBucket: bucket(raw.buttonCount),
    hrefCategory: raw.hrefCategory,
    hrefPathSegmentCountBucket: bucket(raw.hrefPathSegmentCount),
  };
}

// ---------------------------------------------------------------------------
// Report-only HREF-STRUCTURE diagnostic (WHERE in the href does identity live?)
//
// Live run #2 localized identity to the `naver-commerce` anchor href (no data-attrs,
// no onclick, no nested controls). This diagnostic describes the STRUCTURE of those
// hrefs — per path segment a kind/charset/keyword category + length bucket, and a
// query summary — so we can pinpoint which path segment or query key carries the
// stable channel/store id WITHOUT exposing any value. Query VALUES are never read (the
// boundary forwards only path segments + query key NAMES); these pure classifiers turn
// those into categories/booleans/buckets and a hostile test proves no leakage. Does not
// influence the resolver decision.
// ---------------------------------------------------------------------------

export type SegmentKind =
  | "knownKeywordLike"
  | "numericLike"
  | "uuidLike"
  | "alnumIdLike"
  | "slugLike"
  | "shortTextLike"
  | "longTextLike"
  | "empty"
  | "other";
export type SegmentCharset = "digits" | "hex" | "alpha" | "alnum" | "slug" | "mixed" | "other";
export type SegmentKeywordCategory =
  | "channel"
  | "store"
  | "account"
  | "commerce"
  | "seller"
  | "login"
  | "none";
export type SegmentLengthBucket = "empty" | "tiny" | "short" | "medium" | "long" | "huge";

export interface SanitizedPathSegment {
  segmentIndex: number;
  segmentKind: SegmentKind;
  segmentLengthBucket: SegmentLengthBucket;
  charsetCategory: SegmentCharset;
  keywordCategory: SegmentKeywordCategory;
}

export interface SanitizedQueryStructure {
  queryParamCountBucket: CountBucket;
  hasQueryKeyChannelLike: boolean;
  hasQueryKeyStoreLike: boolean;
  hasQueryKeyAccountLike: boolean;
  hasQueryKeyCommerceLike: boolean;
  hasQueryKeySellerLike: boolean;
  hasQueryKeyReturnUrlLike: boolean;
}

export interface SanitizedHrefStructure {
  candidateIndex: number;
  textHash: string;
  hrefCategory: HrefCategory;
  pathSegmentCountBucket: CountBucket;
  segments: SanitizedPathSegment[];
  query: SanitizedQueryStructure;
}

/** Allow-lists used by the no-leak tests. */
export const SANITIZED_PATH_SEGMENT_KEYS: readonly (keyof SanitizedPathSegment)[] = [
  "segmentIndex",
  "segmentKind",
  "segmentLengthBucket",
  "charsetCategory",
  "keywordCategory",
];
export const SANITIZED_QUERY_STRUCTURE_KEYS: readonly (keyof SanitizedQueryStructure)[] = [
  "queryParamCountBucket",
  "hasQueryKeyChannelLike",
  "hasQueryKeyStoreLike",
  "hasQueryKeyAccountLike",
  "hasQueryKeyCommerceLike",
  "hasQueryKeySellerLike",
  "hasQueryKeyReturnUrlLike",
];
export const SANITIZED_HREF_STRUCTURE_KEYS: readonly (keyof SanitizedHrefStructure)[] = [
  "candidateIndex",
  "textHash",
  "hrefCategory",
  "pathSegmentCountBucket",
  "segments",
  "query",
];

// Exact known path keywords (not substrings) — a segment equal to one of these is
// structural routing, not an identity token.
const SEGMENT_KEYWORDS = new Set<string>([
  "channel",
  "channels",
  "store",
  "stores",
  "shop",
  "mall",
  "account",
  "accounts",
  "member",
  "members",
  "user",
  "users",
  "commerce",
  "seller",
  "sellers",
  "login",
  "auth",
  "nid",
  "sell",
  "manage",
  "admin",
  "home",
  "main",
  "product",
  "products",
  "review",
  "reviews",
  "dashboard",
  "setting",
  "settings",
  "profile",
]);

/** Which identity keyword family a path-segment / query-key name resembles (substring). */
function keywordCategoryOf(lower: string): SegmentKeywordCategory {
  if (/channel/.test(lower)) return "channel";
  if (/store|shop|mall/.test(lower)) return "store";
  if (/account|member|user/.test(lower)) return "account";
  if (/commerce/.test(lower)) return "commerce";
  if (/seller/.test(lower)) return "seller";
  if (/login|auth|nid/.test(lower)) return "login";
  return "none";
}

function segmentCharset(s: string): SegmentCharset {
  if (/^[0-9]+$/.test(s)) return "digits";
  if (/^[0-9a-f]+$/i.test(s) && /[0-9]/.test(s) && /[a-f]/i.test(s)) return "hex";
  if (/^[a-z]+$/i.test(s)) return "alpha";
  if (/^[a-z0-9]+$/i.test(s)) return "alnum";
  if (/^[a-z0-9]+(?:[-_.][a-z0-9]+)+$/i.test(s)) return "slug";
  if (/^[\w.~%-]+$/.test(s)) return "mixed";
  return "other";
}

function segmentLengthBucket(n: number): SegmentLengthBucket {
  if (n <= 0) return "empty";
  if (n <= 4) return "tiny";
  if (n <= 12) return "short";
  if (n <= 32) return "medium";
  if (n <= 64) return "long";
  return "huge";
}

function segmentKindOf(s: string, charset: SegmentCharset): SegmentKind {
  if (s.length === 0) return "empty";
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return "uuidLike";
  if (SEGMENT_KEYWORDS.has(s.toLowerCase())) return "knownKeywordLike";
  if (charset === "digits") return "numericLike";
  if ((charset === "alnum" || charset === "hex") && s.length >= 6 && /[0-9]/.test(s) && /[a-z]/i.test(s)) {
    return "alnumIdLike";
  }
  if (charset === "slug") return "slugLike";
  if (charset === "alpha") return s.length <= 12 ? "shortTextLike" : "longTextLike";
  if (s.length > 12) return "longTextLike";
  return "other";
}

/** Pure: classify ONE raw path segment into sanitized categories (never echoes the value). */
export function classifyPathSegment(segment: string): Omit<SanitizedPathSegment, "segmentIndex"> {
  const charset = segmentCharset(segment);
  return {
    segmentKind: segmentKindOf(segment, charset),
    segmentLengthBucket: segmentLengthBucket(segment.length),
    charsetCategory: charset,
    keywordCategory: keywordCategoryOf(segment.toLowerCase()),
  };
}

/** Pure: summarize query KEY NAMES into booleans + a count bucket (values are never seen here). */
export function classifyQueryKeys(keys: readonly string[]): SanitizedQueryStructure {
  let channel = false;
  let store = false;
  let account = false;
  let commerce = false;
  let seller = false;
  let returnUrl = false;
  for (const k of keys) {
    const lower = k.toLowerCase();
    if (/channel/.test(lower)) channel = true;
    if (/store|shop|mall/.test(lower)) store = true;
    if (/account|member|user/.test(lower)) account = true;
    if (/commerce/.test(lower)) commerce = true;
    if (/seller/.test(lower)) seller = true;
    if (/return|redirect|next|\burl\b|back/.test(lower)) returnUrl = true;
  }
  return {
    queryParamCountBucket: bucket(keys.length),
    hasQueryKeyChannelLike: channel,
    hasQueryKeyStoreLike: store,
    hasQueryKeyAccountLike: account,
    hasQueryKeyCommerceLike: commerce,
    hasQueryKeySellerLike: seller,
    hasQueryKeyReturnUrlLike: returnUrl,
  };
}

/**
 * Pure: build the sanitized href structure from already-split RAW path segments + query
 * KEY NAMES (the boundary parses the URL in-page and forwards only these — never a query
 * value, never the raw href). Every output field is an enum/bucket/boolean/index, so it
 * cannot leak; a hostile test proves it.
 */
export function buildHrefStructure(
  candidateIndex: number,
  textHash: string,
  hrefCategory: HrefCategory,
  pathSegments: readonly string[],
  queryKeyNames: readonly string[],
): SanitizedHrefStructure {
  return {
    candidateIndex,
    textHash,
    hrefCategory,
    pathSegmentCountBucket: bucket(pathSegments.length),
    segments: pathSegments.map((s, i) => ({ segmentIndex: i, ...classifyPathSegment(s) })),
    query: classifyQueryKeys(queryKeyNames),
  };
}

// ---------------------------------------------------------------------------
// Report-only CONTINUATION-CARD diagnostic (single-account "continue" surface)
//
// The recurring surface is a single-account "continue with this account / current
// NAVER ID / Commerce ID" reconnect card — NOT a machine-readable multi-store chooser
// (live runs #1–#3 found no id in attributes / onclick / href path / query). The only
// thing identifying the account is the card's DISPLAY TEXT. This diagnostic computes a
// salted fingerprint of that normalized text so a future guarded "continue" can be
// gated on an exact match against `NAVER_EXPECTED_CONTINUE_CARD_FINGERPRINT`. It NEVER
// emits the card text; a hostile test proves it. This slice is report-only (no click).
// ---------------------------------------------------------------------------

export type ContinuationDecisionKind =
  | "CONTINUATION_CARD_DETECTED"
  | "READY_TO_CONTINUE"
  | "AMBIGUOUS"
  | "NO_MATCH"
  | "LOGIN_REQUIRED"
  | "AUTH_CHALLENGE_REQUIRED"
  | "UNSUPPORTED_SURFACE";

/** Raw continuation-card read (markers/count are sanitized; `cardText` is hashed, never emitted). */
export interface RawContinuationCard {
  surface: ResolverSurface;
  /**
   * Number of controls matching the validated SAFE-continue rule (login-like, within/near
   * the matched card, no alternate/switch/logout negatives) — NOT a bare "continue-like"
   * count. The boundary derives it from `matchesSafeContinueHypothesis`. Exactly one →
   * eligible for READY_TO_CONTINUE; 0 or ≥2 → AMBIGUOUS.
   */
  continueControlCount: number;
  /** Joined visible text of the continuation card — normalized + hashed here, NEVER emitted. */
  cardText: string;
  hasCurrentLoginAccountCard: boolean;
  hasNaverCommerceIdMarker: boolean;
  hasNaverIdMarker: boolean;
  salt: string;
}

export interface ExpectedContinueCard {
  /** Salted fingerprint of the expected card text; undefined → a future continue is never allowed. */
  expectedCardFingerprint?: string;
}

export interface SanitizedContinuationCard {
  surface: ResolverSurface;
  continueControlCountBucket: CountBucket;
  cardTextHash: string;
  expectedMatch: boolean;
  hasExactlyOneLikelyContinueControl: boolean;
  hasCurrentLoginAccountCard: boolean;
  hasNaverCommerceIdMarker: boolean;
  hasNaverIdMarker: boolean;
  decisionKind: ContinuationDecisionKind;
}

export const SANITIZED_CONTINUATION_CARD_KEYS: readonly (keyof SanitizedContinuationCard)[] = [
  "surface",
  "continueControlCountBucket",
  "cardTextHash",
  "expectedMatch",
  "hasExactlyOneLikelyContinueControl",
  "hasCurrentLoginAccountCard",
  "hasNaverCommerceIdMarker",
  "hasNaverIdMarker",
  "decisionKind",
];

/**
 * Pure: normalize continuation-card display text before hashing — trim + collapse all
 * whitespace runs to single spaces. `textContent` already concatenates nodes in document
 * order, so the join order is deterministic; this only stabilizes whitespace. The
 * normalized text is used ONLY for hashing and is never returned to a caller that emits it.
 */
export function normalizeContinueCardText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/** Pure: salted one-way fingerprint of the normalized card text (same scheme as `hashValue`). */
export function continueCardFingerprint(salt: string, rawCardText: string): string {
  return createHash("sha256")
    .update(`${salt} ${normalizeContinueCardText(rawCardText)}`)
    .digest("hex")
    .slice(0, 16);
}

/**
 * Pure decision for the continuation-card surface. Only `READY_TO_CONTINUE` would ever
 * authorize a (future, separately-approved) continue click — and only when the surface is
 * the reconnect-continue card, the displayed-account fingerprint matches the configured
 * expected fingerprint, AND exactly one likely continue control exists. Everything else
 * halts (report-only here). An absent expected fingerprint can never reach
 * `READY_TO_CONTINUE` — it reports `CONTINUATION_CARD_DETECTED` so the operator can capture
 * the observed hash first.
 */
export function decideContinuationCard(
  raw: RawContinuationCard,
  expected: ExpectedContinueCard,
): { kind: ContinuationDecisionKind; detail: string } {
  switch (raw.surface) {
    case "auth-challenge":
      return { kind: "AUTH_CHALLENGE_REQUIRED", detail: "auth challenge — stop and ask the user" };
    case "login":
      return { kind: "LOGIN_REQUIRED", detail: "true NAVER-ID login required — stop and ask the user" };
    case "reconnect-continue":
      break;
    case "review-ready":
    case "account-chooser":
    case "store-chooser":
    case "unknown":
      return { kind: "UNSUPPORTED_SURFACE", detail: "not a single-account continuation surface" };
  }

  const cardPresent =
    raw.hasCurrentLoginAccountCard || raw.hasNaverCommerceIdMarker || raw.hasNaverIdMarker;
  if (!cardPresent && raw.continueControlCount === 0) {
    return { kind: "UNSUPPORTED_SURFACE", detail: "no continuation card or continue control readable" };
  }

  if (expected.expectedCardFingerprint === undefined) {
    return {
      kind: "CONTINUATION_CARD_DETECTED",
      detail:
        "continuation card detected; set NAVER_EXPECTED_CONTINUE_CARD_FINGERPRINT to the reported hash to enable a future guarded continue",
    };
  }

  const fingerprint = continueCardFingerprint(raw.salt, raw.cardText);
  if (fingerprint !== expected.expectedCardFingerprint) {
    return { kind: "NO_MATCH", detail: "displayed account does not match the expected continue-card fingerprint" };
  }
  if (raw.continueControlCount !== 1) {
    return { kind: "AMBIGUOUS", detail: "fingerprint matches but not exactly one continue control; halting" };
  }
  return {
    kind: "READY_TO_CONTINUE",
    detail: "fingerprint matches and exactly one continue control (a future guarded continue may proceed)",
  };
}

/** Pure: the log-safe view of a continuation card + its decision. Never carries the card text. */
export function classifyContinuationCard(
  raw: RawContinuationCard,
  expected: ExpectedContinueCard,
): SanitizedContinuationCard {
  const decision = decideContinuationCard(raw, expected);
  const cardTextHash = continueCardFingerprint(raw.salt, raw.cardText);
  return {
    surface: raw.surface,
    continueControlCountBucket: bucket(raw.continueControlCount),
    cardTextHash,
    expectedMatch:
      expected.expectedCardFingerprint !== undefined && cardTextHash === expected.expectedCardFingerprint,
    hasExactlyOneLikelyContinueControl: raw.continueControlCount === 1,
    hasCurrentLoginAccountCard: raw.hasCurrentLoginAccountCard,
    hasNaverCommerceIdMarker: raw.hasNaverCommerceIdMarker,
    hasNaverIdMarker: raw.hasNaverIdMarker,
    decisionKind: decision.kind,
  };
}

// ---------------------------------------------------------------------------
// Report-only CONTINUE-CONTROL identification diagnostic
//
// Live run found the continuation card but `continueControlCount: none` — the actual
// "continue" control uses wording the current marker doesn't match. This per-control
// diagnostic reports, for each CLICKABLE candidate, its structural shape PLUS coarse
// marker booleans (continue/login/account/naver/commerce-like, presence only) so we can
// see WHICH control is the safe continue target — without ever emitting its text. Once a
// live run shows which marker fires on the real control, the `scanContinuationCard` count
// can be corrected from that observed finding (never tuned speculatively).
// ---------------------------------------------------------------------------

/** Raw per-control marker presence (computed in-page from accessible text; booleans only). */
export interface RawControlMarkers {
  continueLike: boolean;
  loginLike: boolean;
  accountLike: boolean;
  naverLike: boolean;
  commerceLike: boolean;
  // Negative markers — a control carrying any of these is an ALTERNATE login / switch /
  // logout action, NOT the "continue as current account" control.
  differentAccount: boolean;
  differentId: boolean;
  otherLogin: boolean;
  switchAccount: boolean;
  logout: boolean;
  // Positive markers — wording tying a control to the CURRENT account.
  currentAccount: boolean;
  continueCurrent: boolean;
  loginCurrent: boolean;
}

/** Which card marker the nearest marker-bearing ancestor of a control carries. */
export type NearestCardMarkerCategory = "currentLogin" | "commerceId" | "naverId" | "none";

/** Per-control containment relative to the matched continuation card (DOM structure only). */
export interface RawControlContainment {
  isWithinContinuationCard: boolean;
  isNearContinuationCard: boolean;
  /** Steps from the control up to the lowest common ancestor it shares with the card. */
  cardAncestorDepth: number;
  nearestCardMarkerCategory: NearestCardMarkerCategory;
}

export interface SanitizedContinueControl {
  candidateIndex: number;
  textHash: string;
  tagCategory: TagCategory;
  roleCategory: RoleCategory;
  clickableTagCategory: ClickableTagCategory;
  hrefCategory: HrefCategory;
  hasHref: boolean;
  hasButton: boolean;
  hasAnchor: boolean;
  hasInput: boolean;
  hasValueAttr: boolean;
  hasAriaLabel: boolean;
  hasTitleAttr: boolean;
  hasNestedLink: boolean;
  hasNestedButton: boolean;
  classTokenCountBucket: CountBucket;
  childElementCountBucket: CountBucket;
  hasContinueLikeMarker: boolean;
  hasLoginLikeMarker: boolean;
  hasAccountLikeMarker: boolean;
  hasNaverLikeMarker: boolean;
  hasCommerceLikeMarker: boolean;
  // Containment relative to the matched continuation card.
  isWithinContinuationCard: boolean;
  isNearContinuationCard: boolean;
  sameCardAncestorDepthBucket: CountBucket;
  nearestCardMarkerCategory: NearestCardMarkerCategory;
  // Negative markers (alternate-login / switch / logout).
  hasDifferentAccountMarker: boolean;
  hasDifferentIdMarker: boolean;
  hasOtherLoginMarker: boolean;
  hasSwitchAccountMarker: boolean;
  hasLogoutMarker: boolean;
  // Positive markers (current-account).
  hasCurrentAccountMarker: boolean;
  hasContinueCurrentMarker: boolean;
  hasLoginCurrentMarker: boolean;
  /**
   * DERIVED, report-only: does this control match the candidate "safe continue" rule
   * (login-like, within/near the matched card, and none of the alternate/switch/logout
   * negatives)? Reported so a live read can confirm whether EXACTLY ONE control matches —
   * it does NOT yet drive any selection/count logic.
   */
  matchesSafeContinueHypothesis: boolean;
}

export const SANITIZED_CONTINUE_CONTROL_KEYS: readonly (keyof SanitizedContinueControl)[] = [
  "candidateIndex",
  "textHash",
  "tagCategory",
  "roleCategory",
  "clickableTagCategory",
  "hrefCategory",
  "hasHref",
  "hasButton",
  "hasAnchor",
  "hasInput",
  "hasValueAttr",
  "hasAriaLabel",
  "hasTitleAttr",
  "hasNestedLink",
  "hasNestedButton",
  "classTokenCountBucket",
  "childElementCountBucket",
  "hasContinueLikeMarker",
  "hasLoginLikeMarker",
  "hasAccountLikeMarker",
  "hasNaverLikeMarker",
  "hasCommerceLikeMarker",
  "isWithinContinuationCard",
  "isNearContinuationCard",
  "sameCardAncestorDepthBucket",
  "nearestCardMarkerCategory",
  "hasDifferentAccountMarker",
  "hasDifferentIdMarker",
  "hasOtherLoginMarker",
  "hasSwitchAccountMarker",
  "hasLogoutMarker",
  "hasCurrentAccountMarker",
  "hasContinueCurrentMarker",
  "hasLoginCurrentMarker",
  "matchesSafeContinueHypothesis",
];

/**
 * Pure: does a control match the candidate "safe continue" rule? login-like, within OR
 * near the matched continuation card, and NONE of the alternate-login / switch / logout
 * negatives. REPORT-ONLY — used to count how many controls match so a live read can show
 * whether exactly one is uniquely identifiable; it does not select or click anything.
 */
export function matchesSafeContinueHypothesis(
  markers: RawControlMarkers,
  containment: RawControlContainment,
): boolean {
  return (
    markers.loginLike &&
    (containment.isWithinContinuationCard || containment.isNearContinuationCard) &&
    !markers.differentAccount &&
    !markers.otherLogin &&
    !markers.switchAccount &&
    !markers.logout
  );
}

/**
 * Pure: combine an already-sanitized candidate shape with its coarse marker booleans +
 * containment into the continue-control view. Carries NO raw value — every field is an
 * enum/bucket/boolean or the already-salted text hash. Used for clickable candidates only.
 */
export function buildContinueControl(
  shape: SanitizedCandidateShape,
  markers: RawControlMarkers,
  containment: RawControlContainment,
): SanitizedContinueControl {
  return {
    candidateIndex: shape.candidateIndex,
    textHash: shape.textHash,
    tagCategory: shape.tagCategory,
    roleCategory: shape.roleCategory,
    clickableTagCategory: shape.clickableTagCategory,
    hrefCategory: shape.hrefCategory,
    hasHref: shape.hasHref,
    hasButton: shape.hasButton,
    hasAnchor: shape.hasAnchor,
    hasInput: shape.hasInput,
    hasValueAttr: shape.hasValueAttr,
    hasAriaLabel: shape.hasAriaLabel,
    hasTitleAttr: shape.hasTitleAttr,
    hasNestedLink: shape.hasNestedLink,
    hasNestedButton: shape.hasNestedButton,
    classTokenCountBucket: shape.classTokenCountBucket,
    childElementCountBucket: shape.childElementCountBucket,
    hasContinueLikeMarker: markers.continueLike,
    hasLoginLikeMarker: markers.loginLike,
    hasAccountLikeMarker: markers.accountLike,
    hasNaverLikeMarker: markers.naverLike,
    hasCommerceLikeMarker: markers.commerceLike,
    isWithinContinuationCard: containment.isWithinContinuationCard,
    isNearContinuationCard: containment.isNearContinuationCard,
    sameCardAncestorDepthBucket: bucket(containment.cardAncestorDepth),
    nearestCardMarkerCategory: containment.nearestCardMarkerCategory,
    hasDifferentAccountMarker: markers.differentAccount,
    hasDifferentIdMarker: markers.differentId,
    hasOtherLoginMarker: markers.otherLogin,
    hasSwitchAccountMarker: markers.switchAccount,
    hasLogoutMarker: markers.logout,
    hasCurrentAccountMarker: markers.currentAccount,
    hasContinueCurrentMarker: markers.continueCurrent,
    hasLoginCurrentMarker: markers.loginCurrent,
    matchesSafeContinueHypothesis: matchesSafeContinueHypothesis(markers, containment),
  };
}
