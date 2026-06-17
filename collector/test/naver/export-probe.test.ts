import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  extractExportProbeSignals,
  SANITIZED_EXPORT_PROBE_KEYS,
} from "../../src/naver/export-probe";

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), "../../fixtures");
const read = (name: string): string => readFileSync(resolve(fixtures, name), "utf8");

const SELLER_URL = "https://sell.smartstore.naver.com/#/review/search";

// Fake PII/sensitive strings embedded in probe_hostile.html + a token-bearing URL.
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

const URL_CATS = ["login", "seller-center", "other"];
const COUNT_BUCKETS = ["none", "one", "few", "some", "many"];
const OPTIONAL_BUCKETS = ["unknown", ...COUNT_BUCKETS];

const ALLOWED_VALUES: Record<string, ReadonlyArray<unknown> | "number" | "boolean" | "frameCategories"> = {
  urlCategory: URL_CATS,
  reviewRouteLike: "boolean",
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
  reviewLike: "boolean",
  searchLike: "boolean",
  frameUrlCategories: "frameCategories",
  shadowRootHostCount: OPTIONAL_BUCKETS,
  exportCandidateCount: OPTIONAL_BUCKETS,
  visibleExportCandidateCount: OPTIONAL_BUCKETS,
  enabledExportCandidateCount: OPTIONAL_BUCKETS,
};

describe("extractExportProbeSignals — sanitization (hostile fixture)", () => {
  const signals = extractExportProbeSignals({
    url: `${SELLER_URL}?authToken=SECRETTOKEN12345&sellerId=SELLER-7788`,
    html: read("probe_hostile.html"),
    // Token-bearing frame URLs must be reduced to categories, never echoed.
    frameUrls: [`${SELLER_URL}?authToken=SECRETTOKEN12345`, "https://nid.naver.com/nidlogin.login"],
    shadowRootHostCount: 2,
    exportCandidateTotal: 3,
    exportCandidateVisible: 3,
    exportCandidateEnabled: 3,
  });
  const serialized = JSON.stringify(signals);

  it("output contains none of the raw PII / token strings", () => {
    for (const s of HOSTILE_STRINGS) expect(serialized).not.toContain(s);
    expect(serialized).not.toContain("authToken");
    expect(serialized).not.toContain("nidlogin");
  });

  it("emits ONLY the allowed keys", () => {
    expect(Object.keys(signals).sort()).toEqual([...SANITIZED_EXPORT_PROBE_KEYS].sort());
  });

  it("every value is a boolean, a count bucket, or an allowed category", () => {
    for (const [key, value] of Object.entries(signals)) {
      const rule = ALLOWED_VALUES[key];
      if (rule === "number") expect(typeof value).toBe("number");
      else if (rule === "boolean") expect(typeof value).toBe("boolean");
      else if (rule === "frameCategories") {
        expect(Array.isArray(value)).toBe(true);
        for (const v of value as unknown[]) expect(URL_CATS).toContain(v);
      } else expect(rule).toContain(value);
    }
  });

  it("frame URLs are reduced to coarse, deduped, sorted categories", () => {
    expect(signals.frameUrlCategories).toEqual(["login", "seller-center"]);
  });

  it("still extracts useful structure from the hostile page (categories, not content)", () => {
    expect(signals.urlCategory).toBe("seller-center");
    expect(signals.reviewLike).toBe(true);
    expect(signals.excelLike).toBe(true);
    expect(signals.downloadLike).toBe(true);
  });
});

describe("extractExportProbeSignals — live-only inputs degrade offline", () => {
  it("without live inputs: no frames, and live buckets are 'unknown'", () => {
    const s = extractExportProbeSignals({ url: SELLER_URL, html: "<html><body>리뷰</body></html>" });
    expect(s.frameUrlCategories).toEqual([]);
    expect(s.shadowRootHostCount).toBe("unknown");
    expect(s.exportCandidateCount).toBe("unknown");
    expect(s.visibleExportCandidateCount).toBe("unknown");
    expect(s.enabledExportCandidateCount).toBe("unknown");
  });

  it("live candidate counts are bucketed, not echoed", () => {
    const s = extractExportProbeSignals({
      url: SELLER_URL,
      html: "<html></html>",
      exportCandidateTotal: 1,
      exportCandidateVisible: 1,
      exportCandidateEnabled: 0,
    });
    expect(s.exportCandidateCount).toBe("one");
    expect(s.visibleExportCandidateCount).toBe("one");
    expect(s.enabledExportCandidateCount).toBe("none");
  });
});

describe("extractExportProbeSignals — distinguishes the three LAYOUT_UNRECOGNIZED causes", () => {
  it("missing selector: export keywords/controls present on the MAIN document", () => {
    // review-export.ts placeholder markers miss this control, but the probe shows
    // an export affordance IS here → the fix is a selector, not navigation.
    const s = extractExportProbeSignals({ url: SELLER_URL, html: read("export_main_document_controls.html") });
    expect(s.excelLike).toBe(true);
    expect(s.downloadLike).toBe(true);
    expect(s.exportLike).toBe(false); // no 내보내기/export/추출 wording
    expect(s.searchLike).toBe(true);
    expect(s.dateInputCount).toBe("few"); // two date inputs
    expect(s.tableGridListCount).toBe("one");
    expect(s.iframeCount).toBe("none");
  });

  it("iframe / sub-route: export keywords ABSENT on main doc, a child frame present", () => {
    const s = extractExportProbeSignals({
      url: SELLER_URL,
      html: read("export_in_iframe.html"),
      // The export UI lives in another browsing context; its category is reported,
      // never its raw URL.
      frameUrls: [SELLER_URL, "https://content.example.com/embedded/review-app"],
    });
    expect(s.excelLike).toBe(false);
    expect(s.downloadLike).toBe(false);
    expect(s.iframeCount).toBe("one");
    expect(s.frameUrlCategories).toEqual(["other", "seller-center"]);
  });

  it("hidden / gated UI: export keyword present but the control is disabled", () => {
    const s = extractExportProbeSignals({
      url: SELLER_URL,
      html: read("export_gated_disabled.html"),
      // Live: the candidate is rendered but not actionable until a search runs.
      exportCandidateTotal: 1,
      exportCandidateVisible: 1,
      exportCandidateEnabled: 0,
    });
    expect(s.excelLike).toBe(true);
    expect(s.disabledControlCount).toBe("one");
    expect(s.dateInputCount).toBe("few");
    expect(s.visibleExportCandidateCount).toBe("one");
    expect(s.enabledExportCandidateCount).toBe("none"); // gated behind a prior step
  });
});

describe("extractExportProbeSignals — count bucketing", () => {
  it("buckets counts none/one/few/some/many", () => {
    const make = (n: number) => extractExportProbeSignals({ url: SELLER_URL, html: "<button></button>".repeat(n) });
    expect(make(0).buttonCount).toBe("none");
    expect(make(1).buttonCount).toBe("one");
    expect(make(4).buttonCount).toBe("few");
    expect(make(12).buttonCount).toBe("some");
    expect(make(30).buttonCount).toBe("many");
  });
});
