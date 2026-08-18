// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

// Same boundary mocks as the run-detail page test (see Operations.test.tsx): render
// production-shaped by default, and keep the bridge boot/reconnect off the wire.
const devModeMock = vi.hoisted(() => ({
  isFixturePreviewEnabled: vi.fn(() => false),
  isBridgeModeEnabled: vi.fn(() => false),
}));
vi.mock("../lib/actionWindow/devMode", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/actionWindow/devMode")>()),
  isFixturePreviewEnabled: devModeMock.isFixturePreviewEnabled,
  isBridgeModeEnabled: devModeMock.isBridgeModeEnabled,
}));
const bridgeMock = vi.hoisted(() => ({
  connectBridgeIfEnabled: vi.fn(async () => false),
  retryBridgeBoot: vi.fn(async () => false),
  isBridgeBootAttempted: vi.fn(() => false),
}));
vi.mock("../lib/actionWindow/bridgeSource", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/actionWindow/bridgeSource")>()),
  connectBridgeIfEnabled: bridgeMock.connectBridgeIfEnabled,
  retryBridgeBoot: bridgeMock.retryBridgeBoot,
  isBridgeBootAttempted: bridgeMock.isBridgeBootAttempted,
}));

import { OperationsHome } from "./OperationsHome";
import { renderWithRouter, screen } from "../test/renderWithRouter";
import { resetOps, seedHome, seedBridge } from "../test/opsStoreHarness";
import { api } from "../lib/apiClient";

const ACTIVE = "현재 작업"; // ActiveRunCard section
const RECENT = "최근 활동"; // RecentActivityList — the DEV-only session list
const IMPORTS = "최근 가져오기 기록"; // ImportHistoryList — the persisted rail
const REVIEW_WORK = "리뷰 업무 현황"; // idle review-work section (FE-12)
const RECONNECT = "다시 연결"; // ConnectionBanner reconnect button
const DIAGNOSTICS = "브리지 진단 (개발용)";

describe("FE-7 Operations home page (store → DOM wiring)", () => {
  beforeEach(() => {
    devModeMock.isFixturePreviewEnabled.mockReturnValue(false);
    devModeMock.isBridgeModeEnabled.mockReturnValue(false);
    // The rail reads persisted import history; keep it off the wire and deterministic.
    vi.spyOn(api, "getReviewImportsStrict").mockResolvedValue([]);
    vi.spyOn(api, "getSellerAccountsStrict").mockResolvedValue([]);
    resetOps();
  });

  it("renders the DEV demo nav production-shaped (absent) by default", () => {
    seedHome("home-empty");
    renderWithRouter(<OperationsHome />);
    expect(screen.queryByRole("navigation", { name: "데모 시나리오 (개발용)" })).toBeNull();
  });

  it("empty state: review-work region + the PERSISTED import-history rail", () => {
    seedHome("home-empty"); // run null, no history, connected
    renderWithRouter(<OperationsHome />);
    expect(screen.getByRole("region", { name: REVIEW_WORK })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: ACTIVE })).toBeNull(); // no active card
    // The rail is the seller's own import history, which survives a reload.
    expect(screen.getByRole("region", { name: IMPORTS })).toBeInTheDocument();
    // The session list is a DEV fixture-preview affordance and is absent production-shaped: it
    // lived in browser memory and could never be a seller's record of their own work.
    expect(screen.queryByRole("region", { name: RECENT })).toBeNull();
  });

  it("is a collection workbench (A6): no worklist here, and it points at the 리뷰 screen", async () => {
    // Reading, deciding and replying to reviews live on /reviews since product assembly A6 — this page
    // collects and keeps the record. A worklist here would be a second list of "what needs a look"
    // with its own count, which is exactly what the assembly removed.
    seedHome("home-empty");
    renderWithRouter(<OperationsHome />);
    expect(screen.getByRole("heading", { name: "리뷰 수집" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "리뷰 화면으로" })).toHaveAttribute("href", "/reviews");
    expect(screen.queryByRole("region", { name: "오늘 확인할 일" })).toBeNull();
    expect(screen.queryByText("내 답변 작업")).toBeNull();
    // Nothing on this page reads accounts or reply work: those reads moved with the worklist.
    expect(api.getSellerAccountsStrict).not.toHaveBeenCalled();
    expect(await screen.findByRole("region", { name: IMPORTS })).toBeInTheDocument();
  });

  it("the session activity list returns only under the DEV fixture preview", () => {
    devModeMock.isFixturePreviewEnabled.mockReturnValue(true);
    seedHome("home-active-checkpoint"); // fixture source + session history
    renderWithRouter(<OperationsHome />);
    expect(screen.getByRole("region", { name: RECENT })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: IMPORTS })).toBeInTheDocument();
  });

  it("active checkpoint: active-run card with the detail link + a populated recent list", () => {
    seedHome("home-active-checkpoint"); // run WAITING_FOR_HUMAN + history, connected
    renderWithRouter(<OperationsHome />);
    expect(screen.getByRole("region", { name: ACTIVE })).toBeInTheDocument();
    // navigation to the run detail is exposed (accessible link, needs-human copy)
    expect(screen.getByRole("link", { name: "확인하러 가기" })).toHaveAttribute(
      "href",
      "/connect/imports/current",
    );
  });

  it("product surface (fixture source, no preview): read-only, says the agent is not connected", () => {
    seedHome("home-empty");
    renderWithRouter(<OperationsHome />);
    expect(screen.getByRole("note")).toHaveTextContent("로컬 에이전트가 연결되어 있지 않아");
    expect(screen.queryByRole("button", { name: "내려받기 시작" })).toBeNull();
  });

  it("offline (bridge): banner + reconnect shown, start affordance suppressed", () => {
    seedBridge()({ kind: "connection", connection: "offline" }); // run null, offline
    renderWithRouter(<OperationsHome />);
    expect(screen.getByRole("button", { name: RECONNECT })).toBeInTheDocument();
    // idle start action is gated on connected → suppressed while offline
    expect(screen.queryByRole("button", { name: "내려받기 시작" })).toBeNull();
  });

  it("diagnostics entry point renders whenever the DEV preview is on (incl. bridge OFF), absent otherwise", () => {
    // preview off by default → absent
    seedHome("home-active-checkpoint");
    const first = renderWithRouter(<OperationsHome />);
    expect(screen.queryByRole("region", { name: DIAGNOSTICS })).toBeNull();
    first.unmount();

    // preview on + bridge mode on → present
    devModeMock.isFixturePreviewEnabled.mockReturnValue(true);
    devModeMock.isBridgeModeEnabled.mockReturnValue(true);
    resetOps();
    seedHome("home-active-checkpoint");
    const second = renderWithRouter(<OperationsHome />);
    expect(screen.getByRole("region", { name: DIAGNOSTICS })).toBeInTheDocument();
    second.unmount();

    // preview on + bridge mode OFF → still present, so the 브리지 꺼짐 verdict is observable
    devModeMock.isBridgeModeEnabled.mockReturnValue(false);
    resetOps();
    seedHome("home-active-checkpoint");
    renderWithRouter(<OperationsHome />);
    expect(screen.getByRole("region", { name: DIAGNOSTICS })).toBeInTheDocument();
  });
});
