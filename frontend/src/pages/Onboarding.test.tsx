// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Onboarding } from "./Onboarding";
import { FIRST_RUN_PATH } from "./Signup";
import { analytics } from "../lib/analytics";
import { readPendingOnboarding, savePendingOnboarding } from "../lib/socialOnboarding";
import { expectNoAxeViolations } from "../test/axe";

const acceptSession = vi.fn();
vi.mock("../lib/auth", () => ({
  useAuth: () => ({ user: null, ready: true, login: vi.fn(), signup: vi.fn(), acceptSession, logout: vi.fn() }),
}));
const complete = vi.fn();
vi.mock("../lib/apiClient", () => ({
  api: { socialOnboardingComplete: (input: unknown) => complete(input) },
}));

function renderOnboarding() {
  return render(
    <MemoryRouter initialEntries={["/onboarding"]}>
      <Routes>
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path={FIRST_RUN_PATH} element={<p>채널 연결 화면</p>} />
        <Route path="/signup" element={<p>계정 만들기 화면</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const pending = { onboardingToken: "tok-1", provider: "google", email: "a@gmail.com", name: "A" };
const session = {
  token: "jwt",
  user: { id: "u", email: "a@gmail.com", name: "A", role: "OWNER", orgId: "o", orgName: "우리 스토어" },
};

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.clearAllMocks());

/**
 * No user without an org (docs/auth_growth_instrumentation_v1.md §2-3): the only thing this screen asks is
 * 상호명; the backend creates org + user + identity together and answers a session; the first-run journey
 * continues at 채널 연결.
 */
describe("/onboarding", () => {
  it("asks 상호명 with the name prefilled, completes, accepts the session, records sign_up + onboarding events", async () => {
    savePendingOnboarding(pending);
    complete.mockResolvedValue(session);
    const before = analytics.emitted.length;
    renderOnboarding();
    expect(screen.getByRole("status")).toHaveTextContent("Google 계정 · a@gmail.com");
    expect(screen.getByLabelText("이름")).toHaveValue("A");
    fireEvent.change(screen.getByLabelText(/상호/), { target: { value: " 우리 스토어 " } });
    // 필수 consent first (docs/service_readiness_v1.md §2-4): the checkbox is `required` (browser-blocked) and the
    // form's own guard says the same thing.
    fireEvent.submit(screen.getByRole("form", { name: "가입 마무리" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("동의");
    expect(complete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText(/\(필수\)/));
    fireEvent.click(screen.getByRole("button", { name: "시작하기" }));
    await waitFor(() => expect(screen.getByText("채널 연결 화면")).toBeInTheDocument());
    expect(complete).toHaveBeenCalledWith({
      onboardingToken: "tok-1", orgName: "우리 스토어", name: "A", termsAccepted: true, marketingConsent: false,
    });
    expect(acceptSession).toHaveBeenCalledWith(session);
    expect(readPendingOnboarding()).toBeNull();
    expect(analytics.emitted.slice(before)).toEqual([
      { event: "onboarding_started", props: {} },
      { event: "sign_up", props: { method: "google" } },
      { event: "onboarding_completed", props: {} },
    ]);
  });

  it("with nothing pending there is nothing to do here → /signup", async () => {
    renderOnboarding();
    await waitFor(() => expect(screen.getByText("계정 만들기 화면")).toBeInTheDocument());
  });

  it("an expired onboarding token is explained and cleared, never a raw error", async () => {
    savePendingOnboarding(pending);
    complete.mockRejectedValue({ response: { status: 401 } });
    renderOnboarding();
    fireEvent.change(screen.getByLabelText(/상호/), { target: { value: "스토어" } });
    fireEvent.click(screen.getByLabelText(/\(필수\)/));
    fireEvent.click(screen.getByRole("button", { name: "시작하기" }));
    expect(await screen.findByText("가입 세션이 만료되었어요")).toBeInTheDocument();
    expect(readPendingOnboarding()).toBeNull();
    expect(acceptSession).not.toHaveBeenCalled();
  });

  it("an email collision at completion is the backend's sentence (fail closed), and the form stays", async () => {
    savePendingOnboarding(pending);
    complete.mockRejectedValue({ response: { status: 409, data: { message: "이미 가입된 이메일입니다. 이메일과 비밀번호로 로그인해 주세요." } } });
    renderOnboarding();
    fireEvent.change(screen.getByLabelText(/상호/), { target: { value: "스토어" } });
    fireEvent.click(screen.getByLabelText(/\(필수\)/));
    fireEvent.click(screen.getByRole("button", { name: "시작하기" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("이미 가입된 이메일");
    expect(acceptSession).not.toHaveBeenCalled();
  });

  it("is accessible", async () => {
    savePendingOnboarding(pending);
    renderOnboarding();
    await expectNoAxeViolations(document.body);
  });
});
