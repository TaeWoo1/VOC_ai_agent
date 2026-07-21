/**
 * **ESM+ REVIEW marketplace-tab OBSERVATION** (read-only; supervised contract discovery).
 *
 * A small, targeted read-only probe to learn the REAL marketplace-tab contract (which frame the tablist
 * lives in, and how the selected tab is marked) BEFORE the production verifier commits to a selected-state
 * rule — so the verifier is never a guess. It NEVER clicks, exports, reads review rows, or returns
 * arbitrary page text: per marketplace-labelled tab it returns only structural evidence (tag/role,
 * visibility, the four ARIA state attrs + native checked, and the tab's class TOKENS for a token-level
 * diff). The Node summarizer reduces two sibling tabs to their DIFFERING class tokens only — never a full
 * arbitrary class string.
 */
import type { BrowserContext, Frame, Page } from "playwright";
import { frameHostAllowed } from "./esm-frame-scan";
import { esmUrlCategory, type EsmUrlCategory } from "./esm-review-probe";

export type MarketplaceLabel = "GMARKET" | "AUCTION";

/**
 * The recovered (2026-07-07, session 73f22e7d) generic selected-state class tokens the successful G2 probe
 * matched — DISCOVERY-ONLY. The A/B differential narrows this to the EXACT observed token before it is
 * scoped into the production verifier; this broad set must never be the production contract.
 */
export const DISCOVERY_SELECTED_CLASS_TOKENS: readonly string[] = ["active", "selected", "on", "current"];

export interface ObservedTab {
  marketplace: MarketplaceLabel;
  tag: string;
  role: string | null;
  visible: boolean;
  enabled: boolean;
  ariaSelected: string | null;
  ariaPressed: string | null;
  ariaCurrent: string | null;
  ariaChecked: string | null;
  nativeChecked: boolean;
  classTokens: string[];
  /** Trimmed textContent length (a NUMBER — never the text) — used to prefer short tab labels over nav prose. */
  textLen: number;
  /** Index of the nearest ancestor that contains BOTH a GMARKET and an AUCTION tab (−1 = none). */
  containerIndex: number;
  hasTablistAncestor: boolean;
  /** role="tab" OR inside a [role="tablist"] — the recovered candidate scope for the review selector. */
  tablistScoped: boolean;
  // ── Dropdown-adapter evidence (REVIEW uses a dropdown, not a tablist) ──────────────────────────────
  /** `aria-expanded` on the nearest dropdown trigger ancestor (button/combobox), or the element itself. */
  triggerExpanded: string | null;
  /** `aria-haspopup` on the nearest dropdown trigger ancestor, or the element itself. */
  triggerHaspopup: string | null;
  /** Tag of the nearest clickable trigger ancestor (button / a / select / [role=button|combobox]). */
  triggerTag: string | null;
  triggerRole: string | null;
  /** Inside an opened menu/listbox/combobox/select (i.e. a dropdown OPTION, not the closed current value). */
  inMenuContext: boolean;
  /** Inside a select/combobox/haspopup trigger context (i.e. plausibly the closed current-value label). */
  inDropdownValueContext: boolean;
}

/**
 * FLAT in-page scan (passed to `evaluate`) — no inner named functions (the `keepNames` `__name` trap).
 * Finds leaf marketplace tabs, groups each by the nearest ancestor containing BOTH marketplaces, and
 * returns sanitized per-tab structural evidence. Never returns raw label text.
 */
