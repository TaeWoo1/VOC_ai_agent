// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ChannelReviews } from "./ChannelReviews";
import { expectNoAxeViolations } from "../../test/axe";
import type { ChannelReviewDetailView, ChannelReviewPageView } from "../../lib/types";

const getChannelReviewsStrict = vi.fn();
const getChannelReviewStrict = vi.fn();

vi.mock("../../lib/apiClient", () => ({
  api: {
    getChannelReviewsStrict: (accountId: string, params: unknown) =>
      getChannelReviewsStrict(accountId, params),
    getChannelReviewStrict: (accountId: string, reviewId: string) =>
      getChannelReviewStrict(accountId, reviewId),
  },
  getToken: () => "token",
}));

const PAGE: ChannelReviewPageView = {
  page: 0,
  size: 20,
  total: 2,
  newCount: 1,
  lastImportAt: "2026-08-14T05:00:00Z",
  lastImportComplete: true,
  items: [
    {
      id: "r1",
      writtenOn: "2026-08-11",
      rating: 5,
      negative: false,
      preview: "배송도 빠르고 포장도 꼼꼼했어요",
      productName: "무선 이어폰",
      productId: "15411270785",
      vendorItemId: "81234567890",
      mediaCount: 2,
      isNew: true,
    },
    {
      id: "r2",
      writtenOn: "2026-08-01",
      rating: 1,
      negative: true,
      preview: "생각보다 크기가 작아서 아쉬웠습니다",
      productName: "무선 이어폰",
      productId: "15411270785",
      vendorItemId: null,
      mediaCount: 0,
      isNew: false,
    },
  ],
};

const DETAIL: ChannelReviewDetailView = {
  id: "r1",
  writtenOn: "2026-08-11",
  rating: 5,
  negative: false,
  body: "배송도 빠르고 포장도 꼼꼼했어요. 다음에도 구매할게요.",
  bodyRedacted: false,
  productName: "무선 이어폰",
  mediaCount: 2,
  isNew: true,
  locateTarget: {
    productId: "15411270785",
    vendorItemId: "81234567890",
    writtenOn: "2026-08-11",
    rating: 5,
    bodyFingerprint: "a".repeat(64),
  },
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/connect/channels/acc-1/reviews"]}>
      <Routes>
        <Route path="/connect/channels/:accountId/reviews" element={<ChannelReviews />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getChannelReviewsStrict.mockResolvedValue(PAGE);
  getChannelReviewStrict.mockResolvedValue(DETAIL);
});

describe("the channel review record", () => {
  it("lists what was collected, and marks what the last import brought in", async () => {
    renderPage();

    expect(await screen.findByText("배송도 빠르고 포장도 꼼꼼했어요")).toBeInTheDocument();
    expect(screen.getByText("총 2개")).toBeInTheDocument();
    expect(screen.getByText("새로 들어온 1개")).toBeInTheDocument();
    expect(screen.getAllByText("새 상품평")).toHaveLength(1);
  });

  it("offers no way to reply, because the channel has none", async () => {
    renderPage();
    await screen.findByText("배송도 빠르고 포장도 꼼꼼했어요");

    for (const label of ["답변", "답글", "초안", "등록하기"]) {
      expect(screen.queryByRole("button", { name: new RegExp(label) })).toBeNull();
    }
  });

  it("asks the backend for the complaints first when the seller chooses that order", async () => {
    renderPage();
    await screen.findByText("배송도 빠르고 포장도 꼼꼼했어요");

    await userEvent.click(screen.getByRole("button", { name: "낮은 평점순" }));

    await waitFor(() =>
      expect(getChannelReviewsStrict).toHaveBeenLastCalledWith(
        "acc-1",
        expect.objectContaining({ sort: "lowest" }),
      ),
    );
  });

  it("opens one review in full when it is chosen", async () => {
    renderPage();
    await screen.findByText("배송도 빠르고 포장도 꼼꼼했어요");

    await userEvent.click(screen.getByText("배송도 빠르고 포장도 꼼꼼했어요"));

    expect(await screen.findByText(/다음에도 구매할게요/)).toBeInTheDocument();
    expect(getChannelReviewStrict).toHaveBeenCalledWith("acc-1", "r1");
  });

  it("says so when the body it shows was redacted", async () => {
    getChannelReviewStrict.mockResolvedValue({ ...DETAIL, bodyRedacted: true });
    renderPage();
    await screen.findByText("배송도 빠르고 포장도 꼼꼼했어요");

    await userEvent.click(screen.getByText("배송도 빠르고 포장도 꼼꼼했어요"));

    expect(await screen.findByText(/가려서 표시했습니다/)).toBeInTheDocument();
  });
});

describe("the page refuses to imply what it does not know", () => {
  it("warns in words when the last import did not reach the end of the list", async () => {
    getChannelReviewsStrict.mockResolvedValue({ ...PAGE, lastImportComplete: false });
    renderPage();

    expect(await screen.findByText(/목록 끝까지 확인되지 않은 상태로 끝났습니다/)).toBeInTheDocument();
  });

  it("does not warn when the import covered the list", async () => {
    renderPage();
    await screen.findByText("배송도 빠르고 포장도 꼼꼼했어요");

    expect(screen.queryByText(/목록 끝까지 확인되지 않은/)).toBeNull();
  });

  it("shows nothing rather than an invented list when the read fails", async () => {
    getChannelReviewsStrict.mockRejectedValue(new Error("backend down"));
    renderPage();

    expect(await screen.findByText("상품평을 불러오지 못했습니다")).toBeInTheDocument();
    expect(screen.queryByText("배송도 빠르고 포장도 꼼꼼했어요")).toBeNull();
  });

  it("says the record is empty and how to fill it, rather than looking broken", async () => {
    getChannelReviewsStrict.mockResolvedValue({ ...PAGE, total: 0, newCount: 0, items: [] });
    renderPage();

    expect(await screen.findByText("아직 수집된 상품평이 없습니다")).toBeInTheDocument();
  });
});

describe("no buyer appears, because none is stored", () => {
  it("renders nothing from a field it does not know about, even if one arrives", async () => {
    // The backend has no author field and refuses one on the wire; this is the last line of the same
    // rule — a page that spread its response into the DOM would render whatever turned up. The word
    // 구매자 in the page's own description is a descriptor, not a value, so the assertion is on the
    // VALUE a buyer field would carry.
    getChannelReviewsStrict.mockResolvedValue({
      ...PAGE,
      items: [{ ...PAGE.items[0], author: "김서연" }, PAGE.items[1]],
    });
    getChannelReviewStrict.mockResolvedValue({ ...DETAIL, author: "김서연" });
    renderPage();
    await screen.findByText("배송도 빠르고 포장도 꼼꼼했어요");
    await userEvent.click(screen.getByText("배송도 빠르고 포장도 꼼꼼했어요"));
    await screen.findByText(/다음에도 구매할게요/);

    expect(document.body.textContent).not.toContain("김서연");
  });
});

describe("accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = renderPage();
    await screen.findByText("배송도 빠르고 포장도 꼼꼼했어요");

    await expectNoAxeViolations(container);
  });
});
