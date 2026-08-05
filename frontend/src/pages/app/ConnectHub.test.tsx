// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ConnectHub } from "./ConnectHub";
import { expectNoAxeViolations } from "../../test/axe";
import type { ChannelResponse, SellerAccountResponse } from "../../lib/types";

const getChannels = vi.fn();
const getSellerAccountsStrict = vi.fn();
const getConnectionStatusStrict = vi.fn();

vi.mock("../../lib/apiClient", () => ({
  api: {
    getChannels: () => getChannels(),
    getSellerAccountsStrict: () => getSellerAccountsStrict(),
    getConnectionStatusStrict: (id: string) => getConnectionStatusStrict(id),
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

beforeEach(() => {
  openCount.mockReturnValue(0);
  getChannels.mockResolvedValue([channel({ id: "c1" }), channel({ id: "c2", nameKo: "채널 나" })]);
  getSellerAccountsStrict.mockResolvedValue([] as SellerAccountResponse[]);
  getConnectionStatusStrict.mockResolvedValue({});
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

describe("채널·자료 연결 — the hub", () => {
  it("carries the four things this area is for", async () => {
    renderHub();
    expect(
      await screen.findByRole("heading", { level: 1, name: "채널·자료 연결" }),
    ).toBeInTheDocument();
    for (const section of ["채널", "정기 자료 가져오기", "가져오기 진행"]) {
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
    expect(screen.getByRole("link", { name: "진행 상황" })).toHaveAttribute(
      "href",
      "/connect/imports",
    );
  });
});

describe("채널·자료 연결 — honesty", () => {
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

describe("채널·자료 연결 — accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = renderHub();
    await screen.findByLabelText("채널 목록");
    await expectNoAxeViolations(container);
  });
});
