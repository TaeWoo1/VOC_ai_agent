// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * <b>The login form is prefilled only where the account exists</b> — Pilot Runtime Foundation v1
 * §2 / §15-C. The `?demo=1` entry is not, by itself, permission to type somebody's credentials
 * into a form: the deployment has to be one that created that account.
 */
const state = { value: null as boolean | null };
vi.mock("../hooks/useDemoEntry", () => ({ useDemoEntry: () => state.value }));
vi.mock("../lib/apiClient", async (orig) => {
  const mod = await orig<typeof import("../lib/apiClient")>();
  return {
    ...mod,
    api: {
      ...mod.api,
      passwordResetConfig: () => Promise.resolve({ enabled: false, devOutbox: false }),
      socialProviders: () => Promise.resolve([]),
    },
  };
});

import { Login } from "./Login";
import { AuthProvider } from "../lib/auth";

function renderLogin(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Login />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("§15-C — the demo prefill follows the deployment", () => {
  it("a demo deployment prefills the fixture account and says so", async () => {
    state.value = true;
    renderLogin("/login?demo=1");
    expect(await screen.findByText("데모 계정으로 둘러보는 중입니다")).toBeInTheDocument();
    expect(screen.getByLabelText("이메일")).toHaveValue("demo@sellerops.ai");
  });

  it("a pilot deployment prefills nothing, even on the demo entry", async () => {
    state.value = false;
    renderLogin("/login?demo=1");
    expect(await screen.findByLabelText("이메일")).toHaveValue("");
    expect(screen.getByLabelText("비밀번호")).toHaveValue("");
    // The notice claims the form is filled in, so it may not appear where it is not.
    expect(screen.queryByText("데모 계정으로 둘러보는 중입니다")).toBeNull();
  });

  it("and an unanswered deployment prefills nothing", async () => {
    state.value = null;
    renderLogin("/login?demo=1");
    expect(await screen.findByLabelText("이메일")).toHaveValue("");
  });
});
