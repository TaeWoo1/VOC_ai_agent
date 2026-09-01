// @vitest-environment jsdom
/**
 * Frontend-first Agent Workspace Redesign v1 — the screen half.
 *
 * §1 one control per row · §2 a word every row shares is said once, or not at all when the sentence
 * above already said it · §3 the object the seller opened is the largest text in its turn · §4 a
 * product and a review are objects the conversation can stand on, and the bar names them.
 *
 * Every assertion is about what the seller READS or PRESSES. Nothing here asserts a sentence a model
 * wrote — none of these sentences is written by one.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { InquiryListArtifact as InquiryListView } from "./artifacts/InquiryListArtifact";
import { ProductListArtifact as ProductListView } from "./artifacts/ProductListArtifact";
import { ReviewListArtifact as ReviewListView } from "./artifacts/ReviewListArtifact";
import { DraftArtifact as DraftView } from "./artifacts/DraftArtifact";
import { currentContext } from "../../lib/conversation/currentContext";
import { onlySharedWord } from "../../lib/conversation/sharedWord";
import type {
  DraftArtifact, InquiryListArtifact, ProductListArtifact, ReviewListArtifact, TurnView, WorkingSetView,
} from "../../lib/conversation/types";

const selectEntity = vi.fn(async () => undefined);
let workingSet: WorkingSetView | null = null;

vi.mock("../../lib/apiClient", () => ({
  api: {
    getInquiryDetailStrict: vi.fn().mockResolvedValue({ details: "고객이 쓴 문장입니다.", draft: null }),
  },
}));
vi.mock("../../lib/conversation/ConversationProvider", () => ({
  useConversation: () => ({ workingSet, selectEntity }),
}));

function shell(node: React.ReactNode) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

function inquiries(over: Partial<InquiryListArtifact> = {}): InquiryListArtifact {
  return {
    artifactId: "a-i", type: "INQUIRY_LIST", title: "답변 안 한 문의", totalCount: 2,
    groups: [{
      key: "UNANSWERED", label: "답변 필요",
      items: [
        { workItemId: "w-1", inquiryId: "i-1", channelCode: "CAFE24", channelNameKo: "카페24", receivedAt: "2026-08-30T00:00:00Z",
          phase: "OPEN", status: "UNANSWERED", title: "배송이 늦습니다", snippet: "언제 오나요?", productId: null,
          productName: null, answerBasis: null, to: "/inquiries/i-1" },
        { workItemId: "w-2", inquiryId: "i-2", channelCode: "CAFE24", channelNameKo: "카페24", receivedAt: "2026-08-29T00:00:00Z",
          phase: "OPEN", status: "UNANSWERED", title: "색상이 다릅니다", snippet: null, productId: null,
          productName: null, answerBasis: null, to: "/inquiries/i-2" },
      ],
    }],
    ...over,
  } as unknown as InquiryListArtifact;
}

function products(): ProductListArtifact {
  return {
    artifactId: "a-p", type: "PRODUCT_LIST", title: "등록된 상품",
    items: [
      { productId: "p-1", productName: "실리콘 몰딩 2호", facts: [{ label: "문의", count: 3 }], to: "/products/p-1" },
      { productId: "p-2", productName: "방수 케이블 커버", facts: [], to: "/products/p-2" },
    ],
  } as unknown as ProductListArtifact;
}

function reviews(): ReviewListArtifact {
  return {
    artifactId: "a-r", type: "REVIEW_LIST", title: "낮은 평점 리뷰", totalCount: 2, freshness: [],
    scope: { rating: "LOW", period: null, channelCode: null },
    items: [
      { reviewId: "r-1", rating: 1, negative: true, preview: "배송이 열흘 걸렸습니다.", productId: "p-1",
        productName: "실리콘 몰딩 2호", channelCode: "CAFE24", channelNameKo: "카페24", writtenOn: "2026-08-29", to: "/reviews?review=r-1" },
      { reviewId: "r-2", rating: 2, negative: true, preview: "포장이 얇아요.", productId: "p-1",
        productName: "실리콘 몰딩 2호", channelCode: "CAFE24", channelNameKo: "카페24", writtenOn: "2026-08-28", to: "/reviews?review=r-2" },
    ],
  } as unknown as ReviewListArtifact;
}

function turnWith(artifacts: unknown[]): TurnView {
  return { turnId: "t", conversationId: "c", role: "AGENT", message: "", artifacts, suggestedActions: [],
    status: "DONE", createdAt: "", continuation: { workingSet: null, pendingHumanAction: null, pendingPrepared: null } } as unknown as TurnView;
}

describe("§2 — a word every row shares is not a distinction", () => {
  it("returns the word only when every row carries it", () => {
    expect(onlySharedWord(["답변 필요", "답변 필요"])).toBe("답변 필요");
    expect(onlySharedWord(["답변 필요", "답변함"])).toBeNull();
    expect(onlySharedWord(["답변 필요"])).toBeNull();
  });

  it("drops the state word from the rows, and says nothing when the seller ASKED for that state", () => {
    shell(<InquiryListView artifact={inquiries({ scope: { status: "UNANSWERED" } } as never)} headline="답변 안 한 문의는 2건입니다." />);
    expect(screen.queryByText("답변 필요")).toBeNull();
    expect(screen.queryByText("모두 답변이 필요한 문의입니다.")).toBeNull();
  });

  it("says it once as a caption when the sentence above did not", () => {
    shell(<InquiryListView artifact={inquiries()} headline="문의는 2건입니다." />);
    expect(screen.queryByText("답변 필요")).toBeNull();
    expect(screen.getByText(/모두 답변이 필요한 문의입니다\./)).toBeInTheDocument();
  });
});

describe("§1/§3 — one control per row, and the customer's words are the largest text", () => {
  it("a collapsed row has no second way to open the workspace", () => {
    shell(<InquiryListView artifact={inquiries()} />);
    expect(screen.getAllByTestId("inquiry-row-select").length).toBe(2);
    expect(screen.queryByRole("link", { name: "문의 화면에서 열기" })).toBeNull();
  });

  it("pressing the row opens the message in place, at the size of the thing that was opened", async () => {
    shell(<InquiryListView artifact={inquiries()} />);
    await userEvent.click(screen.getAllByTestId("inquiry-row-select")[0]!);
    const body = await screen.findByTestId("inquiry-row-body");
    expect(body).toHaveTextContent("고객이 쓴 문장입니다.");
    expect(body.className).toContain("text-lg");
    expect(screen.getByRole("link", { name: "문의 화면에서 열기" })).toHaveAttribute("href", "/inquiries/i-1");
  });

  it("the wait replaces the receipt date rather than standing beside it", () => {
    shell(<InquiryListView artifact={inquiries({
      groups: [{ ...inquiries().groups[0]!, items: [{ ...inquiries().groups[0]!.items[0]!, waitingDays: 40 }] }],
    } as never)} />);
    expect(screen.getByTestId("inquiry-row-waiting")).toHaveTextContent("40일째 대기");
    expect(screen.queryByText(/전$/)).toBeNull();
  });
});

describe("§4 — a product and a review are objects the conversation can stand on", () => {
  it("a product row selects that product and opens its own controls", async () => {
    selectEntity.mockClear();
    shell(<ProductListView artifact={products()} />);
    await userEvent.click(screen.getAllByTestId("product-row-select")[0]!);
    expect(selectEntity).toHaveBeenCalledWith({ productId: "p-1" });
    expect(screen.getByTestId("product-row-detail")).toBeInTheDocument();
  });

  it("a review row selects that review", async () => {
    selectEntity.mockClear();
    shell(<ReviewListView artifact={reviews()} />);
    await userEvent.click(screen.getAllByTestId("review-row-select")[0]!);
    expect(selectEntity).toHaveBeenCalledWith({ reviewId: "r-1" });
  });

  it("the bar names a product from the row the thread drew, and can be left", () => {
    const set = {
      kind: "PRODUCTS", label: "화면에 있는 상품", count: 2, ids: ["p-1", "p-2"], filters: {}, productIds: ["p-1"],
      workItemIds: [], selectedObject: { kind: "PRODUCT", id: "p-1", productId: "p-1", channelCode: null }, turnId: "t",
    } as unknown as WorkingSetView;
    const context = currentContext(set, "INSPECT", [turnWith([products()])]);
    expect(context?.kind).toBe("ANCHOR");
    expect(context?.label).toBe("실리콘 몰딩 2호");
    expect(context?.to).toBe("/products/p-1");
    expect(context?.clearable).toBe(true);
  });

  it("a review is DESCRIBED, never quoted — its text is transient and does not survive a reload", () => {
    const set = {
      kind: "REVIEWS", label: "화면에 있는 리뷰", count: 2, ids: ["r-1"], filters: {}, productIds: [],
      workItemIds: [], selectedObject: { kind: "REVIEW", id: "r-1", productId: "p-1", channelCode: "CAFE24" }, turnId: "t",
    } as unknown as WorkingSetView;
    const context = currentContext(set, null, [turnWith([reviews()])]);
    expect(context?.label).toBe("선택한 리뷰");
    expect(context?.meta).toContain("★ 1");
    expect(context?.meta).not.toContain("배송이 열흘");
  });
});

describe("§3 — the draft is the deliverable", () => {
  const draft = {
    artifactId: "a-d", type: "DRAFT", title: "답변 초안", workItemId: "w-1", version: 3,
    comments: "확인 후 안내드리겠습니다.", channelNameKo: "카페24", productName: null, answerBasis: "GROUNDED",
    evidenceSummary: [], to: "/inquiries/i-1",
  } as unknown as DraftArtifact;

  it("is the largest text in its turn, and the send guarantee stands on its own line", () => {
    shell(<DraftView artifact={draft} />);
    const body = screen.getByTestId("draft-body");
    expect(body.className).toContain("text-lg");
    expect(screen.getByText("아직 아무 곳에도 보내지 않았습니다.")).toBeInTheDocument();
  });
});
