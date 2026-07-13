// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

// Control the DEV fixture-preview flag (drives the honesty gate) without touching
// the real build-time env; keep the rest of devMode intact for the store/bridge.
const devModeMock = vi.hoisted(() => ({ isFixturePreviewEnabled: vi.fn(() => false) }));
vi.mock("../lib/actionWindow/devMode", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/actionWindow/devMode")>()),
  isFixturePreviewEnabled: devModeMock.isFixturePreviewEnabled,
}));

// Strict orders read — mocked so Home renders its real-data path deterministically.
const apiMock = vi.hoisted(() => ({ getOrdersSummaryStrict: vi.fn() }));
vi.mock("../lib/apiClient", () => ({
  api: { getOrdersSummaryStrict: apiMock.getOrdersSummaryStrict },
}));

import { Home } from "./Home";
import { renderWithRouter, screen } from "../test/renderWithRouter";
import { resetOps, seedHome, seedBridgeRun } from "../test/opsStoreHarness";
import { UI_SCENARIOS } from "../lib/actionWindow/fixtures";
import { CHECKPOINT_PROMPT_TITLE, HOME_REVIEW_OPS_COPY } from "../lib/actionWindow/copy";

const SUMMARY = {
  totalOrders7d: 34,
  totalSales7d: 5_600_000,
  trend: [{ date: "2026-07-13", orderCount: 12, salesAmount: 1_200_000 }],
  channelShare: [{ channelNameKo: "네이버", salesAmount: 1_200_000, percent: 100 }],
};

const SECTION = HOME_REVIEW_OPS_COPY.sectionTitle;

describe("Home dashboard — review-ops activity strip honesty gate", () => {
  beforeEach(() => {
    devModeMock.isFixturePreviewEnabled.mockReturnValue(false);
    apiMock.getOrdersSummaryStrict.mockResolvedValue(SUMMARY);
    resetOps();
  });

  it("renders the real order KPIs and the review-ops section", async () => {
    seedHome("home-empty");
    renderWithRouter(<Home />);
    expect(await screen.findByText("오늘 주문")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument(); // today's order count (real data)
    expect(screen.getByRole("region", { name: SECTION })).toBeInTheDocument();
  });

  it("production (no live agent, no preview): a seeded fixture run is NOT shown as live", async () => {
    // fixture source with a checkpoint run seeded, but preview OFF → honest empty
    seedHome("home-active-checkpoint");
    renderWithRouter(<Home />);
    const region = await screen.findByRole("region", { name: SECTION });
    expect(region).toHaveTextContent(HOME_REVIEW_OPS_COPY.emptyBody);
    expect(screen.queryByText(CHECKPOINT_PROMPT_TITLE)).toBeNull();
    expect(
      screen.getByRole("link", { name: new RegExp(HOME_REVIEW_OPS_COPY.open) }),
    ).toHaveAttribute("href", "/operations");
  });

  it("a live bridge run surfaces on the strip, checkpoint-forward", async () => {
    seedBridgeRun(UI_SCENARIOS["human-action-required"].run!, "connected");
    renderWithRouter(<Home />);
    const region = await screen.findByRole("region", { name: SECTION });
    expect(region).toHaveTextContent(CHECKPOINT_PROMPT_TITLE);
    expect(
      screen.getByRole("link", { name: new RegExp(HOME_REVIEW_OPS_COPY.goToCheckpoint) }),
    ).toHaveAttribute("href", "/operations/current");
  });

  it("DEV fixture preview shows the demo run (QA-able), not the empty state", async () => {
    devModeMock.isFixturePreviewEnabled.mockReturnValue(true);
    seedHome("home-active-running");
    renderWithRouter(<Home />);
    const region = await screen.findByRole("region", { name: SECTION });
    expect(region).not.toHaveTextContent(HOME_REVIEW_OPS_COPY.emptyBody);
  });
});
