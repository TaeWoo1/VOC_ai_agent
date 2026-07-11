// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConnectionBanner } from "./ConnectionBanner";
import { CONNECTION_VIEW } from "../../lib/actionWindow/copy";

/** FE-6: the offline/reconnecting banner is the first genuinely DOM-interactive
 *  surface (the FE-4 manual reconnect button + a polite live region). These tests
 *  render it and assert the rendered DOM/aria that the node-env store tests can't. */
describe("FE-6 ConnectionBanner (DOM/a11y)", () => {
  it("renders nothing when the connection is healthy", () => {
    const { container } = render(<ConnectionBanner connection="connected" />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("reconnecting: a polite status region, its copy, and no reconnect button", () => {
    render(<ConnectionBanner connection="reconnecting" onReconnect={() => {}} />);
    const region = screen.getByRole("status");
    expect(region).toBeInTheDocument();
    expect(region).toHaveTextContent(CONNECTION_VIEW.reconnecting.title);
    expect(region).toHaveTextContent(CONNECTION_VIEW.reconnecting.body);
    // reconnecting has no manual action — the transport is still auto-retrying.
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offline: shows the status region and its copy", () => {
    render(<ConnectionBanner connection="offline" onReconnect={() => {}} />);
    const region = screen.getByRole("status");
    expect(region).toHaveTextContent(CONNECTION_VIEW.offline.title);
    expect(region).toHaveTextContent(CONNECTION_VIEW.offline.body);
  });

  it("offline without onReconnect (fixture/simulated preview): no button to press", () => {
    render(<ConnectionBanner connection="offline" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offline + onReconnect: renders the reconnect button with its label", () => {
    render(<ConnectionBanner connection="offline" onReconnect={() => {}} />);
    const button = screen.getByRole("button", { name: new RegExp(CONNECTION_VIEW.offline.action!) });
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute("aria-busy", "false");
  });

  it("retryPending: the button is disabled, aria-busy, and shows the pending label", () => {
    render(<ConnectionBanner connection="offline" retryPending onReconnect={() => {}} />);
    const button = screen.getByRole("button", {
      name: new RegExp(CONNECTION_VIEW.offline.actionPending!),
    });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it("clicking the reconnect button fires onReconnect exactly once", async () => {
    const onReconnect = vi.fn();
    render(<ConnectionBanner connection="offline" onReconnect={onReconnect} />);
    await userEvent.click(screen.getByRole("button"));
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it("a disabled (retryPending) button does not fire onReconnect when clicked", async () => {
    const onReconnect = vi.fn();
    render(<ConnectionBanner connection="offline" retryPending onReconnect={onReconnect} />);
    await userEvent.click(screen.getByRole("button"));
    expect(onReconnect).not.toHaveBeenCalled();
  });
});
