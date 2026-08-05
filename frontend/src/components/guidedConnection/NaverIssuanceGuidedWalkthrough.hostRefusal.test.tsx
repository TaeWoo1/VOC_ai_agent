// @vitest-environment jsdom
// Wiring test for the LIVE host-refusal branch: when the agent is paired but the issuance host reports a
// carrier-mismatch (it is hosting a DIFFERENT run/session), the walkthrough must surface the distinct
// SESSION_MISMATCH notice with a retry — never the generic "cannot guide" or "not running" message. This
// needs live mode (no `run` prop) + a mocked issuance host, so it lives in its own file with its own mocks.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { screen, userEvent } from "../../test/renderWithRouter";
import type { BridgeState } from "../../lib/bridge/bridgeClient";

const h = vi.hoisted(() => ({
  bridge: { phase: "paired", maybeNeedsLocalNetworkAccess: false } as BridgeState,
  retry: vi.fn(),
  attach: vi.fn().mockResolvedValue(null),
  unavailable: "carrier-mismatch" as string | null,
}));

vi.mock("../../hooks/useBridge", () => ({
  useBridge: () => ({ state: h.bridge, requestPairing: vi.fn(), revoke: vi.fn(), retry: h.retry }),
}));
vi.mock("../../lib/actionWindow/issuance/useGuidedIssuance", () => ({
  useGuidedIssuance: () => ({ view: null, unavailable: h.unavailable, attach: h.attach, send: vi.fn() }),
}));

import { NaverIssuanceGuidedWalkthrough } from "./NaverIssuanceGuidedWalkthrough";

beforeEach(() => {
  h.bridge = { phase: "paired", maybeNeedsLocalNetworkAccess: false };
  h.retry.mockClear();
  h.attach.mockClear();
  h.unavailable = "carrier-mismatch";
});

async function start() {
  render(<NaverIssuanceGuidedWalkthrough dispatch={vi.fn()} advertisedEgressIps={[]} />);
  await userEvent.click(screen.getByRole("button", { name: "네이버 연결 안내 시작" }));
}

describe("NaverIssuanceGuidedWalkthrough — live host refusal is guided distinctly", () => {
  it("paired + carrier-mismatch → SESSION_MISMATCH notice (agent on a different run), with a retry", async () => {
    await start();
    expect(screen.getByRole("status", { name: "AGENT_ENV_SESSION_MISMATCH" })).toBeInTheDocument();
    expect(screen.getByText(/다른 연결 세션/)).toBeInTheDocument();
    // The generic "cannot guide" catch-all must NOT be what is shown here.
    expect(screen.queryByText("화면 안내를 사용할 수 없어요. 텍스트로 진행해 주세요.")).toBeNull();
    // Retry must actually RE-ATTACH the issuance host (not merely re-detect the already-paired bridge), or the
    // "restart the agent, then retry" remedy would be a no-op. attach() ran once on mount; retry runs it again.
    const before = h.attach.mock.calls.length;
    await userEvent.click(screen.getByTestId("agent-env-retry"));
    expect(h.attach.mock.calls.length).toBeGreaterThan(before);
  });

  it("paired + no-announcement → HOST_UNAVAILABLE (cannot host), distinct from SESSION_MISMATCH", async () => {
    h.unavailable = "no-announcement";
    await start();
    expect(screen.getByRole("status", { name: "AGENT_ENV_HOST_UNAVAILABLE" })).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "AGENT_ENV_SESSION_MISMATCH" })).toBeNull();
  });

  it("paired + start-refused → HOST_UNAVAILABLE (issuance-level refusal, not a bridge phase)", async () => {
    h.unavailable = "start-refused";
    await start();
    expect(screen.getByRole("status", { name: "AGENT_ENV_HOST_UNAVAILABLE" })).toBeInTheDocument();
  });
});
