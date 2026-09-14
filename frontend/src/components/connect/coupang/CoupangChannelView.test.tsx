// @vitest-environment jsdom
/**
 * 쿠팡 채널 화면의 계약: <b>두 장의 카드, 각 카드에 다음 걸음 하나.</b>
 *
 * 여기서 단언하는 대부분은 「무엇이 없는가」다 — 이 패키지가 고친 것이 대체로 그것이기 때문이다:
 * 첫 화면의 경쟁 CTA, 정상 상태의 진단 줄, 같은 채널을 반대로 설명하던 배지, 될 수 없는 수집을
 * 제안하던 컨트롤, 그리고 개발자가 쓴 영문 주석.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CoupangChannelView } from "./CoupangChannelView";
import { expectNoAxeViolations } from "../../../test/axe";
import type {
  ChannelCapabilityOverview,
  ConnectionInfoView,
  ConnectionStatusView,
  SyncRunView,
} from "../../../lib/types";

const getReviewAcquisitionReadiness = vi.fn();
const getChannelCapabilityOverview = vi.fn();
const getChannelReviewsStrict = vi.fn();

vi.mock("../../../lib/apiClient", () => ({
  api: {
    getReviewAcquisitionReadiness: (...a: unknown[]) => getReviewAcquisitionReadiness(...a),
    getChannelCapabilityOverview: (...a: unknown[]) => getChannelCapabilityOverview(...a),
    getChannelReviewsStrict: (...a: unknown[]) => getChannelReviewsStrict(...a),
    manualSync: vi.fn(),
  },
}));

const overview = (autoCollectSupported: boolean): ChannelCapabilityOverview => ({
  channelCode: "COUPANG",
  channelNameKo: "쿠팡",
  connectorClass: "API",
  autoCollectSupported,
  dataTypes: [],
  unsupportedScopes: [],
});

/** 서버가 실제로 돌려주는 쿠팡의 모양: 문의·주문은 API로 되고, 리뷰는 안 된다. */
const CAPABILITIES = [
  { channelCode: "COUPANG", connectorClass: "API", dataType: "INQUIRY", supported: true, verificationStatus: "NEEDS_VERIFICATION", notes: null },
  { channelCode: "COUPANG", connectorClass: "API", dataType: "ORDER_SUMMARY", supported: true, verificationStatus: "CONFIRMED", notes: null },
  { channelCode: "COUPANG", connectorClass: "API", dataType: "REVIEW", supported: false, verificationStatus: "UNSUPPORTED", notes: "No review-retrieval endpoint in the official seller API." },
];

const screenRead = (over: Partial<SyncRunView> = {}): SyncRunView =>
  ({
    id: "r1",
    sellerAccountId: "acc-1",
    channelId: "ch",
    dataType: "REVIEW",
    trigger: "ACTION_WINDOW",
    attempt: 1,
    rateLimited: false,
    nextRetryAt: null,
    jobType: "AGENT_HANDOFF",
    uploadType: "REVIEW",
    status: "SUCCESS",
    totalRows: 9,
    successRows: 9,
    skippedRows: 0,
    failedRows: 0,
    errorMessage: null,
    startedAt: "2026-09-14T00:00:00Z",
    finishedAt: "2026-09-14T00:00:00Z",
    method: "SELLER_CENTER_READ",
    coverage: null,
    ...over,
  }) as SyncRunView;

function view(over: Partial<Parameters<typeof CoupangChannelView>[0]> = {}) {
  return render(
    <MemoryRouter>
      <CoupangChannelView
        accountId="acc-1"
        channelCode="COUPANG"
        title="쿠팡"
        status={{ state: "CONNECTED", consecutiveFailures: 0 } as unknown as ConnectionStatusView}
        connectionInfo={{ authType: "API_KEY" } as unknown as ConnectionInfoView}
        infoLoading={false}
        infoError={false}
        credentialTemplate={null}
        templateError={false}
        schedules={[]}
        capabilities={CAPABILITIES}
        runs={[screenRead()]}
        onReport={() => undefined}
        onChanged={() => undefined}
        {...over}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  getReviewAcquisitionReadiness.mockResolvedValue({ state: "READY", channelCode: "COUPANG" });
  getChannelCapabilityOverview.mockResolvedValue(overview(true));
  getChannelReviewsStrict.mockResolvedValue({ total: 1204 });
});
afterEach(() => vi.clearAllMocks());

