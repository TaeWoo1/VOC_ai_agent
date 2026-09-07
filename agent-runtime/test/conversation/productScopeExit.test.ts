/**
 * The sentence that leaves the product on screen — Pilot QA Pass 5, measured live 2026-09-07.
 *
 * <b>A screen hint is a default scope, not the question's scope.</b> Every send from the product
 * panel carries that product's id, and the runtime verifies it with one org-scoped read and seeds it
 * as a resolved entity — which is right for 「이 상품 문제 보여줘」 and wrong the moment the seller
 * widens. On the live panel 「이 상품은 됐고 전체에서 가장 반복되는 문제는?」 and 「전체에서 가장
 * 반복되는 문제는?」 came back with the same three product-scoped rows, word for word: the shop was
 * asked and the product answered.
 *
 * <b>The pointer test could not catch it, and that is the second half.</b> 「이 상품은 됐고 …」 contains
 * 「이 상품」, so the `/이 상품/` gate the service already had read the sentence as pointing at the very
 * product it set aside.
 *
 * Both assertions count READS, not sentences: the hint costs exactly one verifying read, so whether it
 * travelled is observable without reading a word any model wrote.
 */
import { describe, expect, it } from "vitest";
import { TOKEN, harness, say } from "./support";
import { MOLDING } from "../support/operatorFixtures";
import { namesEveryProduct } from "../../src/conversation/productFocus";
import { issueSubjectOf } from "../../src/conversation/issueSubject";
import { isRefineWord, namesContent } from "../../src/conversation/reference";

describe("the product on screen scopes the question until the sentence says otherwise", () => {
  it("a question about the product resolves the hint — the control", async () => {
    const h = harness();
    const { conversationId: id } = await h.service.create(TOKEN);

    await say(h, id, "전선몰딩 상품 요즘 문제 있어?", { productId: MOLDING.id });

    // The one org-scoped read that turns an id from a URL into a verified entity.
    expect(h.operator.calls.signals).toBeGreaterThan(0);
  });

  it("a question put to the whole catalogue does not resolve it at all", async () => {
    const h = harness();
    const { conversationId: id } = await h.service.create(TOKEN);

    await say(h, id, "상품별로 묶어줘", { productId: MOLDING.id });

    // Not "resolved and then ignored" — never fetched, because it was never the question's scope.
    expect(h.operator.calls.signals).toBe(0);
  });

  it("names the widening phrases, and refuses to read 전체 as one when it modifies the product in view", () => {
    for (const said of [
      "전체에서 가장 반복되는 문제는?",
      "이 상품은 됐고 전체에서 가장 반복되는 문제는?",
      "모든 상품에서 반복되는 문제 보여줘",
      "상품별로 묶어줘",
      "다른 상품도 같은 문제 있어?",
    ]) {
      expect(namesEveryProduct(said), said).toBe(true);
    }
    for (const said of [
      "이 상품 문제 보여줘",
      "이 상품 전체 리뷰 보여줘",
      "그중 접착 문제 근거 보여줘",
      "접착 부족 문제 근거 보여줘",
    ]) {
      expect(namesEveryProduct(said), said).toBe(false);
    }
  });
});

describe("a refine expression points at the rows — it is not the name of anything", () => {
  it("「그중」 is not read as part of the problem the sentence named", () => {
    // Live: the whole span was taken as the name, so an exact lookup for 「그중 접착」 found nothing and
    // the seller was told a problem they had just been shown is not in the record.
    expect(issueSubjectOf("그중 접착 문제 근거 보여줘")).toBe("접착");
    expect(issueSubjectOf("여기서 접착 부족 문제 근거 보여줘")).toBe("접착 부족");
  });

  it("the predicate is offered from the table that lane already had — and only the naming lanes ask", () => {
    for (const token of ["그중", "여기서", "거기서", "위에서", "앞에서"]) {
      expect(isRefineWord(token), token).toBe(true);
    }
    expect(isRefineWord("접착")).toBe(false);
    // NOT folded into `namesContent`: measured, that let the row-selection lane answer 「그중 배송
    // 얘기만 볼래」 with 「하나를 골라 주세요」 — a refine turned into a pick-one.
    expect(namesContent("그중")).toBe(true);
  });
});
