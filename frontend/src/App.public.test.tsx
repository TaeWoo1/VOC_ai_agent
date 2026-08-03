// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "./App";
import { AuthProvider } from "./lib/auth";

// Public-surface routing. The point of this file is the boundary itself: a visitor with no token
// must reach the product page, and must NOT reach any app route.
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
  localStorage.clear();
});

describe("public routes — reachable without a token", () => {
  it("renders the product page at /product", async () => {
    renderAt("/product");
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("채널은 늘었는데");
  });

  it("normalizes unknown /product/* paths to the product page", async () => {
    renderAt("/product/features/anything");
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("채널은 늘었는데");
  });

  it("renders the login page inside the public shell", async () => {
    renderAt("/login");
    expect(await screen.findByLabelText("이메일")).toBeInTheDocument();
    // The public chrome is present, so a visitor can get back to the product page.
    expect(screen.getByRole("link", { name: "제품 소개 보기" })).toHaveAttribute("href", "/product");
  });

  it("shows the demo notice only for the demo entry", async () => {
    renderAt("/login?demo=1");
    expect(await screen.findByText("데모 계정으로 둘러보는 중입니다")).toBeInTheDocument();
  });

  it("omits the demo notice on a plain login", async () => {
    renderAt("/login");
    await screen.findByLabelText("이메일");
    expect(screen.queryByText("데모 계정으로 둘러보는 중입니다")).toBeNull();
  });
});

describe("app routes — closed without a token", () => {
  for (const path of ["/", "/inbox", "/orders", "/settings/channels"]) {
    it(`sends an unauthenticated visitor from ${path} to the login page`, async () => {
      renderAt(path);
      expect(await screen.findByLabelText("이메일")).toBeInTheDocument();
    });
  }
});
