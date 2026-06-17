import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { detectSession, signalsFromHtml } from "../src/session";

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures");
const html = (name: string) => readFileSync(resolve(fixtures, name), "utf8");

describe("detectSession", () => {
  it("auth challenge wins over everything", () => {
    expect(
      detectSession({ url: "x", hasAuthChallenge: true, hasLoginForm: true, hasLoggedInMarker: true }),
    ).toBe("AUTH_CHALLENGE");
  });

  it("login form → LOGGED_OUT", () => {
    expect(
      detectSession({ url: "x", hasAuthChallenge: false, hasLoginForm: true, hasLoggedInMarker: false }),
    ).toBe("LOGGED_OUT");
  });

  it("login URL → LOGGED_OUT even without a detected form", () => {
    expect(
      detectSession({
        url: "https://nid.naver.com/nidlogin.login",
        hasAuthChallenge: false,
        hasLoginForm: false,
        hasLoggedInMarker: true,
      }),
    ).toBe("LOGGED_OUT");
  });

  it("logged-in marker only → LOGGED_IN", () => {
    expect(
      detectSession({ url: "https://sell.naver.com/review", hasAuthChallenge: false, hasLoginForm: false, hasLoggedInMarker: true }),
    ).toBe("LOGGED_IN");
  });

  it("uncertain → LOGGED_OUT (fail-safe)", () => {
    expect(
      detectSession({ url: "x", hasAuthChallenge: false, hasLoginForm: false, hasLoggedInMarker: false }),
    ).toBe("LOGGED_OUT");
  });
});

describe("signalsFromHtml + detectSession against fixtures", () => {
  it("logged-in fixture → LOGGED_IN", () => {
    const s = signalsFromHtml(html("session_logged_in.html"), "https://sell.smartstore.naver.com/review");
    expect(detectSession(s)).toBe("LOGGED_IN");
  });

  it("login fixture → LOGGED_OUT", () => {
    const s = signalsFromHtml(html("session_login.html"), "https://nid.naver.com/nidlogin.login");
    expect(detectSession(s)).toBe("LOGGED_OUT");
  });

  it("2fa fixture → AUTH_CHALLENGE", () => {
    const s = signalsFromHtml(html("session_2fa.html"), "https://nid.naver.com/nidlogin.login");
    expect(detectSession(s)).toBe("AUTH_CHALLENGE");
  });
});
