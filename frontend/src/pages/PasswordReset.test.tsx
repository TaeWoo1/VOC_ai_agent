// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Login } from "./Login";
import { ForgotPassword, FORGOT_SENT_TITLE } from "./ForgotPassword";
import { ResetPassword, RESET_DONE_PATH } from "./ResetPassword";
import { LegalPlaceholder } from "./LegalPlaceholder";
import { expectNoAxeViolations } from "../test/axe";

const passwordResetConfig = vi.fn();
const forgotPassword = vi.fn();
const resetPassword = vi.fn();
vi.mock("../lib/apiClient", () => ({
  api: {
    socialProviders: async () => ({ google: false, naver: false }),
    passwordResetConfig: () => passwordResetConfig(),
    forgotPassword: (email: string) => forgotPassword(email),
    resetPassword: (token: string, pw: string) => resetPassword(token, pw),
  },
}));
vi.mock("../lib/auth", () => ({
  useAuth: () => ({ user: null, ready: true, login: vi.fn(), signup: vi.fn(), acceptSession: vi.fn(), logout: vi.fn() }),
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/legal/terms" element={<LegalPlaceholder kind="terms" />} />
        <Route path="/legal/privacy" element={<LegalPlaceholder kind="privacy" />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => vi.clearAllMocks());

/** docs/service_readiness_v1.md §6 — the reset lifecycle as the seller sees it. */
describe("password reset", () => {
  it("/login shows the reset entry only when a mailed link can reach someone", async () => {
    passwordResetConfig.mockResolvedValue({ enabled: false, devOutbox: false });
    const { unmount } = renderAt("/login");
    await waitFor(() => expect(passwordResetConfig).toHaveBeenCalled());
    expect(screen.queryByRole("link", { name: "비밀번호를 잊으셨나요?" })).toBeNull();
    unmount();
    passwordResetConfig.mockResolvedValue({ enabled: true, devOutbox: false });
    renderAt("/login");
    expect(await screen.findByRole("link", { name: "비밀번호를 잊으셨나요?" })).toHaveAttribute("href", "/forgot-password");
  });

  it("/login?reset=1 confirms the change", () => {
    passwordResetConfig.mockResolvedValue({ enabled: true, devOutbox: false });
    renderAt("/login?reset=1");
    expect(screen.getByRole("status")).toHaveTextContent("비밀번호가 바뀌었어요");
  });

  it("/forgot-password says the same sentence for any address, and names the dev outbox when that is where mail goes", async () => {
    passwordResetConfig.mockResolvedValue({ enabled: true, devOutbox: true });
    forgotPassword.mockResolvedValue(undefined);
    renderAt("/forgot-password");
    fireEvent.change(screen.getByLabelText("이메일"), { target: { value: " nobody@x.io " } });
    fireEvent.click(screen.getByRole("button", { name: "재설정 링크 보내기" }));
    expect(await screen.findByText(FORGOT_SENT_TITLE)).toBeInTheDocument();
    expect(forgotPassword).toHaveBeenCalledWith("nobody@x.io");
    expect(await screen.findByText(/개발 모드: 메일은 backend 로그에 출력됩니다/)).toBeInTheDocument();
    await expectNoAxeViolations(document.body);
  });

  it("/reset-password reads the token once, strips it from the URL, and lands on /login?reset=1", async () => {
    resetPassword.mockResolvedValue(undefined);
    passwordResetConfig.mockResolvedValue({ enabled: true, devOutbox: false });
    renderAt("/reset-password?token=ONE-TIME");
    fireEvent.change(screen.getByLabelText(/새 비밀번호 \(6자 이상\)/), { target: { value: "newpass1" } });
    fireEvent.change(screen.getByLabelText("새 비밀번호 확인"), { target: { value: "newpass2" } });
    fireEvent.click(screen.getByRole("button", { name: "비밀번호 변경" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("서로 달라요");
    expect(resetPassword).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("새 비밀번호 확인"), { target: { value: "newpass1" } });
    fireEvent.click(screen.getByRole("button", { name: "비밀번호 변경" }));
    await waitFor(() => expect(resetPassword).toHaveBeenCalledWith("ONE-TIME", "newpass1"));
    expect(await screen.findByText("비밀번호가 바뀌었어요")).toBeInTheDocument();
    expect(RESET_DONE_PATH).toBe("/login?reset=1");
  });

  it("/reset-password: a spent link (401) and a missing token both explain and offer a new request", async () => {
    resetPassword.mockRejectedValue({ response: { status: 401 } });
    renderAt("/reset-password?token=SPENT");
    fireEvent.change(screen.getByLabelText(/새 비밀번호 \(6자 이상\)/), { target: { value: "newpass1" } });
    fireEvent.change(screen.getByLabelText("새 비밀번호 확인"), { target: { value: "newpass1" } });
    fireEvent.click(screen.getByRole("button", { name: "비밀번호 변경" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("만료되었거나 이미 사용");
    expect(screen.getByRole("link", { name: "재설정 링크 다시 요청" })).toHaveAttribute("href", "/forgot-password");
  });

  it("/reset-password without a token is the same dead-link screen", () => {
    renderAt("/reset-password");
    expect(screen.getByRole("alert")).toHaveTextContent("만료되었거나 이미 사용");
  });
});

/** docs/service_readiness_v1.md §2-4 / §7: the legal pages are placeholders — no invented legal wording. */
describe("legal placeholders", () => {
  it("say the document is not confirmed and carry the draft version", () => {
    renderAt("/legal/privacy");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("개인정보처리방침");
    expect(screen.getByRole("status")).toHaveTextContent("아직 확정되지 않았습니다");
    expect(screen.getByRole("status")).toHaveTextContent("draft-2026-08");
    expect(document.body.textContent).not.toMatch(/제\s*\d+\s*조/); // no article-style legal text
  });
});
