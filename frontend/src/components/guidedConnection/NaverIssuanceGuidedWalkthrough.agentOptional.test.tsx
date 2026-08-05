// @vitest-environment jsdom
//
// The Local Agent is OPTIONAL, never a hard requirement (root safety fence). When the agent is not running
// (bridge `unreachable`, before any pairing), the walkthrough must:
//   • show the screen-guidance "run the agent, then retry" path (AgentPairingPanel), and
//   • ALSO offer the distinct text-only "proceed without the agent" path,
// as two separate affordances, and the "다시 찾기" retry must re-detect the bridge so that once the seller
// starts the agent the guided (screen) path recovers. This needs live mode + a mocked bridge, so it has its
// own mocks. (The paired-but-host-refused recovery is covered in the sibling hostRefusal test.)
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { screen, userEvent } from "../../test/renderWithRouter";
import type { BridgeState } from "../../lib/bridge/bridgeClient";

const h = vi.hoisted(() => ({
  bridge: { phase: "unreachable", maybeNeedsLocalNetworkAccess: false } as BridgeState,
  retry: vi.fn(),
  requestPairing: vi.fn(),
  attach: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../hooks/useBridge", () => ({
  useBridge: () => ({ state: h.bridge, requestPairing: h.requestPairing, revoke: vi.fn(), retry: h.retry }),
}));
vi.mock("../../lib/actionWindow/issuance/useGuidedIssuance", () => ({
  // Pre-pairing there is no host refusal — attach never ran (the agent isn't paired), so `unavailable` is null.
  useGuidedIssuance: () => ({ view: null, unavailable: null, attach: h.attach, send: vi.fn() }),
}));

import { NaverIssuanceGuidedWalkthrough } from "./NaverIssuanceGuidedWalkthrough";

beforeEach(() => {
  h.bridge = { phase: "unreachable", maybeNeedsLocalNetworkAccess: false };
  h.retry.mockClear();
  h.requestPairing.mockClear();
  h.attach.mockClear();
});

async function start(dispatch = vi.fn()) {
  render(<NaverIssuanceGuidedWalkthrough dispatch={dispatch} advertisedEgressIps={[]} />);
  await userEvent.click(screen.getByRole("button", { name: "네이버 연결 안내 시작" }));
  return dispatch;
}

describe("NaverIssuanceGuidedWalkthrough — agent not running (optional, with a text path)", () => {
  it("shows BOTH the screen-guidance pairing path and the distinct text-only path", async () => {
    await start();
    // Screen guidance: "run your helper, then retry" — the pairing panel with its retry.
    expect(screen.getByTestId("agent-pairing")).toBeInTheDocument();
    expect(screen.getByText(/도우미를 찾지 못했어요/)).toBeInTheDocument();
    expect(screen.getByTestId("agent-pairing-retry")).toBeInTheDocument();
    // Separate text-only path — the agent is never a hard requirement.
    expect(screen.getByRole("button", { name: "텍스트로 직접 진행하기" })).toBeInTheDocument();
    // The paired-only host notices must NOT appear before pairing.
    expect(screen.queryByRole("status", { name: /^AGENT_ENV_/ })).toBeNull();
  });

  it("the text path advances the journey to the static checklist without the agent", async () => {
    const dispatch = await start();
    await userEvent.click(screen.getByRole("button", { name: "텍스트로 직접 진행하기" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "APPLICATION_ISSUANCE_MODE", mode: "text" });
  });

  it("'다시 찾기' re-detects the bridge so the screen path recovers once the agent is started", async () => {
    await start();
    await userEvent.click(screen.getByTestId("agent-pairing-retry"));
    expect(h.retry).toHaveBeenCalled();
  });
});
