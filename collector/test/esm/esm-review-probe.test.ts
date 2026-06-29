import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  esmUrlCategory,
  extractEsmReviewProbeSignals,
  SANITIZED_ESM_REVIEW_PROBE_KEYS,
} from "../../src/esm/esm-review-probe";

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures");
const read = (name: string): string => readFileSync(resolve(fixtures, name), "utf8");

// A seller-center ESM review route with a token + ids in the query string.
const ESM_REVIEW_URL = "https://www.esmplus.com/Home/v2/manage-feedback";

// Fake PII/sensitive strings embedded in esm_review_hostile.html + a token-bearing URL.
const HOSTILE_STRINGS = [
  "별빛상회",
  "ESM-SELLER-4521",
  "홍길동",
  "gildong@example.com",
  "수분진정 수분크림 50ml",
  "정말 최악이에요 환불해주세요",
  "ORD-998877",
  "CUST-554433",
  "SECRETTOKEN12345",
];

const URL_CATS = ["login", "seller-center", "other"];
const COUNT_BUCKETS = ["none", "one", "few", "some", "many"];
const OPTIONAL_BUCKETS = ["unknown", ...COUNT_BUCKETS];
const LAYOUT_HINTS = ["SYNC_LIKELY", "ASYNC_LIKELY", "UNRECOGNIZED"];
const VERDICTS = ["LOGGED_IN", "RECONNECT_REQUIRED", "ACCOUNT_LOGIN_REQUIRED", "AUTH_CHALLENGE_REQUIRED", "UNKNOWN"];

const ALLOWED_VALUES: Record<string, ReadonlyArray<unknown> | "boolean" | "frameCategories"> = {
  urlCategory: URL_CATS,
  reviewRouteLike: "boolean",
  manageFeedbackRouteLike: "boolean",
  passwordFieldPresent: "boolean",
  authChallengePresent: "boolean",
  menuOrGnbPresent: "boolean",
  logoutAffordancePresent: "boolean",
  accountReconnectAffordancePresent: "boolean",
  iframeCount: COUNT_BUCKETS,
  buttonCount: COUNT_BUCKETS,
  anchorCount: COUNT_BUCKETS,
  roleButtonCount: COUNT_BUCKETS,
  disabledControlCount: COUNT_BUCKETS,
  downloadAttributeCount: COUNT_BUCKETS,
  dateInputCount: COUNT_BUCKETS,
  tableGridListCount: COUNT_BUCKETS,
  excelLike: "boolean",
  downloadLike: "boolean",
  exportLike: "boolean",
  csvOrXlsxLike: "boolean",
  asyncMarkerPresent: "boolean",
  frameUrlCategories: "frameCategories",
  shadowRootHostCount: OPTIONAL_BUCKETS,
  exportCandidateCount: OPTIONAL_BUCKETS,
  visibleExportCandidateCount: OPTIONAL_BUCKETS,
  enabledExportCandidateCount: OPTIONAL_BUCKETS,
  hasActionableExportCandidate: "boolean",
  exportLayoutHint: LAYOUT_HINTS,
  sessionVerdict: VERDICTS,
};

describe("esmUrlCategory — coarse, never echoes the raw URL", () => {
  it("classifies an esmplus seller-center route", () => {
    expect(esmUrlCategory(`${ESM_REVIEW_URL}?token=SECRETTOKEN12345`)).toBe("seller-center");
  });
  it("classifies a login route (login wins over host)", () => {
    expect(esmUrlCategory("https://www.esmplus.com/login?redirect=/Home")).toBe("login");
    expect(esmUrlCategory("https://signin.example.com/auth")).toBe("login");
  });
  it("classifies an unrelated host as other", () => {
    expect(esmUrlCategory("https://example.com/whatever")).toBe("other");
  });
});

describe("extractEsmReviewProbeSignals — sanitization (hostile fixture)", () => {
  const signals = extractEsmReviewProbeSignals({
    url: `${ESM_REVIEW_URL}?token=SECRETTOKEN12345&sellerId=ESM-SELLER-4521`,
    html: read("esm_review_hostile.html"),
    // Token-bearing frame URLs must be reduced to categories, never echoed.
    frameUrls: [`${ESM_REVIEW_URL}?token=SECRETTOKEN12345`, "https://www.esmplus.com/login"],
    shadowRootHostCount: 1,
    exportCandidateTotal: 2,
    exportCandidateVisible: 2,
    exportCandidateEnabled: 2,
  });
  const serialized = JSON.stringify(signals);

  it("output contains none of the raw PII / token strings", () => {
    for (const s of HOSTILE_STRINGS) expect(serialized).not.toContain(s);
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("esmplus");
    expect(serialized).not.toContain("manage-feedback");
  });

  it("emits ONLY the allowed keys", () => {
    expect(Object.keys(signals).sort()).toEqual([...SANITIZED_ESM_REVIEW_PROBE_KEYS].sort());
  });

  it("every value is a boolean, a count bucket, or an allowed category", () => {
    for (const [key, value] of Object.entries(signals)) {
      const rule = ALLOWED_VALUES[key];
      if (rule === "boolean") expect(typeof value).toBe("boolean");
      else if (rule === "frameCategories") {
        expect(Array.isArray(value)).toBe(true);
        for (const v of value as unknown[]) expect(URL_CATS).toContain(v);
      } else expect(rule).toContain(value);
    }
  });

  it("frame URLs are reduced to coarse, deduped, sorted categories", () => {
    expect(signals.frameUrlCategories).toEqual(["login", "seller-center"]);
  });

  it("still extracts useful structure (categories, not content)", () => {
    expect(signals.urlCategory).toBe("seller-center");
    expect(signals.manageFeedbackRouteLike).toBe(true);
    expect(signals.reviewRouteLike).toBe(true);
    expect(signals.excelLike).toBe(true);
    expect(signals.downloadLike).toBe(true);
    expect(signals.hasActionableExportCandidate).toBe(true);
    // logout + gnb + export controls on a seller-center route → usable session.
    expect(signals.sessionVerdict).toBe("LOGGED_IN");
    expect(signals.exportLayoutHint).toBe("SYNC_LIKELY");
  });
});

