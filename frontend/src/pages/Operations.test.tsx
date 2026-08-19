// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

// Boundary mocks (importOriginal — keep the rest of each module real):
//  - devMode: render the page production-shaped by default (no DEV demo nav, which
//    would otherwise show because vitest sets import.meta.env.DEV = true). The
//    diagnostics-entry tests flip both flags on.
//  - bridgeSource: neutralize the mount boot + reconnect real path so no test opens
//    a WebSocket (jsdom has none); the store is still driven for real via the harness.
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

import { Operations } from "./Operations";
import { renderWithRouter, screen, within, waitFor, userEvent } from "../test/renderWithRouter";
import { resetOps, seedRun, seedBridge, seedBridgeRun } from "../test/opsStoreHarness";
import { UI_SCENARIOS } from "../lib/actionWindow/fixtures";
import { CONNECTION_VIEW, SECTION_TITLE, commandLabel } from "../lib/actionWindow/copy";

const CHECKPOINT = "확인이 필요한 작업"; // HumanCheckpointCard section
const CONTROLS = "가능한 동작"; // ActionWindowControlPanel section
const TIMELINE = "진행 단계"; // OperationRunTimeline section (last-known view)
const RECONNECT = "다시 연결"; // ConnectionBanner reconnect button (offline)
const DIAGNOSTICS = "브리지 진단 (개발용)"; // FE-5 BridgeDiagnostics section
// The banner is identified by its own FE-owned copy — a `role="status"` query would
// be ambiguous because the blocker notice (BlockerNotice) is also a role="status" region.
const OFFLINE_BANNER = CONNECTION_VIEW.offline.title;
const RECONNECTING_BANNER = CONNECTION_VIEW.reconnecting.title;

