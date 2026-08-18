// @vitest-environment jsdom
// The workspace's 상품평 panel. Its whole reason to exist is that the way into the record must be
// visible whatever the count read does — so every test here checks the link is still there.
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ReviewRecordPanel } from "./ReviewRecordPanel";
import { expectNoAxeViolations } from "../../test/axe";
import type { ChannelReviewPageView } from "../../lib/types";

const getChannelReviewsStrict = vi.fn();
vi.mock("../../lib/apiClient", () => ({
  api: {
    getChannelReviewsStrict: (accountId: string, params: unknown) =>
      getChannelReviewsStrict(accountId, params),
  },
}));

afterEach(() => {
  vi.clearAllMocks();
});

function renderPanel(props: { accountId?: string; channelCode?: string | null; refreshKey?: number } = {}) {
  return render(
    <MemoryRouter>
      <ReviewRecordPanel
        accountId={props.accountId ?? "acc-cp"}
        channelCode={props.channelCode === undefined ? "COUPANG" : props.channelCode}
        refreshKey={props.refreshKey}
      />
    </MemoryRouter>,
  );
}

/**
 * Typed on purpose. As an untyped literal this fixture silently stopped matching the response the
 * panel receives when the page gained `triageSummary` — `tsc` had nothing to check it against, so
 * the drift would only have surfaced the day something here read the new field.
 */
function page(total: number): ChannelReviewPageView {
  return {
    page: 0,
    size: 1,
    total,
    newCount: 0,
    lastImportAt: null,
    lastImportComplete: true,
  aiPilotEnabled: false,
  channel: { channelCode: "COUPANG", aiTriage: true, originalLocate: "LOCATE_RUN", replySupported: false },
    triageSummary: { needsAttention: 0, watch: 0, fyi: total, aiAttention: 0, repeatedCategories: [] },
    items: [],
  };
}

describe("상품평 패널 — the entry point", () => {
  it("names the count it found and links into the record", async () => {
    getChannelReviewsStrict.mockResolvedValue(page(22));
    renderPanel();
    const link = await screen.findByRole("link", { name: "상품평 22개 보기" });
    expect(link).toHaveAttribute("href", "/reviews/acc-cp");
    expect(screen.getByText(/22개를 모아 두었습니다/)).toBeInTheDocument();
  });

  it("asks the server for the total only, not for a screenful of what buyers wrote", async () => {
    getChannelReviewsStrict.mockResolvedValue(page(22));
    renderPanel();
    await screen.findByRole("link", { name: "상품평 22개 보기" });
    expect(getChannelReviewsStrict).toHaveBeenCalledWith("acc-cp", { size: 1 });
  });

  it("keeps the way in when the record is empty, and says why it is empty", async () => {
    getChannelReviewsStrict.mockResolvedValue(page(0));
    renderPanel();
    expect(await screen.findByRole("link", { name: "상품평 0개 보기" })).toHaveAttribute(
      "href",
      "/reviews/acc-cp",
    );
    expect(screen.getByText(/아직 수집된 상품평이 없습니다/)).toBeInTheDocument();
  });

  it("keeps the way in when the count cannot be read at all", async () => {
    getChannelReviewsStrict.mockRejectedValue(new Error("backend down"));
    renderPanel();
    const link = await screen.findByRole("link", { name: "상품평 보기" });
    expect(link).toHaveAttribute("href", "/reviews/acc-cp");
    // No fabricated total, and no claim the record is empty — a failed read is not zero reviews.
    expect(await screen.findByText(/확인하지 못했습니다/)).toBeInTheDocument();
    expect(screen.queryByText(/0개/)).toBeNull();
  });

  it("offers the link while the count is still loading", () => {
    getChannelReviewsStrict.mockReturnValue(new Promise(() => {}));
    renderPanel();
    expect(screen.getByRole("link", { name: "상품평 보기" })).toBeInTheDocument();
    // Loading is not the same admission as a failed read; it must not accuse the backend early.
    expect(screen.queryByText(/확인하지 못했습니다/)).toBeNull();
  });

  it("promises no reply affordance the channel does not have", async () => {
    getChannelReviewsStrict.mockResolvedValue(page(22));
    renderPanel();
    await screen.findByRole("link", { name: "상품평 22개 보기" });
    expect(screen.getByText(/답변 작성 기능은 제공하지 않습니다/)).toBeInTheDocument();
  });

  it("makes no channel-specific claim about a channel it was not told", async () => {
    // Each channel's note is stored beside it. A NAVER panel must not inherit Coupang's claim, and
    // it speaks in the product's word (리뷰), not Coupang's (상품평).
    getChannelReviewsStrict.mockResolvedValue(page(22));
    renderPanel({ channelCode: "NAVER" });
    await screen.findByRole("link", { name: "리뷰 22개 보기" });
    expect(screen.queryByText(/쿠팡/)).toBeNull();
    expect(screen.queryByText(/답변 작성 기능은 제공하지 않습니다/)).toBeNull();
    expect(screen.getByText(/스마트스토어센터에서 직접 작성/)).toBeInTheDocument();
  });

  it("falls back to the generic sentence for a channel with no note of its own", async () => {
    getChannelReviewsStrict.mockResolvedValue(page(22));
    renderPanel({ channelCode: null });
    await screen.findByRole("link", { name: "리뷰 22개 보기" });
    expect(screen.getByText(/이 채널에서 수집한 구매자 리뷰 기록입니다/)).toBeInTheDocument();
  });

  it("stops stating the old total once a re-read fails", async () => {
    // `useApiData` keeps the last successful `data` across a re-read, and this panel re-reads on
    // every `refreshKey` bump the workspace's sections can cause. Without reading `error`, a seller
    // who saved connection info while the backend was down would keep seeing the previous number
    // presented as current — the same class of lie as inventing a zero.
    getChannelReviewsStrict.mockResolvedValue(page(22));
    const { rerender } = renderPanel();
    await screen.findByRole("link", { name: "상품평 22개 보기" });

    getChannelReviewsStrict.mockRejectedValue(new Error("backend down"));
    rerender(
      <MemoryRouter>
        <ReviewRecordPanel accountId="acc-cp" channelCode="COUPANG" refreshKey={1} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText(/확인하지 못했습니다/)).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "상품평 보기" })).toBeInTheDocument();
    expect(screen.queryByText(/22개/)).toBeNull();
  });

  it("does not carry one account's total onto another", async () => {
    getChannelReviewsStrict.mockResolvedValue(page(22));
    const { rerender } = renderPanel();
    await screen.findByRole("link", { name: "상품평 22개 보기" });

    getChannelReviewsStrict.mockRejectedValue(new Error("backend down"));
    rerender(
      <MemoryRouter>
        <ReviewRecordPanel accountId="acc-other" channelCode="COUPANG" />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText(/확인하지 못했습니다/)).toBeInTheDocument());
    // The link now points at a different record; stating the first account's total beside it would
    // be a number about one seller account printed under another.
    expect(screen.getByRole("link", { name: "상품평 보기" })).toHaveAttribute(
      "href",
      "/reviews/acc-other",
    );
    expect(screen.queryByText(/22개/)).toBeNull();
  });

  it("has no axe violations", async () => {
    getChannelReviewsStrict.mockResolvedValue(page(22));
    const { container } = renderPanel();
    await screen.findByRole("link", { name: "상품평 22개 보기" });
    await expectNoAxeViolations(container);
  });
});
