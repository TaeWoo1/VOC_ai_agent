// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Signup, FIRST_RUN_PATH } from "./Signup";
import { Login } from "./Login";
import { signupFailure, SIGNUP_FAILURE_COPY } from "../lib/signupError";
import { expectNoAxeViolations } from "../test/axe";

const signup = vi.fn();
vi.mock("../lib/auth", () => ({
  useAuth: () => ({ user: null, ready: true, login: vi.fn(), signup, logout: vi.fn() }),
}));

function renderSignup() {
  return render(
    <MemoryRouter initialEntries={["/signup"]}>
      <Routes>
        <Route path="/signup" element={<Signup />} />
        <Route path={FIRST_RUN_PATH} element={<p>채널 연결 화면</p>} />
        <Route path="/login" element={<Login />} />
      </Routes>
    </MemoryRouter>,
  );
}

function fill() {
  fireEvent.change(screen.getByLabelText(/상호/), { target: { value: "테스트 스토어" } });
  fireEvent.change(screen.getByLabelText("이름"), { target: { value: "판매자" } });
  fireEvent.change(screen.getByLabelText("이메일"), { target: { value: "seller@example.test" } });
  fireEvent.change(screen.getByLabelText(/비밀번호/), { target: { value: "secret123" } });
}

afterEach(() => vi.clearAllMocks());

/**
 * Self-Pilot first-run UX: 가입 → 채널 연결 → 첫 수집 → 홈. Sign-up is the existing POST /api/auth/signup
 * (through the auth context), ends signed in, and lands on 채널 연결 — the one thing a fresh org can do.
 */
describe("회원가입", () => {
  it("submits the four backend fields and lands on 채널 연결", async () => {
    signup.mockResolvedValue(undefined);
    renderSignup();
    fill();
    fireEvent.click(screen.getByRole("button", { name: "계정 만들기" }));
    await waitFor(() => expect(screen.getByText("채널 연결 화면")).toBeInTheDocument());
    expect(signup).toHaveBeenCalledWith({
      email: "seller@example.test",
      password: "secret123",
      name: "판매자",
      orgName: "테스트 스토어",
    });
  });

  it("refuses a short password before calling the backend", async () => {
    renderSignup();
    fill();
    fireEvent.change(screen.getByLabelText(/비밀번호/), { target: { value: "abc" } });
    fireEvent.submit(screen.getByRole("form", { name: "회원가입" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("6자 이상");
    expect(signup).not.toHaveBeenCalled();
  });

  it("says the email is taken on a 409 and never blames the connection", async () => {
    signup.mockRejectedValue({ response: { status: 409, data: { message: "이미 등록된 이메일입니다." } } });
    renderSignup();
    fill();
    fireEvent.click(screen.getByRole("button", { name: "계정 만들기" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(SIGNUP_FAILURE_COPY.EMAIL_TAKEN);
  });

  it("links to login and back, and is accessible", async () => {
    renderSignup();
    expect(screen.getByRole("link", { name: "로그인" })).toHaveAttribute("href", "/login");
    await expectNoAxeViolations(document.body);
    fireEvent.click(screen.getByRole("link", { name: "로그인" }));
    // The login form starts EMPTY for a real seller (demo prefill only under ?demo=1) and links to sign-up.
    expect(screen.getByLabelText("이메일")).toHaveValue("");
    expect(screen.getByRole("link", { name: "계정 만들기" })).toHaveAttribute("href", "/signup");
  });
});

describe("signupFailure", () => {
  it("separates no-answer from the server's answer", () => {
    expect(signupFailure(new Error("Network Error"))).toEqual({ message: SIGNUP_FAILURE_COPY.UNREACHABLE, input: false });
    expect(signupFailure({ response: { status: 409 } })).toEqual({ message: SIGNUP_FAILURE_COPY.EMAIL_TAKEN, input: true });
    expect(signupFailure({ response: { status: 400, data: { message: "email: 올바른 형식의 이메일 주소여야 합니다" } } }).message)
        .toBe("email: 올바른 형식의 이메일 주소여야 합니다");
    expect(signupFailure({ response: { status: 400 } })).toEqual({ message: SIGNUP_FAILURE_COPY.INVALID, input: true });
    expect(signupFailure({ response: { status: 502 } })).toEqual({ message: SIGNUP_FAILURE_COPY.SERVER, input: false });
  });
});