describe("FE-7 Operations run-detail page (store → DOM wiring)", () => {
  beforeEach(() => {
    devModeMock.isFixturePreviewEnabled.mockReturnValue(false);
    devModeMock.isBridgeModeEnabled.mockReturnValue(false);
    bridgeMock.retryBridgeBoot.mockClear();
    bridgeMock.retryBridgeBoot.mockResolvedValue(false);
    resetOps();
  });

  it("renders the DEV demo nav production-shaped (absent) by default", () => {
    seedRun("human-action-required");
    renderWithRouter(<Operations />);
    expect(screen.queryByRole("navigation", { name: "데모 시나리오 (개발용)" })).toBeNull();
  });

  it("connected + WAITING_FOR_HUMAN: checkpoint + controls + timeline are shown, no banner", () => {
    // Commands render only behind a live Bridge or the developer preview (A7); the fixture world
    // stands in for a live one here, so opt in.
    devModeMock.isFixturePreviewEnabled.mockReturnValue(true);
    seedRun("human-action-required"); // connected fixture, status WAITING_FOR_HUMAN
    renderWithRouter(<Operations />);
    expect(screen.getByRole("region", { name: CHECKPOINT })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: CONTROLS })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: TIMELINE })).toBeInTheDocument();
    // connected → no resilience banner (neither offline nor reconnecting copy)
    expect(screen.queryByText(OFFLINE_BANNER)).toBeNull();
    expect(screen.queryByText(RECONNECTING_BANNER)).toBeNull();
  });

  it("checkpoint dedup: the recheck action renders once (checkpoint card), not again in the rail", () => {
    devModeMock.isFixturePreviewEnabled.mockReturnValue(true);
    seedRun("human-action-required"); // WAITING_FOR_HUMAN, allows recheck + manual + guidance + cancel
    renderWithRouter(<Operations />);
    const recheck = commandLabel("REQUEST_STEP_RECHECK");
    // Exactly one recheck button on the whole page (the checkpoint card's).
    expect(screen.getAllByRole("button", { name: recheck })).toHaveLength(1);
    const checkpoint = screen.getByRole("region", { name: CHECKPOINT });
    const controls = screen.getByRole("region", { name: CONTROLS });
    expect(within(checkpoint).getByRole("button", { name: recheck })).toBeInTheDocument();
    expect(within(controls).queryByRole("button", { name: recheck })).toBeNull();
    // The rail still surfaces the non-checkpoint commands (e.g. cancel).
    expect(
      within(controls).getByRole("button", { name: commandLabel("CANCEL_RUN") }),
    ).toBeInTheDocument();
  });

  it("connected idle (no run): shows the start region", () => {
    seedRun("ready-to-start"); // run === null, connected
    renderWithRouter(<Operations />);
    expect(screen.getByRole("region", { name: "시작하기" })).toBeInTheDocument();
  });

  it("product surface (fixture source, no preview): read-only — says the agent is not connected, offers no command", () => {
    // A plain dev server or a shipped build without a paired agent must not let the fixture source
    // "start" a scripted run and pass it off as the seller's (A7).
    seedRun("human-action-required");
    renderWithRouter(<Operations />);
    expect(screen.getByText(/SellerOps 도우미가 필요합니다/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: commandLabel("CANCEL_RUN") })).toBeNull();
    expect(screen.queryByRole("region", { name: SECTION_TITLE.controls })).toBeNull();
  });

  it("offline (bridge) with a last-known run: banner + reconnect shown, commands suppressed, timeline stays", () => {
    seedBridgeRun(UI_SCENARIOS["human-action-required"].run!, "offline");
    renderWithRouter(<Operations />);
    // offline banner + reconnect action exposed (offline + bridge → onReconnect defined)
    expect(screen.getByText(OFFLINE_BANNER)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: RECONNECT })).toBeInTheDocument();
    // commands suppressed while not connected
    expect(screen.queryByRole("region", { name: CHECKPOINT })).toBeNull();
    expect(screen.queryByRole("region", { name: CONTROLS })).toBeNull();
    // last-known view stays visible read-only
    expect(screen.getByRole("region", { name: TIMELINE })).toBeInTheDocument();
  });

  it("reconnecting (bridge) with a run: banner shown WITHOUT a reconnect button, commands suppressed", () => {
    seedBridgeRun(UI_SCENARIOS["human-action-required"].run!, "reconnecting");
    renderWithRouter(<Operations />);
    expect(screen.getByText(RECONNECTING_BANNER)).toBeInTheDocument(); // banner present
    expect(screen.queryByRole("button", { name: RECONNECT })).toBeNull(); // no manual action mid-retry
    expect(screen.queryByRole("region", { name: CHECKPOINT })).toBeNull();
    expect(screen.queryByRole("region", { name: CONTROLS })).toBeNull();
  });

  it("clicking reconnect invokes the reconnect boundary only — no real Bridge/WebSocket path", async () => {
    seedBridge()({ kind: "connection", connection: "offline" });
    renderWithRouter(<Operations />);
    await userEvent.click(screen.getByRole("button", { name: RECONNECT }));
    // The page wired the button to the (mocked) bridge boundary — proving the action
    // is exposed and that no real transport was reached (retryBridgeBoot is a stub,
    // so no WebSocket is opened).
    await waitFor(() => expect(bridgeMock.retryBridgeBoot).toHaveBeenCalledTimes(1));
  });

  describe("diagnostics entry point (bridge mode on)", () => {
    beforeEach(() => {
      devModeMock.isFixturePreviewEnabled.mockReturnValue(true);
      devModeMock.isBridgeModeEnabled.mockReturnValue(true);
    });

    it("renders on a live bridge world", () => {
      seedBridge()({ kind: "connection", connection: "connected" });
      renderWithRouter(<Operations />);
      expect(screen.getByRole("region", { name: DIAGNOSTICS })).toBeInTheDocument();
    });

    it("renders in the fixture-fallback world too (bridge mode on, fixture source)", () => {
      seedRun("human-action-required");
      renderWithRouter(<Operations />);
      expect(screen.getByRole("region", { name: DIAGNOSTICS })).toBeInTheDocument();
    });

    it("renders in the bridge-OFF (fixture-demo) world too, so the 브리지 꺼짐 verdict is observable", () => {
      devModeMock.isBridgeModeEnabled.mockReturnValue(false); // preview on, bridge mode off
      seedRun("human-action-required");
      renderWithRouter(<Operations />);
      expect(screen.getByRole("region", { name: DIAGNOSTICS })).toBeInTheDocument();
    });

    it("is absent when the DEV preview is off", () => {
      devModeMock.isFixturePreviewEnabled.mockReturnValue(false);
      devModeMock.isBridgeModeEnabled.mockReturnValue(false);
      seedRun("human-action-required");
      renderWithRouter(<Operations />);
      expect(screen.queryByRole("region", { name: DIAGNOSTICS })).toBeNull();
    });
  });
});
