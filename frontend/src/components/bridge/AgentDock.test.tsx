// @vitest-environment jsdom
/**
 * The dock is quiet unless the SellerOps 도우미 is connected, or was and broke (agent UX cleanup, 2026-08-19).
 * A new seller must never meet "내 PC 연결 / 연결하지 못했습니다" as a default fixture of the shell.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BridgeState } from "../../lib/bridge/bridgeClient";
import { BRIDGE_TOKEN_KEY } from "../../lib/bridge/bridgeClient";

const bridge = {
  state: { phase: "connecting", maybeNeedsLocalNetworkAccess: false } as BridgeState,
  requestPairing: vi.fn(),
  revoke: vi.fn(),
  retry: vi.fn(),
};
let setBridgeState: ((s: BridgeState) => void) | null = null;
vi.mock("../../hooks/useBridge", async () => {
  const React = await import("react");
  return {
    useBridge: () => {
      const [state, set] = React.useState<BridgeState>(bridge.state);
      setBridgeState = set;
      return { state, requestPairing: bridge.requestPairing, revoke: bridge.revoke, retry: bridge.retry };
    },
  };
});

import { AgentDock } from "./AgentDock";

function phase(p: BridgeState["phase"], extra: Partial<BridgeState> = {}) {
  act(() => setBridgeState?.({ phase: p, maybeNeedsLocalNetworkAccess: false, ...extra }));
}

beforeEach(() => {
  localStorage.clear();
  bridge.state = { phase: "connecting", maybeNeedsLocalNetworkAccess: false };
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("AgentDock", () => {
  it("a new seller sees nothing while the helper is searched for, off, or simply not connected", () => {
    render(<AgentDock />);
    expect(screen.queryByTestId("agent-dock")).toBeNull();
    phase("unreachable");
    expect(screen.queryByTestId("agent-dock")).toBeNull();
    phase("unpaired");
    expect(screen.queryByTestId("agent-dock")).toBeNull();
    expect(document.body.textContent).not.toMatch(/내 PC 연결|연결하지 못했습니다|로컬 에이전트/);
  });

  it("connected → a small chip; tapping it shows the detail with 연결 해제; disconnecting goes quiet again", async () => {
    render(<AgentDock />);
    phase("paired", { snapshot: { connections: [], supportedEvents: [] } as never });
    const chip = screen.getByTestId("agent-dock-chip");
    expect(chip).toHaveTextContent("SellerOps 도우미 연결됨");
    expect(screen.queryByTestId("agent-dock-detail")).toBeNull();
    await userEvent.click(chip);
    expect(screen.getByTestId("agent-dock-detail")).toHaveTextContent(/SellerOps 도우미와 연결되어 있어요/);
    await userEvent.click(screen.getByTestId("agent-dock-revoke"));
    expect(bridge.revoke).toHaveBeenCalled();
    phase("unpaired");
    expect(screen.queryByTestId("agent-dock")).toBeNull();
  });

  it("was connected in this page load, then the helper went away → reconnect notice with 도우미 words, and it stays through retries", async () => {
    render(<AgentDock />);
    phase("paired", { snapshot: { connections: [], supportedEvents: [] } as never });
    phase("disconnected");
    const dock = screen.getByTestId("agent-dock");
    expect(dock).toHaveTextContent("SellerOps 도우미와 연결이 끊어졌어요");
    phase("connecting");
    expect(screen.getByTestId("agent-dock")).toHaveTextContent("다시 연결하는 중…");
    phase("unreachable");
    expect(screen.getByTestId("agent-dock")).toHaveTextContent(/도우미가 꺼진 것 같아요/);
    await userEvent.click(screen.getByTestId("agent-dock-reconnect"));
    expect(bridge.retry).toHaveBeenCalled();
    expect(document.body.textContent).not.toMatch(/로컬 에이전트/);
    phase("paired", { snapshot: { connections: [], supportedEvents: [] } as never });
    expect(screen.getByTestId("agent-dock-chip")).toBeInTheDocument();
  });

  it("a remembered pairing (stored token) reconnecting normally shows nothing until it is connected", () => {
    localStorage.setItem(BRIDGE_TOKEN_KEY, "tok");
    render(<AgentDock />);
    expect(screen.queryByTestId("agent-dock")).toBeNull();
    phase("connecting_ws");
    expect(screen.queryByTestId("agent-dock")).toBeNull();
    phase("paired", { snapshot: { connections: [], supportedEvents: [] } as never });
    expect(screen.getByTestId("agent-dock-chip")).toBeInTheDocument();
  });

  it("agent-side revocation → notice whose action starts a new pairing, and the code is shown while pending", async () => {
    localStorage.setItem(BRIDGE_TOKEN_KEY, "tok");
    render(<AgentDock />);
    phase("connecting_ws");
    phase("revoked");
    expect(screen.getByTestId("agent-dock")).toHaveTextContent("SellerOps 도우미 연결이 해제됐어요");
    await userEvent.click(screen.getByTestId("agent-dock-reconnect"));
    expect(bridge.requestPairing).toHaveBeenCalled();
    phase("pairing_pending", { confirmationCode: "4821" });
    expect(screen.getByTestId("agent-dock-code")).toHaveTextContent("4821");
  });

  it("while unpaired, a pairing completed on another screen is picked up (presence of the stored token → retry)", () => {
    vi.useFakeTimers();
    render(<AgentDock />);
    phase("unpaired");
    act(() => { vi.advanceTimersByTime(2100); });
    expect(bridge.retry).not.toHaveBeenCalled();
    localStorage.setItem(BRIDGE_TOKEN_KEY, "tok");
    act(() => { vi.advanceTimersByTime(2100); });
    expect(bridge.retry).toHaveBeenCalledTimes(1);
  });
});
