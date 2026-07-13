// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RecentActivityList } from "./RecentActivityList";
import {
  channelLabel,
  resolveCopy,
  runStatusView,
  SECTION_TITLE,
} from "../../lib/actionWindow/copy";
import { shortDate } from "../../lib/format";
import type { RecentRunItem } from "../../lib/actionWindow/homeFixtures";

// Synthetic terminal-run items (one COMPLETED, one FAILED) — sanitized fields only.
const items: RecentRunItem[] = [
  {
    runId: "run_test_completed",
    runCopyKey: "actionWindow.review.run",
    channelCode: "esm_plus",
    status: "COMPLETED",
    completedSteps: 4,
    totalSteps: 4,
    finishedAt: "2026-07-05T09:12:00Z",
  },
  {
    runId: "run_test_failed",
    runCopyKey: "actionWindow.review.run",
    channelCode: "esm_plus",
    status: "FAILED",
    completedSteps: 3,
    totalSteps: 4,
    finishedAt: "2026-07-03T14:40:00Z",
  },
];

describe("FE-11 RecentActivityList (DOM/a11y)", () => {
  it("shows the empty message and no rows when there is no finished run", () => {
    render(<RecentActivityList items={[]} />);
    const region = screen.getByRole("region", { name: SECTION_TITLE.recentActivity });
    expect(region).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: SECTION_TITLE.recentActivity }),
    ).toBeInTheDocument();
    expect(region).toHaveTextContent("아직 완료된 작업이 없어요.");
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("renders one row per finished run with its FE-owned copy", () => {
    render(<RecentActivityList items={items} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(items.length);
    const region = screen.getByRole("region", { name: SECTION_TITLE.recentActivity });
    for (const item of items) {
      expect(region).toHaveTextContent(resolveCopy(item.runCopyKey));
      expect(region).toHaveTextContent(channelLabel(item.channelCode));
      expect(region).toHaveTextContent(runStatusView(item.status).label);
      // shortDate is imported (not hardcoded) so the assertion is timezone-stable.
      expect(region).toHaveTextContent(shortDate(item.finishedAt));
    }
    expect(region).toHaveTextContent(
      `${items[0].completedSteps} / ${items[0].totalSteps}`,
    );
  });

  it("shows each run's status as a text label (no decorative glyph)", () => {
    const { container } = render(<RecentActivityList items={items} />);
    expect(screen.getByText(runStatusView("COMPLETED").label)).toBeInTheDocument();
    expect(screen.getByText(runStatusView("FAILED").label)).toBeInTheDocument();
    // The status glyph span was removed — only nav/section icons remain elsewhere.
    expect(container.querySelector("[aria-hidden='true']")).toBeNull();
  });
});
