/**
 * **The consent-BLOCK probe: which checkbox belongs to which consent sentence.**
 *
 * The 2026-08-10 terms reading found no accessible association at all — both checkboxes `nameSource: NONE`,
 * neither consent sentence unique. The tempting next move is to pair box `i` with consent `i` by document order
 * and call it measured. This instrument exists so the pairing can be established STRUCTURALLY instead, and so
 * that "we could not say" stays a distinct answer from "they are paired".
 */
import { describe, expect, it } from "vitest";
import {
  WING_CONSENT_BLOCK_VERDICTS,
  buildWingConsentBlockScript,
  sanitizeConsentBlockCensus,
  type WingConsentBlockCensus,
} from "../../../src/cli/coupang-wing-classifier";
import { WING_STAGE3_TERMS_OPTION_CANDIDATES } from "../../../src/action-window/coupang-wing-label-recon";

const CONSENTS = WING_STAGE3_TERMS_OPTION_CANDIDATES.map((c) => c.exactText);

/* ── a fake DOM good enough to run the REAL generated script against ── */

class El {
  parentElement: El | null = null;
  readonly children: El[] = [];
  constructor(
    readonly tag: string,
    readonly attrs: Record<string, string> = {},
    private readonly ownText = "",
    readonly visible = true,
  ) {}
  add(...kids: El[]): this {
    for (const k of kids) {
      k.parentElement = this;
      this.children.push(k);
    }
    return this;
  }
  get textContent(): string {
    return this.ownText + this.children.map((c) => c.textContent).join(" ");
  }
  descendants(): El[] {
    return this.children.flatMap((c) => [c, ...c.descendants()]);
  }
  querySelectorAll(sel: string): El[] {
    if (sel !== "input[type='checkbox']") return [];
    return this.descendants().filter((e) => e.tag === "INPUT" && e.attrs.type === "checkbox");
  }
  getClientRects(): { length: number }[] {
    return this.visible ? [{ length: 1 }] : [];
  }
  getBoundingClientRect(): { width: number; height: number } {
    return this.visible ? { width: 10, height: 10 } : { width: 0, height: 0 };
  }
}

const box = (visible = true): El => new El("INPUT", { type: "checkbox" }, "", visible);
const text = (t: string): El => new El("SPAN", {}, t);
const div = (...kids: El[]): El => new El("DIV").add(...kids);

function run(root: El, consents: readonly string[] = CONSENTS): { out: unknown; sanitized: WingConsentBlockCensus } {
  const doc = { querySelectorAll: (sel: string) => root.querySelectorAll(sel) };
  const win = { getComputedStyle: (el: El) => ({ display: el.visible ? "block" : "none", visibility: "visible" }) };
  const out = new Function("document", "window", `return (${buildWingConsentBlockScript([...consents])});`)(doc, win);
  const sanitized = sanitizeConsentBlockCensus(out, consents);
  expect(sanitized, "the real script must always produce a usable reading").not.toBeNull();
  return { out, sanitized: sanitized! };
}

