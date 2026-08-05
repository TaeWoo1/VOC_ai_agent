// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "./App";
import appSource from "./App.tsx?raw";
import { AuthProvider } from "./lib/auth";

// `AuthProvider` clears the token if the session read fails, which would bounce every
// authenticated assertion to /login. Only that one call is replaced; routing, guards and pages are
// the real thing.
vi.mock("./lib/apiClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/apiClient")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getMe: async () => ({
        id: "user-1",
        email: "operator@example.test",
        name: "운영자",
        orgId: "org-1",
        orgName: "테스트 스토어",
      }),
    },
  };
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.setItem("sellerops_token", "test-token");
});

afterEach(() => {
  localStorage.clear();
  vi.unstubAllEnvs();
});

// Only routes whose targets make no network calls are rendered here. The full legacy mapping is
// covered exhaustively — and deterministically — by `lib/legacyRoutes.test.ts`; mounting pages
// that fetch would make this file a slow, flaky duplicate of tests those pages already own.
describe("v2 app routes", () => {
  for (const [path, heading] of [
    // The menu item is 운영 홈; the page's own headline is the question it answers.
    ["/", "오늘 확인할 고객 신호"],
    ["/inbox", "고객 인박스"],
    ["/memory", "고객운영 메모리"],
    ["/reports", "주간 고객운영 리포트"],
    ["/connect", "채널·자료 연결"],
    ["/settings", "설정"],
  ] as const) {
    it(`renders ${heading} at ${path}`, async () => {
      renderAt(path);
      expect(await screen.findByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
    });
  }

  it("mounts the v2 shell around app pages", async () => {
    renderAt("/");
    await screen.findByRole("heading", { level: 1, name: "오늘 확인할 고객 신호" });
    expect(screen.getByRole("navigation", { name: "주 메뉴" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "모바일 메뉴" })).toBeInTheDocument();
  });
});

describe("legacy routes — live behaviour", () => {
  for (const [from, heading] of [
    ["/issues", "고객운영 메모리"],
    ["/inquiries", "고객 인박스"],
    ["/settings/channels", "채널·자료 연결"],
    // The separate channel list folded into the hub in Slice 6.
    ["/connect/channels", "채널·자료 연결"],
    ["/channels", "채널·자료 연결"],
  ] as const) {
    it(`${from} lands on ${heading}`, async () => {
      renderAt(from);
      expect(await screen.findByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
    });
  }
});

describe("the operations agent", () => {
  it("keeps its route while leaving the menu", () => {
    // Asserted at the source level: mounting the agent console would pull in its runtime client,
    // and what matters here is that the route was not deleted along with the menu entry.
    expect(appSource).toContain('path="/agent"');
  });
});

describe("unknown paths", () => {
  it("render a real 404 rather than a silent redirect", async () => {
    renderAt("/does-not-exist");
    expect(await screen.findByText("페이지를 찾을 수 없습니다")).toBeInTheDocument();
  });
});
