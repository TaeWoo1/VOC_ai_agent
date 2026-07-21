/**
 * `chrome-selector-spec/v1` — the persisted description of HOW the two seller-center
 * chrome fields are located.
 *
 * WHY SELECTORS ARE A PERSISTED CONTRACT AND NOT A CONSTANT. Nobody can write these by
 * hand without having read the surface, and guessing them is how the previous three
 * identity designs failed. They are produced by an operator-calibrated discovery run
 * from the exact elements the operator clicked, validated, and only then stored.
 *
 * WHY THE PAIR IS FINGERPRINTED. A binding is only meaningful together with the
 * selectors that produced it: the same page read through different selectors can yield
 * a different pair, so a silently changed selector would turn a MATCH into a statement
 * about something else. The digest lets a later run detect that the source changed and
 * fail closed, rather than compare two things that were never comparable.
 *
 * STABILITY IS RECORDED, NOT ENFORCED HERE. A `weak` spec is still usable — sometimes a
 * surface offers nothing better — but it is labelled so the operator sees what their
 * binding rests on, and so a run can report it.
 *
 * NO OBSERVED VALUE EVER ENTERS THIS MODULE. A spec describes a location; the user id
 * and shop name are read through it and never stored beside it.
 *
 * Pure — no fs, no browser, no network, no clock.
 */

import { createHash } from "node:crypto";

/** How a selector was derived, strongest first. Order is the preference order. */
export const SELECTOR_STRATEGIES = [
  "element-id",
  "test-id",
  "aria-label",
  "chrome-ancestry",
  "class-path",
  "document-path",
] as const;

export type SelectorStrategy = (typeof SELECTOR_STRATEGIES)[number];

/**
 * `strong` survives a re-render and a redeploy in the normal case; `weak` is positional
 * or class-derived and is expected to rot. Dynamic class names and absolute document
 * paths are always weak.
 */
export type SelectorStability = "strong" | "weak";

export const STRONG_STRATEGIES: readonly SelectorStrategy[] = [
  "element-id",
  "test-id",
  "aria-label",
  "chrome-ancestry",
];

export function stabilityOf(strategy: SelectorStrategy): SelectorStability {
  return STRONG_STRATEGIES.includes(strategy) ? "strong" : "weak";
}

/** Longest selector accepted. A longer one is a document path in disguise. */
export const MAX_SELECTOR_LENGTH = 300;

export interface SelectorSpec {
  strategy: SelectorStrategy;
  selector: string;
  stability: SelectorStability;
}

/** The two fields, each with its candidate specs in preference order. */
export interface ChromeSelectorSpecs {
  userId: SelectorSpec[];
  shopName: SelectorSpec[];
}

const DOMAIN = "chrome-selector-spec/v1\n";

/**
 * Digest of the spec PAIR, order-sensitive, so any change to either field's candidate
 * list — added, removed, reordered, or edited — produces a different value.
 */
export function selectorSpecsFingerprint(specs: ChromeSelectorSpecs): string {
  const canonical = JSON.stringify({
    userId: specs.userId.map((s) => [s.strategy, s.selector]),
    shopName: specs.shopName.map((s) => [s.strategy, s.selector]),
  });
  return createHash("sha256").update(DOMAIN + canonical, "utf8").digest("hex");
}

function isSpec(v: unknown): v is SelectorSpec {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  const { strategy, selector } = r as { strategy?: unknown; selector?: unknown };
  if (typeof strategy !== "string" || !SELECTOR_STRATEGIES.includes(strategy as SelectorStrategy)) {
    return false;
  }
  if (typeof selector !== "string") return false;
  if (selector.length === 0 || selector.length > MAX_SELECTOR_LENGTH) return false;
  return true;
}

/**
 * Validate an untrusted spec list. Stability is RECOMPUTED from the strategy rather
 * than trusted from the file — a stored `strong` on a `document-path` would otherwise
 * misreport what a binding rests on.
 */
export function parseSelectorSpecs(input: unknown): ChromeSelectorSpecs | null {
  if (typeof input !== "object" || input === null) return null;
  const r = input as Record<string, unknown>;
  const list = (v: unknown): SelectorSpec[] | null => {
    if (!Array.isArray(v) || v.length === 0) return null;
    const specs: SelectorSpec[] = [];
    for (const entry of v) {
      if (!isSpec(entry)) return null;
      specs.push({
        strategy: entry.strategy,
        selector: entry.selector,
        stability: stabilityOf(entry.strategy),
      });
    }
    return specs;
  };
  const userId = list(r.userId);
  const shopName = list(r.shopName);
  if (userId === null || shopName === null) return null;
  return { userId, shopName };
}