export function observeMarketplaceTabsInPage(): { tabs: ObservedTab[] } {
  const GMARKET = /지마켓|g\s*마켓|gmarket/i;
  const AUCTION = /옥션|auction/i;
  const SEL = "[role='tab'], [role='radio'], [role='option'], button, a, li, span, div";
  const all = Array.from(document.querySelectorAll(SEL));
  // Pass 1: leaf marketplace elements (no marketplace-labelled descendant → the actual tab, not a wrapper).
  const leaves: Array<{ el: Element; marketplace: MarketplaceLabel }> = [];
  for (const el of all) {
    const label = `${el.textContent ?? ""} ${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("title") ?? ""}`;
    let marketplace: MarketplaceLabel | null = null;
    if (GMARKET.test(label)) marketplace = "GMARKET";
    else if (AUCTION.test(label)) marketplace = "AUCTION";
    if (marketplace === null) continue;
    let hasLabelledDescendant = false;
    for (const d of Array.from(el.querySelectorAll(SEL))) {
      const dl = `${d.textContent ?? ""} ${d.getAttribute("aria-label") ?? ""} ${d.getAttribute("title") ?? ""}`;
      if (GMARKET.test(dl) || AUCTION.test(dl)) {
        hasLabelledDescendant = true;
        break;
      }
    }
    if (hasLabelledDescendant) continue;
    leaves.push({ el, marketplace });
  }
  // Pass 2: per leaf, find the nearest ancestor containing BOTH a GMARKET and an AUCTION leaf → container.
  const containers: Element[] = [];
  const tabs: ObservedTab[] = [];
  for (const leaf of leaves) {
    const he = leaf.el as HTMLElement;
    let containerEl: Element | null = null;
    let hasTablist = false;
    let anc: Element | null = he;
    while (anc !== null) {
      if (anc.getAttribute("role") === "tablist") hasTablist = true;
      let hasG = false;
      let hasA = false;
      for (const other of leaves) {
        if (!anc.contains(other.el)) continue;
        if (other.marketplace === "GMARKET") hasG = true;
        else hasA = true;
      }
      if (containerEl === null && hasG && hasA) containerEl = anc;
      anc = anc.parentElement;
    }
    let containerIndex = -1;
    if (containerEl !== null) {
      let idx = containers.indexOf(containerEl);
      if (idx < 0) {
        idx = containers.length;
        containers.push(containerEl);
      }
      containerIndex = idx;
    }
    const cs = getComputedStyle(he);
    const rect = he.getBoundingClientRect();
    const laidOut = he.offsetParent !== null || he.getClientRects().length > 0 || (rect.width > 0 && rect.height > 0);
    const visible = laidOut && cs.display !== "none" && cs.visibility !== "hidden" && cs.visibility !== "collapse";
    tabs.push({
      marketplace: leaf.marketplace,
      tag: he.tagName.toLowerCase(),
      role: he.getAttribute("role"),
      visible,
      enabled: !(he as HTMLButtonElement).disabled && he.getAttribute("aria-disabled") !== "true",
      ariaSelected: he.getAttribute("aria-selected"),
      ariaPressed: he.getAttribute("aria-pressed"),
      ariaCurrent: he.getAttribute("aria-current"),
      ariaChecked: he.getAttribute("aria-checked"),
      nativeChecked: (he as HTMLInputElement).checked === true,
      classTokens: Array.from(he.classList),
      textLen: (he.textContent ?? "").trim().length,
      containerIndex,
      hasTablistAncestor: hasTablist,
      tablistScoped: he.getAttribute("role") === "tab" || he.closest("[role='tablist']") !== null,
      triggerExpanded: (he.closest("[aria-expanded]") as HTMLElement | null)?.getAttribute("aria-expanded") ?? null,
      triggerHaspopup: (he.closest("[aria-haspopup]") as HTMLElement | null)?.getAttribute("aria-haspopup") ?? null,
      triggerTag: (he.closest("button, a, select, [role='button'], [role='combobox']") as HTMLElement | null)?.tagName.toLowerCase() ?? null,
      triggerRole: (he.closest("button, a, select, [role='button'], [role='combobox']") as HTMLElement | null)?.getAttribute("role") ?? null,
      inMenuContext: he.closest("[role='option'], [role='menuitem'], [role='listbox'], [role='menu'], option") !== null,
      inDropdownValueContext:
        he.closest("select, [role='combobox'], [aria-haspopup], [aria-expanded]") !== null,
    });
  }
  return { tabs };
}

/** One frame's observation, tagged with sanitized page + frame provenance. */
export interface FrameMarketplaceObservation {
  pageIndex: number;
  pageCategory: EsmUrlCategory;
  frameUrlCategory: EsmUrlCategory;
  readResult: "read" | "skipped-cross-origin" | "blocked";
  allowlisted: boolean;
  isMain: boolean;
  tabs: ObservedTab[];
}

/** Same-origin guard from Node (only the boolean is used; raw URLs never emitted). */
function sameOrigin(frameUrl: string, topUrl: string): boolean {
  try {
    return new URL(frameUrl).origin === new URL(topUrl).origin;
  } catch {
    return false;
  }
}

