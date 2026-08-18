// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ConnectHub } from "./ConnectHub";
import { expectNoAxeViolations } from "../../test/axe";
import type { ChannelResponse, ChannelReviewPageView, SellerAccountResponse } from "../../lib/types";

const getChannels = vi.fn();
const getSellerAccountsStrict = vi.fn();
const getConnectionStatusStrict = vi.fn();
const getChannelReviewsStrict = vi.fn();

vi.mock("../../lib/apiClient", () => ({
  api: {
    getChannelsStrict: () => getChannels(),
    getSellerAccountsStrict: () => getSellerAccountsStrict(),
    getConnectionStatusStrict: (id: string) => getConnectionStatusStrict(id),
    getChannelReviewsStrict: (id: string, params: unknown) => getChannelReviewsStrict(id, params),
  },
  getToken: () => null,
}));

const openCount = vi.fn(() => 0);
vi.mock("../../lib/openAlerts", () => ({
  useOpenAlerts: () => ({ openCount: openCount(), refresh: vi.fn(), syncOpenCount: vi.fn() }),
}));

vi.mock("../../hooks/useOperationsStore", () => ({
  useOperationsStore: () => ({ sourceMode: "mock", run: null }),
}));

function channel(over: Partial<ChannelResponse> & Pick<ChannelResponse, "id">): ChannelResponse {
  return {
    code: "X",
    nameKo: "채널 가",
    status: "FILE_UPLOAD_SUPPORTED",
    dataBadges: [],
    lastSyncedAt: null,
    actionLabel: "파일 업로드",
    support: {
      autoCollectSupported: false,
      autoCollectDataTypes: [],
      fileUploadSupported: true,
      connectionCheckSupported: false,
      credentialSetupSupported: false,
    },
    ...over,
  } as ChannelResponse;
}

const COUPANG = channel({
  id: "cp",
  code: "COUPANG",
  nameKo: "쿠팡",
  status: "AVAILABLE",
  actionLabel: "관리",
});

function coupangAccount(): SellerAccountResponse {
  return {
    id: "acc-cp",
    channelId: "cp",
    channelNameKo: "쿠팡",
    alias: null,
    connectionStatus: "CONNECTED",
    lastSyncedAt: "2026-08-15T00:00:00Z",
    fileUpload: false,
  };
}

/** Typed, so it cannot silently stop matching the response this hub receives — see ReviewRecordPanel.test. */
function reviewPage(total: number): ChannelReviewPageView {
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

beforeEach(() => {
  openCount.mockReturnValue(0);
  getChannels.mockResolvedValue([channel({ id: "c1" }), channel({ id: "c2", nameKo: "채널 나" })]);
  getSellerAccountsStrict.mockResolvedValue([] as SellerAccountResponse[]);
  getConnectionStatusStrict.mockResolvedValue({});
  getChannelReviewsStrict.mockResolvedValue(reviewPage(22));
});

afterEach(() => {
  vi.clearAllMocks();
});

function renderHub() {
  return render(
    <MemoryRouter>
      <ConnectHub />
    </MemoryRouter>,
  );
}

describe("채널 연결 — the hub", () => {
  it("carries the four things this area is for", async () => {
    renderHub();
    expect(
      await screen.findByRole("heading", { level: 1, name: "채널 연결" }),
    ).toBeInTheDocument();
    for (const section of ["채널", "정기 자료 가져오기", "리뷰 수집 실행"]) {
      expect(screen.getByRole("heading", { name: section })).toBeInTheDocument();
    }
  });

  it("holds the channel list itself rather than pointing at a separate page", async () => {
    renderHub();
    const list = await screen.findByLabelText("채널 목록");
    expect(within(list).getByText("채널 가")).toBeInTheDocument();
    expect(within(list).getByText("채널 나")).toBeInTheDocument();
  });

  it("describes support with the server's own conservative wording", async () => {
    renderHub();
    const list = await screen.findByLabelText("채널 목록");
    // From `channelSupportDisplay`, which turns support FACTS into copy. The hub adds no claim.
    expect(within(list).getAllByText("엑셀 업로드 지원").length).toBeGreaterThan(0);
  });

  it("surfaces connection alerts only when there are some", async () => {
    renderHub();
    await screen.findByLabelText("채널 목록");
    expect(screen.queryByText(/확인이 필요한 연결 알림/)).toBeNull();
  });

  it("links the alert banner into the alert list when alerts exist", async () => {
    openCount.mockReturnValue(2);
    renderHub();
    expect(await screen.findByText("확인이 필요한 연결 알림 2건")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "확인하기" })).toHaveAttribute(
      "href",
      "/settings/alerts",
    );
  });

  it("routes into the import surfaces that already work", async () => {
    renderHub();
    await screen.findByLabelText("채널 목록");
    expect(screen.getByRole("link", { name: "자료 넘기기" })).toHaveAttribute(
      "href",
      "/connect/upload",
    );
    expect(screen.getByRole("link", { name: "과거 리뷰 가져오기" })).toHaveAttribute(
      "href",
      "/connect/review-history",
    );
    expect(screen.getByRole("link", { name: "작업대 열기" })).toHaveAttribute(
      "href",
      "/connect/imports",
    );
  });
});

