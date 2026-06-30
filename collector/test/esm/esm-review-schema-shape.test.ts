import { describe, expect, it } from "vitest";
import {
  categorizeHeader,
  headerHash,
  HEADER_CATEGORIES,
  parseXlsxPathArg,
  rowCountBucket,
  summarizeSchemaShape,
  type WorkbookShape,
} from "../../src/esm/esm-review-schema-shape";

const SALT = "test-salt";

describe("parseXlsxPathArg", () => {
  it("reads --xlsx <path> and --xlsx=<path>; null when absent", () => {
    expect(parseXlsxPathArg(["--xlsx", "/a/b.xlsx"])).toBe("/a/b.xlsx");
    expect(parseXlsxPathArg(["--xlsx=/a/b.xlsx"])).toBe("/a/b.xlsx");
    expect(parseXlsxPathArg(["--other", "x"])).toBeNull();
    expect(parseXlsxPathArg([])).toBeNull();
  });
});

function shape(over: Partial<WorkbookShape>): WorkbookShape {
  return {
    workbookReadable: true,
    sheetCount: 1,
    selectedSheetIndex: 0,
    rowCount: 50,
    columnCount: 6,
    headers: [],
    readerRisks: [],
    ...over,
  };
}

describe("rowCountBucket", () => {
  it("is coarse and never the exact count", () => {
    expect(rowCountBucket(0)).toBe("zero");
    expect(rowCountBucket(-3)).toBe("zero");
    expect(rowCountBucket(1)).toBe("one");
    expect(rowCountBucket(9)).toBe("few");
    expect(rowCountBucket(10)).toBe("tens");
    expect(rowCountBucket(99)).toBe("tens");
    expect(rowCountBucket(100)).toBe("hundreds");
    expect(rowCountBucket(5000)).toBe("thousands_plus");
  });
});

describe("categorizeHeader — Korean + English variants (risk-first)", () => {
  it("review id candidates", () => {
    expect(categorizeHeader("리뷰글번호")).toBe("reviewIdCandidate");
    expect(categorizeHeader("리뷰번호")).toBe("reviewIdCandidate");
    expect(categorizeHeader("Review ID")).toBe("reviewIdCandidate");
    expect(categorizeHeader("평가번호")).toBe("reviewIdCandidate");
  });
  it("date candidates", () => {
    expect(categorizeHeader("작성일")).toBe("reviewDateCandidate");
    expect(categorizeHeader("등록일자")).toBe("reviewDateCandidate");
    expect(categorizeHeader("Review Date")).toBe("reviewDateCandidate");
  });
  it("rating candidates", () => {
    expect(categorizeHeader("평점")).toBe("ratingCandidate");
    expect(categorizeHeader("별점")).toBe("ratingCandidate");
    expect(categorizeHeader("Rating")).toBe("ratingCandidate");
  });
  it("product candidates", () => {
    expect(categorizeHeader("상품명")).toBe("productCandidate");
    expect(categorizeHeader("Product Name")).toBe("productCandidate");
    expect(categorizeHeader("상품번호")).toBe("productCandidate");
  });
  it("review text candidates", () => {
    expect(categorizeHeader("리뷰내용")).toBe("reviewTextCandidate");
    expect(categorizeHeader("후기")).toBe("reviewTextCandidate");
    expect(categorizeHeader("Content")).toBe("reviewTextCandidate");
  });
  it("reply/status candidates", () => {
    expect(categorizeHeader("답변상태")).toBe("replyStatusCandidate");
    expect(categorizeHeader("노출여부")).toBe("replyStatusCandidate");
    expect(categorizeHeader("Reply")).toBe("replyStatusCandidate");
  });
  it("PII/identity-like headers are categorised as RISK (risk-first wins over benign tokens)", () => {
    expect(categorizeHeader("구매자")).toBe("orderOrBuyerRiskCandidate");
    expect(categorizeHeader("구매자 휴대폰")).toBe("orderOrBuyerRiskCandidate");
    expect(categorizeHeader("주문번호")).toBe("orderOrBuyerRiskCandidate");
    expect(categorizeHeader("상품주문번호")).toBe("orderOrBuyerRiskCandidate"); // order beats product
    expect(categorizeHeader("이메일")).toBe("orderOrBuyerRiskCandidate");
    expect(categorizeHeader("받는분 주소")).toBe("orderOrBuyerRiskCandidate");
    expect(categorizeHeader("작성자")).toBe("orderOrBuyerRiskCandidate");
    expect(categorizeHeader("Buyer ID")).toBe("orderOrBuyerRiskCandidate");
  });
  it("unknown for unmatched / empty", () => {
    expect(categorizeHeader("zzz_misc_col")).toBe("unknown");
    expect(categorizeHeader("   ")).toBe("unknown");
  });
});

