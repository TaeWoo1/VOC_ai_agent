/**
 * **ESM+ REVIEW marketplace-selection verifier** (pure reducer + one flat in-page scan).
 *
 * ESM+ serves GMARKET and AUCTION through one shared review shell; a capture must belong to exactly
 * ONE marketplace, established by a **verified page signal** (decisions.md D1/D2/D7) — never inferred
 * from `loginMode`, hostname, backend channel code, connection id, or a historical candidate index.
 *
 * This module reads the live review surface's marketplace **tablist** and reduces it to a sanitized enum
 * (`GMARKET | AUCTION | UNKNOWN | AMBIGUOUS`). It NEVER returns arbitrary page text: a tab's label is
 * matched only against the fixed GMARKET/AUCTION vocabulary, and only the enum result leaves the page.
 * Badge indices are per-run and are deliberately NOT used — selection is read from `aria-selected` /
 * `aria-pressed` / `aria-current` / `aria-checked` and the fixed selected-label signal.
 */

export type MarketplaceEnum = "GMARKET" | "AUCTION";
export type SelectedMarketplace = MarketplaceEnum | "UNKNOWN" | "AMBIGUOUS";

/** The sanitized verification method recorded on a verified capture result. */
export const MARKETPLACE_VERIFICATION_METHOD = "selected-tab-label";

/** One sanitized marketplace tab observation: a KNOWN label token, its selected state, and visibility. */
export interface MarketplaceTabSignal {
  /** Matched ONLY when the visible label equals a fixed GMARKET/AUCTION token; never arbitrary text. */
  labelToken: MarketplaceEnum | null;
  /** Selected via aria-selected / aria-pressed / aria-current / aria-checked. */
  selected: boolean;
  visible: boolean;
}

/**
 * Reduce the observed marketplace tabs to one sanitized enum. Considers ONLY visible, known-label,
 * selected tabs: exactly one distinct selected marketplace → that marketplace; more than one (both
 * selected) → `AMBIGUOUS`; none selected → `UNKNOWN`. Takes tab signals ONLY — no loginMode / channel /
 * connection id / index input, so those can never influence the result.
 */
export function classifySelectedMarketplace(tabs: readonly MarketplaceTabSignal[]): SelectedMarketplace {
  const selectedKnown = tabs.filter((t) => t.visible && t.labelToken !== null && t.selected);
  const distinct = new Set<MarketplaceEnum>(selectedKnown.map((t) => t.labelToken as MarketplaceEnum));
  if (distinct.size === 0) return "UNKNOWN";
  if (distinct.size > 1) return "AMBIGUOUS";
  return [...distinct][0]!;
}

/** Strictly parse `--marketplace GMARKET|AUCTION`; null when missing OR invalid (no normalization). */
export function parseMarketplaceArg(args: readonly string[]): MarketplaceEnum | null {
  const i = args.indexOf("--marketplace");
  if (i < 0) return null;
  const v = args[i + 1];
  return v === "GMARKET" || v === "AUCTION" ? v : null;
}

/** True iff a string is a concrete marketplace enum. */
export function isMarketplace(s: unknown): s is MarketplaceEnum {
  return s === "GMARKET" || s === "AUCTION";
}

export type MarketplaceGateOutcome = "VERIFIED" | "SELECTION_REQUIRED" | "AMBIGUOUS_FAIL";

/**
 * Pure gate over (requested, detected):
 * - detected === requested → `VERIFIED`;
 * - detected === `AMBIGUOUS` (both tabs selected) → `AMBIGUOUS_FAIL` (fail closed, never auto-resolve);
 * - otherwise (UNKNOWN, or the other marketplace selected) → `SELECTION_REQUIRED` (operator selects, then
 *   re-inspect once; still not `VERIFIED` → the CLL fails closed).
 * Never returns VERIFIED for anything but an exact match — so loginMode/channel/hostname/index can never
 * make a capture claim a marketplace the page didn't verify.
 */
export function marketplaceGateOutcome(requested: MarketplaceEnum, detected: SelectedMarketplace): MarketplaceGateOutcome {
  if (detected === requested) return "VERIFIED";
  if (detected === "AMBIGUOUS") return "AMBIGUOUS_FAIL";
  return "SELECTION_REQUIRED";
}

/**
 * FLAT in-page scan (passed to `page.evaluate`) — self-contained, no inner named functions (the
 * tsx/esbuild `keepNames` `__name` serialization trap). Reads the marketplace tablist and returns
 * sanitized tab signals only: a KNOWN GMARKET/AUCTION token (or null), selected state, visibility.
 * Never returns raw labels, store/account names, URLs, or review data.
 */
export function marketplaceTabScanInPage(): { tabs: Array<{ labelToken: "GMARKET" | "AUCTION" | null; selected: boolean; visible: boolean }> } {
  const GMARKET = /지마켓|g\s*마켓|gmarket/i;
  const AUCTION = /옥션|auction/i;
  const SEL = "[role='tab'], [role='option'], [role='radio'], [aria-selected], [aria-pressed], button, a, li";
  const seen = new Set<string>();
  const tabs: Array<{ labelToken: "GMARKET" | "AUCTION" | null; selected: boolean; visible: boolean }> = [];
  for (const el of Array.from(document.querySelectorAll(SEL))) {
    const he = el as HTMLElement;
    const label = `${he.textContent ?? ""} ${he.getAttribute("aria-label") ?? ""} ${he.getAttribute("title") ?? ""}`;
    let labelToken: "GMARKET" | "AUCTION" | null = null;
    if (GMARKET.test(label)) labelToken = "GMARKET";
    else if (AUCTION.test(label)) labelToken = "AUCTION";
    if (labelToken === null) continue;
    const ariaCurrent = he.getAttribute("aria-current");
    const selected =
      he.getAttribute("aria-selected") === "true" ||
      he.getAttribute("aria-pressed") === "true" ||
      he.getAttribute("aria-checked") === "true" ||
      (ariaCurrent !== null && ariaCurrent !== "false");
    const cs = getComputedStyle(he);
    const rect = he.getBoundingClientRect();
    const laidOut = he.offsetParent !== null || he.getClientRects().length > 0 || (rect.width > 0 && rect.height > 0);
    const visible = laidOut && cs.display !== "none" && cs.visibility !== "hidden" && cs.visibility !== "collapse";
    const key = `${labelToken}|${selected ? 1 : 0}|${visible ? 1 : 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tabs.push({ labelToken, selected, visible });
  }
  return { tabs };
}
