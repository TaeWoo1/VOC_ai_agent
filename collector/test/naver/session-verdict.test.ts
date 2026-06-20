import { describe, expect, it } from "vitest";
import {
  classifySessionVerdict,
  type SessionVerdictInput,
} from "../../src/naver/session-verdict";

/** All-false baseline; override only the signals a case needs. */
function input(overrides: Partial<SessionVerdictInput> = {}): SessionVerdictInput {
  return {
    isSellerCenterUrl: false,
    passwordFieldPresent: false,
    authChallengePresent: false,
    menuOrGnbPresent: false,
    logoutAffordancePresent: false,
    exportCandidatesPresent: false,
    accountReconnectAffordancePresent: false,
    ...overrides,
  };
}

describe("classifySessionVerdict — precedence", () => {
  it("auth challenge wins over everything (even a logged-in-looking seller page)", () => {
    expect(
      classifySessionVerdict(
        input({
          authChallengePresent: true,
          passwordFieldPresent: true,
          isSellerCenterUrl: true,
          menuOrGnbPresent: true,
          accountReconnectAffordancePresent: true,
        }),
      ),
    ).toBe("AUTH_CHALLENGE_REQUIRED");
  });

  it("a password field → ACCOUNT_LOGIN_REQUIRED even with strong seller-center signals", () => {
    // The ambient-login-WIDGET case: strong shell present, but a real password field is
    // decisive (e.g. session_admin_with_login_widget.html).
    expect(
      classifySessionVerdict(
        input({
          passwordFieldPresent: true,
          isSellerCenterUrl: true,
          menuOrGnbPresent: true,
          logoutAffordancePresent: true,
          exportCandidatesPresent: true,
        }),
      ),
    ).toBe("ACCOUNT_LOGIN_REQUIRED");
  });

  it("LOGGED_IN is checked before RECONNECT — a usable page with a reconnect affordance is LOGGED_IN", () => {
    expect(
      classifySessionVerdict(
        input({
          isSellerCenterUrl: true,
          menuOrGnbPresent: true,
          accountReconnectAffordancePresent: true, // present, but does not win
        }),
      ),
    ).toBe("LOGGED_IN");
  });
});

describe("classifySessionVerdict — password rule is guarded by the reconnect affordance", () => {
  // Run-1 finding: the Commerce reconnect screen carries an alternate login form
  // (passwordFieldPresent) ABOVE/below a currently-logged-in account-continuation card.
  // A bare password rule wrongly masked the reconnect; the guard fixes that.
  it("password + reconnect affordance → RECONNECT_REQUIRED (the alternate form does not mask it)", () => {
    expect(
      classifySessionVerdict(
        input({ passwordFieldPresent: true, accountReconnectAffordancePresent: true }),
      ),
    ).toBe("RECONNECT_REQUIRED");
  });

  it("password + NO reconnect affordance → ACCOUNT_LOGIN_REQUIRED (unchanged)", () => {
    expect(classifySessionVerdict(input({ passwordFieldPresent: true }))).toBe(
      "ACCOUNT_LOGIN_REQUIRED",
    );
  });

  it("auth challenge still wins over a guarded password + reconnect", () => {
    expect(
      classifySessionVerdict(
        input({
          authChallengePresent: true,
          passwordFieldPresent: true,
          accountReconnectAffordancePresent: true,
        }),
      ),
    ).toBe("AUTH_CHALLENGE_REQUIRED");
  });

  it("a STRONG seller-center session still wins even with password + reconnect both present", () => {
    expect(
      classifySessionVerdict(
        input({
          isSellerCenterUrl: true,
          menuOrGnbPresent: true,
          passwordFieldPresent: true,
          accountReconnectAffordancePresent: true,
        }),
      ),
    ).toBe("LOGGED_IN");
  });
});

describe("classifySessionVerdict — LOGGED_IN (relaxed)", () => {
  it("seller-center + any one strong signal → LOGGED_IN", () => {
    for (const strong of [
      { menuOrGnbPresent: true },
      { logoutAffordancePresent: true },
      { exportCandidatesPresent: true },
    ]) {
      expect(classifySessionVerdict(input({ isSellerCenterUrl: true, ...strong }))).toBe(
        "LOGGED_IN",
      );
    }
  });

  it("an ambient login/account/reconnect affordance does NOT suppress LOGGED_IN", () => {
    // loginAffordancePresent is not even an input; a reconnect affordance alongside a
    // strong session still resolves to LOGGED_IN.
    expect(
      classifySessionVerdict(
        input({
          isSellerCenterUrl: true,
          logoutAffordancePresent: true,
          accountReconnectAffordancePresent: true,
        }),
      ),
    ).toBe("LOGGED_IN");
  });

  it("strong signals OFF a seller-center URL are not enough → not LOGGED_IN", () => {
    expect(
      classifySessionVerdict(input({ isSellerCenterUrl: false, menuOrGnbPresent: true })),
    ).toBe("UNKNOWN");
  });
});

describe("classifySessionVerdict — RECONNECT vs UNKNOWN", () => {
  it("account-chooser affordance with no usable session → RECONNECT_REQUIRED", () => {
    expect(
      classifySessionVerdict(
        input({ isSellerCenterUrl: true, accountReconnectAffordancePresent: true }),
      ),
    ).toBe("RECONNECT_REQUIRED");
  });

  it("reconnect affordance even off a seller-center URL → RECONNECT_REQUIRED", () => {
    expect(
      classifySessionVerdict(input({ accountReconnectAffordancePresent: true })),
    ).toBe("RECONNECT_REQUIRED");
  });

  it("nothing decisive (e.g. branding only) → UNKNOWN", () => {
    expect(classifySessionVerdict(input({ isSellerCenterUrl: true }))).toBe("UNKNOWN");
  });

  it("a seller-center URL with NO strong signal and NO reconnect affordance → UNKNOWN", () => {
    expect(classifySessionVerdict(input())).toBe("UNKNOWN");
  });
});
