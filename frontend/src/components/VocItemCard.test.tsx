// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { VocItemCard } from "./VocItemCard";
import type { OperatorVocItem } from "../lib/types";
import { PREVIEW_PLACEHOLDER, PRODUCT_PLACEHOLDER } from "../lib/vocItems";

// Covers the additive `productName` on the drill-down row: a named product renders as
// the row's subject, missing product context renders the frontend-owned placeholder,
// and neither path disturbs the rating / preview / dates / reply chip already there.
//
// NOTE: jsdom does not apply Tailwind, so responsive classes are asserted as DOM/class
// presence only, never as visual visibility — matching ReviewWorkCard.test.tsx.

function item(over: Partial<OperatorVocItem> = {}): OperatorVocItem {
  return {
    channelCode: "CAFE24",
    channelNameKo: "카페24",
    sourceType: "REVIEW",
    productName: "가을 니트 가디건 CHARCOAL",
    rating: 2,
    replyStatus: "PENDING",
    sourceCreatedDate: "2026-05-10",
    collectedDate: "2026-05-30",
    signalType: "LOW_RATING_REVIEW",
    safePreview: "배송은 빨랐는데 색이 생각과 달라요",
    ...over,
  };
}

function renderCard(over: Partial<OperatorVocItem> = {}) {
  render(
    <ul>
      <VocItemCard item={item(over)} />
    </ul>,
  );
  return screen.getByRole("listitem");
}

describe("VocItemCard product context", () => {
  it("renders a named product as the row subject, with the other fields intact", () => {
    const row = renderCard();

    expect(row).toHaveTextContent("가을 니트 가디건 CHARCOAL");
    // Everything that was already on the row still is — the product line is additive.
    expect(row).toHaveTextContent("미답변"); // reply chip (PENDING)
    expect(row).toHaveTextContent("★★"); // rating = 2
    expect(row).toHaveTextContent("작성 2026-05-10");
    expect(row).toHaveTextContent("수집 2026-05-30");
    expect(row).toHaveTextContent("배송은 빨랐는데 색이 생각과 달라요");
  });

  it("renders 상품명 미상 when product context is missing, still with the other fields intact", () => {
    const row = renderCard({ productName: null });

    expect(row).toHaveTextContent(PRODUCT_PLACEHOLDER);
    // The null product must not take the preview or any other field down with it.
    expect(row).toHaveTextContent("배송은 빨랐는데 색이 생각과 달라요");
    expect(row).toHaveTextContent("미답변");
    expect(row).toHaveTextContent("★★");
    expect(row).toHaveTextContent("작성 2026-05-10");
  });

  it("announces the placeholder with a label so it is not a bare, context-free string", () => {
    // Without the sr-only prefix a screen-reader user hears only "상품명 미상" with no
    // indication of which field it belongs to.
    renderCard({ productName: null });
    expect(screen.getByText("상품:", { exact: false })).toBeInTheDocument();
  });

  it("keeps the product and preview absences distinct rather than collapsing them", () => {
    // Both null: two different placeholders, because "no name available" and
    // "no preview available" are different facts about the row.
    const row = renderCard({ productName: null, safePreview: null });
    expect(row).toHaveTextContent(PRODUCT_PLACEHOLDER);
    expect(row).toHaveTextContent(PREVIEW_PLACEHOLDER);
    expect(PRODUCT_PLACEHOLDER).not.toBe(PREVIEW_PLACEHOLDER);
  });

  it("renders no product identifier — no id/sku/productNo is available to leak", () => {
    // The row's whole text is names and metadata; the backend sends no product
    // identifier on this surface, so nothing here may look like one.
    const row = renderCard();
    const text = within(row).getByText("가을 니트 가디건 CHARCOAL").textContent ?? "";
    expect(text).not.toMatch(/\d{7,}/); // a SKU/상품번호-shaped digit run
    expect(row.innerHTML).not.toMatch(/href|data-product|sku|productNo|productId/i);
  });

  it("preserves the existing responsive layout of the metadata row", () => {
    // The product line is a sibling ABOVE the existing flex row, so the md: column→row
    // switch that row relies on must survive unchanged.
    const row = renderCard();
    expect(row.querySelector(".md\\:flex-row")).not.toBeNull();
    expect(row.querySelector(".md\\:justify-between")).not.toBeNull();
  });
});
