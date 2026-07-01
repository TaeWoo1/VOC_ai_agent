import { describe, expect, it } from "vitest";
import { summarizeCompositeKeys } from "../../src/esm/esm-review-composite-key";
import { summarizeOverlap } from "../../src/esm/esm-review-overlap";
import type { WorkbookRowSample } from "../../src/esm/esm-review-xlsx-reader";

const HEADERS = ["작성일", "상품명", "평점", "리뷰내용", "답변상태", "구매자명"];
const SALT = "shared-salt";

function sample(
  rows: ReadonlyArray<ReadonlyArray<string | null>>,
  headerCells: ReadonlyArray<string | null> = HEADERS,
): WorkbookRowSample {
  return {
    workbookReadable: true,
    sheetCount: 1,
    selectedSheetIndex: 0,
    rowCount: rows.length + 1,
    columnCount: headerCells.length,
    headers: headerCells.filter((h): h is string => h !== null && h.trim().length > 0),
    readerRisks: [],
    headerCells,
    sampleRows: rows,
  };
}

const R1 = ["2026-06-01", "Widget", "5", "great product", "미답변", "홍길동"];
const R1_REPLIED = ["2026-06-01", "Widget", "5", "great product", "답변완료", "김철수"];
const R2 = ["2026-06-02", "Gadget", "4", "ok item", "미답변", "이영희"];
const A_ONLY = ["2026-06-03", "Thing", "3", "meh", "미답변", "박민수"];
const B_ONLY = ["2026-05-30", "Doohickey", "2", "bad", "미답변", "최지은"];

const keysOf = (rows: ReadonlyArray<ReadonlyArray<string | null>>) => summarizeCompositeKeys(sample(rows), { salt: SALT });

describe("summarizeOverlap — same review → same key across two exports", () => {
  it("detects the overlapping reviews and reports comparable", () => {
    // A = {R1, R2, A_ONLY}; B = {R1(reply changed), R2, B_ONLY}. Overlap on R1+R2.
    const a = keysOf([R1, R2, A_ONLY]);
    const b = keysOf([R1_REPLIED, R2, B_ONLY]);
    const v = summarizeOverlap(a, b);
    expect(v.comparable).toBe(true);
    expect(v.channelMatch).toBe(true);
    expect(v.slotProvenanceMatch).toBe(true);
    expect(v.excludedCategoriesMatch).toBe(true);
    expect(v.l1.overlapBucket).not.toBe("zero"); // R1 + R2 matched despite reply/buyer change
    expect(v.l1.falseMergeBucket).toBe("zero"); // L1 includes text ⇒ no false-merge possible
    expect(v.replyStatusExcludedFromIdentity).toBe(true);
  });

  it("flags zero overlap when the two ranges do not intersect", () => {
    const a = keysOf([R1]);
    const b = keysOf([B_ONLY]);
    const v = summarizeOverlap(a, b);
    expect(v.comparable).toBe(true);
    expect(v.l1.overlapBucket).toBe("zero");
    expect(v.l1.matchRate).toBe("none");
    expect(v.risks).toContain("no-overlap-check-ranges");
  });
});

describe("summarizeOverlap — false-merge (collision) on weak keys", () => {
  it("surfaces an L3 false-merge when two different reviews share date+product", () => {
    // Same day + product as R1 but a different review body ⇒ same L3, different context.
    const SAME_DAY_PRODUCT_DIFF = ["2026-06-01", "Widget", "1", "a completely different review", "미답변", "다른사람"];
    const a = keysOf([R1, SAME_DAY_PRODUCT_DIFF]);
    const b = keysOf([R1_REPLIED]);
    const v = summarizeOverlap(a, b);
    expect(v.l3.overlapBucket).not.toBe("zero");
    expect(v.l3.falseMergeBucket).not.toBe("zero"); // date+product key maps to 2 distinct contents
    expect(v.l1.falseMergeBucket).toBe("zero"); // L1 (with text) keeps them apart
    expect(v.risks).toContain("weak-key-false-merge-observed");
  });
});

describe("summarizeOverlap — fails closed on drift / unreadable", () => {
  it("channel mismatch ⇒ not comparable", () => {
    const a = keysOf([R1]);
    const b = { ...keysOf([R1]), channel: "other" as unknown as typeof a.channel };
    const v = summarizeOverlap(a, b);
    expect(v.comparable).toBe(false);
    expect(v.channelMatch).toBe(false);
    expect(v.risks).toContain("channel-mismatch");
    expect(v.l1.overlapBucket).toBe("zero");
  });

  it("slot-provenance drift (different identity columns) ⇒ not comparable", () => {
    // B built with a DIFFERENT date header ⇒ its reviewDate slot hash differs.
    const a = keysOf([R1]);
    const bHeaders = ["등록일", "상품명", "평점", "리뷰내용", "답변상태", "구매자명"];
    const b = summarizeCompositeKeys(sample([R1], bHeaders), { salt: SALT });
    const v = summarizeOverlap(a, b);
    expect(v.slotProvenanceMatch).toBe(false);
    expect(v.comparable).toBe(false);
    expect(v.risks).toContain("slot-provenance-drift");
  });

  it("unreadable export ⇒ not comparable", () => {
    const a = keysOf([R1]);
    const b = { ...keysOf([R1]), workbookReadable: false };
    const v = summarizeOverlap(a, b);
    expect(v.comparable).toBe(false);
    expect(v.risks).toContain("export-unreadable");
  });
});

describe("summarizeOverlap — sanitisation", () => {
  it("emits only sanitized metadata (no raw values) and confirms nothing", () => {
    const a = keysOf([R1, R2]);
    const b = keysOf([R1_REPLIED, R2]);
    const v = summarizeOverlap(a, b);
    const json = JSON.stringify(v);
    for (const raw of ["Widget", "great product", "미답변", "홍길동", "2026-06-01", "작성일"]) {
      expect(json).not.toContain(raw);
    }
    expect(v.rawCellLeak).toBe(false);
    expect(v.dedupKeyConfirmed).toBe(false);
    expect(v.schemaMappingConfirmed).toBe(false);
  });
});
