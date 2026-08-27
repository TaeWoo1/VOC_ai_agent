import { describe, expect, it } from "vitest";
import { isPlaceholderProduct, orderProductRows, productChannelLabel, type ProductRowFacts } from "./productRows";
import type { ProductSummaryView } from "./types";

const row = (id: string, name: string): ProductSummaryView => ({ id, name, sku: null, status: null, matchedOn: null, matchedName: null });
const facts = (over: Partial<ProductRowFacts>): ProductRowFacts => ({ channels: [], inquiries: 0, unanswered: 0, reviews: 0, issueEvidence: 0, knowledge: 0, ...over });

describe("상품 목록 순서 — presentation, never semantics", () => {
  it("puts what needs attention first: unanswered, then issue evidence, then review volume", () => {
    const rows = [row("a", "가"), row("b", "나"), row("c", "다"), row("d", "라")];
    const f = new Map<string, ProductRowFacts | null>([
      ["a", facts({ reviews: 100 })],
      ["b", facts({ unanswered: 2 })],
      ["c", facts({ issueEvidence: 5 })],
      ["d", facts({})],
    ]);
    expect(orderProductRows(rows, f).map((r) => r.id)).toEqual(["b", "c", "a", "d"]);
  });

  it("never lets the backend's unattributed placeholder lead the catalogue", () => {
    const rows = [row("p", "(미지정 상품)"), row("a", "가")];
    const f = new Map<string, ProductRowFacts | null>([["p", facts({ unanswered: 9 })], ["a", facts({})]]);
    expect(isPlaceholderProduct(rows[0])).toBe(true);
    expect(orderProductRows(rows, f).map((r) => r.id)).toEqual(["a", "p"]);
  });

  it("hides nothing: every row comes back exactly once, facts or not", () => {
    const rows = [row("a", "가"), row("b", "나"), row("c", "다")];
    const out = orderProductRows(rows, new Map([["b", null]]));
    expect(out.map((r) => r.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("speaks the product's channel words and passes an unknown code through", () => {
    expect(productChannelLabel("NAVER")).toBe("네이버");
    expect(productChannelLabel("COUPANG")).toBe("쿠팡");
    expect(productChannelLabel("CAFE24")).toBe("카페24");
    expect(productChannelLabel("ESM")).toBe("ESM");
  });
});