describe("headerHash", () => {
  it("is a stable 16-hex non-reversible token; same text → same hash", () => {
    const h = headerHash(SALT, "리뷰내용");
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(headerHash(SALT, "  리뷰내용  ")).toBe(h); // whitespace-normalised
    expect(headerHash(SALT, "리뷰내용")).not.toContain("리뷰");
  });
  it("differs by salt", () => {
    expect(headerHash("a", "x")).not.toBe(headerHash("b", "x"));
  });
});

describe("summarizeSchemaShape — sanitized output", () => {
  const headers = ["리뷰글번호", "작성일", "평점", "상품명", "리뷰내용", "답변상태"];

  it("valid workbook: shape + categories + dedup candidate, nothing CONFIRMED", () => {
    const out = summarizeSchemaShape(shape({ headers, rowCount: 50, columnCount: 6 }), SALT);
    expect(out.workbookReadable).toBe(true);
    expect(out.sheetCount).toBe(1);
    expect(out.selectedSheetIndex).toBe(0);
    expect(out.rowCountBucket).toBe("tens");
    expect(out.columnCount).toBe(6);
    expect(out.headerCount).toBe(6);
    expect(out.categoryPresence.reviewIdCandidate).toBe(true);
    expect(out.categoryPresence.ratingCandidate).toBe(true);
    expect(out.categoryPresence.orderOrBuyerRiskCandidate).toBe(false);
    // dedup candidate is the review-id-like column, but never confirmed.
    expect(out.candidateDedupFields).toHaveLength(1);
    expect(out.candidateDedupFields[0]!.category).toBe("reviewIdCandidate");
    expect(out.candidateDedupFields[0]!.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(out.dedupKeyConfirmed).toBe(false);
    expect(out.schemaMappingConfirmed).toBe(false);
    expect(out.rawCellLeak).toBe(false);
    expect(out.uploaded).toBe(false);
    expect(out.rowsParsed).toBe(false);
  });

  it("headerMeta carries hash + category only — NEVER the raw header text", () => {
    const out = summarizeSchemaShape(shape({ headers }), SALT);
    const serialized = JSON.stringify(out);
    for (const raw of headers) {
      expect(serialized).not.toContain(raw);
    }
    // No Hangul leaks at all.
    expect(/[가-힣]/.test(serialized)).toBe(false);
    expect(out.headerMeta.every((h) => /^[0-9a-f]{16}$/.test(h.hash) && HEADER_CATEGORIES.includes(h.category))).toBe(
      true,
    );
  });

  it("PII-like headers raise a sanitized risk and are NOT printed raw", () => {
    const piiHeaders = ["리뷰글번호", "구매자 휴대폰번호", "받는분 주소", "이메일주소"];
    const out = summarizeSchemaShape(shape({ headers: piiHeaders }), SALT);
    expect(out.categoryPresence.orderOrBuyerRiskCandidate).toBe(true);
    expect(out.risks).toContain("pii-like-header-present");
    const serialized = JSON.stringify(out);
    for (const raw of piiHeaders) expect(serialized).not.toContain(raw);
    expect(serialized).not.toContain("휴대폰");
    expect(serialized).not.toContain("주소");
  });

  it("empty workbook → zero bucket + empty-workbook risk", () => {
    const out = summarizeSchemaShape(shape({ headers: [], rowCount: 0, columnCount: 0 }), SALT);
    expect(out.rowCountBucket).toBe("zero");
    expect(out.headerCount).toBe(0);
    expect(out.risks).toContain("empty-workbook");
    expect(out.risks).toContain("no-dedup-key-candidate");
  });

  it("rows but no header row → no-header-row risk", () => {
    const out = summarizeSchemaShape(shape({ headers: [], rowCount: 12 }), SALT);
    expect(out.risks).toContain("no-header-row");
  });

  it("unreadable workbook → unreadable risk, reader risks passed through", () => {
    const out = summarizeSchemaShape(
      shape({ workbookReadable: false, sheetCount: 0, selectedSheetIndex: null, rowCount: 0, columnCount: 0, readerRisks: ["not-zip-container"] }),
      SALT,
    );
    expect(out.workbookReadable).toBe(false);
    expect(out.risks).toContain("not-zip-container");
    expect(out.risks).toContain("unreadable-workbook");
  });

  it("multiple sheets flagged", () => {
    const out = summarizeSchemaShape(shape({ headers, sheetCount: 3 }), SALT);
    expect(out.risks).toContain("multiple-sheets");
  });

  it("no review-id-like header → no-dedup-key-candidate risk, dedup stays unconfirmed", () => {
    const out = summarizeSchemaShape(shape({ headers: ["작성일", "평점", "상품명"] }), SALT);
    expect(out.candidateDedupFields).toHaveLength(0);
    expect(out.risks).toContain("no-dedup-key-candidate");
    expect(out.dedupKeyConfirmed).toBe(false);
  });
});
