// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { BottomTabBar } from "./BottomTabBar";
import { expectNoAxeViolations } from "../test/axe";

// Control the shared open-alert count without the provider/api round-trip.
const alertsMock = vi.hoisted(() => ({ openCount: 0 }));
vi.mock("../lib/openAlerts", () => ({
  useOpenAlerts: () => ({
    openCount: alertsMock.openCount,
    refresh: async () => {},
    syncOpenCount: () => {},
  }),
}));

function renderBar(onMore = () => {}) {
  return render(
    <MemoryRouter>
      <BottomTabBar onMore={onMore} />
    </MemoryRouter>,
  );
}

describe("BottomTabBar (mobile primary nav)", () => {
  it("renders the curated frontstage tabs pointing at the same routes", () => {
    alertsMock.openCount = 0;
    renderBar();
    expect(screen.getByRole("link", { name: /홈/ })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: /주문/ })).toHaveAttribute("href", "/orders");
    expect(screen.getByRole("link", { name: /리뷰/ })).toHaveAttribute("href", "/operations");
    expect(screen.getByRole("link", { name: /알림/ })).toHaveAttribute("href", "/settings/alerts");
  });

  it("opens the full-nav drawer via the 더보기 button (not a route)", async () => {
    alertsMock.openCount = 0;
    const onMore = vi.fn();
    renderBar(onMore);
    const more = screen.getByRole("button", { name: "더보기" });
    expect(more).toHaveAttribute("aria-haspopup", "dialog");
    await userEvent.click(more);
    expect(onMore).toHaveBeenCalledTimes(1);
  });

  it("shows the open-alert count on the 알림 tab only when > 0", () => {
    alertsMock.openCount = 0;
    const first = renderBar();
    // Icon is aria-hidden (no text), so with no alerts the tab reads just its label.
    expect(screen.getByRole("link", { name: /알림/ })).toHaveTextContent(/^알림$/);
    first.unmount();

    alertsMock.openCount = 3;
    renderBar();
    expect(screen.getByRole("link", { name: /알림/ })).toHaveTextContent("3");
  });

  it("has no axe violations", async () => {
    alertsMock.openCount = 2;
    const { container } = renderBar();
    await expectNoAxeViolations(container);
  });
});
