// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { InboxItemRedirect } from "./InboxItemRedirect";

const getInboxStrict = vi.fn();
const getSellerAccountsStrict = vi.fn();
const getChannelsStrict = vi.fn();

vi.mock("../../lib/apiClient", () => ({
  api: {
    getInboxStrict: () => getInboxStrict(),
    getSellerAccountsStrict: () => getSellerAccountsStrict(),
    getChannelsStrict: () => getChannelsStrict(),
  },
  getToken: () => null,
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/inbox/:itemRef" element={<InboxItemRedirect />} />
        <Route path="/inquiries" element={<h1>문의</h1>} />
        <Route path="/inquiries/:itemRef" element={<h1>문의 상세</h1>} />
        <Route path="/reviews" element={<h1>리뷰</h1>} />
        <Route path="/reviews/:accountId" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  );
}

function Probe() {
  const { pathname, search } = useLocation();
  return <h1>{`리뷰 ${pathname}${search}`}</h1>;
}

beforeEach(() => {
  getInboxStrict.mockResolvedValue({
    items: [
      { id: "i1", type: "INQUIRY", channelId: "nv", channelNameKo: "네이버", productName: "", snippet: "", rating: null, status: "UNANSWERED", receivedAt: "2026-08-01T00:00:00Z" },
      { id: "r1", type: "REVIEW", channelId: "cp", channelNameKo: "쿠팡", productName: "", snippet: "", rating: 1, status: "NEGATIVE", receivedAt: "2026-08-01T00:00:00Z" },
    ],
    total: 2,
  });
  getSellerAccountsStrict.mockResolvedValue([
    { id: "acc-cp", channelId: "cp", channelNameKo: "쿠팡", alias: null, connectionStatus: "CONNECTED", lastSyncedAt: null, fileUpload: false },
  ]);
  getChannelsStrict.mockResolvedValue([
    { id: "cp", code: "COUPANG", nameKo: "쿠팡", status: "CONNECTED", dataBadges: [], lastSyncedAt: null, actionLabel: "", support: { autoCollectSupported: false, autoCollectDataTypes: [], fileUploadSupported: true, fileUploadDataTypes: [], connectionCheckSupported: false, credentialSetupSupported: false } },
  ]);
});

afterEach(() => vi.clearAllMocks());

describe("/inbox/:itemRef — resolves an old deep link to the surface that owns the row", () => {
  it("sends an inquiry to 문의", async () => {
    renderAt("/inbox/i1");
    expect(await screen.findByRole("heading", { name: "문의 상세" })).toBeInTheDocument();
  });

  it("sends a review to its account on 리뷰, opening that review", async () => {
    renderAt("/inbox/r1");
    expect(await screen.findByRole("heading", { name: "리뷰 /reviews/acc-cp?review=r1" })).toBeInTheDocument();
  });

  it("lands on 문의 when the row is unknown, rather than a dead end", async () => {
    renderAt("/inbox/nope");
    expect(await screen.findByRole("heading", { name: "문의" })).toBeInTheDocument();
  });

  it("lands on 리뷰 when a review's account cannot be resolved", async () => {
    getSellerAccountsStrict.mockResolvedValue([]);
    renderAt("/inbox/r1");
    expect(await screen.findByRole("heading", { name: "리뷰" })).toBeInTheDocument();
  });
});
