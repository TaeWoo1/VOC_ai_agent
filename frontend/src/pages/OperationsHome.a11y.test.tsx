// @vitest-environment jsdom
import { describe, it, beforeEach, vi } from "vitest";

// FE-9: automated axe-core a11y scans of the home page across its rendered states.
// Same boundary mocks as the FE-7 DOM-integration test (OperationsHome.test.tsx).
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
import { renderWithRouter } from "../test/renderWithRouter";
import { resetOps, seedHome, seedBridge } from "../test/opsStoreHarness";
import { api } from "../lib/apiClient";
import { expectNoAxeViolations } from "../test/axe";

describe("FE-9 Operations home page — axe a11y scans", () => {
  beforeEach(() => {
    // The import-history rail self-fetches; keep the axe run off the wire and deterministic.
    vi.spyOn(api, "getReviewImportsStrict").mockResolvedValue([]);
    devModeMock.isFixturePreviewEnabled.mockReturnValue(false);
    devModeMock.isBridgeModeEnabled.mockReturnValue(false);
    resetOps();
  });

  it("empty state (start region + empty recent list) has no violations", async () => {
    seedHome("home-empty");
    const { container } = renderWithRouter(<OperationsHome />);
    await expectNoAxeViolations(container);
  });

  it("active checkpoint (active-run card + populated recent list) has no violations", async () => {
    seedHome("home-active-checkpoint");
    const { container } = renderWithRouter(<OperationsHome />);
    await expectNoAxeViolations(container);
  });

  it("offline (banner + reconnect, start affordance suppressed) has no violations", async () => {
    seedBridge()({ kind: "connection", connection: "offline" });
    const { container } = renderWithRouter(<OperationsHome />);
    await expectNoAxeViolations(container);
  });

  it("diagnostics-entry world (bridge mode on) has no violations", async () => {
    devModeMock.isFixturePreviewEnabled.mockReturnValue(true);
    devModeMock.isBridgeModeEnabled.mockReturnValue(true);
    seedHome("home-active-checkpoint");
    const { container } = renderWithRouter(<OperationsHome />);
    await expectNoAxeViolations(container);
  });
});
