/**
 * `chrome-selector-spec/v1`.
 *
 * This module had NO offline test, and an adversarial pass found four single-line mutations that survived
 * the whole suite green — two of them fail-open on a permanent binding. Each `MUTATION:` note below names
 * the edit the test exists to kill, because a test whose purpose is not written down gets deleted by the
 * next person who finds it inconvenient.
 */
import { describe, it, expect } from "vitest";
import {
  SELECTOR_STRATEGIES,
  MAX_SELECTOR_LENGTH,
  parseSelectorSpecs,
  rankCandidates,
  selectorEmbedsValue,
  selectorSpecsFingerprint,
  specsCollide,
  stabilityOf,
  withoutIdentityBearingSpecs,
  type ChromeSelectorSpecs,
} from "../../../src/action-window/reply-submission/chrome-selector-spec";

const spec = (strategy: string, selector: string) =>
  ({ strategy, selector, stability: stabilityOf(strategy as never) }) as never;

const specs = (user: string[], shop: string[]): ChromeSelectorSpecs => ({
  userId: user.map((s) => spec("element-id", s)),
  shopName: shop.map((s) => spec("element-id", s)),
});

describe("specsCollide", () => {
  it("is TRUE for a duplicated selector — the direction never asserted anywhere before", () => {
    // MUTATION: `return specs.shopName.some(...)` -> `return false`. Nothing offline called this, and the
    // browser rung only ever asserted `=== false`, so the fail-open direction was unobserved.
    expect(specsCollide(specs(["#a"], ["#a"]))).toBe(true);
    expect(specsCollide(specs(["#a", "#b"], ["#z", "#b"]))).toBe(true);
  });

  it("is FALSE for disjoint selectors", () => {
    expect(specsCollide(specs(["#a"], ["#b"]))).toBe(false);
  });

  it("does NOT catch two different selectors that resolve to one element — by construction", () => {
    // Recorded as a KNOWN LIMIT rather than left implicit. This compares strings; it has no access to what
    // they resolve to. The class is closed at the value layer, in `normalizeSessionIdentity`, which refuses
    // a pair whose halves are equal. If that check is ever removed, THIS is the hole it reopens.
    expect(specsCollide(specs(["#account-chip"], ["header > span:nth-of-type(1)"]))).toBe(false);
  });
});

describe("selectorSpecsFingerprint", () => {
  const base = specs(["#u"], ["#s"]);

  it("changes on add, remove, reorder, and edit — on EITHER field", () => {
    // MUTATION: `.update(DOMAIN + canonical)` -> `.update(DOMAIN)`. Every spec set would then digest
    // identically, `selector-source-changed` becomes unreachable, and a re-calibration silently re-points
    // the identity read while an old binding still MATCHes. No test called this function at all; the
    // verifier tests pass "a".repeat(64) literals.
    const f = selectorSpecsFingerprint(base);
    expect(selectorSpecsFingerprint(specs(["#u", "#u2"], ["#s"]))).not.toBe(f);
    expect(selectorSpecsFingerprint(specs([], ["#s"]))).not.toBe(f);
    expect(selectorSpecsFingerprint(specs(["#u"], ["#s", "#s2"]))).not.toBe(f);
    expect(selectorSpecsFingerprint(specs(["#u"], ["#sX"]))).not.toBe(f);
  });

  it("is order-sensitive WITHIN a field", () => {
    expect(selectorSpecsFingerprint(specs(["#a", "#b"], ["#s"]))).not.toBe(
      selectorSpecsFingerprint(specs(["#b", "#a"], ["#s"])),
    );
  });

  it("is order-sensitive ACROSS the two fields — swapping them is a different source", () => {
    expect(selectorSpecsFingerprint(specs(["#u"], ["#s"]))).not.toBe(
      selectorSpecsFingerprint(specs(["#s"], ["#u"])),
    );
  });

  it("is stable for an identical pair, and covers the strategy as well as the selector", () => {
    expect(selectorSpecsFingerprint(base)).toBe(selectorSpecsFingerprint(specs(["#u"], ["#s"])));
    const asClassPath: ChromeSelectorSpecs = {
      userId: [spec("class-path", "#u")],
      shopName: [spec("element-id", "#s")],
    };
    expect(selectorSpecsFingerprint(asClassPath)).not.toBe(selectorSpecsFingerprint(base));
  });
});

describe("rankCandidates", () => {
  it("orders by STRATEGY preference, not by derivation order", () => {
    // MUTATION: iterate `candidates` instead of `SELECTOR_STRATEGIES`. A document-path would become
    // specs.userId[0] — the selector every future run tries FIRST. Only the RUN_INTEGRATION-gated browser
    // rung asserted this, so the default suite shipped it green.
    const ranked = rankCandidates([
      { strategy: "document-path", selector: "body > div" },
      { strategy: "class-path", selector: "div.x" },
      { strategy: "element-id", selector: "#id" },
      { strategy: "aria-label", selector: '[aria-label="a"]' },
    ]);
    expect(ranked.map((r) => r.strategy)).toEqual([
      "element-id",
      "aria-label",
      "class-path",
      "document-path",
    ]);
    expect(ranked[0]!.selector).toBe("#id");
  });

  it("dedupes by selector, keeping the strongest strategy that produced it", () => {
    const ranked = rankCandidates([
      { strategy: "document-path", selector: "#same" },
      { strategy: "element-id", selector: "#same" },
    ]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]!.strategy).toBe("element-id");
  });

  it("drops an unknown strategy and an over-long selector rather than ranking them last", () => {
    const ranked = rankCandidates([
      { strategy: "psychic", selector: "#a" },
      { strategy: "element-id", selector: `#${"x".repeat(MAX_SELECTOR_LENGTH)}` },
    ]);
    expect(ranked).toHaveLength(0);
  });

  it("labels stability from the strategy, for every strategy", () => {
    for (const strategy of SELECTOR_STRATEGIES) {
      const [only] = rankCandidates([{ strategy, selector: "#a" }]);
      expect(only!.stability, strategy).toBe(stabilityOf(strategy));
    }
    expect(stabilityOf("document-path")).toBe("weak");
    expect(stabilityOf("class-path")).toBe("weak");
    expect(stabilityOf("element-id")).toBe("strong");
  });
});

