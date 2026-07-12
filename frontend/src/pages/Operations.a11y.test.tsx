// @vitest-environment jsdom
import { describe, it, beforeEach, vi } from "vitest";

// FE-9: automated axe-core a11y scans of the run-detail page across its rendered
// states. Same boundary mocks as the FE-7 DOM-integration test (Operations.test.tsx):
// render production-shaped by default, and keep the bridge boot/reconnect off the wire.
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
import { renderWithRouter } from "../test/renderWithRouter";
import { resetOps, seedRun, seedBridgeRun } from "../test/opsStoreHarness";
import { UI_SCENARIOS } from "../lib/actionWindow/fixtures";
import { expectNoAxeViolations } from "../test/axe";

describe("FE-9 Operations run-detail page — axe a11y scans", () => {
  beforeEach(() => {
    devModeMock.isFixturePreviewEnabled.mockReturnValue(false);
    devModeMock.isBridgeModeEnabled.mockReturnValue(false);
    resetOps();
  });

  it("connected + WAITING_FOR_HUMAN (checkpoint + controls + timeline) has no violations", async () => {
    seedRun("human-action-required");
    const { container } = renderWithRouter(<Operations />);
    await expectNoAxeViolations(container);
  });

  it("connected idle (start region) has no violations", async () => {
    seedRun("ready-to-start");
    const { container } = renderWithRouter(<Operations />);
    await expectNoAxeViolations(container);
  });

  it("offline (banner + reconnect, commands suppressed, last-known timeline) has no violations", async () => {
    seedBridgeRun(UI_SCENARIOS["human-action-required"].run!, "offline");
    const { container } = renderWithRouter(<Operations />);
    await expectNoAxeViolations(container);
  });

  it("reconnecting (banner without reconnect button) has no violations", async () => {
    seedBridgeRun(UI_SCENARIOS["human-action-required"].run!, "reconnecting");
    const { container } = renderWithRouter(<Operations />);
    await expectNoAxeViolations(container);
  });

  it("diagnostics-entry world (bridge mode on) has no violations", async () => {
    devModeMock.isFixturePreviewEnabled.mockReturnValue(true);
    devModeMock.isBridgeModeEnabled.mockReturnValue(true);
    seedRun("human-action-required");
    const { container } = renderWithRouter(<Operations />);
    await expectNoAxeViolations(container);
  });
});
