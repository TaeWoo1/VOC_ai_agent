/**
 * The login form's honesty about whose problem a failure is.
 *
 * Pinned because the alternative was measured: on the 2026-07-25 live run the form reported "이메일 또는
 * 비밀번호를 확인해 주세요" for a request that never reached the backend (first an env var vite never read, then a
 * CORS origin allowing `localhost` while the browser was on `127.0.0.1`), and most of an hour went into checking
 * credentials that were correct the whole time.
 */
import { describe, expect, it } from "vitest";
import { LOGIN_FAILURE_COPY, loginFailure } from "./loginError";

describe("loginFailure", () => {
  it("blames the credentials only when the server actually rejected them", () => {
    for (const status of [401, 403]) {
      const failure = loginFailure({ response: { status } });
      expect(failure.credentials, String(status)).toBe(true);
      expect(failure.message).toBe(LOGIN_FAILURE_COPY.CREDENTIALS);
    }
  });

  /**
   * The case that mattered. No response means nothing answered — API down, wrong base URL, or an origin the
   * backend does not allow. A browser cannot tell those apart (a CORS rejection is opaque to scripts by design),
   * so the copy names the class of problem rather than guessing a member of it.
   */
  it.each([
    ["a bare network error", new Error("Network Error")],
    ["an axios error with no response", { message: "Network Error", isAxiosError: true }],
    ["a response with no status", { response: {} }],
    ["nothing at all", undefined],
    ["null", null],
    ["a string", "boom"],
  ])("reports %s as a connection problem, never as a wrong password", (_label, error) => {
    const failure = loginFailure(error);
    expect(failure.credentials).toBe(false);
    expect(failure.message).toBe(LOGIN_FAILURE_COPY.UNREACHABLE);
    expect(failure.message).not.toMatch(/비밀번호/);
  });

  it("reports a server fault as ours rather than the seller's", () => {
    for (const status of [500, 502, 503]) {
      const failure = loginFailure({ response: { status } });
      expect(failure.credentials, String(status)).toBe(false);
      expect(failure.message).toBe(LOGIN_FAILURE_COPY.SERVER);
    }
  });

  /** No status code, URL, origin, or stack ever reaches the screen. The distinction is the point, not the detail. */
  it("never surfaces a diagnostic detail to the seller", () => {
    const failure = loginFailure({ response: { status: 418 }, config: { url: "http://127.0.0.1:8080/api/auth/login" } });
    expect(failure.message).not.toMatch(/418|http|127\.0\.0\.1|CORS/i);
  });
});
