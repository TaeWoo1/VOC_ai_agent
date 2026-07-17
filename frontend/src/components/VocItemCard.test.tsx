// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { VocItemCard } from "./VocItemCard";
import type { OperatorVocItem } from "../lib/types";
import { PREVIEW_PLACEHOLDER, PRODUCT_PLACEHOLDER } from "../lib/vocItems";
import { mockChannels } from "../lib/mocks";

// Covers the additive `productName` on the drill-down row: a named product renders as
// the row's subject, missing product context renders the frontend-owned placeholder,
// and neither path disturbs the rating / preview / dates / reply chip already there.
//
// NOTE: jsdom does not apply Tailwind, so responsive classes are asserted as DOM/class
// presence only, never as visual visibility — matching ReviewWorkCard.test.tsx.

// Two source-faithful factories, and no way to override your way out of either.
//
// Each source fixes a JOINT set of fields, and the fields are not independent — a Cafe24
// row has no product name AND no ref AND a real reply status, because it is a community
// article; a NAVER row has all three the other way, because it is an ingested export.
// Overriding one in isolation mints a row neither source can emit, which is how a "Cafe24"
// fixture ended up carrying a triage anchor, a product name, and a 미답변 chip. The
// `Omit` on each override type is what stops that at compile time rather than at review.

/** The invariants the ingested-review (NAVER) source fixes on every row it emits. */
type NaverInvariant = "channelCode" | "channelNameKo" | "sourceType" | "replyStatus" | "actionRef";

/**
 * A NAVER review row — a product name it CAN resolve, a triage ref it CAN mint, and a null
 * reply status because a seller-center export carries none.
 *
 * `productName` stays overridable: NAVER genuinely fails to resolve some names (no link,
 * cross-org, SKU-named), so null is a real row here — unlike on Cafe24, where it is fixed.
 */
function naverReviewItem(over: Partial<Omit<OperatorVocItem, NaverInvariant>> = {}): OperatorVocItem {
  return {
    channelCode: "NAVER",
    channelNameKo: "네이버 스마트스토어",
    sourceType: "REVIEW",
    productName: "가을 니트 가디건 CHARCOAL",
    rating: 2,
    // Null, never "PENDING"/"UNKNOWN": IngestedReviewVocItemSource passes null, so every
    // NAVER row renders 상태 미상. A fixture asserting 미답변 here tests a row that cannot
    // exist.
    replyStatus: null,
    sourceCreatedDate: "2026-05-10",
    collectedDate: "2026-05-30",
    signalType: "LOW_RATING_REVIEW",
    safePreview: "배송은 빨랐는데 색이 생각과 달라요",
    actionRef: "review:6f1c8b1e-0000-4000-8000-000000000001",
    triageDisposition: null,
    ...over,
  };
}

/**
 * The invariants the Cafe24 community source fixes on every row it emits.
 *
 * Read off `Cafe24VocItemSource.toItem()` argument by argument, not from memory — the last
 * three positional args are literally `null` (productName), `null` (actionRef), `null`
 * (triageDisposition), and `supports()` accepts only CAFE24. `triageDisposition` belongs
 * here for the SAME reason as `actionRef`: the source hardcodes both, in one statement,
 * because a community article is not a review row. Pinning one and not its twin is how a
 * fixture ends up able to claim a decision on a row that can never carry one.
 */
type Cafe24Invariant =
  | "channelCode"
  | "channelNameKo"
  | "productName"
  | "actionRef"
  | "triageDisposition";

/**
 * A Cafe24 community article.
 *
 * `replyStatus` and `sourceType` stay overridable because the source READS them
 * (`a.getReplyStatus()`, and REVIEW/INQUIRY from `a.getSourceKind()`) — they are real
 * columns, and the reply status is the one field this row has and a NAVER row does not.
 */
function cafe24CommunityItem(
  over: Partial<Omit<OperatorVocItem, Cafe24Invariant>> = {},
): OperatorVocItem {
  return {
    ...naverReviewItem(over),
    channelCode: "CAFE24",
    // The channels table's own value — "카페24 자사몰", never the abbreviated "카페24".
    // channelNameKo is `channel.getNameKo()` resolved upstream, so a row can only ever
    // carry the catalog string; see CHANNELS in ./mocks and MockDataSeeder.
    channelNameKo: "카페24 자사몰",
    productName: null,
    actionRef: null,
    triageDisposition: null,
    // The community store's real column — this row is the only one of the two that has one.
    replyStatus: over.replyStatus ?? "PENDING",
  };
}

function renderCard(over: Partial<Omit<OperatorVocItem, NaverInvariant>> = {}) {
  return renderItem(naverReviewItem(over));
}

function renderItem(voc: OperatorVocItem) {
  render(
    <ul>
      <VocItemCard item={voc} accountId="acct-1" />
    </ul>,
  );
  return screen.getByRole("listitem");
}