/**
 * Observe marketplace tabs in the TOP document, every same-origin child frame, and every allowlisted
 * cross-origin child frame (mirrors the export scan's traversal + allowlist; no independent origin policy).
 */
export async function observeMarketplaceAcrossFrames(page: Page, allowlist: readonly string[], pageIndex = 0): Promise<FrameMarketplaceObservation[]> {
  const mainFrame = page.mainFrame();
  const topUrl = page.url();
  const pageCategory = esmUrlCategory(topUrl);
  const out: FrameMarketplaceObservation[] = [];
  for (const frame of page.frames() as Frame[]) {
    const isMain = frame === mainFrame;
    const isSameOrigin = isMain || sameOrigin(frame.url(), topUrl);
    const allowlisted = !isMain && !isSameOrigin && frameHostAllowed(frame.url(), allowlist);
    const category = esmUrlCategory(frame.url());
    if (!isMain && !isSameOrigin && !allowlisted) {
      out.push({ pageIndex, pageCategory, frameUrlCategory: category, readResult: "skipped-cross-origin", allowlisted: false, isMain: false, tabs: [] });
      continue;
    }
    try {
      const scan = await frame.evaluate(observeMarketplaceTabsInPage);
      out.push({ pageIndex, pageCategory, frameUrlCategory: category, readResult: "read", allowlisted, isMain, tabs: scan.tabs });
    } catch {
      out.push({ pageIndex, pageCategory, frameUrlCategory: category, readResult: "blocked", allowlisted, isMain, tabs: [] });
    }
  }
  return out;
}

/** Observe marketplace tabs across EVERY page in the context (recovered scope), not just the capture page. */
export async function observeMarketplaceAcrossPages(ctx: BrowserContext, allowlist: readonly string[]): Promise<FrameMarketplaceObservation[]> {
  const out: FrameMarketplaceObservation[] = [];
  const pages = ctx.pages();
  for (let i = 0; i < pages.length; i += 1) {
    try {
      const perPage = await observeMarketplaceAcrossFrames(pages[i]!, allowlist, i);
      out.push(...perPage);
    } catch {
      out.push({ pageIndex: i, pageCategory: "other", frameUrlCategory: "other", readResult: "blocked", allowlisted: false, isMain: true, tabs: [] });
    }
  }
  return out;
}

/** One sanitized VISIBLE marketplace element (the A/B-comparison unit). */
export interface VisibleMarketplaceCandidate {
  pageIndex: number;
  pageCategory: EsmUrlCategory;
  frameUrlCategory: EsmUrlCategory;
  isMain: boolean;
  allowlisted: boolean;
  marketplace: MarketplaceLabel;
  tag: string;
  role: string | null;
  textLen: number;
  tablistScoped: boolean;
  ariaSelected: string | null;
  ariaPressed: string | null;
  ariaCurrent: string | null;
  ariaChecked: string | null;
  nativeChecked: boolean;
  hasTablistAncestor: boolean;
  triggerExpanded: string | null;
  triggerHaspopup: string | null;
  triggerTag: string | null;
  triggerRole: string | null;
  inMenuContext: boolean;
  inDropdownValueContext: boolean;
  /** Which of the recovered generic selected-class tokens are present on THIS element (discovery-only). */
  selectedClassTokens: string[];
  classTokens: string[];
}

/**
 * Extract the VISIBLE marketplace elements that are plausibly the real REVIEW dropdown control: a
 * dropdown current-value or option (menu/haspopup/combobox/select context), a tablist tab (legacy), or a
 * short-labelled control. Includes dropdown + selected-class evidence per element. Sanitized only.
 */
