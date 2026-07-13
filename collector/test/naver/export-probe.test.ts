import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  extractExportProbeSignals,
  FRAME_AWARE_EXPORT_PROBE_KEYS,
  FRAME_EXPORT_PROBE_KEYS,
  SANITIZED_EXPORT_PROBE_KEYS,
  summarizeFrameExportProbes,
  type FrameExportProbe,
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
  semanticRowCount: COUNT_BUCKETS,
  dataRowLikeCount: COUNT_BUCKETS,
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

describe("extractExportProbeSignals — row-shape signal (Run-1 false-positive-empty diagnostic)", () => {
  const rows = (n: number, one: string): string => one.repeat(n);
  const probe = (html: string) => extractExportProbeSignals({ url: SELLER_URL, html });

  it("semantic <tbody><tr> rows are counted by BOTH signals", () => {
    const html = `<table><tbody>${rows(4, "<tr><td>x</td></tr>")}</tbody></table>`;
    const s = probe(html);
    expect(s.semanticRowCount).toBe("few"); // 4 body rows
    expect(s.dataRowLikeCount).toBe("few"); // superset agrees when rows are semantic
  });

  it("role=row grid rows are counted; a role=columnheader header row is excluded", () => {
    // 1 header (role=row + role=columnheader) + 3 data rows, all role=row → 3 data rows.
    const header = `<div role="row"><div role="columnheader">별점</div></div>`;
    const html = `<div role="grid">${header}${rows(3, '<div role="row"><div role="cell">x</div></div>')}</div>`;
    const s = probe(html);
    expect(s.semanticRowCount).toBe("few"); // 4 role=row minus 1 header = 3
    expect(s.dataRowLikeCount).toBe("few");
  });

  it("DIV-GRID with NO <tr>/role=row: semantic sees none, dataRowLike catches the rows", () => {
    // The Run-1 shape — rows visible on screen but rendered as class/data-attr divs.
    // The readiness gate (semantic) would report EMPTY; the broad signal quantifies the gap.
    const one = '<div class="ReviewList__row" data-rowindex="0"><span>리뷰</span></div>';
    const s = probe(`<div class="ReviewList">${rows(12, one)}</div>`);
    expect(s.semanticRowCount).toBe("none"); // <-- the false-positive-empty
    expect(s.dataRowLikeCount).toBe("some"); // <-- 12 div rows detected
  });

  it("virtualized grid keyed only by aria-rowindex is detected", () => {
    const one = '<div aria-rowindex="1"><span>x</span></div>';
    const s = probe(`<div role="presentation">${rows(8, one)}</div>`);
    expect(s.semanticRowCount).toBe("none");
    expect(s.dataRowLikeCount).toBe("some"); // 8 aria-rowindex rows
  });

  it("dataRowLike is a strict superset: semantic rows PLUS extra div rows", () => {
    // 2 real table rows + 5 div rows → semantic=2 (few), broad=max(2,5)=5 (few) but ≥ semantic.
    const html =
      `<table><tbody>${rows(2, "<tr><td>x</td></tr>")}</tbody></table>` +
      `<div>${rows(5, '<div class="grid-row" data-row-key="k"></div>')}</div>`;
    const s = probe(html);
    expect(s.semanticRowCount).toBe("few"); // 2
    expect(s.dataRowLikeCount).toBe("few"); // 5 ≥ 2
  });

  it("a bare layout utility (flex-row) does NOT inflate the row signal", () => {
    // `flex-row` is a layout class, not a data row — deliberately excluded.
    const s = probe(`<div class="d-flex flex-row"><button>엑셀다운로드</button></div>`);
    expect(s.semanticRowCount).toBe("none");
    expect(s.dataRowLikeCount).toBe("none");
  });

  it("no rows anywhere → both signals are none", () => {
    const s = probe("<div><p>표시할 리뷰가 없습니다</p></div>");
    expect(s.semanticRowCount).toBe("none");
    expect(s.dataRowLikeCount).toBe("none");
  });

  it("row markers inside an HTML comment do not count (comments are stripped)", () => {
    const s = probe('<!-- <div class="table-row" data-rowindex="9"></div> --><div>없음</div>');
    expect(s.dataRowLikeCount).toBe("none");
  });
});

