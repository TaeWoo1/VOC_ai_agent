import type { BrowserContext, Frame, Page } from "playwright";
import { log } from "../log";
import {
  buildCandidateShape,
  buildContinueControl,
  buildHrefStructure,
  classifyAccountStoreSurface,
  classifyContinuationCard,
  decideAccountStoreAction,
  pickCandidateIdentity,
  resolverSurfaceFromVerdict,
  type ClickableTagCategory,
  type ExpectedContinueCard,
  type ExpectedIdentity,
  type HrefCategory,
  type RawCandidateShape,
  type RawControlContainment,
  type RawControlMarkers,
  type RawSelectionCandidate,
  type RawSelectionSurface,
  type ResolverDecision,
  type ResolverSurface,
  type RoleCategory,
  type SanitizedCandidateShape,
  type SanitizedContinuationCard,
  type SanitizedContinueControl,
  type SanitizedHrefStructure,
  type SanitizedSelectionSignals,
  type TagCategory,
} from "./account-store-resolver";
import { sessionVerdictFromContent, urlCategory } from "./session-check";

/**
 * Live boundary for the account/store RESOLVER — a STRICTLY READ-ONLY, NO-CLICK gather.
 *
 * It reads the surface the human left (top document + every child frame, plus popup
 * presence), extracts candidate account/store cards as RAW structured fields, and hands
 * them to the PURE `account-store-resolver` core, which sanitizes + decides. This module
 * performs NO click, NO navigation, NO selection, NO download, NO upload, writes NO
 * status, and prints nothing — it returns the pure decision + the sanitized (log-safe)
 * signals for the caller to display. The no-leak guarantee is proven by the
 * hostile-fixture test on the pure core; a source-guard test locks the no-click shape.
 *
 * The candidate selectors / identity attributes below are PLACEHOLDERS (like
 * `ACCOUNT_RECONNECT_MARKERS`) to be confirmed by the first live no-click run. If they
 * read nothing stable, the pure core reports AMBIGUOUS / UNSUPPORTED — an honest "cannot
 * safely resolve", never a guess.
 */

// Placeholder markers — drive ONLY a coarse surface sub-label; matched text is never returned.
const STORE_SELECT_MARKERS = [/스토어\s*선택/, /store[-\s]?(select(or|ion)?|chooser|picker)/i];
const ACCOUNT_SELECT_MARKERS = [
  /계정\s*선택/,
  /다른\s*계정/,
  /account[-\s]?(chooser|select(or|ion)?|picker)/i,
];
const anyMatch = (markers: RegExp[], html: string): boolean => markers.some((re) => re.test(html));

/** One candidate as read from the live DOM — RAW fields, sanitized only by the pure core. */
interface RawCandidateScan {
  visibleText: string;
  commerceId: string | null;
  storeUrlPath: string | null;
  accountScope: string | null;
  clickable: boolean;
  /** Structural shape (booleans/counts/enums only — never a value). Bucketed by the pure helper. */
  shape: RawCandidateShape;
  /**
   * For naver-commerce anchors only: the href split into raw path SEGMENTS + query KEY
   * NAMES (query VALUES are never read in-page). Classified to categories by the pure
   * `buildHrefStructure`; null for non-naver-commerce candidates.
   */
  hrefParts: { pathSegments: string[]; queryKeyNames: string[] } | null;
  /** Coarse continue/login/account/naver/commerce + negative/positive marker presence (booleans only). */
  markers: RawControlMarkers;
  /** Per-control containment relative to the matched continuation card (DOM structure only). */
  containment: RawControlContainment;
}

/** Raw continuation-card read from the top document (markers + raw card text). */
interface RawContinuationCardScan {
  cardText: string;
  hasCurrentLoginAccountCard: boolean;
  hasNaverCommerceIdMarker: boolean;
  hasNaverIdMarker: boolean;
}

