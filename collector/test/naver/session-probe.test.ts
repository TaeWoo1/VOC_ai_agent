import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  extractProbeSignals,
  SANITIZED_PROBE_KEYS,
  type SanitizedProbeSignals,
} from "../../src/naver/session-probe";

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), "../../fixtures");
const read = (name: string): string => readFileSync(resolve(fixtures, name), "utf8");

const SELLER_URL = "https://sell.smartstore.naver.com/#/review/search";
const LOGIN_URL = "https://nid.naver.com/nidlogin.login";

// Fake PII/sensitive strings embedded in probe_hostile.html.
const HOSTILE_STRINGS = [
  "달빛코스메틱",
  "seller-admin@example-store.co.kr",
  "gildong@example.com",
  "홍길동",
  "수분진정 수분크림 50ml",
  "정말 최악이에요 환불해주세요",
  "ORD-998877",
  "CUST-554433",
  "SECRETTOKEN12345",
  "SELLER-7788",
];

const ALLOWED_VALUES: Record<string, ReadonlyArray<unknown> | "number" | "boolean"> = {
  urlCategory: ["login", "seller-center", "other"],
  documentReadyState: ["loading", "interactive", "complete", "unknown"],
  htmlLengthBucket: ["empty", "tiny", "small", "medium", "large", "huge"],
  scriptCount: "number",
  appRootPresent: "boolean",
  appRootChildCount: ["unknown", "none", "few", "some", "many"],
  passwordFieldPresent: "boolean",
  captchaOrAuthChallengePresent: "boolean",
  loginAffordancePresent: "boolean",
  candidateLoggedInShellPresent: "boolean",
  candidateMenuOrGnbPresent: "boolean",
  candidateLogoutAffordancePresent: "boolean",
  reviewRouteLike: "boolean",
  exportCandidateCount: ["none", "one", "few", "many"],
  hydrationWaitResult: ["hydrated", "timeout", "not-attempted", "error"],
};

describe("extractProbeSignals — sanitization (hostile fixture)", () => {
  const signals = extractProbeSignals({
    url: `${SELLER_URL}?authToken=SECRETTOKEN12345&sellerId=SELLER-7788`,
    html: read("probe_hostile.html"),
    readyState: "complete",
    appRootChildCount: 12,
    hydrationWaitResult: "hydrated",
  });
  const serialized = JSON.stringify(signals);

  it("output contains none of the raw PII / token strings", () => {
    for (const s of HOSTILE_STRINGS) {
      expect(serialized).not.toContain(s);
    }
  });

  it("emits ONLY the allowed keys", () => {
    expect(Object.keys(signals).sort()).toEqual([...SANITIZED_PROBE_KEYS].sort());
  });

  it("every value is a boolean, a number, or an allowed category string", () => {
    for (const [key, value] of Object.entries(signals)) {
      const rule = ALLOWED_VALUES[key];
      if (rule === "number") expect(typeof value).toBe("number");
      else if (rule === "boolean") expect(typeof value).toBe("boolean");
      else expect(rule).toContain(value);
    }
  });

  it("still extracts useful structure from the hostile page (categories, not content)", () => {
    expect(signals.urlCategory).toBe("seller-center");
    expect(signals.candidateLoggedInShellPresent).toBe(true);
    expect(signals.candidateLogoutAffordancePresent).toBe(true);
    expect(signals.appRootPresent).toBe(true);
    expect(signals.appRootChildCount).toBe("some"); // 12 → some
    expect(signals.reviewRouteLike).toBe(true);
  });
});

describe("extractProbeSignals — discrete signal detection", () => {
  it("login form fixture → login affordance + password field, login URL category", () => {
    const s = extractProbeSignals({ url: LOGIN_URL, html: read("session_login.html") });
    expect(s.passwordFieldPresent).toBe(true);
    expect(s.loginAffordancePresent).toBe(true);
    expect(s.urlCategory).toBe("login");
    expect(s.captchaOrAuthChallengePresent).toBe(false);
  });

  it("2FA fixture → auth challenge detected", () => {
    const s = extractProbeSignals({ url: LOGIN_URL, html: read("session_2fa.html") });
    expect(s.captchaOrAuthChallengePresent).toBe(true);
  });

  it("logged-in fixture → candidate logged-in shell detected", () => {
    const s = extractProbeSignals({ url: SELLER_URL, html: read("session_logged_in.html") });
    expect(s.candidateLoggedInShellPresent).toBe(true);
  });

  it("hydrated app shell → readyState complete + child-count bucket reflects hydration", () => {
    const hydrated = extractProbeSignals({ url: SELLER_URL, html: "<div id='app'></div>", readyState: "complete", appRootChildCount: 80 });
    expect(hydrated.documentReadyState).toBe("complete");
    expect(hydrated.appRootPresent).toBe(true);
    expect(hydrated.appRootChildCount).toBe("many"); // 80 → many

    const unhydrated = extractProbeSignals({ url: SELLER_URL, html: "<div id='app'></div>", readyState: "loading", appRootChildCount: 0 });
    expect(unhydrated.documentReadyState).toBe("loading");
    expect(unhydrated.appRootChildCount).toBe("none"); // 0 children → not hydrated
  });

  it("appRootChildCount is 'unknown' when not provided (offline / no root)", () => {
    const s = extractProbeSignals({ url: SELLER_URL, html: "<html></html>" });
    expect(s.appRootChildCount).toBe("unknown");
    expect(s.hydrationWaitResult).toBe("not-attempted");
  });

  it("export candidates are bucketed, not echoed", () => {
    const many = extractProbeSignals({ url: SELLER_URL, html: read("probe_hostile.html") });
    expect(many.exportCandidateCount).toBe("many"); // several export controls in the fixture
    const few = extractProbeSignals({ url: SELLER_URL, html: "<button>엑셀 다운로드</button>" });
    expect(few.exportCandidateCount).toBe("one");
    const none = extractProbeSignals({ url: SELLER_URL, html: "<html><body>no export here</body></html>" });
    expect(none.exportCandidateCount).toBe("none");
  });
});