describe("the consent-block probe, run against the real generated script", () => {
  it("**pairs each box with its own consent when each sits in its own block**", () => {
    // The layout that would make the pairing a fact: one row per consent, one box in each.
    const root = div(
      div(box(), text(CONSENTS[0]!)),
      div(box(), text(CONSENTS[1]!)),
    );
    const { sanitized } = run(root);
    expect(sanitized.visibleCheckboxCount).toBe(2);
    expect(sanitized.rows.map((r) => [r.index, r.verdict, r.consentIndex, r.blockVisibleCheckboxCount])).toEqual([
      [0, "NEAREST_BLOCK_HOLDS_EXACTLY_ONE_CONSENT", 0, 1],
      [1, "NEAREST_BLOCK_HOLDS_EXACTLY_ONE_CONSENT", 1, 1],
    ]);
    // A clean 1:1 map — every consent claimed by exactly one box's own block.
    expect(sanitized.consentsMatchedExactlyOnce).toBe(2);
    expect(sanitized.consentsCompared).toBe(2);
  });

  it("**refuses to guess when one block holds both consents** — the pairing is not a fact there", () => {
    // Both boxes and both sentences inside one container. Document order would happily pair 0↔0 and 1↔1; the
    // page has said nothing that supports it, and this is where an invented association would enter.
    const root = div(div(box(), box(), text(CONSENTS[0]!), text(CONSENTS[1]!)));
    const { sanitized } = run(root);
    for (const r of sanitized.rows) {
      expect(r.verdict).toBe("NEAREST_BLOCK_HOLDS_SEVERAL_CONSENTS");
      expect(r.consentIndex).toBe(-1);
    }
    expect(sanitized.consentsMatchedExactlyOnce).toBe(0);
  });

  it("a block holding one consent but BOTH boxes identifies neither box", () => {
    // Subtler, and the reason `blockVisibleCheckboxCount` is on the row: the nearest block is unambiguous about
    // the consent and useless about the box. It must not count toward a clean pairing.
    const root = div(div(box(), box(), text(CONSENTS[0]!)), div(text(CONSENTS[1]!)));
    const { sanitized } = run(root);
    expect(sanitized.rows.every((r) => r.verdict === "NEAREST_BLOCK_HOLDS_EXACTLY_ONE_CONSENT")).toBe(true);
    expect(sanitized.rows.every((r) => r.blockVisibleCheckboxCount === 2)).toBe(true);
    expect(sanitized.consentsMatchedExactlyOnce).toBe(0);
  });

  it("says so when no ancestor within the bound holds a consent", () => {
    // A box whose own subtree holds no sentence still pairs, if the nearest COMMON ancestor holds exactly one:
    // being in a sibling element is a structural relationship, and depth records how loose it is.
    const sibling = run(div(div(box()), div(text(CONSENTS[0]!))));
    expect(sibling.sanitized.rows[0]!.verdict).toBe("NEAREST_BLOCK_HOLDS_EXACTLY_ONE_CONSENT");
    expect(sibling.sanitized.rows[0]!.consentIndex).toBe(0);
    expect(sibling.sanitized.rows[0]!.ancestorDepth).toBe(2);
    // Add the second sentence to that same ancestor and it stops identifying anything.
    const both = run(div(div(box()), div(text(CONSENTS[0]!)), div(text(CONSENTS[1]!))));
    expect(both.sanitized.rows[0]!.verdict).toBe("NEAREST_BLOCK_HOLDS_SEVERAL_CONSENTS");
    expect(both.sanitized.rows[0]!.consentIndex).toBe(-1);
    const orphan = run(div(div(box())));
    expect(orphan.sanitized.rows[0]!.verdict).toBe("NO_ANCESTOR_HOLDS_A_CONSENT_WITHIN_BOUND");
    expect(orphan.sanitized.rows[0]!.ancestorDepth).toBe(-1);
    expect(orphan.sanitized.consentsMatchedExactlyOnce).toBe(0);
  });

  it("counts only PAINTING checkboxes — the terms screen carries ten hidden ones", () => {
    const root = div(div(box(false), box(), text(CONSENTS[0]!)), div(box(false), box(), text(CONSENTS[1]!)));
    const { sanitized } = run(root);
    expect(sanitized.visibleCheckboxCount).toBe(2);
    expect(sanitized.rows).toHaveLength(2);
    expect(sanitized.rows.every((r) => r.blockVisibleCheckboxCount === 1)).toBe(true);
  });

  it("emits INDICES and integers only — no page wording crosses the boundary", () => {
    const root = div(div(box(), text(CONSENTS[0]!)), div(box(), text(CONSENTS[1]!)));
    const { out, sanitized } = run(root);
    for (const blob of [JSON.stringify(out), JSON.stringify(sanitized)]) {
      expect(blob).not.toContain("동의");
      expect(blob).not.toContain("약관");
      expect(blob).not.toContain("카테고리");
      expect(blob).not.toMatch(/[가-힣]/);
    }
  });

  it("the script never reads `checked`, and never writes anything", () => {
    // Which box the seller ticked is their business. Reading it would also make the record depend on a decision
    // SellerOps is not entitled to observe, let alone store.
    const src = buildWingConsentBlockScript(CONSENTS);
    for (const f of ["checked", ".click(", ".focus(", "dispatchEvent", "setAttribute", "removeAttribute", "innerHTML", "textContent ="]) {
      expect(src, f).not.toContain(f);
    }
  });
});