/**
 * The hub is where a seller looks for what a channel collected, and until now the 상품평 record was
 * reachable only from a header button one page deeper. Two live sittings stalled on exactly that:
 * the data was there — the API answered with the full total — and the person in front of the screen
 * still had to be told the URL. These tests hold the row's way in.
 */
describe("채널 연결 — the 상품평 entry", () => {
  it("puts the record one click from the hub, with the count on the button", async () => {
    getChannels.mockResolvedValue([COUPANG]);
    getSellerAccountsStrict.mockResolvedValue([coupangAccount()]);
    renderHub();
    const link = await screen.findByRole("link", { name: "쿠팡 상품평 22개 보기" });
    expect(link).toHaveAttribute("href", "/reviews/acc-cp");
    expect(link).toHaveTextContent("상품평 22개 보기");
  });

  it("reads the total only, never a page of what buyers wrote", async () => {
    getChannels.mockResolvedValue([COUPANG]);
    getSellerAccountsStrict.mockResolvedValue([coupangAccount()]);
    renderHub();
    await screen.findByRole("link", { name: "쿠팡 상품평 22개 보기" });
    expect(getChannelReviewsStrict).toHaveBeenCalledWith("acc-cp", { size: 1 });
  });

  it("keeps the entry when the count read fails — the number is optional, the way in is not", async () => {
    getChannels.mockResolvedValue([COUPANG]);
    getSellerAccountsStrict.mockResolvedValue([coupangAccount()]);
    // Rejected by hand AFTER the first paint. Mocking an already-rejected promise and awaiting the
    // countless label would resolve on the loading render, and an implementation that turned a failed
    // read into `0` — the invented zero this whole entry exists to avoid — would pass unnoticed.
    let fail: (e: Error) => void = () => {};
    const pending = new Promise<never>((_resolve, reject) => {
      fail = reject;
    });
    // The TEST holds this promise too, so the test must handle its rejection. Without this the reject
    // below is an unhandled rejection on any run where the component has not chained it yet — which is
    // a green suite locally and a red one on a slower machine.
    pending.catch(() => {});
    getChannelReviewsStrict.mockReturnValue(pending);
    renderHub();
    await screen.findByRole("link", { name: "쿠팡 상품평 보기" });
    // Reject only once the component has actually asked, so the failure lands on a consumer.
    await waitFor(() => expect(getChannelReviewsStrict).toHaveBeenCalled());
    await act(async () => {
      fail(new Error("backend down"));
    });
    const link = screen.getByRole("link", { name: "쿠팡 상품평 보기" });
    expect(link).toHaveAttribute("href", "/reviews/acc-cp");
    expect(screen.queryByRole("link", { name: /0개/ })).toBeNull();
  });

  it("keeps the entry when nothing has been collected yet", async () => {
    getChannels.mockResolvedValue([COUPANG]);
    getSellerAccountsStrict.mockResolvedValue([coupangAccount()]);
    getChannelReviewsStrict.mockResolvedValue(reviewPage(0));
    renderHub();
    expect(await screen.findByRole("link", { name: "쿠팡 상품평 0개 보기" })).toBeInTheDocument();
  });

  it("offers nothing on a channel with no connected account — there is no record to open", async () => {
    getChannels.mockResolvedValue([COUPANG]);
    getSellerAccountsStrict.mockResolvedValue([]);
    renderHub();
    await screen.findByLabelText("채널 목록");
    expect(screen.queryByRole("link", { name: /상품평/ })).toBeNull();
    expect(getChannelReviewsStrict).not.toHaveBeenCalled();
  });

  it("offers nothing on a channel that keeps no review record, account or not", async () => {
    // The account is connected here ON PURPOSE: with no account the assertion would pass whatever
    // the channel predicate said, and the hub could stop consulting it without a test noticing.
    getChannels.mockResolvedValue([channel({ id: "c1", code: "GMARKET", nameKo: "G마켓" })]);
    getSellerAccountsStrict.mockResolvedValue([{ ...coupangAccount(), channelId: "c1" }]);
    renderHub();
    await screen.findByLabelText("채널 목록");
    expect(screen.queryByRole("link", { name: /(상품평|리뷰)( \d+개)? 보기/ })).toBeNull();
    expect(getChannelReviewsStrict).not.toHaveBeenCalled();
  });

  it("speaks the product's word on a channel without one of its own — 리뷰 N개 보기 on NAVER", async () => {
    getChannels.mockResolvedValue([channel({ id: "c1", code: "NAVER", nameKo: "네이버" })]);
    getSellerAccountsStrict.mockResolvedValue([{ ...coupangAccount(), id: "acc-nv", channelId: "c1" }]);
    getChannelReviewsStrict.mockResolvedValue(reviewPage(7));
    renderHub();
    const link = await screen.findByRole("link", { name: "네이버 리뷰 7개 보기" });
    expect(link).toHaveAttribute("href", "/reviews/acc-nv");
  });

  it("stays keyboard-reachable and has no axe violations with the entry present", async () => {
    getChannels.mockResolvedValue([COUPANG]);
    getSellerAccountsStrict.mockResolvedValue([coupangAccount()]);
    const { container } = renderHub();
    const link = await screen.findByRole("link", { name: "쿠팡 상품평 22개 보기" });
    link.focus();
    expect(document.activeElement).toBe(link);
    await expectNoAxeViolations(container);
  });
});

describe("채널 연결 — honesty", () => {
  it("makes no automatic-integration claim", async () => {
    renderHub();
    await screen.findByLabelText("채널 목록");
    const text = document.body.textContent ?? "";
    for (const banned of ["자동 연동", "연동 완료", "실시간", "곧 지원", "자동 수집 완료"]) {
      expect(text).not.toContain(banned);
    }
  });

  it("names no mechanism", async () => {
    renderHub();
    await screen.findByLabelText("채널 목록");
    const text = document.body.textContent ?? "";
    for (const banned of ["로컬 에이전트", "브라우저 자동화", "스크래핑", "크롤링", "백엔드"]) {
      expect(text).not.toContain(banned);
    }
  });

  it("says 정기 자료 가져오기, not 엑셀 업로드, for the seller-facing route", async () => {
    renderHub();
    await screen.findByLabelText("채널 목록");
    expect(screen.getByRole("heading", { name: "정기 자료 가져오기" })).toBeInTheDocument();
  });
});

describe("채널 연결 — accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = renderHub();
    await screen.findByLabelText("채널 목록");
    await expectNoAxeViolations(container);
  });
});
