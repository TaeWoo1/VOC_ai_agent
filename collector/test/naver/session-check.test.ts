import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { clearLogSink, getLogSink } from "../../src/log";
import {
  checkLiveSession,
  checkLiveSessionVerdict,
  sessionStateFromContent,
  sessionVerdictFromContent,
  urlCategory,
} from "../../src/naver/session-check";
import type { PwPage } from "../../src/profile";

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), "../../fixtures");
const read = (name: string): string => readFileSync(resolve(fixtures, name), "utf8");

const SELLER_URL = "https://sell.smartstore.naver.com/o/n/review";
const LOGIN_URL = "https://nid.naver.com/nidlogin.login";

describe("sessionStateFromContent", () => {
  it("logged-in fixture → LOGGED_IN", () => {
    expect(sessionStateFromContent(read("session_logged_in.html"), SELLER_URL)).toBe("LOGGED_IN");
  });

  it("login fixture → LOGGED_OUT", () => {
    expect(sessionStateFromContent(read("session_login.html"), LOGIN_URL)).toBe("LOGGED_OUT");
  });

  it("2FA/CAPTCHA fixture → AUTH_CHALLENGE", () => {
    expect(sessionStateFromContent(read("session_2fa.html"), LOGIN_URL)).toBe("AUTH_CHALLENGE");
  });

  it("a logged-in page served from a login URL still resolves to LOGGED_OUT (fail-safe)", () => {
    expect(sessionStateFromContent(read("session_logged_in.html"), LOGIN_URL)).toBe("LOGGED_OUT");
  });
});

describe("sessionStateFromContent — seller-center detector precedence (synthetic)", () => {
  const SELLER_REVIEW_URL = "https://sell.smartstore.naver.com/#/review/search";

  it("authenticated admin shell WITH an ambient login widget → LOGGED_IN", () => {
    // The live milestone-1 regression: strong logged-in signals (logout + seller
    // GNB + authenticated shell) must beat an ambient embedded login form.
    expect(sessionStateFromContent(read("session_admin_with_login_widget.html"), SELLER_REVIEW_URL)).toBe(
      "LOGGED_IN",
    );
  });

  it("authenticated review route (seller GNB + shell) → LOGGED_IN", () => {
    expect(sessionStateFromContent(read("session_logged_in.html"), SELLER_REVIEW_URL)).toBe("LOGGED_IN");
  });

  it("login URL with SmartStore branding → LOGGED_OUT", () => {
    expect(sessionStateFromContent(read("session_login_with_branding.html"), LOGIN_URL)).toBe("LOGGED_OUT");
  });

  it("seller-center page with branding only (no logout/GNB/shell) → LOGGED_OUT", () => {
    expect(sessionStateFromContent(read("session_branding_only.html"), SELLER_REVIEW_URL)).toBe("LOGGED_OUT");
  });

  it("unknown seller-center shell without strong markers → LOGGED_OUT (fail-safe)", () => {
    expect(sessionStateFromContent("<html><body><div id='app'></div></body></html>", SELLER_REVIEW_URL)).toBe(
      "LOGGED_OUT",
    );
  });
});

describe("sessionVerdictFromContent — content → five-state verdict (fixtures)", () => {
  // The pure offline seam the live discovery HALT runs on (`checkLiveSessionVerdict` is
  // its I/O wrapper). It reuses the probe's tightened, branding-demoted markers, so a
  // fixture-level verdict here is exactly what discovery would decide on the same page.
  it("Commerce reconnect interstitial (account chooser, no password) → RECONNECT_REQUIRED", () => {
    expect(sessionVerdictFromContent(read("session_reconnect.html"), SELLER_URL)).toBe(
      "RECONNECT_REQUIRED",
    );
  });

  it("full NAVER account login page (password field) → ACCOUNT_LOGIN_REQUIRED", () => {
    expect(sessionVerdictFromContent(read("session_login.html"), LOGIN_URL)).toBe(
      "ACCOUNT_LOGIN_REQUIRED",
    );
  });

  it("2FA / CAPTCHA page → AUTH_CHALLENGE_REQUIRED", () => {
    expect(sessionVerdictFromContent(read("session_2fa.html"), LOGIN_URL)).toBe(
      "AUTH_CHALLENGE_REQUIRED",
    );
  });

  it("usable seller-center shell (no password) → LOGGED_IN", () => {
    expect(sessionVerdictFromContent(read("session_logged_in.html"), SELLER_URL)).toBe("LOGGED_IN");
  });

  it("branding-only seller page (no strong signal, no reconnect) → UNKNOWN", () => {
    expect(sessionVerdictFromContent(read("session_branding_only.html"), SELLER_URL)).toBe("UNKNOWN");
  });
});

describe("urlCategory", () => {
  it("categorizes without exposing the raw URL", () => {
    expect(urlCategory(LOGIN_URL)).toBe("login");
    expect(urlCategory(SELLER_URL)).toBe("seller-center");
    expect(urlCategory("https://example.com/x")).toBe("other");
  });
});

describe("checkLiveSession", () => {
  beforeEach(() => clearLogSink());

  function fakePage(html: string, url: string): PwPage {
    return {
      url: () => url,
      content: async () => html,
      goto: async () => null,
      click: async () => {},
      waitForEvent: async () => {
        throw new Error("not used");
      },
    };
  }

  it("returns the detected state and logs only a coarse URL category", async () => {
    const page = fakePage(read("session_logged_in.html"), `${SELLER_URL}?token=SECRET-SHOULD-NOT-LOG`);
    const state = await checkLiveSession(page);
    expect(state).toBe("LOGGED_IN");

    const serialized = JSON.stringify(getLogSink());
    expect(serialized).toContain("session.check");
    expect(serialized).toContain("seller-center");
    // the raw URL (and its query token) must never appear in logs
    expect(serialized).not.toContain("SECRET-SHOULD-NOT-LOG");
    expect(serialized).not.toContain("sell.smartstore.naver.com");
  });

  it("checkLiveSessionVerdict returns the verdict and logs only the verdict + category", async () => {
    const page = fakePage(read("session_logged_in.html"), `${SELLER_URL}?token=SECRET-SHOULD-NOT-LOG`);
    const verdict = await checkLiveSessionVerdict(page);
    expect(verdict).toBe("LOGGED_IN");

    const serialized = JSON.stringify(getLogSink());
    expect(serialized).toContain("session.check");
    expect(serialized).toContain("LOGGED_IN");
    expect(serialized).toContain("seller-center");
    expect(serialized).not.toContain("SECRET-SHOULD-NOT-LOG");
    expect(serialized).not.toContain("sell.smartstore.naver.com");
  });
});