describe("host-side sanitization of the consent-block reading", () => {
  it("an UNUSABLE reading is null — never a census reporting zero checkboxes", () => {
    for (const bad of [null, undefined, "", "{}", 0, 3, true, [], [{ index: 0 }]]) {
      expect(sanitizeConsentBlockCensus(bad, CONSENTS)).toBeNull();
    }
    expect(sanitizeConsentBlockCensus({}, CONSENTS)).not.toBeNull();
  });

  it("only the CLEAN verdict may carry a consent index", () => {
    // Defence in depth against the exact failure this instrument exists to prevent: a script bug reporting an
    // ambiguous block as a confident pairing.
    const dirty = sanitizeConsentBlockCensus(
      {
        visibleCheckboxCount: 2,
        rows: [
          { index: 9, verdict: "NEAREST_BLOCK_HOLDS_SEVERAL_CONSENTS", consentIndex: 1, ancestorDepth: 2, blockVisibleCheckboxCount: 2 },
          { index: 9, verdict: "NO_ANCESTOR_HOLDS_A_CONSENT_WITHIN_BOUND", consentIndex: 0, ancestorDepth: 4, blockVisibleCheckboxCount: 1 },
        ],
        consentsMatchedExactlyOnce: 99,
      },
      CONSENTS,
    )!;
    expect(dirty.rows[0]!.consentIndex).toBe(-1);
    expect(dirty.rows[1]!.consentIndex).toBe(-1);
    expect(dirty.rows[1]!.ancestorDepth).toBe(-1);
    // Indices re-derived from position, so a page-chosen ordinal cannot land in the record.
    expect(dirty.rows.map((r) => r.index)).toEqual([0, 1]);
    // …and a clean-pairing count larger than the consent list is clamped, not believed.
    expect(dirty.consentsMatchedExactlyOnce).toBe(2);
  });

  it("an unknown verdict folds to the SAFEST value, not the useful one", () => {
    const r = sanitizeConsentBlockCensus(
      { rows: [{ verdict: "PAIRED_OBVIOUSLY", consentIndex: 0, ancestorDepth: 1, blockVisibleCheckboxCount: 1 }] },
      CONSENTS,
    )!;
    expect(WING_CONSENT_BLOCK_VERDICTS).toContain(r.rows[0]!.verdict);
    expect(r.rows[0]!.verdict).toBe("NO_ANCESTOR_HOLDS_A_CONSENT_WITHIN_BOUND");
    expect(r.rows[0]!.consentIndex).toBe(-1);
  });

  it("bounds the rows and SAYS SO, and reports the depth bound it searched", () => {
    const many = Array.from({ length: 40 }, () => ({ verdict: "NEAREST_BLOCK_HOLDS_EXACTLY_ONE_CONSENT", consentIndex: 0, ancestorDepth: 1, blockVisibleCheckboxCount: 1 }));
    const capped = sanitizeConsentBlockCensus({ rows: many, visibleCheckboxCount: 40 }, CONSENTS)!;
    expect(capped.rows.length).toBeLessThanOrEqual(16);
    expect(capped.rowsTruncated).toBe(true);
    // The depth is a real limit on the finding — "no ancestor holds a consent" means none WITHIN EIGHT.
    expect(capped.depthBound).toBe(8);
  });
});