describe("the fixtures are rows their source could actually emit", () => {
  // The factories encode a source contract, and the card renders only SOME of it —
  // channelCode/channelNameKo never reach the DOM, so no rendering test can catch a
  // fixture claiming a channel name that does not exist. That is exactly how "카페24"
  // (the source emits "카페24 자사몰") survived several rounds. Asserted on the object.
  const nameFor = (code: string) => mockChannels().find((c) => c.code === code)!.nameKo;

  it("mints a NAVER row exactly as IngestedReviewVocItemSource would", () => {
    const row = naverReviewItem();
    // Derived from the catalog, not typed in: the source passes `channel.getNameKo()`, so
    // the row can only ever carry the catalog's own string.
    expect(row.channelNameKo).toBe(nameFor("NAVER"));
    expect(row.channelCode).toBe("NAVER");
    expect(row.sourceType).toBe("REVIEW"); // SOURCE_TYPE_REVIEW, hardcoded
    expect(row.replyStatus).toBeNull(); // an export carries no reply state
    expect(row.actionRef).not.toBeNull(); // this store IS the anchor: every row addressable
  });

  it("mints a Cafe24 row exactly as Cafe24VocItemSource would", () => {
    const row = cafe24CommunityItem();
    expect(row.channelNameKo).toBe(nameFor("CAFE24")); // "카페24 자사몰", never "카페24"
    expect(row.channelCode).toBe("CAFE24");
    // The three the source hardcodes null, in one statement, for one reason.
    expect(row.productName).toBeNull();
    expect(row.actionRef).toBeNull();
    expect(row.triageDisposition).toBeNull();
    // ...and the one field it really reads.
    expect(row.replyStatus).toBe("PENDING");
  });
});

describe("VocItemCard product context", () => {
  it("renders a named product as the row subject, with the other fields intact", () => {
    const row = renderCard();

    expect(row).toHaveTextContent("가을 니트 가디건 CHARCOAL");
    // Everything that was already on the row still is — the product line is additive.
    // 상태 미상, not 미답변: an export carries no reply state, so the source sends null and
    // the chip says the status is unknown. There is no NAVER row that says 미답변.
    expect(row).toHaveTextContent("상태 미상");
    expect(row).toHaveTextContent("★★"); // rating = 2
    expect(row).toHaveTextContent("작성 2026-05-10");
    expect(row).toHaveTextContent("수집 2026-05-30");
    expect(row).toHaveTextContent("배송은 빨랐는데 색이 생각과 달라요");
  });

  it("renders a Cafe24 row's real reply status — the one field it has and NAVER lacks", () => {
    // The mirror of the row above: the community store carries a genuine reply status, so
    // this is where 미답변 is a real chip rather than an invented one.
    expect(renderItem(cafe24CommunityItem({ replyStatus: "PENDING" }))).toHaveTextContent("미답변");
  });

  it("renders 상품명 미상 when product context is missing, still with the other fields intact", () => {
    const row = renderCard({ productName: null });

    expect(row).toHaveTextContent(PRODUCT_PLACEHOLDER);
    // The null product must not take the preview or any other field down with it.
    expect(row).toHaveTextContent("배송은 빨랐는데 색이 생각과 달라요");
    expect(row).toHaveTextContent("상태 미상");
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

  it("offers no triage control on a Cafe24 row, which cannot be decided", () => {
    // THE home of the null-ref case, and deliberately so: a Cafe24 community article has no
    // triage anchor, so this is the row that really carries one. Asserted per-ROW rather
    // than by fabricating a page that mixes Cafe24 and NAVER rows — one page is one account
    // is one channel, so that page cannot exist.
    //
    // The absence of a control, not a disabled one: a disabled control says "you may not",
    // when the truth is "this row cannot carry a decision at all".
    const row = renderItem(cafe24CommunityItem());

    expect(screen.queryByRole("group", { name: "처리 상태" })).not.toBeInTheDocument();
    expect(screen.queryByText("처리 상태")).not.toBeInTheDocument();
    // ...and nothing else about the row is degraded. A capability limit, not a lesser row:
    // the preview, rating and dates are all still there, and the product falls back to the
    // placeholder rather than blanking the row.
    expect(row).toHaveTextContent(PRODUCT_PLACEHOLDER);
    expect(row).toHaveTextContent("배송은 빨랐는데 색이 생각과 달라요");
    expect(row).toHaveTextContent("★★");
    expect(row).toHaveTextContent("작성 2026-05-10");
  });

  it("offers the triage control on a NAVER review row, which carries a ref", () => {
    renderCard();

    expect(screen.getByRole("group", { name: "처리 상태" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "대응 필요" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "지켜보기" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "조치 불필요" })).toBeInTheDocument();
  });

  it("never renders the ref itself — it is an address, not something to show", () => {
    const row = renderCard();

    // The ref carries a row id. It is round-tripped by the client, never displayed: an
    // operator has no use for it, and a visible id invites someone to treat it as data.
    expect(row).not.toHaveTextContent("6f1c8b1e");
    expect(row.textContent ?? "").not.toMatch(/review:/);
  });

  it("preserves the existing responsive layout of the metadata row", () => {
    // The product line is a sibling ABOVE the existing flex row, so the md: column→row
    // switch that row relies on must survive unchanged.
    const row = renderCard();
    expect(row.querySelector(".md\\:flex-row")).not.toBeNull();
    expect(row.querySelector(".md\\:justify-between")).not.toBeNull();
  });
});