/**
 * Turn validated candidates into specs, ordered by strategy preference and deduped.
 * Order matters: the first spec is the one a later run will use, so a `document-path`
 * must never sit ahead of an `element-id` just because it was derived first.
 */
export function rankCandidates(
  candidates: readonly { strategy: string; selector: string }[],
): SelectorSpec[] {
  const seen = new Set<string>();
  const specs: SelectorSpec[] = [];
  for (const strategy of SELECTOR_STRATEGIES) {
    for (const c of candidates) {
      if (c.strategy !== strategy) continue;
      if (seen.has(c.selector)) continue;
      if (c.selector.length === 0 || c.selector.length > MAX_SELECTOR_LENGTH) continue;
      seen.add(c.selector);
      specs.push({ strategy, selector: c.selector, stability: stabilityOf(strategy) });
    }
  }
  return specs;
}

/**
 * True when the two fields carry an IDENTICAL selector string. That is a calibration
 * error which would produce a composite of one value with itself.
 *
 * SCOPE, STATED BECAUSE IT WAS ONCE OVERSTATED: this is a set intersection over selector
 * STRINGS. Two *different* strings can still resolve to the same element, and this cannot
 * see that — a location check has no access to what the locations hold. The value-layer
 * refusal in `normalizeSessionIdentity` (equal halves are not an identity) is what
 * actually closes the self-composite class; this stays as the cheap, early, operator-
 * legible half of it. Do not describe either one as "the two fields read the same
 * element" — neither proves that on its own.
 */
export function specsCollide(specs: ChromeSelectorSpecs): boolean {
  const user = new Set(specs.userId.map((s) => s.selector));
  return specs.shopName.some((s) => user.has(s.selector));
}

/**
 * Comparison form for "does this selector embed that value": NFC, case-folded, and with
 * ALL whitespace removed on both sides.
 *
 * Whitespace is stripped rather than collapsed because the two sides are formatted by
 * different authors — an attribute may read `"seller_alpha  계정"` while the rendered
 * text reads `"seller_alpha 계정"`, and a collapse-only comparison misses that.
 */
function comparable(raw: string): string {
  return raw.normalize("NFC").replace(/\s+/gu, "").toLowerCase();
}

/**
 * True when `selector` embeds `value` — the check that keeps an observed identity value
 * out of a persisted selector spec.
 *
 * THE DIRECTION IS THE WHOLE POINT, and getting it backwards is what two independent
 * reviewers caught. The in-page derivation guard asked *"does this attribute contain the
 * element's ENTIRE rendered text?"*, which fires only when the element renders the bare
 * value and nothing else. Real seller chrome decorates it — `"seller_alpha님"`,
 * `"seller_alpha 계정"`, a caret span — so the rendered text is no longer a substring of
 * `aria-label="seller_alpha 계정 메뉴"` and the guard waved through a selector containing
 * the account name.
 *
 * The threat is the reverse containment: *is the VALUE inside the SELECTOR*. That is what
 * this asks, and it is asked on the Node side, against BOTH fields' observed values, so a
 * hostile page cannot answer it and a per-field guard cannot miss the other field's value.
 */
export function selectorEmbedsValue(selector: string, value: string): boolean {
  const needle = comparable(value);
  // A one-character value would match almost any selector; treat it as unusable rather
  // than as evidence, and let the field's own shape check reject it.
  if (needle.length < 2) return false;
  return comparable(selector).includes(needle);
}

/**
 * Drop every spec that embeds either observed value. Returns the survivors plus the
 * number rejected, so the caller can refuse loudly instead of silently storing fewer.
 */
export function withoutIdentityBearingSpecs(
  specs: readonly SelectorSpec[],
  values: readonly (string | null)[],
): { kept: SelectorSpec[]; rejected: number } {
  const present = values.filter((v): v is string => typeof v === "string" && v.length > 0);
  const kept = specs.filter((s) => !present.some((v) => selectorEmbedsValue(s.selector, v)));
  return { kept, rejected: specs.length - kept.length };
}
