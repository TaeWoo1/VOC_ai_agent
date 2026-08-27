import { describe, expect, it } from "vitest";
import { answerObjects, answerObjectHref } from "./answerObjects";
import type { EvidenceRef } from "./agentRuntime/types";

function ref(id: string, locator: EvidenceRef["locator"]): EvidenceRef {
  return {
    evidenceId: id,
    kind: "REVIEW_ISSUE",
    sourceTool: "t",
    sourceCall: "c",
    locator,
    asOf: null,
    events: null,
    coverage: "COVERED",
    provenance: "p",
  };
}

describe("answerObjects", () => {
  it("groups the answer's own evidence by product and keeps each fact as it was read", () => {
    const objects = answerObjects([
      ref("e1", { productId: "p1", productName: "전선몰딩", label: "반복되는 리뷰 문제", count: 3 }),
      ref("e2", { productId: "p1", label: "답변이 필요한 문의", count: 2 }),
      ref("e3", { productId: "p2", productName: "케이블타이", label: "반복되는 리뷰 문제", count: 1 }),
    ]);

    expect(objects).toEqual([
      { productId: "p1", productName: "전선몰딩", facts: ["반복되는 리뷰 문제 3건", "답변이 필요한 문의 2건"] },
      { productId: "p2", productName: "케이블타이", facts: ["반복되는 리뷰 문제 1건"] },
    ]);
  });

  it("never adds two counts together — 3 and 2 are two facts, and 5 is nobody's", () => {
    const [object] = answerObjects([
      ref("e1", { productId: "p1", label: "리뷰", count: 3 }),
      ref("e2", { productId: "p1", label: "문의", count: 2 }),
    ]);
    expect(object!.facts).toEqual(["리뷰 3건", "문의 2건"]);
  });

  it("org-wide evidence produces no object — there is nothing for the seller to open", () => {
    expect(answerObjects([ref("e1", { label: "답변이 필요한 문의", count: 22 })])).toEqual([]);
  });

  it("a repeated citation of the same fact is listed once", () => {
    const [object] = answerObjects([
      ref("e1", { productId: "p1", label: "리뷰", count: 3 }),
      ref("e2", { productId: "p1", label: "리뷰", count: 3 }),
    ]);
    expect(object!.facts).toEqual(["리뷰 3건"]);
  });

  it("points at the product screen that already exists", () => {
    expect(answerObjectHref({ productId: "p1", productName: null, facts: [] })).toBe("/products/p1");
  });
});
