import { describe, expect, it } from "vitest";
import {
  IDENTITY_CATEGORIES,
  normalizeRating,
  normalizeReviewDate,
  summarizeCompositeKeys,
} from "../../src/esm/esm-review-composite-key";
import type { WorkbookRowSample } from "../../src/esm/esm-review-xlsx-reader";

// Column order used throughout: date | product | rating | reviewText | replyStatus | buyer(PII).
const HEADERS = ["작성일", "상품명", "평점", "리뷰내용", "답변상태", "구매자명"];

function sample(
  rows: ReadonlyArray<ReadonlyArray<string | null>>,
  opts: { readable?: boolean; rowCount?: number; headerCells?: ReadonlyArray<string | null> } = {},
): WorkbookRowSample {
  const headerCells = opts.headerCells ?? HEADERS;
  return {
    workbookReadable: opts.readable ?? true,
    sheetCount: 1,
    selectedSheetIndex: 0,
    rowCount: opts.rowCount ?? rows.length + 1,
    columnCount: headerCells.length,
    headers: headerCells.filter((h): h is string => h !== null && h.trim().length > 0),
    readerRisks: [],
    headerCells,
    sampleRows: rows,
  };
}

const R1 = ["2026-06-01", "Widget", "5", "great product", "미답변", "홍길동"];
// Same review as R1, but the reply status AND buyer differ (both non-identity).
const R1_REPLIED = ["2026-06-01", "Widget", "5", "great product", "답변완료", "김철수"];

const SALT = "shared-salt";

describe("normalizeReviewDate / normalizeRating", () => {
  it("canonicalises separators + zero-pad so the same day aligns", () => {
    expect(normalizeReviewDate("2026.6.1")).toBe("2026-06-01");
    expect(normalizeReviewDate("2026/06/01")).toBe("2026-06-01");
    expect(normalizeReviewDate("2026-06-01 09:05:33")).toBe("2026-06-01T09:05");
    expect(normalizeReviewDate("2026-06-01")).toBe("2026-06-01");
  });
  it("falls back to a stable lowered form when unparseable", () => {
    expect(normalizeReviewDate("  Yesterday ")).toBe("yesterday");
  });
  it("reduces a rating to its leading numeric token", () => {
    expect(normalizeRating("5점")).toBe("5");
    expect(normalizeRating("5.0")).toBe("5.0");
    expect(normalizeRating("★★★★★")).toBe("★★★★★".toLowerCase());
  });
});

describe("summarizeCompositeKeys — same review → same key (repeatability + replyStatus invariance)", () => {
  it("produces identical L1/L2/L3 + context when only replyStatus and buyer differ", () => {
    const a = summarizeCompositeKeys(sample([R1]), { salt: SALT });
    const b = summarizeCompositeKeys(sample([R1_REPLIED]), { salt: SALT });
    const ra = a.rows[0]!;
    const rb = b.rows[0]!;
    expect(ra.l1).not.toBeNull();
    expect(ra.l1).toBe(rb.l1);
    expect(ra.l2).toBe(rb.l2);
    expect(ra.l3).toBe(rb.l3);
    expect(ra.context).toBe(rb.context);
  });

  it("is stable across date-format drift (2026-06-01 vs 2026.6.1)", () => {
    const a = summarizeCompositeKeys(sample([R1]), { salt: SALT });
    const drift = ["2026.6.1", "Widget", "5", "great product", "미답변", "홍길동"];
    const b = summarizeCompositeKeys(sample([drift]), { salt: SALT });
    expect(a.rows[0]!.l1).toBe(b.rows[0]!.l1);
  });
});

