// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthCallback, ONBOARDING_PATH } from "./AuthCallback";
import { analytics } from "../lib/analytics";
import { readPendingOnboarding } from "../lib/socialOnboarding";

const acceptSession = vi.fn();
vi.mock("../lib/auth", () => ({
  useAuth: () => ({ user: null, ready: true, login: vi.fn(), signup: vi.fn(), acceptSession, logout: vi.fn() }),
}));
const socialExchange = vi.fn();
vi.mock("../lib/apiClient", () => ({
  api: { socialExchange: (code: string) => socialExchange(code) },
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/" element={<p>홈 화면</p>} />
        <Route path={ONBOARDING_PATH} element={<p>온보딩 화면</p>} />
        <Route path="/login" element={<p>로그인 화면</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.clearAllMocks());

const user = { id: "u-1", email: "a@x.io", name: "A", role: "OWNER", orgId: "o-1", orgName: "스토어" };

/**
 * The URL carries only a one-time code; the JWT arrives in the exchange body and is accepted through the auth
 * context (docs/auth_growth_instrumentation_v1.md §2-1). A first-time identity is parked as a pending
 * onboarding — nothing about it in the URL — and sent to 상호명.
 */
describe("/auth/callback", () => {
  it("exchanges the code, accepts the session, records login(method) and goes 홈", async () => {
    socialExchange.mockResolvedValue({ status: "SIGNED_IN", token: "jwt", user, provider: "google" });
    const before = analytics.emitted.length;
    renderAt("/auth/callback?code=abc");
    await waitFor(() => expect(screen.getByText("홈 화면")).toBeInTheDocument());
    expect(socialExchange).toHaveBeenCalledWith("abc");
    expect(acceptSession).toHaveBeenCalledWith({ token: "jwt", user });
    expect(analytics.emitted.slice(before)).toEqual([{ event: "login", props: { method: "google" } }]);
  });

  it("parks a first-time identity as a pending onboarding (session storage, not URL) and goes to /onboarding", async () => {
    socialExchange.mockResolvedValue({
      status: "ONBOARDING_REQUIRED",
      onboardingToken: "tok",
      provider: "naver",
      email: "b@naver.com",
      name: "B",
    });
    renderAt("/auth/callback?code=xyz");
    await waitFor(() => expect(screen.getByText("온보딩 화면")).toBeInTheDocument());
    expect(readPendingOnboarding()).toEqual({ onboardingToken: "tok", provider: "naver", email: "b@naver.com", name: "B" });
    expect(acceptSession).not.toHaveBeenCalled();
  });

  it("without a code goes back to login, told plainly", async () => {
    renderAt("/auth/callback");
    await waitFor(() => expect(screen.getByText("로그인 화면")).toBeInTheDocument());
    expect(socialExchange).not.toHaveBeenCalled();
  });

  it("a spent or expired code is '다시 로그인', not an error screen", async () => {
    socialExchange.mockRejectedValue({ response: { status: 401 } });
    renderAt("/auth/callback?code=used");
    expect(await screen.findByText(/만료되었거나 이미 사용/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "로그인 화면으로" })).toHaveAttribute("href", "/login");
    expect(acceptSession).not.toHaveBeenCalled();
  });
});
