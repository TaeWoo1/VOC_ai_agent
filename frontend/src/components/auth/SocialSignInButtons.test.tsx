// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { SocialSignInButtons, SOCIAL_AUTHORIZE_PATH } from "./SocialSignInButtons";
import { Login, SOCIAL_NOTICE } from "../../pages/Login";
import { expectNoAxeViolations } from "../../test/axe";

const socialProviders = vi.fn();
vi.mock("../../lib/apiClient", () => ({
  api: { socialProviders: () => socialProviders() },
}));
vi.mock("../../lib/auth", () => ({
  useAuth: () => ({ user: null, ready: true, login: vi.fn(), signup: vi.fn(), acceptSession: vi.fn(), logout: vi.fn() }),
}));

afterEach(() => vi.clearAllMocks());

/**
 * A button exists only for a provider the backend says is configured, and it is a plain full-page link to
 * Spring Security's authorize endpoint on the same origin (docs/auth_growth_instrumentation_v1.md §4).
 */
describe("SocialSignInButtons", () => {
  it("renders Google and NAVER as authorize links when both are configured", async () => {
    socialProviders.mockResolvedValue({ google: true, naver: true });
    render(<SocialSignInButtons intent="login" />);
    const google = await screen.findByRole("link", { name: "Google 계정으로 로그인" });
    expect(google).toHaveAttribute("href", `${SOCIAL_AUTHORIZE_PATH}/google`);
    expect(screen.getByRole("link", { name: "네이버 로그인" })).toHaveAttribute("href", `${SOCIAL_AUTHORIZE_PATH}/naver`);
    expect(screen.getByText("또는 이메일로")).toBeInTheDocument();
    await expectNoAxeViolations(document.body);
  });

  it("renders only the configured provider, with sign-up wording on /signup", async () => {
    socialProviders.mockResolvedValue({ google: true, naver: false });
    render(<SocialSignInButtons intent="signup" />);
    expect(await screen.findByRole("link", { name: "Google 계정으로 가입" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /네이버/ })).toBeNull();
  });

  it("renders nothing when no provider is configured or the read fails", async () => {
    socialProviders.mockResolvedValue({ google: false, naver: false });
    const { unmount } = render(<SocialSignInButtons intent="login" />);
    await waitFor(() => expect(socialProviders).toHaveBeenCalled());
    expect(screen.queryByTestId("social-sign-in")).toBeNull();
    unmount();
    socialProviders.mockRejectedValue(new Error("Network Error"));
    render(<SocialSignInButtons intent="login" />);
    await waitFor(() => expect(socialProviders).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("social-sign-in")).toBeNull();
  });
});

describe("/login social outcome notices", () => {
  it("explains the fail-closed email collision and points at the email form", async () => {
    socialProviders.mockResolvedValue({ google: false, naver: false });
    render(
      <MemoryRouter initialEntries={["/login?social=email_taken"]}>
        <Routes>
          <Route path="/login" element={<Login />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole("status")).toHaveTextContent(SOCIAL_NOTICE.email_taken.title);
    expect(screen.getByRole("status")).toHaveTextContent("자동 연결하지 않았습니다");
    expect(screen.getByLabelText("이메일")).toHaveValue("");
    await expectNoAxeViolations(document.body);
  });

  it("ignores an unknown social value", () => {
    socialProviders.mockResolvedValue({ google: false, naver: false });
    render(
      <MemoryRouter initialEntries={["/login?social=whatever"]}>
        <Routes>
          <Route path="/login" element={<Login />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.queryByRole("status")).toBeNull();
  });
});