describe("summarizeCompositeKeys — different reviews differ; degraded levels", () => {
  it("a different reviewText changes L1 but keeps the (text-free) L2/L3", () => {
    const a = summarizeCompositeKeys(sample([R1]), { salt: SALT });
    const diffText = ["2026-06-01", "Widget", "5", "totally different body", "미답변", "홍길동"];
    const b = summarizeCompositeKeys(sample([diffText]), { salt: SALT });
    expect(a.rows[0]!.l1).not.toBe(b.rows[0]!.l1);
    expect(a.rows[0]!.l2).toBe(b.rows[0]!.l2);
    expect(a.rows[0]!.l3).toBe(b.rows[0]!.l3);
    expect(a.rows[0]!.context).not.toBe(b.rows[0]!.context);
  });

  it("empty reviewText cell ⇒ L1 null but L2/L3 present", () => {
    const noText = ["2026-06-01", "Widget", "5", "", "미답변", "홍길동"];
    const out = summarizeCompositeKeys(sample([noText]), { salt: SALT });
    expect(out.rows[0]!.l1).toBeNull();
    expect(out.rows[0]!.l2).not.toBeNull();
    expect(out.rows[0]!.l3).not.toBeNull();
  });

  it("an absent reviewText COLUMN flags L1 as unreachable", () => {
    // Header set without a reviewText column (date | product | rating | replyStatus).
    const headerCells = ["작성일", "상품명", "평점", "답변상태"];
    const row = ["2026-06-01", "Widget", "5", "미답변"];
    const out = summarizeCompositeKeys(sample([row], { headerCells }), { salt: SALT });
    expect(out.rows[0]!.l1).toBeNull();
    expect(out.rows[0]!.l2).not.toBeNull();
    expect(out.risks).toContain("reviewText-column-absent-l1-unreachable");
  });

  it("empty product cell ⇒ all levels null for that row (no key reachable)", () => {
    const noProduct = ["2026-06-01", "", "5", "great product", "미답변", "홍길동"];
    const out = summarizeCompositeKeys(sample([noProduct]), { salt: SALT });
    expect(out.rows[0]!.l1).toBeNull();
    expect(out.rows[0]!.l2).toBeNull();
    expect(out.rows[0]!.l3).toBeNull();
  });

  it("an absent product COLUMN flags weak-or-no-key-reachable", () => {
    const headerCells = ["작성일", "평점", "리뷰내용"]; // no product column
    const row = ["2026-06-01", "5", "great product"];
    const out = summarizeCompositeKeys(sample([row], { headerCells }), { salt: SALT });
    expect(out.rows[0]!.l3).toBeNull();
    expect(out.risks).toContain("weak-or-no-key-reachable");
  });
});

describe("summarizeCompositeKeys — exclusions, salting, sanitisation", () => {
  it("excludes replyStatus + PII (and review-id/unknown) from identity", () => {
    const out = summarizeCompositeKeys(sample([R1]), { salt: SALT });
    expect(out.excludedCategories).toContain("replyStatusCandidate");
    expect(out.excludedCategories).toContain("orderOrBuyerRiskCandidate");
    for (const identity of IDENTITY_CATEGORIES) {
      expect(out.excludedCategories).not.toContain(identity);
    }
    expect(out.risks).toContain("reply-status-present-excluded");
    expect(out.risks).toContain("pii-like-header-present-excluded");
  });

  it("depends on the salt (different salt ⇒ different key)", () => {
    const a = summarizeCompositeKeys(sample([R1]), { salt: "salt-a" });
    const b = summarizeCompositeKeys(sample([R1]), { salt: "salt-b" });
    expect(a.rows[0]!.l1).not.toBe(b.rows[0]!.l1);
    // ...but deterministic for the same salt.
    const a2 = summarizeCompositeKeys(sample([R1]), { salt: "salt-a" });
    expect(a.rows[0]!.l1).toBe(a2.rows[0]!.l1);
  });

  it("store fingerprint namespaces keys and is reported as a boolean only", () => {
    const withFp = summarizeCompositeKeys(sample([R1]), { salt: SALT, storeFingerprint: "store-fp-hash" });
    const withoutFp = summarizeCompositeKeys(sample([R1]), { salt: SALT });
    expect(withFp.storeFingerprintApplied).toBe(true);
    expect(withoutFp.storeFingerprintApplied).toBe(false);
    expect(withFp.rows[0]!.l1).not.toBe(withoutFp.rows[0]!.l1);
    expect(JSON.stringify(withFp)).not.toContain("store-fp-hash");
  });

  it("leaks no raw header or cell value into the output", () => {
    const out = summarizeCompositeKeys(sample([R1, R1_REPLIED]), { salt: SALT });
    const json = JSON.stringify(out);
    for (const raw of ["작성일", "상품명", "평점", "리뷰내용", "답변상태", "구매자명"]) {
      expect(json).not.toContain(raw);
    }
    for (const raw of ["Widget", "great product", "미답변", "답변완료", "홍길동", "김철수", "2026-06-01"]) {
      expect(json).not.toContain(raw);
    }
    expect(out.rawCellLeak).toBe(false);
    expect(out.dedupKeyConfirmed).toBe(false);
    expect(out.schemaMappingConfirmed).toBe(false);
  });

  it("channel literal is emitted (safe) and coverage is bucketed", () => {
    const out = summarizeCompositeKeys(sample([R1, R1_REPLIED]), { salt: SALT });
    expect(out.channel).toBe("esmplus");
    expect(out.sampledRowBucket).toBe("few");
    expect(out.coverage.l1).toBe("few");
  });

  it("fails soft on an unreadable workbook", () => {
    const out = summarizeCompositeKeys(sample([], { readable: false, rowCount: 0 }), { salt: SALT });
    expect(out.workbookReadable).toBe(false);
    expect(out.rows).toEqual([]);
    expect(out.risks).toContain("unreadable-workbook");
  });
});