export interface CollectedSelection {
  decision: ResolverDecision;
  signals: SanitizedSelectionSignals;
  /** Report-only structural diagnostic, parallel to `signals.candidates` (same index/hash). */
  candidateShapes: SanitizedCandidateShape[];
  /** Report-only href structure for naver-commerce anchor candidates (where identity may live). */
  hrefStructures: SanitizedHrefStructure[];
  /** Report-only single-account continuation-card diagnostic (display-text fingerprint). */
  continuationCard: SanitizedContinuationCard;
  /** Report-only per-clickable-control diagnostic (which control is the safe continue target). */
  continueControls: SanitizedContinueControl[];
}

/**
 * READ-ONLY candidate scan, runnable in any frame. Reads text + a small set of identity
 * ATTRIBUTES only — it never clicks, focuses, submits, or dispatches an event, and never
 * returns matched marker text. NOTE (no named inner functions): the callback is serialized
 * into the page sandbox, so it uses only plain inline loops — a named inner helper would be
 * rewritten by esbuild keepNames to `__name(...)`, undefined in the page (the storage-collect
 * bug). A source-guard test locks this shape.
 */
async function scanSelectionCandidates(frame: Frame): Promise<RawCandidateScan[]> {
  return frame.evaluate(() => {
    const ID_ATTRS = [
      "data-channel-no",
      "data-channel-code",
      "data-channel-id",
      "data-commerce-id",
      "data-store-no",
      "data-store-id",
    ];
    const ACCOUNT_ATTRS = ["data-account-id", "data-account-no", "data-login-id"];
    const nodes = Array.from(
      document.querySelectorAll(
        "button, a, [role='button'], [role='option'], li[role='listitem'], [data-channel-no], [data-store-no], [data-account-id]",
      ),
    );

    // Locate the continuation card element ONCE (tightest element carrying the current-
    // account marker, else a Commerce-ID / NAVER-ID marker) so per-control containment can
    // be measured against it. Plain inline loops only (no named helper → no `__name`).
    const CARD_CURRENT = /현재\s*로그인\s*중인/;
    const CARD_COMMERCE = /커머스\s*(아이디|id)/i;
    const CARD_NAVERID = /네이버\s*아이디|naver\s*id/i;
    let cardEl: Element | null = null;
    let cardBestLen = Infinity;
    const allEls = Array.from(document.querySelectorAll("*"));
    for (const el of allEls) {
      const tc = el.textContent ?? "";
      if (CARD_CURRENT.test(tc) && tc.length < cardBestLen) {
        cardBestLen = tc.length;
        cardEl = el;
      }
    }
    if (!cardEl) {
      let l2 = Infinity;
      for (const el of allEls) {
        const tc = el.textContent ?? "";
        if ((CARD_COMMERCE.test(tc) || CARD_NAVERID.test(tc)) && tc.length < l2) {
          l2 = tc.length;
          cardEl = el;
        }
      }
    }

    const out: RawCandidateScan[] = [];
    for (const el of nodes) {
      const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      let commerceId: string | null = null;
      for (const a of ID_ATTRS) {
        const v = el.getAttribute(a);
        if (v && v.trim().length > 0) {
          commerceId = v.trim();
          break;
        }
      }
      let storeUrlPath: string | null = null;
      const href = el.getAttribute("href");
      if (href) {
        const m = href.match(/\/(?:store|channel|sell)\/([A-Za-z0-9_-]+)/);
        if (m && m[1]) storeUrlPath = m[1];
      }
      let accountScope: string | null = null;
      for (const a of ACCOUNT_ATTRS) {
        const v = el.getAttribute(a);
        if (v && v.trim().length > 0) {
          accountScope = v.trim();
          break;
        }
      }
      const tag = el.tagName.toLowerCase();
      const role = (el.getAttribute("role") ?? "").toLowerCase();
      const clickable = tag === "button" || tag === "a" || role === "button" || role === "option";
      if (text.length === 0 && commerceId === null && storeUrlPath === null && accountScope === null) {
        continue;
      }

      // Coarse continue/login/account/naver/commerce marker presence from accessible text.
      // The `acc` string is RAW (never returned); only the booleans leave the page.
      const acc = `${el.textContent ?? ""} ${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("title") ?? ""} ${(el as HTMLInputElement).value ?? ""}`;
      const markers = {
        continueLike: /이\s*계정으로\s*계속|계정으로\s*계속|계속하기|계속|continue/i.test(acc),
        loginLike: /로그인|login|sign\s*in/i.test(acc),
        accountLike: /계정|account/i.test(acc),
        naverLike: /네이버|naver/i.test(acc),
        commerceLike: /커머스|commerce|스마트스토어|smartstore/i.test(acc),
        differentAccount: /다른\s*계정|other\s*account/i.test(acc),
        differentId: /다른\s*(아이디|id)|other\s*id/i.test(acc),
        otherLogin: /다른\s*(아이디|계정)?\s*(으로)?\s*로그인|other\s*(id|account)?\s*login/i.test(acc),
        switchAccount: /계정\s*전환|전환하기|switch\s*account|change\s*account/i.test(acc),
        logout: /로그아웃|logout|sign\s*out/i.test(acc),
        currentAccount: /현재\s*(로그인|계정)|이\s*계정|이\s*아이디|current\s*account|this\s*account/i.test(acc),
        continueCurrent: /이\s*계정으로\s*계속|계속하기|continue/i.test(acc),
        loginCurrent: /이\s*계정으로\s*로그인|이\s*아이디로\s*로그인|현재.{0,10}로그인/i.test(acc),
      };

      // ----- Containment relative to the matched continuation card (DOM structure only).
      let isWithinContinuationCard = false;
      let isNearContinuationCard = false;
      let cardAncestorDepth = 0;
      let nearestCardMarkerCategory: "currentLogin" | "commerceId" | "naverId" | "none" = "none";
      if (cardEl) {
        isWithinContinuationCard = cardEl !== el && cardEl.contains(el);
        let cur: Element | null = el;
        let d = 0;
        while (cur && d < 30) {
          if (cur.contains(cardEl)) break;
          cur = cur.parentElement;
          d += 1;
        }
        cardAncestorDepth = d;
        isNearContinuationCard = isWithinContinuationCard || d <= 4;
        let a: Element | null = el;
        let steps = 0;
        while (a && steps < 8) {
          const atc = a.textContent ?? "";
          if (atc.length < 2000) {
            if (CARD_CURRENT.test(atc)) {
              nearestCardMarkerCategory = "currentLogin";
              break;
            }
            if (CARD_COMMERCE.test(atc)) {
              nearestCardMarkerCategory = "commerceId";
              break;
            }
            if (CARD_NAVERID.test(atc)) {
              nearestCardMarkerCategory = "naverId";
              break;
            }
          }
          a = a.parentElement;
          steps += 1;
        }
      }
      const containment = {
        isWithinContinuationCard,
        isNearContinuationCard,
        cardAncestorDepth,
        nearestCardMarkerCategory,
      };

      // ----- Sanitized structural shape (booleans / small counts / fixed enums ONLY).
      // No raw attribute value, no raw href, no raw class/id/name/value leaves this block.
      let tagCategory: TagCategory = "other";
      if (tag === "button" || tag === "a" || tag === "input" || tag === "li" || tag === "div" || tag === "span") {
        tagCategory = tag;
      }
      let roleCategory: RoleCategory = "none";
      if (role === "button" || role === "option" || role === "listitem" || role === "link") {
        roleCategory = role;
      } else if (role.length > 0) {
        roleCategory = "other";
      }

      let dataAttrCount = 0;
      let hasDataAttrNameChannelLike = false;
      let hasDataAttrNameStoreLike = false;
      let hasDataAttrNameAccountLike = false;
      let hasDataAttrNameCommerceLike = false;
      const attrs = el.attributes;
      for (let ai = 0; ai < attrs.length; ai += 1) {
        const name = attrs[ai]!.name.toLowerCase();
        if (name.indexOf("data-") === 0) {
          dataAttrCount += 1;
          if (/channel/.test(name)) hasDataAttrNameChannelLike = true;
          if (/store|shop|mall/.test(name)) hasDataAttrNameStoreLike = true;
          if (/account|login|member|user/.test(name)) hasDataAttrNameAccountLike = true;
          if (/commerce|seller|biz|brand/.test(name)) hasDataAttrNameCommerceLike = true;
        }
      }

      const nestedLinks = el.querySelectorAll("a[href]");
      const nestedButtons = el.querySelectorAll("button");
      const hasNestedLink = nestedLinks.length > 0;
      const hasNestedButton = nestedButtons.length > 0;
      const hasAnchor = tag === "a" || el.querySelector("a") !== null;
      const hasButton = tag === "button" || hasNestedButton;
      const hasInput = tag === "input" || el.querySelector("input") !== null;
      const hasRadio =
        (tag === "input" && (el.getAttribute("type") ?? "").toLowerCase() === "radio") ||
        el.querySelector("input[type='radio']") !== null;
      const hasImage = tag === "img" || el.querySelector("img") !== null;
      const hasSvg = tag === "svg" || el.querySelector("svg") !== null;

      let clickableTagCategory: ClickableTagCategory = "none";
      if (clickable) clickableTagCategory = tagCategory;
      else if (hasNestedButton) clickableTagCategory = "button";
      else if (hasNestedLink) clickableTagCategory = "a";

      let hrefCategory: HrefCategory = "none";
      let hrefPathSegmentCount = 0;
      if (href) {
        try {
          const u = new URL(href, location.href);
          const host = u.hostname.toLowerCase();
          if (/nid\.naver|nidlogin/.test(host) || /\/login|nidlogin|\bauth\b/.test(u.pathname)) {
            hrefCategory = "naver-login";
          } else if (/sell\.smartstore|sell\.naver|commerce|smartstore/.test(host)) {
            hrefCategory = "naver-commerce";
          } else if (host === location.hostname) {
            hrefCategory = "same-origin";
          } else if (u.protocol === "http:" || u.protocol === "https:") {
            hrefCategory = "external";
          } else {
            hrefCategory = "other";
          }
          let segs = 0;
          for (const p of u.pathname.split("/")) {
            if (p.length > 0) segs += 1;
          }
          hrefPathSegmentCount = segs;
        } catch {
          hrefCategory = "other";
        }
      }

      // For naver-commerce anchors, split the href into raw path SEGMENTS + query KEY
      // NAMES only — query VALUES are never read (use searchParams.keys(), never get()).
      let hrefParts: { pathSegments: string[]; queryKeyNames: string[] } | null = null;
      if (hrefCategory === "naver-commerce") {
        try {
          const u2 = new URL((el as HTMLAnchorElement).href);
          const segs: string[] = [];
          for (const p of u2.pathname.split("/")) {
            if (p.length > 0) segs.push(p);
          }
          const keys: string[] = [];
          for (const k of u2.searchParams.keys()) keys.push(k);
          hrefParts = { pathSegments: segs, queryKeyNames: keys };
        } catch {
          hrefParts = null;
        }
      }

      const shape: RawCandidateShape = {
        tagCategory,
        roleCategory,
        clickableTagCategory,
        hasHref: el.hasAttribute("href"),
        hasButton,
        hasAnchor,
        hasInput,
        hasRadio,
        hasImage,
        hasSvg,
        hasAriaLabel: el.hasAttribute("aria-label"),
        hasTitleAttr: el.hasAttribute("title"),
        hasDataAttrs: dataAttrCount > 0,
        hasDataAttrNameChannelLike,
        hasDataAttrNameStoreLike,
        hasDataAttrNameAccountLike,
        hasDataAttrNameCommerceLike,
        hasIdAttr: el.hasAttribute("id"),
        hasClassAttr: el.hasAttribute("class"),
        hasNameAttr: el.hasAttribute("name"),
        hasValueAttr: el.hasAttribute("value"),
        hasOnClickAttr: el.hasAttribute("onclick"),
        hasNestedLink,
        hasNestedButton,
        dataAttrCount,
        classTokenCount: el.classList ? el.classList.length : 0,
        childElementCount: el.childElementCount,
        linkCount: nestedLinks.length,
        buttonCount: nestedButtons.length,
        hrefCategory,
        hrefPathSegmentCount,
      };

      out.push({ visibleText: text, commerceId, storeUrlPath, accountScope, clickable, shape, hrefParts, markers, containment });
    }
    return out;
  });
}