describe("parseSelectorSpecs", () => {
  it("RECOMPUTES stability, so a hand-edited file cannot claim a document-path is strong", () => {
    // MUTATION: trust `entry.stability` when present. The store would then be authoritative for how
    // trustworthy it is — which is what the module header explicitly forbids, untested until now.
    const parsed = parseSelectorSpecs({
      userId: [{ strategy: "document-path", selector: "body > i", stability: "strong" }],
      shopName: [{ strategy: "element-id", selector: "#s", stability: "weak" }],
    });
    expect(parsed?.userId[0]!.stability).toBe("weak");
    expect(parsed?.shopName[0]!.stability).toBe("strong");
  });

  it("refuses anything malformed rather than salvaging part of it", () => {
    for (const bad of [
      null,
      "a string",
      42,
      {},
      { userId: [], shopName: [{ strategy: "element-id", selector: "#s" }] },
      { userId: [{ strategy: "element-id", selector: "#u" }] },
      { userId: [{ strategy: "psychic", selector: "#u" }], shopName: [{ strategy: "element-id", selector: "#s" }] },
      { userId: [{ strategy: "element-id", selector: "" }], shopName: [{ strategy: "element-id", selector: "#s" }] },
      { userId: [{ strategy: "element-id" }], shopName: [{ strategy: "element-id", selector: "#s" }] },
      {
        userId: [{ strategy: "element-id", selector: "#".repeat(MAX_SELECTOR_LENGTH + 1) }],
        shopName: [{ strategy: "element-id", selector: "#s" }],
      },
    ]) {
      expect(parseSelectorSpecs(bad), JSON.stringify(bad)?.slice(0, 60)).toBeNull();
    }
  });

  it("round-trips a well-formed pair", () => {
    const parsed = parseSelectorSpecs(JSON.parse(JSON.stringify(specs(["#u"], ["#s"]))));
    expect(parsed).toEqual(specs(["#u"], ["#s"]));
  });
});

describe("selectorEmbedsValue — the direction two reviewers caught backwards", () => {
  const USER = "seller_alpha";

  it("catches the value inside an attribute selector even when the element DECORATES it", () => {
    // The whole bug: the in-page guard asked "does the attribute contain the element's ENTIRE text". With
    // the chip rendering "seller_alpha님" and aria-label="seller_alpha 계정", containment failed and the
    // account name was persisted. The question that matters is the reverse one.
    expect(selectorEmbedsValue('[aria-label="seller_alpha 계정 메뉴"]', USER)).toBe(true);
    expect(selectorEmbedsValue("#gnb_seller_alpha", USER)).toBe(true);
    expect(selectorEmbedsValue('[data-testid="acct-seller_alpha-menu"]', USER)).toBe(true);
  });

  it("is insensitive to whitespace and case on BOTH sides", () => {
    expect(selectorEmbedsValue('[aria-label="SELLER_ALPHA  계정"]', USER)).toBe(true);
    expect(selectorEmbedsValue('[aria-label="seller_alpha\n계정"]', "SELLER_ALPHA")).toBe(true);
  });

  it("does not fire on an innocent chrome selector", () => {
    expect(selectorEmbedsValue("#_gnb_nav > div > span", USER)).toBe(false);
    expect(selectorEmbedsValue("#seller-lnb .shop-name", "감마상점")).toBe(false);
  });

  it("refuses to treat a one-character value as evidence", () => {
    // It would match nearly every selector; that is a shape problem, not a leak, and the field's own
    // normalizer is what should reject it.
    expect(selectorEmbedsValue("#a", "a")).toBe(false);
  });
});

describe("withoutIdentityBearingSpecs", () => {
  it("purges the USER ID from the SHOP-NAME field — the cross-field hole", () => {
    // The in-page guard was per-field: deriving the shop-name selector, it only knew the shop name, so
    // `#shop-switch-seller_alpha` sailed through and persisted the account name as a shopName spec.
    const { kept, rejected } = withoutIdentityBearingSpecs(
      [spec("element-id", "#shop-switch-seller_alpha"), spec("element-id", "#seller-lnb")],
      ["seller_alpha", "감마상점"],
    );
    expect(rejected).toBe(1);
    expect(kept.map((k) => k.selector)).toEqual(["#seller-lnb"]);
  });

  it("purges the SHOP NAME from the user-id field too", () => {
    const { kept, rejected } = withoutIdentityBearingSpecs(
      [spec("aria-label", '[aria-label="감마상점 계정"]')],
      ["seller_alpha", "감마상점"],
    );
    expect(rejected).toBe(1);
    expect(kept).toEqual([]);
  });

  it("ignores null values rather than treating them as a wildcard", () => {
    const { kept, rejected } = withoutIdentityBearingSpecs([spec("element-id", "#anything")], [null, null]);
    expect(rejected).toBe(0);
    expect(kept).toHaveLength(1);
  });

  it("keeps everything when no value is embedded", () => {
    const { kept, rejected } = withoutIdentityBearingSpecs(
      [spec("element-id", "#_gnb_nav"), spec("chrome-ancestry", "#seller-lnb > div > span")],
      ["seller_alpha", "감마상점"],
    );
    expect(rejected).toBe(0);
    expect(kept).toHaveLength(2);
  });
});
