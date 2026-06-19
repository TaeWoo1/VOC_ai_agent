import { describe, expect, it } from "vitest";
import { haltForVerdict } from "../../src/naver/session-halt";
import type { SessionVerdict } from "../../src/naver/session-verdict";
import type { CollectorState } from "../../src/status";

describe("haltForVerdict — verdict → discovery halt decision", () => {
  it("LOGGED_IN is the only verdict that proceeds", () => {
    const decision = haltForVerdict("LOGGED_IN");
    expect(decision.proceed).toBe(true);
  });

  const halting: Array<{ verdict: SessionVerdict; state: CollectorState; detail: RegExp }> = [
    { verdict: "RECONNECT_REQUIRED", state: "RECONNECT_REQUIRED", detail: /Commerce reconnect required/i },
    { verdict: "ACCOUNT_LOGIN_REQUIRED", state: "ACCOUNT_LOGIN_REQUIRED", detail: /account login required/i },
    { verdict: "AUTH_CHALLENGE_REQUIRED", state: "ACTION_REQUIRED_FOR_2FA_OR_CAPTCHA", detail: /2FA|CAPTCHA/i },
    { verdict: "UNKNOWN", state: "SESSION_EXPIRED", detail: /not confirmed usable/i },
  ];

  for (const { verdict, state, detail } of halting) {
    it(`${verdict} halts → ${state} with an honest detail`, () => {
      const decision = haltForVerdict(verdict);
      expect(decision.proceed).toBe(false);
      expect(decision.state).toBe(state);
      expect(decision.detail).toMatch(detail);
      expect(decision.detail.length).toBeGreaterThan(0);
    });
  }

  it("only RECONNECT_REQUIRED and UNKNOWN distinguish reconnect from generic expiry", () => {
    // The whole point: a known-account reconnect must NOT read as SESSION_EXPIRED.
    expect(haltForVerdict("RECONNECT_REQUIRED").state).not.toBe("SESSION_EXPIRED");
    expect(haltForVerdict("ACCOUNT_LOGIN_REQUIRED").state).not.toBe("SESSION_EXPIRED");
    expect(haltForVerdict("UNKNOWN").state).toBe("SESSION_EXPIRED");
  });

  it("no halt decision is ever LAST_SUCCESS (discovery is not collection)", () => {
    const verdicts: SessionVerdict[] = [
      "LOGGED_IN",
      "RECONNECT_REQUIRED",
      "ACCOUNT_LOGIN_REQUIRED",
      "AUTH_CHALLENGE_REQUIRED",
      "UNKNOWN",
    ];
    for (const v of verdicts) expect(haltForVerdict(v).state).not.toBe("LAST_SUCCESS");
  });

  it("detail strings are static and content-free (no URL / HTML / PII surface)", () => {
    const verdicts: SessionVerdict[] = [
      "LOGGED_IN",
      "RECONNECT_REQUIRED",
      "ACCOUNT_LOGIN_REQUIRED",
      "AUTH_CHALLENGE_REQUIRED",
      "UNKNOWN",
    ];
    for (const v of verdicts) {
      const { detail } = haltForVerdict(v);
      expect(detail).not.toMatch(/https?:\/\//i);
      expect(detail).not.toMatch(/[<>]/);
    }
  });
});