export function visibleMarketplaceCandidates(frames: readonly FrameMarketplaceObservation[], maxTextLen = 12): VisibleMarketplaceCandidate[] {
  const out: VisibleMarketplaceCandidate[] = [];
  for (const f of frames) {
    for (const t of f.tabs) {
      if (!t.visible) continue;
      const plausible = t.tablistScoped || t.inMenuContext || t.inDropdownValueContext || t.textLen <= maxTextLen;
      if (!plausible) continue;
      out.push({
        pageIndex: f.pageIndex,
        pageCategory: f.pageCategory,
        frameUrlCategory: f.frameUrlCategory,
        isMain: f.isMain,
        allowlisted: f.allowlisted,
        marketplace: t.marketplace,
        tag: t.tag,
        role: t.role,
        textLen: t.textLen,
        tablistScoped: t.tablistScoped,
        ariaSelected: t.ariaSelected,
        ariaPressed: t.ariaPressed,
        ariaCurrent: t.ariaCurrent,
        ariaChecked: t.ariaChecked,
        nativeChecked: t.nativeChecked,
        hasTablistAncestor: t.hasTablistAncestor,
        triggerExpanded: t.triggerExpanded,
        triggerHaspopup: t.triggerHaspopup,
        triggerTag: t.triggerTag,
        triggerRole: t.triggerRole,
        inMenuContext: t.inMenuContext,
        inDropdownValueContext: t.inDropdownValueContext,
        selectedClassTokens: t.classTokens.map((c) => c.toLowerCase()).filter((c) => DISCOVERY_SELECTED_CLASS_TOKENS.includes(c)),
        classTokens: t.classTokens,
      });
    }
  }
  return out;
}

/** Sanitized summary of one qualifying (both-marketplaces) tab group. */
export interface MarketplaceGroupSummary {
  frameUrlCategory: EsmUrlCategory;
  isMain: boolean;
  allowlisted: boolean;
  hasTablistAncestor: boolean;
  gmarket: { visible: boolean; ariaSelectedTrue: boolean; ariaPressedTrue: boolean; ariaCurrentSet: boolean; ariaCheckedTrue: boolean; nativeChecked: boolean };
  auction: { visible: boolean; ariaSelectedTrue: boolean; ariaPressedTrue: boolean; ariaCurrentSet: boolean; ariaCheckedTrue: boolean; nativeChecked: boolean };
  /** Class tokens present on exactly one of the two tabs (symmetric difference) — never full class strings. */
  differingClassTokens: { gmarketOnly: string[]; auctionOnly: string[] };
  /** True when exactly one tab shows an ARIA/native selected signal the other lacks. */
  uniqueAriaSelectedDifference: boolean;
}

const truthyAriaCurrent = (v: string | null): boolean => v !== null && v !== "false";
const ariaState = (t: ObservedTab) => ({
  visible: t.visible,
  ariaSelectedTrue: t.ariaSelected === "true",
  ariaPressedTrue: t.ariaPressed === "true",
  ariaCurrentSet: truthyAriaCurrent(t.ariaCurrent),
  ariaCheckedTrue: t.ariaChecked === "true",
  nativeChecked: t.nativeChecked,
});
const anyAriaSelected = (s: ReturnType<typeof ariaState>): boolean =>
  s.ariaSelectedTrue || s.ariaPressedTrue || s.ariaCurrentSet || s.ariaCheckedTrue || s.nativeChecked;

/**
 * Reduce the raw frame observations to per-qualifying-group summaries (a group has BOTH a GMARKET and an
 * AUCTION tab in the same container). Reports only the DIFFERING class tokens between the two tabs.
 */
export function summarizeMarketplaceObservation(frames: readonly FrameMarketplaceObservation[]): MarketplaceGroupSummary[] {
  const summaries: MarketplaceGroupSummary[] = [];
  for (const f of frames) {
    const byContainer = new Map<number, ObservedTab[]>();
    for (const t of f.tabs) {
      if (t.containerIndex < 0) continue;
      const list = byContainer.get(t.containerIndex) ?? [];
      list.push(t);
      byContainer.set(t.containerIndex, list);
    }
    for (const list of byContainer.values()) {
      const g = list.find((t) => t.marketplace === "GMARKET");
      const a = list.find((t) => t.marketplace === "AUCTION");
      if (g === undefined || a === undefined) continue;
      const gTokens = new Set(g.classTokens);
      const aTokens = new Set(a.classTokens);
      const gState = ariaState(g);
      const aState = ariaState(a);
      summaries.push({
        frameUrlCategory: f.frameUrlCategory,
        isMain: f.isMain,
        allowlisted: f.allowlisted,
        hasTablistAncestor: g.hasTablistAncestor || a.hasTablistAncestor,
        gmarket: gState,
        auction: aState,
        differingClassTokens: {
          gmarketOnly: [...gTokens].filter((x) => !aTokens.has(x)),
          auctionOnly: [...aTokens].filter((x) => !gTokens.has(x)),
        },
        uniqueAriaSelectedDifference: anyAriaSelected(gState) !== anyAriaSelected(aState),
      });
    }
  }
  return summaries;
}
