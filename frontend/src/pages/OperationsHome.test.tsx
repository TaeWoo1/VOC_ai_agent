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

const ACTIVE = "현재 작업"; // ActiveRunCard section
const RECENT = "최근 활동"; // RecentActivityList section
const REVIEW_WORK = "리뷰 업무 현황"; // idle review-work section (FE-12)
const RECONNECT = "다시 연결"; // ConnectionBanner reconnect button
const DIAGNOSTICS = "브리지 진단 (개발용)";

describe("FE-7 Operations home page (store → DOM wiring)", () => {
  beforeEach(() => {
    devModeMock.isFixturePreviewEnabled.mockReturnValue(false);
    devModeMock.isBridgeModeEnabled.mockReturnValue(false);
    resetOps();
  });

  it("renders the DEV demo nav production-shaped (absent) by default", () => {
    seedHome("home-empty");
    renderWithRouter(<OperationsHome />);
    expect(screen.queryByRole("navigation", { name: "데모 시나리오 (개발용)" })).toBeNull();
  });

  it("empty state: review-work region + the recent-activity empty message", () => {
    seedHome("home-empty"); // run null, no history, connected
    renderWithRouter(<OperationsHome />);
    expect(screen.getByRole("region", { name: REVIEW_WORK })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: ACTIVE })).toBeNull(); // no active card
    const recent = screen.getByRole("region", { name: RECENT });
    expect(recent).toHaveTextContent("아직 완료된 작업이 없어요.");
  });

  it("active checkpoint: active-run card with the detail link + a populated recent list", () => {
    seedHome("home-active-checkpoint"); // run WAITING_FOR_HUMAN + history, connected
    renderWithRouter(<OperationsHome />);
    expect(screen.getByRole("region", { name: ACTIVE })).toBeInTheDocument();
    // navigation to the run detail is exposed (accessible link, needs-human copy)
    expect(screen.getByRole("link", { name: "확인하러 가기" })).toHaveAttribute(
      "href",
      "/operations/current",
    );
    expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0); // recent history rendered
  });

  it("offline (bridge): banner + reconnect shown, start affordance suppressed", () => {
    seedBridge()({ kind: "connection", connection: "offline" }); // run null, offline
    renderWithRouter(<OperationsHome />);
    expect(screen.getByRole("button", { name: RECONNECT })).toBeInTheDocument();
    // idle start action is gated on connected → suppressed while offline
    expect(screen.queryByRole("button", { name: "내려받기 시작" })).toBeNull();
  });

  it("diagnostics entry point renders when bridge mode is on, absent otherwise", () => {
    // off by default
    seedHome("home-active-checkpoint");
    const first = renderWithRouter(<OperationsHome />);
    expect(screen.queryByRole("region", { name: DIAGNOSTICS })).toBeNull();
    first.unmount();

    // on
    devModeMock.isFixturePreviewEnabled.mockReturnValue(true);
    devModeMock.isBridgeModeEnabled.mockReturnValue(true);
    resetOps();
    seedHome("home-active-checkpoint");
    renderWithRouter(<OperationsHome />);
    expect(screen.getByRole("region", { name: DIAGNOSTICS })).toBeInTheDocument();
  });
});