/** Per-frame read that degrades to [] on a detached/navigating frame (never aborts the run). */
async function scanFrameSafe(frame: Frame): Promise<RawCandidateScan[]> {
  try {
    return await scanSelectionCandidates(frame);
  } catch {
    return [];
  }
}

/**
 * READ-ONLY continuation-card scan (top document). Detects the single-account "continue"
 * markers and reads the tightest element containing the "currently logged in as …" marker
 * as the raw card text (hashed in Node, never returned to output). The continue-CONTROL
 * count is NOT computed here — it is derived in `collectSelectionSurface` from the validated
 * safe-continue rule (`matchesSafeContinueHypothesis`) over the per-control diagnostic, so
 * the rule lives in exactly one place. NO named inner helper (the `__name` bug) — plain
 * inline loops only.
 */
async function scanContinuationCard(page: Page): Promise<RawContinuationCardScan> {
  return page.evaluate(() => {
    const CURRENT = /현재\s*로그인\s*중인/;
    const COMMERCE = /커머스\s*(아이디|id)/i;
    const NAVERID = /네이버\s*아이디|naver\s*id/i;

    const bodyText = document.body ? document.body.textContent ?? "" : "";
    const hasCurrentLoginAccountCard = CURRENT.test(bodyText);
    const hasNaverCommerceIdMarker = COMMERCE.test(bodyText);
    const hasNaverIdMarker = NAVERID.test(bodyText);

    // Tightest element containing the current-account marker → most stable card text.
    let cardText = "";
    let bestLen = Infinity;
    const all = Array.from(document.querySelectorAll("*"));
    for (const el of all) {
      const tc = el.textContent ?? "";
      if (CURRENT.test(tc) && tc.length < bestLen) {
        bestLen = tc.length;
        cardText = tc;
      }
    }
    if (cardText.length === 0) {
      // Fallback: tightest element matching a Commerce-ID / NAVER-ID marker.
      let l2 = Infinity;
      for (const el of all) {
        const tc = el.textContent ?? "";
        if ((COMMERCE.test(tc) || NAVERID.test(tc)) && tc.length < l2) {
          l2 = tc.length;
          cardText = tc;
        }
      }
    }

    return {
      cardText,
      hasCurrentLoginAccountCard,
      hasNaverCommerceIdMarker,
      hasNaverIdMarker,
    };
  });
}

