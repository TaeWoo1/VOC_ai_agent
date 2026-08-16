// @vitest-environment jsdom
// 수집 가능 데이터 — the badges, and the two questions they must stop conflating.
//
// `supported` answers what the PULL CONNECTOR can serve. An acquisition path answers how SellerOps
// actually gets the data. Coupang 상품평 is `supported: false` — Coupang publishes no seller review
// API — and is collected anyway through the Action Window, so rendering the boolean alone printed
// 리뷰 미지원 on a page whose next panel counted 22 collected 상품평.
//
// The words matter as much as the split. 지원 is reserved by
// `docs/channel-capability-registration-matrix.md` §4.1 for 운영 지원 — the always-on rung only 파일
// 업로드 has reached — so the acquisition axis says which route and how far it is proven, never 지원.
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

/**
 * The badge carrying a data type's name. A badge with an evidence line nests its label one level in,
 * so anchor on the label and walk out to the element that carries the tone.
 */
function badgeFor(dataTypeLabel: string): HTMLElement {
  return screen.getByText(dataTypeLabel).closest("span.rounded-xl") as HTMLElement;
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
    expect(await screen.findByText("수집 경로 확인됨 · Action Window")).toBeInTheDocument();
  });

  it("names the route and the evidence as two separate claims", async () => {
    getChannelCapabilityOverview.mockResolvedValue(COUPANG);
    renderBadges();
    await screen.findByText("수집 경로 확인됨 · Action Window");
    // Which route it takes, and how far that route has been proven, are different facts.
    expect(screen.getByText("실계정 검증 완료")).toBeInTheDocument();
  });

  it("never says 지원 about an acquisition path", async () => {
    getChannelCapabilityOverview.mockResolvedValue(COUPANG);
    renderBadges();
    await screen.findByText("수집 경로 확인됨 · Action Window");
    // §4.1 reserves the word for 운영 지원. A route with one live sitting behind it is not that, and
    // 수집 지원 read exactly like the promise the matrix says only 파일 업로드 may make.
    expect(badgeFor("상품평")).not.toHaveTextContent("지원");
  });

  it("calls Coupang reviews what Coupang calls them", async () => {
    getChannelCapabilityOverview.mockResolvedValue(COUPANG);
    renderBadges();
    // The same word the /connect entry point and the record panel use; a badge saying 리뷰 beside them
    // is the same thing under a second name.
    expect(await screen.findByText("상품평")).toBeInTheDocument();
    expect(screen.queryByText("리뷰")).toBeNull();
  });

  it("never prints 미지원 for a data type SellerOps actually collects", async () => {
    getChannelCapabilityOverview.mockResolvedValue(COUPANG);
    renderBadges();
    await screen.findByText("수집 경로 확인됨 · Action Window");
    // The exact regression: a record holding 22 상품평 under a badge reading 리뷰 미지원.
    expect(badgeFor("상품평")).not.toHaveTextContent("미지원");
  });

  it("takes the missing official API from the connector's own note, not from the boolean", async () => {
    getChannelCapabilityOverview.mockResolvedValue(COUPANG);
    renderBadges();
    await screen.findByText("수집 경로 확인됨 · Action Window");
    // Both facts on one screen: collected via Action Window, and no official API to collect it with.
    expect(screen.getByText("제외 범위")).toBeInTheDocument();
    expect(screen.getByText("리뷰 API 없음 (쿠팡 미제공)")).toBeInTheDocument();
  });

  it("leaves every other data type exactly as it was", async () => {
    getChannelCapabilityOverview.mockResolvedValue(COUPANG);
    renderBadges();
    await screen.findByText("수집 경로 확인됨 · Action Window");
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
    // soften an absent one. And 리뷰 stays 리뷰: the Coupang word is Coupang's, not everyone's.
    expect(screen.getByText("미지원")).toBeInTheDocument();
    expect(screen.getByText("리뷰")).toBeInTheDocument();
    expect(screen.queryByText("상품평")).toBeNull();
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

  it("marks a path that is not yet live-proven as needing confirmation, and does not dress it as proven", async () => {
    getChannelCapabilityOverview.mockResolvedValue(
      overview({
        channelCode: "GMARKET",
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
    renderBadges("GMARKET");
    expect(await screen.findByText("수집 경로 있음 · 파일 내보내기")).toBeInTheDocument();
    // The evidence line is where an unproven route has to admit it: 있음 is not 확인됨.
    expect(screen.getByText("실계정 검증 전")).toBeInTheDocument();
    // And an unproven route must not read stronger than a connector capability that is merely
    // unverified — the tone is on the badge, not the words inside it.
    const badge = badgeFor("리뷰");
    expect(badge.className).toContain("text-warn");
    expect(badge.className).not.toContain("text-good");
  });

  it("makes no claim from a status it cannot describe, even with a known method", async () => {
    getChannelCapabilityOverview.mockResolvedValue(
      overview({
        dataTypes: [
          type({
            dataType: "REVIEW",
            label: "리뷰",
            supported: false,
            verificationStatus: "UNSUPPORTED",
            // Known route, unknown evidence word. Rendering it would print an undefined status beside a
            // real method name — a claim assembled out of half a fact.
            acquisitionPaths: [{ method: "ACTION_WINDOW", verificationStatus: "POLICY_GATED" }],
          }),
        ],
      }),
    );
    renderBadges();
    expect(await screen.findByText("미지원")).toBeInTheDocument();
    expect(screen.queryByText(/Action Window/)).toBeNull();
    expect(screen.queryByText(/undefined/)).toBeNull();
  });

  it("keeps the connector's own verdict when it can serve the type itself", async () => {
    getChannelCapabilityOverview.mockResolvedValue(
      overview({
        dataTypes: [
          type({
            dataType: "REVIEW",
            label: "리뷰",
            supported: true,
            verificationStatus: "CONFIRMED",
            // A second route beside a working connector must not hide 확인됨 behind a route name.
            acquisitionPaths: [{ method: "ACTION_WINDOW", verificationStatus: "LIVE_PROVEN" }],
          }),
        ],
      }),
    );
    renderBadges();
    expect(await screen.findByText("확인됨")).toBeInTheDocument();
  });

  it("fails closed on a dead backend rather than showing a capability", async () => {
    getChannelCapabilityOverview.mockRejectedValue(new Error("backend down"));
    renderBadges();
    expect(await screen.findByText(/불러오지 못했습니다/)).toBeInTheDocument();
    expect(screen.queryByText(/Action Window/)).toBeNull();
  });

  it("has no axe violations", async () => {
    getChannelCapabilityOverview.mockResolvedValue(COUPANG);
    const { container } = renderBadges();
    await screen.findByText("수집 경로 확인됨 · Action Window");
    await expectNoAxeViolations(container);
  });
});
