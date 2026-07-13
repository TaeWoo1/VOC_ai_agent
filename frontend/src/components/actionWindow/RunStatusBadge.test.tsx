// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RunStatusBadge } from "./RunStatusBadge";
import { runStatusView } from "../../lib/actionWindow/copy";
import type { RunStatus } from "../../lib/actionWindow/contract";

// Every RunStatus the badge can be handed. Kept explicit (not derived) so a new
// status added to the contract shows up here as a deliberate test update.
const ALL_STATUSES: RunStatus[] = [
  "PREPARING",
  "RUNNING",
  "WAITING_FOR_HUMAN",
  "PAUSED",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
];

describe("FE-11 RunStatusBadge (DOM/a11y)", () => {
  it("renders the FE-owned label for a run status", () => {
    render(<RunStatusBadge status="RUNNING" />);
    expect(screen.getByText(runStatusView("RUNNING").label)).toBeInTheDocument();
  });

  it("renders each run status's FE label (text-only, admin-console chip)", () => {
    for (const status of ALL_STATUSES) {
      const view = runStatusView(status);
      const { unmount } = render(<RunStatusBadge status={status} />);
      expect(screen.getByText(view.label)).toBeInTheDocument();
      unmount();
    }
  });

  it("announces only the label (no decorative glyph node)", () => {
    const { container } = render(<RunStatusBadge status="COMPLETED" />);
    expect(container.querySelector("[aria-hidden='true']")).toBeNull();
    expect(container.textContent).toBe(runStatusView("COMPLETED").label);
  });
});