/** Continuation-card read that degrades to an empty card on any error (never aborts the run). */
async function scanContinuationCardSafe(page: Page): Promise<RawContinuationCardScan> {
  try {
    return await scanContinuationCard(page);
  } catch {
    return {
      cardText: "",
      hasCurrentLoginAccountCard: false,
      hasNaverCommerceIdMarker: false,
      hasNaverIdMarker: false,
    };
  }
}

/**
 * Read the current (human-left) surface, classify it, and decide — WITHOUT clicking.
 * Returns the pure decision + sanitized signals. Candidate cards are read only on an
 * actual selection surface; login/auth/review-ready/unknown short-circuit in the pure
 * decision, so no account cards are read there.
 */
export async function collectSelectionSurface(
  page: Page,
  ctx: BrowserContext,
  expected: ExpectedIdentity,
  salt: string,
  expectedContinueCard: ExpectedContinueCard = {},
): Promise<CollectedSelection> {
  const url = page.url();
  const topHtml = await page.content();
  const verdict = sessionVerdictFromContent(topHtml, url);
  const surface: ResolverSurface = resolverSurfaceFromVerdict(verdict, {
    storeSelectMarkerPresent: anyMatch(STORE_SELECT_MARKERS, topHtml),
    accountSelectMarkerPresent: anyMatch(ACCOUNT_SELECT_MARKERS, topHtml),
  });

  let candidates: RawSelectionCandidate[] = [];
  let rawScans: RawCandidateScan[] = [];
  let inTopDocument = false;
  let inChildFrame = false;
  if (surface === "account-chooser" || surface === "store-chooser" || surface === "reconnect-continue") {
    const mainFrame = page.mainFrame();
    const top = await scanFrameSafe(mainFrame);
    inTopDocument = top.length > 0;
    const all = [...top];
    for (const frame of page.frames()) {
      if (frame === mainFrame) continue;
      const fc = await scanFrameSafe(frame);
      if (fc.length > 0) inChildFrame = true;
      all.push(...fc);
    }
    rawScans = all;
    candidates = all.map((c) => {
      const id = pickCandidateIdentity(c);
      return {
        identityToken: id.identityToken,
        sourceCategory: id.sourceCategory,
        visibleText: c.visibleText,
        clickable: c.clickable,
      };
    });
  }
  const popupPagePresent = ctx.pages().length > 1;

  const raw: RawSelectionSurface = {
    surface,
    candidates,
    inTopDocument,
    inChildFrame,
    popupPagePresent,
    salt,
  };
  const decision = decideAccountStoreAction(raw, expected);
  const signals = classifyAccountStoreSurface(raw, expected);
  // Report-only structural shapes, correlated by index + the already-salted textHash from
  // the sanitized candidate (so nothing new — no raw value — crosses into the shape).
  const candidateShapes = rawScans.map((c, i) =>
    buildCandidateShape(i, signals.candidates[i]?.textHash ?? "", c.shape),
  );
  // Report-only continue-control diagnostic: per CLICKABLE candidate, the sanitized shape
  // plus coarse marker booleans (which control reads continue/login/account/naver/commerce).
  const continueControls: SanitizedContinueControl[] = [];
  rawScans.forEach((c, i) => {
    const shape = candidateShapes[i];
    if (c.clickable && shape) continueControls.push(buildContinueControl(shape, c.markers, c.containment));
  });
  // Report-only href structure for naver-commerce anchors: the pure classifier turns the
  // raw path segments + query key NAMES into categories/buckets (no value ever emitted).
  const hrefStructures: SanitizedHrefStructure[] = [];
  rawScans.forEach((c, i) => {
    if (c.hrefParts) {
      hrefStructures.push(
        buildHrefStructure(
          i,
          signals.candidates[i]?.textHash ?? "",
          c.shape.hrefCategory,
          c.hrefParts.pathSegments,
          c.hrefParts.queryKeyNames,
        ),
      );
    }
  });
  // The continue-CONTROL count is the number of controls matching the VALIDATED safe-continue
  // rule (login-like, within/near the matched card, no alternate/switch/logout negatives) —
  // derived from the per-control diagnostic so the rule lives in exactly one place. It is
  // STRUCTURAL + marker-based, never an index or raw text. The conservative gate downstream
  // (`decideContinuationCard`) requires EXACTLY one such control to reach READY_TO_CONTINUE;
  // 0 or ≥2 → AMBIGUOUS (never click).
  const safeContinueControlCount = continueControls.filter(
    (c) => c.matchesSafeContinueHypothesis,
  ).length;

  // Report-only continuation-card diagnostic (single-account "continue" surface). Read
  // the card markers + tightest card text from the top document; the pure classifier
  // normalizes + hashes the text (never emits it) and decides would-continue safety.
  const cardScan = await scanContinuationCardSafe(page);
  const continuationCard = classifyContinuationCard(
    {
      surface,
      continueControlCount: safeContinueControlCount,
      cardText: cardScan.cardText,
      hasCurrentLoginAccountCard: cardScan.hasCurrentLoginAccountCard,
      hasNaverCommerceIdMarker: cardScan.hasNaverCommerceIdMarker,
      hasNaverIdMarker: cardScan.hasNaverIdMarker,
      salt,
    },
    expectedContinueCard,
  );

  // Coarse log only — never the raw URL/HTML/candidate content.
  log("classify.account-store.surface", {
    surface,
    urlCategory: urlCategory(url),
    decisionKind: decision.kind,
    continuationDecision: continuationCard.decisionKind,
  });
  return { decision, signals, candidateShapes, hrefStructures, continuationCard, continueControls };
}
