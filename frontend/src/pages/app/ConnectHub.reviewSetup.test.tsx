// @vitest-environment jsdom
/**
 * <b>자격 없이 상품평 수집을 시작한다</b>(First External Seller Gate B1, 2026-09-14).
 *
 * 쿠팡 계정 행을 만드는 코드는 오랫동안 하나뿐이었고, 그것은 판매자가 Access Key·Secret Key·업체코드를
 * 제출하는 순간에만 돌았다. 그래서 API 키가 필요 없는 lane을 쓰려는 판매자도 키 발급 화면을 지나야 했다.
 * 여기서 단언하는 것은 그 press가 무엇을 부르고 <b>무엇을 부르지 않는가</b>이다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ChannelResponse, SellerAccountResponse } from "../../lib/types";

const h = vi.hoisted(() => ({
  createApiChannelAccount: vi.fn(),
  storeCredential: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => h.navigate };
});

vi.mock("../../lib/apiClient", () => ({
  api: {
    getChannelsStrict: async () => CHANNELS,
    getSellerAccountsStrict: async () => ACCOUNTS,
    getConnectionStatusStrict: async () => {
      throw new Error("no status");
    },
    getChannelReviewsStrict: async () => ({ total: 0 }),
    getReviewAcquisitionReadiness: async () => ({ state: "HELPER_NOT_LINKED", channelCode: "COUPANG" }),
    getSyncRunsStrict: async () => [],
    createApiChannelAccount: (...a: unknown[]) => h.createApiChannelAccount(...a),
    storeCredential: (...a: unknown[]) => h.storeCredential(...a),
  },
}));

vi.mock("../../hooks/useOperationsStore", () => ({ useOperationsStore: () => ({ sourceMode: "fixture", run: null }) }));
vi.mock("../../lib/openAlerts", () => ({ useOpenAlerts: () => ({ openCount: 0 }) }));

const support = {
  fileUploadSupported: true,
  fileUploadDataTypes: [],
  autoCollectSupported: false,
  autoCollectDataTypes: [],
  connectionCheckSupported: false,
  credentialSetupSupported: true,
  screenReadReviews: true,
};
const CHANNELS: ChannelResponse[] = [
  {
    id: "ch-cp",
    code: "COUPANG",
    nameKo: "쿠팡",
    status: "AVAILABLE",
    dataBadges: [],
    lastSyncedAt: null,
    actionLabel: "연결하기",
    support,
  } as unknown as ChannelResponse,
];
let ACCOUNTS: SellerAccountResponse[] = [];

const { ConnectHub } = await import("./ConnectHub");

beforeEach(() => {
  ACCOUNTS = [];
  h.createApiChannelAccount.mockResolvedValue({ id: "acc-new" });
});
afterEach(() => vi.clearAllMocks());

describe("첫 판매자가 상품평 수집을 시작하는 길", () => {
  it("계정이 없으면 자격 없이 만들고 수집 화면으로 보낸다 — 키는 한 번도 요구되지 않는다", async () => {
    render(<MemoryRouter><ConnectHub /></MemoryRouter>);
    const cta = await screen.findByTestId("channel-review-setup");
    expect(cta).toHaveTextContent("리뷰 수집 연결하기");
    fireEvent.click(cta);
    await waitFor(() => expect(h.createApiChannelAccount).toHaveBeenCalledWith("ch-cp"));
    // 자격은 이 경로에서 저장되지도, 요구되지도 않는다.
    expect(h.storeCredential).not.toHaveBeenCalled();
    expect(h.navigate).toHaveBeenCalledWith("/connect/channels/acc-new/review-collection", {
      state: { start: true },
    });
  });

  it("계정이 이미 있으면 다시 만들지 않는다", async () => {
    ACCOUNTS = [
      {
        id: "acc-1",
        channelId: "ch-cp",
        channelNameKo: "쿠팡",
        fileUpload: false,
        // 자격을 넣은 적이 없는 계정 — 브라우저 수집만 쓰는 판매자가 영원히 머무는 상태.
        connectionStatus: "PENDING",
      } as SellerAccountResponse,
    ];
    render(<MemoryRouter><ConnectHub /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId("channel-review-setup"));
    await waitFor(() =>
      expect(h.navigate).toHaveBeenCalledWith("/connect/channels/acc-1/review-collection", { state: { start: true } }),
    );
    expect(h.createApiChannelAccount).not.toHaveBeenCalled();
  });
});
