import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { detectSession, signalsFromHtml, type SessionSignals } from "../src/session";

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures");
const html = (name: string) => readFileSync(resolve(fixtures, name), "utf8");

/** A logged-out, ambiguous seller-center baseline; tests flip individual signals. */
const base: SessionSignals = {
  url: "https://sell.smartstore.naver.com/#/review/search",
  isLoginUrl: false,
  isSellerCenterUrl: true,
  hasAuthChallenge: false,
  hasLoginForm: false,
  hasLogoutAffordance: false,
  hasAdminGnb: false,
  hasSellerShell: false,
};

describe("detectSession", () => {
  it("auth challenge wins over everything (even strong logged-in + login url)", () => {
    expect(
      detectSession({ ...base, hasAuthChallenge: true, isLoginUrl: true, hasLogoutAffordance: true }),
    ).toBe("AUTH_CHALLENGE");
  });

  it("a genuine login URL is decisive LOGGED_OUT, even with strong logged-in signals", () => {
    expect(detectSession({ ...base, isLoginUrl: true, hasLogoutAffordance: true, hasAdminGnb: true })).toBe(
      "LOGGED_OUT",
    );
  });

  it("seller-center + strong logged-in signal beats an ambient login form → LOGGED_IN", () => {
    // The core regression: an ambient login widget (hasLoginForm) must NOT flip a
    // clearly logged-in admin page back to LOGGED_OUT.
    expect(detectSession({ ...base, hasLoginForm: true, hasLogoutAffordance: true })).toBe("LOGGED_IN");
  });

  it("seller-center + admin GNB → LOGGED_IN", () => {
    expect(detectSession({ ...base, hasAdminGnb: true })).toBe("LOGGED_IN");
  });

  it("seller-center + authenticated shell attribute → LOGGED_IN", () => {
    expect(detectSession({ ...base, hasSellerShell: true })).toBe("LOGGED_IN");
  });

  it("a strong signal off a seller-center URL is NOT enough → LOGGED_OUT", () => {
    expect(detectSession({ ...base, isSellerCenterUrl: false, hasLogoutAffordance: true })).toBe("LOGGED_OUT");
  });

  it("a login form with no strong logged-in signal → LOGGED_OUT", () => {
    expect(detectSession({ ...base, isSellerCenterUrl: false, hasLoginForm: true })).toBe("LOGGED_OUT");
  });

  it("branding-only / nothing strong → LOGGED_OUT (fail-safe)", () => {
    expect(detectSession(base)).toBe("LOGGED_OUT");
  });
});

describe("signalsFromHtml + detectSession against fixtures", () => {
  const SELLER_URL = "https://sell.smartstore.naver.com/#/review/search";
  const LOGIN_URL = "https://nid.naver.com/nidlogin.login";

  it("logged-in fixture on a seller-center URL → LOGGED_IN", () => {
    expect(detectSession(signalsFromHtml(html("session_logged_in.html"), SELLER_URL))).toBe("LOGGED_IN");
  });

  it("login fixture on a login URL → LOGGED_OUT", () => {
    expect(detectSession(signalsFromHtml(html("session_login.html"), LOGIN_URL))).toBe("LOGGED_OUT");
  });

  it("2fa fixture → AUTH_CHALLENGE", () => {
    expect(detectSession(signalsFromHtml(html("session_2fa.html"), LOGIN_URL))).toBe("AUTH_CHALLENGE");
  });
});
