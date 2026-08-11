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

function renderPanel(
  phase: string,
  extra: {
    confirmationCode?: string | null;
    confirmUrl?: string | null;
    maybeNeedsLocalNetworkAccess?: boolean;
  } = {},
) {
  const onConnect = vi.fn();
  const onRetry = vi.fn();
  render(
    <AgentPairingPanel
      phase={phase}
      confirmationCode={extra.confirmationCode ?? null}
      confirmUrl={extra.confirmUrl ?? null}
      maybeNeedsLocalNetworkAccess={extra.maybeNeedsLocalNetworkAccess}
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
   * A helper that IS running but is blocked by Chrome's Local Network Access permission looks identical to
   * "not running" at the socket layer. When the origin makes that plausible (secure, non-loopback), the panel
   * adds the permission hint on top of the "run the helper" line — otherwise the seller is only ever told to
   * start a helper that is already started.
   */
  it("adds the Local Network Access hint when the browser permission may be blocking the helper", () => {
    renderPanel("unreachable", { maybeNeedsLocalNetworkAccess: true });
    expect(screen.getByTestId("agent-pairing-local-network-hint")).toHaveTextContent(/로컬 네트워크 접근/);
    // The "run the helper" line is still present — the hint is additive, not a replacement.
    expect(screen.getByTestId("agent-pairing")).toHaveTextContent(/도우미를 실행/);
  });

  it("omits the Local Network Access hint when the origin makes a permission block implausible", () => {
    renderPanel("unreachable", { maybeNeedsLocalNetworkAccess: false });
    expect(screen.queryByTestId("agent-pairing-local-network-hint")).toBeNull();
  });

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

  /**
   * The client already opens the approval page on the seller's click, but a browser can block that tab and the
   * seller is then waiting on a window that never appeared. The link is the recovery — without it the only way
   * back is a URL nobody in the product ever sees.
   */
  it("keeps the approval page reachable while pairing is pending", () => {
    const url = "http://127.0.0.1:47615/bridge/confirm?requestId=r1";
    renderPanel("pairing_pending", { confirmationCode: "482913", confirmUrl: url });
    const link = screen.getByTestId("agent-pairing-confirm-link");
    expect(link).toHaveAttribute("href", url);
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("offers no approval link when the agent gave no usable one", () => {
    renderPanel("pairing_pending", { confirmationCode: "482913" });
    expect(screen.queryByTestId("agent-pairing-confirm-link")).toBeNull();
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