describe("summarizeFrameExportProbes — frame-aware aggregation (PURE)", () => {
  // A top document with an actionable (visible AND enabled) export candidate.
  const topWithCandidate = extractExportProbeSignals({
    url: SELLER_URL,
    html: "<html></html>",
    exportCandidateVisible: 1,
    exportCandidateEnabled: 1,
  });
  // A top document with no candidate (offline live-scalars degrade to "unknown").
  const topNoCandidate = extractExportProbeSignals({ url: SELLER_URL, html: "<html></html>" });

  // A child that has a visible but DISABLED candidate (not actionable).
  const childGated = extractExportProbeSignals({
    url: SELLER_URL,
    html: "<html></html>",
    exportCandidateVisible: 1,
    exportCandidateEnabled: 0,
  });
  // A child with an actionable candidate.
  const childActionable = extractExportProbeSignals({
    url: SELLER_URL,
    html: "<html></html>",
    exportCandidateVisible: 2,
    exportCandidateEnabled: 2,
  });

  const blockedFrame: FrameExportProbe = { frameUrlCategory: "other", readResult: "blocked", signals: null };
  const childFrames = (n: number): FrameExportProbe[] => Array.from({ length: n }, () => blockedFrame);

  it("buckets the TOTAL frame count (top document + children)", () => {
    const fc = (n: number) =>
      summarizeFrameExportProbes({ sessionVerdict: "LOGGED_IN", topDocument: topNoCandidate, frames: childFrames(n) })
        .frameCount;
    expect(fc(0)).toBe("one"); // just the top document
    expect(fc(4)).toBe("few"); // 5 total
    expect(fc(19)).toBe("some"); // 20 total
    expect(fc(25)).toBe("many"); // 26 total
  });

  it("anyFrameExportCandidates is true when the TOP document has an actionable candidate", () => {
    const s = summarizeFrameExportProbes({
      sessionVerdict: "LOGGED_IN",
      topDocument: topWithCandidate,
      frames: childFrames(2),
    });
    expect(s.anyFrameExportCandidates).toBe(true);
  });

  it("anyFrameExportCandidates is true when a CHILD frame has an actionable candidate", () => {
    const s = summarizeFrameExportProbes({
      sessionVerdict: "LOGGED_IN",
      topDocument: topNoCandidate,
      frames: [{ frameUrlCategory: "seller-center", readResult: "read", signals: childActionable }],
    });
    expect(s.anyFrameExportCandidates).toBe(true);
  });

  it("anyFrameExportCandidates is false when no frame has a visible AND enabled candidate", () => {
    const s = summarizeFrameExportProbes({
      sessionVerdict: "LOGGED_IN",
      topDocument: topNoCandidate,
      frames: [
        { frameUrlCategory: "seller-center", readResult: "read", signals: childGated },
        blockedFrame,
      ],
    });
    expect(s.anyFrameExportCandidates).toBe(false);
  });

  it("is deterministic for the same input", () => {
    const input = {
      sessionVerdict: "LOGGED_IN" as const,
      topDocument: topNoCandidate,
      frames: [{ frameUrlCategory: "other" as const, readResult: "read" as const, signals: childActionable }],
    };
    expect(summarizeFrameExportProbes(input)).toEqual(summarizeFrameExportProbes(input));
  });

  it("emits ONLY the allowed top-level / per-frame / signal keys", () => {
    const s = summarizeFrameExportProbes({
      sessionVerdict: "LOGGED_IN",
      topDocument: topWithCandidate,
      frames: [{ frameUrlCategory: "seller-center", readResult: "read", signals: childActionable }, blockedFrame],
    });
    expect(Object.keys(s).sort()).toEqual([...FRAME_AWARE_EXPORT_PROBE_KEYS].sort());
    for (const f of s.frames) {
      expect(Object.keys(f).sort()).toEqual([...FRAME_EXPORT_PROBE_KEYS].sort());
      if (f.signals) {
        expect(Object.keys(f.signals).sort()).toEqual([...SANITIZED_EXPORT_PROBE_KEYS].sort());
      }
    }
    expect(Object.keys(s.topDocument).sort()).toEqual([...SANITIZED_EXPORT_PROBE_KEYS].sort());
  });

  it("never reintroduces raw PII / tokens from a hostile per-frame read", () => {
    const hostileTop = extractExportProbeSignals({
      url: `${SELLER_URL}?authToken=SECRETTOKEN12345&sellerId=SELLER-7788`,
      html: read("probe_hostile.html"),
      frameUrls: [`${SELLER_URL}?authToken=SECRETTOKEN12345`, "https://nid.naver.com/nidlogin.login"],
      shadowRootHostCount: 2,
      exportCandidateTotal: 3,
      exportCandidateVisible: 3,
      exportCandidateEnabled: 3,
    });
    const hostileChild = extractExportProbeSignals({
      url: `${SELLER_URL}?authToken=SECRETTOKEN12345`,
      html: read("probe_hostile.html"),
    });
    const s = summarizeFrameExportProbes({
      sessionVerdict: "LOGGED_IN",
      topDocument: hostileTop,
      frames: [{ frameUrlCategory: "seller-center", readResult: "read", signals: hostileChild }],
    });
    const serialized = JSON.stringify(s);
    for (const str of HOSTILE_STRINGS) expect(serialized).not.toContain(str);
    expect(serialized).not.toContain("authToken");
    expect(serialized).not.toContain("nidlogin");
  });
});
