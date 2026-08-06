// @vitest-environment jsdom
// The channel list surfaces the Coupang credential-expiry state from the health read: WARN_* / DATE_PASSED /
// EXPIRED show "만료 예정·조치 필요", and from WARN_14 (renewRecommended) the row offers the guided-renewal
// CTA that routes to the renewal page. OK / no-expiry rows show neither.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ChannelList } from "./ChannelList";
import type {
  ChannelResponse,
  ConnectionStatusView,
  CoupangExpiryStatusView,
  SellerAccountResponse,
} from "../../lib/types";

const navigateSpy = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigateSpy };
});

const COUPANG: ChannelResponse = {
  id: "coupang-ch",
  code: "COUPANG",
  nameKo: "쿠팡",
  status: "AVAILABLE",
  dataBadges: [],
  lastSyncedAt: null,
  actionLabel: "관리",
  support: {
    fileUploadSupported: false,
    fileUploadDataTypes: [],
    autoCollectSupported: true,
    autoCollectDataTypes: ["ORDER_SUMMARY"],
    connectionCheckSupported: true,
    credentialSetupSupported: true,
  },
};

const ACCOUNT: SellerAccountResponse = {
  id: "acc-cp",
  channelId: "coupang-ch",
  channelNameKo: "쿠팡",
  alias: null,
  connectionStatus: "CONNECTED",
  lastSyncedAt: "2026-08-06T00:00:00Z",
  fileUpload: false,
};

function health(expiry: CoupangExpiryStatusView | null): ConnectionStatusView {
  return {
    sellerAccountId: "acc-cp",
    state: "CONNECTED",
    lastSuccessAt: "2026-08-06T00:00:00Z",
    consecutiveFailures: 0,
    lastError: null,
    lastSyncedAt: "2026-08-06T00:00:00Z",
    nextScheduledAt: null,
    expiry,
  };
}

function expiry(over: Partial<CoupangExpiryStatusView>): CoupangExpiryStatusView {
  return { expiresAt: null, daysRemaining: null, state: "OK", authFailing: false, renewRecommended: false, ...over };
}

function renderList(h: ConnectionStatusView) {
  return render(
    <MemoryRouter>
      <ChannelList
        channels={[COUPANG]}
        accounts={[ACCOUNT]}
        health={new Map([["acc-cp", h]])}
        statusLoading={false}
        onNotice={vi.fn()}
      />
    </MemoryRouter>,
  );
}

describe("ChannelList — Coupang credential expiry", () => {
  it("shows '만료 예정·조치 필요' + the renewal CTA from WARN_14", () => {
    navigateSpy.mockClear();
    renderList(health(expiry({ state: "WARN_14", renewRecommended: true })));
    expect(screen.getByTestId("channel-expiry")).toHaveTextContent("만료 예정·조치 필요");
    const cta = screen.getByRole("button", { name: "WING에서 API 키 갱신하기" });
    cta.click();
    expect(navigateSpy).toHaveBeenCalledWith("/connect/coupang/renew/acc-cp");
  });

  it("flags EXPIRED with the renewal CTA", () => {
    renderList(health(expiry({ state: "EXPIRED", authFailing: true, renewRecommended: true })));
    expect(screen.getByTestId("channel-expiry")).toHaveTextContent("만료됨");
    expect(screen.getByRole("button", { name: "WING에서 API 키 갱신하기" })).toBeInTheDocument();
  });

  it("shows the attention flag but NO renewal CTA at WARN_30 (before renewRecommended)", () => {
    renderList(health(expiry({ state: "WARN_30", renewRecommended: false })));
    expect(screen.getByTestId("channel-expiry")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "WING에서 API 키 갱신하기" })).toBeNull();
  });

  it("shows nothing expiry-related for OK / no-expiry rows", () => {
    const { rerender } = renderList(health(expiry({ state: "OK" })));
    expect(screen.queryByTestId("channel-expiry")).toBeNull();
    expect(screen.queryByRole("button", { name: "WING에서 API 키 갱신하기" })).toBeNull();
    rerender(
      <MemoryRouter>
        <ChannelList
          channels={[COUPANG]}
          accounts={[ACCOUNT]}
          health={new Map([["acc-cp", health(null)]])}
          statusLoading={false}
          onNotice={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId("channel-expiry")).toBeNull();
  });
});
