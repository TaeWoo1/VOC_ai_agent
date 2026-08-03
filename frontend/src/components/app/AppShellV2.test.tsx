// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AppShellV2 } from "./AppShellV2";
import { AppProviders } from "./AppProviders";
import { AuthProvider } from "../../lib/auth";
import { NAV_ITEMS, MOBILE_TABS } from "../../lib/nav.v2";
import { expectNoAxeViolations } from "../../test/axe";

function renderShell(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <AppProviders>
          <Routes>
            <Route element={<AppShellV2 />}>
              <Route path="*" element={<p>페이지 내용</p>} />
            </Route>
          </Routes>
        </AppProviders>
      </AuthProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("AppShellV2 — navigation surfaces", () => {
  it("renders the side nav from the shared model", () => {
    renderShell();
    const sideNav = screen.getByRole("navigation", { name: "주 메뉴" });
    for (const item of NAV_ITEMS) {
      expect(within(sideNav).getByRole("link", { name: item.label })).toHaveAttribute(
        "href",
        item.to,
      );
    }
  });

  it("renders exactly five mobile targets: four destinations and 더보기", () => {
    renderShell();
    const bar = screen.getByRole("navigation", { name: "모바일 메뉴" });
    const links = within(bar).getAllByRole("link");
    expect(links).toHaveLength(MOBILE_TABS.length);
    expect(links.map((link) => link.getAttribute("href"))).toEqual(
      MOBILE_TABS.map((tab) => tab.to),
    );
    expect(within(bar).getByRole("button", { name: "더보기" })).toBeInTheDocument();
  });

  it("never exposes the operations agent as a destination", () => {
    const { container } = renderShell();
    const navHrefs = Array.from(container.querySelectorAll("nav a")).map((a) =>
      a.getAttribute("href"),
    );
    expect(navHrefs).not.toContain("/agent");
  });

  it("renders the page body through the outlet", () => {
    renderShell();
    expect(screen.getByText("페이지 내용")).toBeInTheDocument();
  });
});

describe("AppShellV2 — 더보기 drawer", () => {
  it("opens on demand and covers every destination", async () => {
    const user = userEvent.setup();
    renderShell();
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(screen.getByRole("button", { name: "더보기" }));
    const drawer = screen.getByRole("dialog", { name: "전체 메뉴" });
    // The drawer shows the WHOLE model, not just the items the tab bar left out.
    for (const item of NAV_ITEMS) {
      expect(within(drawer).getByRole("link", { name: item.label })).toBeInTheDocument();
    }
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByRole("button", { name: "더보기" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("moves focus into the drawer when it opens", async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByRole("button", { name: "더보기" }));
    expect(screen.getByRole("button", { name: "닫기" })).toHaveFocus();
  });
});

describe("AppShellV2 — demo notice", () => {
  it("shows the demo-data notice on app screens when running on seeded data", () => {
    vi.stubEnv("VITE_USE_MOCKS", "true");
    renderShell();
    expect(screen.getByLabelText("데모 모드 안내")).toBeInTheDocument();
  });

  it("shows nothing when not on demo data", () => {
    vi.stubEnv("VITE_USE_MOCKS", "false");
    renderShell();
    expect(screen.queryByLabelText("데모 모드 안내")).toBeNull();
  });
});

describe("AppShellV2 — accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = renderShell();
    await expectNoAxeViolations(container);
  });
});