describe("extractEsmReviewProbeSignals — five-state session verdict (reused, channel-generic)", () => {
  it("a login page (password, no reconnect, no strong seller-center) → ACCOUNT_LOGIN_REQUIRED", () => {
    const s = extractEsmReviewProbeSignals({
      url: "https://www.esmplus.com/login",
      html: '<html><body><form><input type="password" name="pwd" /></form></body></html>',
    });
    expect(s.sessionVerdict).toBe("ACCOUNT_LOGIN_REQUIRED");
  });

  it("an auth challenge (captcha / 2단계) wins → AUTH_CHALLENGE_REQUIRED", () => {
    const s = extractEsmReviewProbeSignals({
      url: "https://www.esmplus.com/login",
      html: '<html><body><div class="captcha">자동입력 방지</div><input type="password" /></body></html>',
    });
    expect(s.sessionVerdict).toBe("AUTH_CHALLENGE_REQUIRED");
  });

  it("a seller-center route with a strong signal → LOGGED_IN", () => {
    const s = extractEsmReviewProbeSignals({
      url: `${ESM_REVIEW_URL}`,
      html: "<html><body><nav id='gnb'></nav><button>로그아웃</button></body></html>",
    });
    expect(s.sessionVerdict).toBe("LOGGED_IN");
  });

  it("an account-selection interstitial → RECONNECT_REQUIRED (only when observed)", () => {
    const s = extractEsmReviewProbeSignals({
      url: "https://www.esmplus.com/account",
      html: "<html><body><h1>계정 선택</h1></body></html>",
    });
    expect(s.sessionVerdict).toBe("RECONNECT_REQUIRED");
  });

  it("an ambiguous page → UNKNOWN (never proceed)", () => {
    const s = extractEsmReviewProbeSignals({ url: "https://example.com/x", html: "<html><body>hi</body></html>" });
    expect(s.sessionVerdict).toBe("UNKNOWN");
  });
});

describe("extractEsmReviewProbeSignals — export layout hint (coarse, NEEDS_DISCOVERY)", () => {
  it("an async download-center marker → ASYNC_LIKELY (wins over sync)", () => {
    const s = extractEsmReviewProbeSignals({
      url: ESM_REVIEW_URL,
      html: "<html><body><a>엑셀 다운로드</a><div>다운로드 센터</div></body></html>",
    });
    expect(s.asyncMarkerPresent).toBe(true);
    expect(s.exportLayoutHint).toBe("ASYNC_LIKELY");
  });

  it("an export keyword with no async marker → SYNC_LIKELY", () => {
    const s = extractEsmReviewProbeSignals({ url: ESM_REVIEW_URL, html: "<html><body><button>엑셀</button></body></html>" });
    expect(s.exportLayoutHint).toBe("SYNC_LIKELY");
  });

  it("no export affordance → UNRECOGNIZED", () => {
    const s = extractEsmReviewProbeSignals({ url: ESM_REVIEW_URL, html: "<html><body>리뷰 목록</body></html>" });
    expect(s.exportLayoutHint).toBe("UNRECOGNIZED");
  });
});

describe("extractEsmReviewProbeSignals — live-only inputs degrade offline", () => {
  it("without live inputs: no frames, and live buckets are 'unknown'", () => {
    const s = extractEsmReviewProbeSignals({ url: ESM_REVIEW_URL, html: "<html><body>리뷰</body></html>" });
    expect(s.frameUrlCategories).toEqual([]);
    expect(s.shadowRootHostCount).toBe("unknown");
    expect(s.exportCandidateCount).toBe("unknown");
    expect(s.visibleExportCandidateCount).toBe("unknown");
    expect(s.enabledExportCandidateCount).toBe("unknown");
    expect(s.hasActionableExportCandidate).toBe(false);
  });

  it("live candidate counts are bucketed, not echoed; gated control is not actionable", () => {
    const s = extractEsmReviewProbeSignals({
      url: ESM_REVIEW_URL,
      html: "<html></html>",
      exportCandidateTotal: 1,
      exportCandidateVisible: 1,
      exportCandidateEnabled: 0,
    });
    expect(s.exportCandidateCount).toBe("one");
    expect(s.visibleExportCandidateCount).toBe("one");
    expect(s.enabledExportCandidateCount).toBe("none");
    expect(s.hasActionableExportCandidate).toBe(false);
  });
});

describe("extractEsmReviewProbeSignals — determinism", () => {
  it("is deterministic for the same input", () => {
    const input = { url: ESM_REVIEW_URL, html: read("esm_review_hostile.html") };
    expect(extractEsmReviewProbeSignals(input)).toEqual(extractEsmReviewProbeSignals(input));
  });
});