describe("쿠팡 채널 화면 — 두 가지 방법, 그뿐", () => {
  it("판매자가 이해해야 하는 두 가지가 카드 둘로 선다", async () => {
    view();
    expect(await screen.findByTestId("coupang-review-card")).toBeInTheDocument();
    expect(await screen.findByTestId("coupang-api-card")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "리뷰 수집" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "문의·주문 자동 수집" })).toBeInTheDocument();
  });

  it("리뷰 카드는 판매자가 하는 일로 자기를 설명하고, API 키를 요구하지 않는다고 말한다", async () => {
    view();
    const card = await screen.findByTestId("coupang-review-card");
    expect(within(card).getByText(/로그인된 쿠팡 판매자 화면에서 상품평을 가져옵니다/)).toBeInTheDocument();
    expect(within(card).getByText(/API 키는 필요하지 않습니다/)).toBeInTheDocument();
  });

  it("연결된 계정의 리뷰 카드는 상태·마지막 수집·컨트롤 하나다", async () => {
    view();
    const card = await screen.findByTestId("coupang-review-card");
    await waitFor(() => expect(within(card).getByText(/가져온 상품평 1,204개/)).toBeInTheDocument());
    expect(within(card).getByRole("link", { name: "지금 가져오기" })).toHaveAttribute(
      "href",
      "/connect/channels/acc-1/review-collection",
    );
  });

  it("연결되지 않은 계정의 리뷰 카드는 셋업으로 보낸다 — 같은 주소로", async () => {
    getReviewAcquisitionReadiness.mockResolvedValue({ state: "HELPER_NOT_LINKED", channelCode: "COUPANG" });
    view();
    const cta = await screen.findByRole("link", { name: "리뷰 수집 연결하기" });
    expect(cta).toHaveAttribute("href", "/connect/channels/acc-1/review-collection");
  });

  it("정상 상태에 도우미·실행 프로그램 같은 진단은 없다", async () => {
    view();
    await screen.findByTestId("coupang-review-card");
    expect(screen.queryByText(/도우미/)).toBeNull();
    expect(screen.queryByTestId("helper-status")).toBeNull();
  });

  const solidIn = (el: HTMLElement) =>
    [...el.querySelectorAll("a,button")].filter(
      (c) => c.className.includes("bg-brand-700") && !c.closest("details"),
    );

  it("한 시점에 가장 강한 컨트롤은 하나다", async () => {
    view();
    const review = await screen.findByTestId("coupang-review-card");
    const api = await screen.findByTestId("coupang-api-card");
    // 둘 다 연결된 화면에서 지금 할 일은 상품평을 한 번 더 가져오는 것뿐이고, 나머지는 보조다.
    expect(solidIn(review).map((c) => c.textContent)).toEqual(["지금 가져오기"]);
    expect(solidIn(api)).toHaveLength(0);
  });

  it("끝나지 않은 연결이 있으면 그것이 이 화면의 다음 걸음이다", async () => {
    view({ connectionInfo: null });
    const api = await screen.findByTestId("coupang-api-card");
    const review = await screen.findByTestId("coupang-review-card");
    expect(solidIn(api).map((c) => c.textContent)).toEqual(["API 연결하기"]);
    expect(solidIn(review)).toHaveLength(0);
  });

  it("커넥터가 꺼진 배포에서는 문의·주문 카드가 존재하지 않는다", async () => {
    getChannelCapabilityOverview.mockResolvedValue(overview(false));
    view();
    await screen.findByTestId("coupang-review-card");
    await waitFor(() => expect(screen.queryByTestId("coupang-api-card")).toBeNull());
    // 그리고 자격을 받을 자리도 없다.
    expect(screen.queryByText("연결에 필요한 정보")).toBeNull();
  });

  it("지운 화면들은 돌아오지 않는다", async () => {
    view();
    await screen.findByTestId("coupang-review-card");
    for (const gone of ["요약", "수집 가능 데이터", "수집된 리뷰·문의", "다음 조치"]) {
      expect(screen.queryByText(gone, { exact: true })).toBeNull();
    }
    // capability registry의 영문 note가 판매자 문장으로 나가던 자리.
    expect(screen.queryByText(/official seller API/)).toBeNull();
  });

  it("될 수 없는 수집을 제안하지 않는다 — 기간 수집에 리뷰가 없다", async () => {
    view();
    await screen.findByTestId("coupang-api-card");
    const fold = screen.getByText("기간 지정 수집").closest("details");
    expect(fold).not.toBeNull();
    // 쿠팡 리뷰에는 API 기간 수집 경로가 없다(`supported:false`). 예전 화면은 ✓리뷰를 켠 채로 제공했다.
    expect(within(fold as HTMLElement).queryByRole("button", { name: /리뷰/ })).toBeNull();
    expect(within(fold as HTMLElement).getByRole("button", { name: /문의/ })).toBeInTheDocument();
  });

  it("「API 연결하기」는 실제로 연결 정보를 연다 — 앵커가 아니라", async () => {
    view({ connectionInfo: null });
    const cta = await screen.findByTestId("coupang-api-cta");
    const fold = screen.getByText("연결 정보").closest("details") as HTMLDetailsElement;
    expect(fold.open).toBe(false);
    fireEvent.click(cta);
    await waitFor(() => expect(fold.open).toBe(true));
  });

  it("실행 기록은 접혀 있다", async () => {
    view();
    await screen.findByTestId("coupang-review-card");
    const fold = screen.getByText("지난 실행 기록").closest("details");
    expect(fold).not.toBeNull();
    expect(fold).not.toHaveAttribute("open");
  });

  it("접근성 위반 0", async () => {
    const { container } = view();
    await screen.findByTestId("coupang-api-card");
    await expectNoAxeViolations(container);
  });
});
