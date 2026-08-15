// @vitest-environment jsdom
// 수집 가능 데이터 — the badges, and the two questions they must stop conflating.
//
// `supported` answers what the PULL CONNECTOR can serve. An acquisition path answers how SellerOps
// actually gets the data. Coupang 상품평 is `supported: false` — Coupang publishes no seller review
// API — and is collected anyway through the Action Window, so rendering the boolean alone printed
// 리뷰 미지원 on a page whose next panel counted 22 collected 상품평.
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CapabilityBadges } from "./CapabilityBadges";
import { expectNoAxeViolations } from "../test/axe";
import type { ChannelCapabilityOverview, DataTypeCapability } from "../lib/types";

const getChannelCapabilityOverview = vi.fn();
vi.mock("../lib/apiClient", () => ({
  api: {
    getChannelCapabilityOverview: (code: string) => getChannelCapabilityOverview(code),
  },
}));

afterEach(() => {
  vi.clearAllMocks();
});

function type(over: Partial<DataTypeCapability> & Pick<DataTypeCapability, "dataType" | "label">): DataTypeCapability {
  return { supported: true, verificationStatus: "CONFIRMED", ...over };
}

function overview(over: Partial<ChannelCapabilityOverview> = {}): ChannelCapabilityOverview {
  return {
    channelCode: "COUPANG",
    channelNameKo: "쿠팡",
    connectorClass: "API",
    autoCollectSupported: true,
    dataTypes: [],
    unsupportedScopes: [],
    ...over,
  };
}

/** The real Coupang shape: connector says no, the Action Window says yes, and the API gap is a scope. */
const COUPANG = overview({
  dataTypes: [
    type({ dataType: "ORDER_SUMMARY", label: "주문·매출" }),
    type({
      dataType: "REVIEW",
      label: "리뷰",
      supported: false,
      verificationStatus: "UNSUPPORTED",
      acquisitionPaths: [{ method: "ACTION_WINDOW", verificationStatus: "LIVE_PROVEN" }],
    }),
    type({ dataType: "INQUIRY", label: "문의" }),
  ],
  unsupportedScopes: [{ code: "REVIEW_API", label: "리뷰 API 없음 (쿠팡 미제공)" }],
});

function renderBadges(code = "COUPANG") {
  return render(<CapabilityBadges channelCode={code} />);
}

describe("수집 가능 데이터 — the acquisition axis", () => {
  it("says how 상품평 are collected instead of calling them unsupported", async () => {
    getChannelCapabilityOverview.mockResolvedValue(COUPANG);
    renderBadges();
    expect(await screen.findByText("수집 지원 · Action Window")).toBeInTheDocument();
  });

  it("never prints 미지원 for a data type SellerOps actually collects", async () => {
    getChannelCapabilityOverview.mockResolvedValue(COUPANG);
    renderBadges();
    await screen.findByText("수집 지원 · Action Window");
    // The exact regression: a record holding 22 상품평 under a badge reading 리뷰 미지원.
    const review = screen.getByText("리뷰").closest("span") as HTMLElement;
    expect(review).not.toHaveTextContent("미지원");
  });

  it("takes the missing official API from the connector's own note, not from the boolean", async () => {
    getChannelCapabilityOverview.mockResolvedValue(COUPANG);
    renderBadges();
    await screen.findByText("수집 지원 · Action Window");
    // Both facts on one screen: collected via Action Window, and no official API to collect it with.
    expect(screen.getByText("제외 범위")).toBeInTheDocument();
    expect(screen.getByText("리뷰 API 없음 (쿠팡 미제공)")).toBeInTheDocument();
  });

  it("leaves every other data type exactly as it was", async () => {
    getChannelCapabilityOverview.mockResolvedValue(COUPANG);
    renderBadges();
    await screen.findByText("수집 지원 · Action Window");
    // 주문·매출 and 문의 both CONFIRMED, still rendered by the connector's own verdict.
    expect(screen.getAllByText("확인됨")).toHaveLength(2);
  });

  it("leaves a channel with no acquisition path untouched, including its 미지원", async () => {
    getChannelCapabilityOverview.mockResolvedValue(
      overview({
        channelCode: "GMARKET",
        dataTypes: [
          type({ dataType: "ORDER_SUMMARY", label: "주문·매출", verificationStatus: "NEEDS_VERIFICATION" }),
          type({ dataType: "REVIEW", label: "리뷰", supported: false, verificationStatus: "UNSUPPORTED" }),
        ],
      }),
    );
    renderBadges("GMARKET");
    expect(await screen.findByText("확인 필요")).toBeInTheDocument();
    // No proven path here, so the honest answer is still 미지원. The axis adds a fact; it does not
    // soften an absent one.
    expect(screen.getByText("미지원")).toBeInTheDocument();
  });

  it("renders a backend that predates the field exactly as before", async () => {
    getChannelCapabilityOverview.mockResolvedValue(
      overview({
        dataTypes: [type({ dataType: "REVIEW", label: "리뷰", supported: false, verificationStatus: "UNSUPPORTED" })],
      }),
    );
    renderBadges();
    // `acquisitionPaths` absent entirely — not an empty array. Missing must read as "no path".
    expect(await screen.findByText("미지원")).toBeInTheDocument();
  });

  it("makes no claim from a path it cannot describe", async () => {
    getChannelCapabilityOverview.mockResolvedValue(
      overview({
        dataTypes: [
          type({
            dataType: "REVIEW",
            label: "리뷰",
            supported: false,
            verificationStatus: "UNSUPPORTED",
            // A method this build has no copy for. Inventing a label would be a support claim about a
            // route nobody here checked.
            acquisitionPaths: [{ method: "TELEPATHY", verificationStatus: "LIVE_PROVEN" }],
          }),
        ],
      }),
    );
    renderBadges();
    expect(await screen.findByText("미지원")).toBeInTheDocument();
    expect(screen.queryByText(/TELEPATHY/)).toBeNull();
  });

  it("marks a path that is not yet live-proven as needing confirmation", async () => {
    getChannelCapabilityOverview.mockResolvedValue(
      overview({
        dataTypes: [
          type({
            dataType: "REVIEW",
            label: "리뷰",
            supported: false,
            verificationStatus: "UNSUPPORTED",
            acquisitionPaths: [{ method: "EXPORT", verificationStatus: "NEEDS_VERIFICATION" }],
          }),
        ],
      }),
    );
    renderBadges();
    expect(await screen.findByText("수집 지원·확인 필요 · 파일 내보내기")).toBeInTheDocument();
  });

  it("fails closed on a dead backend rather than showing a capability", async () => {
    getChannelCapabilityOverview.mockRejectedValue(new Error("backend down"));
    renderBadges();
    expect(await screen.findByText(/수집 지원 정보를 불러오지 못했습니다/)).toBeInTheDocument();
    expect(screen.queryByText(/Action Window/)).toBeNull();
  });

  it("has no axe violations", async () => {
    getChannelCapabilityOverview.mockResolvedValue(COUPANG);
    const { container } = renderBadges();
    await screen.findByText("수집 지원 · Action Window");
    await expectNoAxeViolations(container);
  });
});
