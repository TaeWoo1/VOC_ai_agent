// @vitest-environment jsdom
/**
 * The pairing entry point the live run found missing (proof record, finding 14).
 *
 * `BridgeStatus` already existed but mounts only behind `VITE_ENABLE_AGENT_BRIDGE=true`, a developer flag. On
 * 2026-07-25 the seated operator could not connect their local helper from the product at all, and the run only
 * proceeded because that flag was set by hand. These tests pin that the action is reachable from the card that is
 * blocked without it, and that each phase names its own fix rather than collapsing into "offline".
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentPairingPanel } from "./AgentPairingPanel";

afterEach(cleanup);

function renderPanel(phase: string, extra: { confirmationCode?: string | null } = {}) {
  const onConnect = vi.fn();
  const onRetry = vi.fn();
  render(
    <AgentPairingPanel
      phase={phase}
      confirmationCode={extra.confirmationCode ?? null}
      onConnect={onConnect}
      onRetry={onRetry}
    />,
  );
  return { onConnect, onRetry };
}

describe("AgentPairingPanel", () => {
  it("offers pairing when the agent is there but not connected", async () => {
    const { onConnect } = renderPanel("unpaired");
    await userEvent.click(screen.getByTestId("agent-pairing-connect"));
    expect(onConnect).toHaveBeenCalled();
  });

  /**
   * "Not running" and "not connected" have different fixes. Running the helper is the seller's action for the
   * first; pressing connect is the action for the second, and offering the wrong one is a dead end.
   */
  it.each(["unreachable", "connecting", "connecting_ws", "disconnected"])(
    "asks the seller to start the helper when it cannot be found (%s)",
    async (phase) => {
      const { onRetry, onConnect } = renderPanel(phase);
      expect(screen.getByTestId("agent-pairing")).toHaveTextContent(/도우미를 실행/);
      await userEvent.click(screen.getByTestId("agent-pairing-retry"));
      expect(onRetry).toHaveBeenCalled();
      expect(onConnect).not.toHaveBeenCalled();
    },
  );

  /**
   * The approval happens in the agent's own window on the seller's machine. The panel shows the code to match
   * and nothing else — there is no way to approve from the browser, which is the entire point of the handshake.
   */
  it("shows the confirmation code and no approve button while pairing is pending", () => {
    renderPanel("pairing_pending", { confirmationCode: "482913" });
    expect(screen.getByTestId("agent-pairing-code")).toHaveTextContent("482913");
    expect(screen.queryByTestId("agent-pairing-connect")).toBeNull();
    expect(screen.getByTestId("agent-pairing")).toHaveTextContent(/허용/);
  });

  it("explains a denial and offers to try again", () => {
    renderPanel("pairing_denied");
    expect(screen.getByTestId("agent-pairing")).toHaveTextContent(/거부/);
    expect(screen.getByTestId("agent-pairing-connect")).toBeInTheDocument();
  });

  it("says nothing at all once connected", () => {
    renderPanel("paired");
    expect(screen.queryByTestId("agent-pairing")).toBeNull();
  });

  /** Pairing is not the fix for a version mismatch, so offering it would send the seller down the wrong path. */
  it("stays out of the way when the fix is an update rather than a connection", () => {
    renderPanel("incompatible_version");
    expect(screen.queryByTestId("agent-pairing")).toBeNull();
  });
});
