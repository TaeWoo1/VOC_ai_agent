// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SettingsHome } from "./SettingsHome";
import { expectNoAxeViolations } from "../../test/axe";

const logout = vi.fn();
vi.mock("../../lib/auth", () => ({
  useAuth: () => ({
    user: {
      id: "u1",
      email: "operator@example.test",
      name: "운영자",
      orgId: "o1",
      orgName: "테스트 스토어",
    },
    ready: true,
    login: vi.fn(),
    logout,
  }),
}));

function renderSettings() {
  return render(
    <MemoryRouter>
      <SettingsHome />
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("설정", () => {
  it("shows only facts already in the session", () => {
    renderSettings();
    expect(screen.getByRole("heading", { level: 1, name: "설정" })).toBeInTheDocument();
    expect(screen.getByText("테스트 스토어")).toBeInTheDocument();
    expect(screen.getByText("운영자")).toBeInTheDocument();
    expect(screen.getByText("operator@example.test")).toBeInTheDocument();
  });

  it("states plainly which data the screens are showing", () => {
    vi.stubEnv("VITE_USE_MOCKS", "true");
    renderSettings();
    expect(screen.getByText("데모 데이터")).toBeInTheDocument();
  });

  it("routes to the alert list", () => {
    renderSettings();
    expect(screen.getByRole("link", { name: "알림 보기" })).toHaveAttribute(
      "href",
      "/settings/alerts",
    );
  });

  it("offers the account action", () => {
    renderSettings();
    expect(screen.getByRole("button", { name: "로그아웃" })).toBeInTheDocument();
  });

  it("builds no setting that controls nothing", () => {
    // A switch that flips nothing is a promise the product does not keep. Settings arrive when the
    // capability behind them does.
    const { container } = renderSettings();
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    expect(container.querySelectorAll("select")).toHaveLength(0);
    // The only control is the account action.
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("has no axe violations", async () => {
    const { container } = renderSettings();
    await expectNoAxeViolations(container);
  });
});
