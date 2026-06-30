import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  classifyCellValue,
  summarizeRowShape,
  type SanitizedRowShape,
} from "../../src/esm/esm-review-row-shape";
import type { WorkbookRowSample } from "../../src/esm/esm-review-xlsx-reader";

const SALT = "test-salt";

/** Build a WorkbookRowSample from column-aligned fake headers + rows (all SAFE fake values). */
function sample(headerCells: Array<string | null>, sampleRows: Array<Array<string | null>>, rowCount?: number): WorkbookRowSample {
  return {
    workbookReadable: true,
    sheetCount: 1,
    selectedSheetIndex: 0,
    rowCount: rowCount ?? sampleRows.length + 1,
    columnCount: headerCells.length,
    headers: headerCells.filter((h): h is string => !!h && h.trim().length > 0),
    readerRisks: [],
    headerCells,
    sampleRows,
  };
}

// A 7-column fixture mirroring the ESM categories, with SAFE FAKE values (incl. fake PII).
const HEADERS = ["리뷰내용", "평점", "상품명", "작성일", "구매자휴대폰", "답변상태", "noticecode"];
const ROWS: Array<Array<string | null>> = [
  ["정말최고예요", "5", "무선마우스", "2026-06-01", "01012345678", "답변완료", "AB12CD"],
  ["배송빨라요", "5", "기계식키보드", "2026-06-02", "01099998888", "미답변", "EF34GH"],
  ["그냥그래요", "5", "USB허브", "2026-06-03", "01077776666", "답변완료", "IJ56KL"],
];
const FIXTURE = sample(HEADERS, ROWS, 4);

describe("classifyCellValue", () => {
  it("classifies coarse value shapes, value-blind", () => {
    expect(classifyCellValue(null)).toBe("empty");
    expect(classifyCellValue("   ")).toBe("empty");
    expect(classifyCellValue("2026-06-01")).toBe("date-like");
    expect(classifyCellValue("2026.06.01 12:30")).toBe("date-like");
    expect(classifyCellValue("5")).toBe("numeric-small");
    expect(classifyCellValue("01012345678")).toBe("numeric-long");
    expect(classifyCellValue("AB12CD")).toBe("id-like");
    expect(classifyCellValue("좋아요")).toBe("text-short");
    expect(classifyCellValue("정말 ".repeat(20).trim())).toBe("text-long");
  });
});

describe("summarizeRowShape — per-column signals", () => {
  const out = summarizeRowShape(FIXTURE, SALT);
  const byCat = (c: string) => out.columns.filter((col) => col.category === c);

  it("categorises columns and reads populated/distinctness/value-class", () => {
    expect(out.columnCount).toBe(7);
    const text = byCat("reviewTextCandidate")[0]!;
    expect(text.populated).toBe("all");
    expect(text.distinctness).toBe("all-distinct");
    expect(text.valueClass).toBe("text-short");

    const rating = byCat("ratingCandidate")[0]!;
    expect(rating.distinctness).toBe("all-same");
    expect(rating.enumLike).toBe(true);
    expect(rating.valueClass).toBe("numeric-small");
  });

  it("emits value hashes for non-PII columns but NEVER for PII-like columns", () => {
    const text = byCat("reviewTextCandidate")[0]!;
    expect(text.valueHashes).toHaveLength(3);
    const pii = byCat("orderOrBuyerRiskCandidate")[0]!;
    expect(pii.valueHashes).toBeUndefined();
    expect(pii.populated).toBe("all"); // presence still reported
  });

  it("evaluates dedup feasibility and suspects an id-like unknown column as a natural key", () => {
    expect(out.dedup.l1Feasible).toBe(true); // date+product+rating+text populated, text discriminates
    expect(out.dedup.idColumnSuspected).toBe(true); // 'noticecode' unknown col is id-like + all-distinct
  });

  it("holds honest markers — rows inspected, but no leak and nothing confirmed", () => {
    expect(out.minimalRowsInspected).toBe(true);
    expect(out.rawCellLeak).toBe(false);
    expect(out.schemaMappingConfirmed).toBe(false);
    expect(out.dedupKeyConfirmed).toBe(false);
    expect(out.sampledRowBucket).toBe("few");
    expect(out.risks).toContain("pii-like-header-present");
  });
});

describe("summarizeRowShape — no raw value ever leaves the module", () => {
  it("JSON output contains no raw header or cell value", () => {
    const json = JSON.stringify(summarizeRowShape(FIXTURE, SALT));
    // Check distinctive raws (containing a non-hex char) so a match can't be a hash substring;
    // pure-digit raws (e.g. "5", phone digits) are covered structurally (PII cols emit no hash).
    const distinctive = [...HEADERS, ...ROWS.flat()].filter(
      (v): v is string => !!v && /[^0-9a-fA-F]/.test(v),
    );
    expect(distinctive.length).toBeGreaterThan(5);
    for (const raw of distinctive) expect(json).not.toContain(raw);
  });

  it("same value+salt ⇒ same hash; different salt ⇒ different hash (non-reversible)", () => {
    const a = summarizeRowShape(FIXTURE, SALT).columns[0]!.valueHashes!;
    const b = summarizeRowShape(FIXTURE, "other-salt").columns[0]!.valueHashes!;
    expect(a[0]).toBe(summarizeRowShape(FIXTURE, SALT).columns[0]!.valueHashes![0]);
    expect(a[0]).not.toBe(b[0]);
    expect(a[0]).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("summarizeRowShape — edge cases", () => {
  it("no sampled rows ⇒ honest empty, no leak, sanitized risks", () => {
    const out = summarizeRowShape(sample(HEADERS, []), SALT);
    expect(out.minimalRowsInspected).toBe(false);
    expect(out.sampledRowBucket).toBe("zero");
    expect(out.risks).toContain("no-populated-data-rows");
    for (const col of out.columns) expect(col.populated).toBe("none");
  });

  it("a single sampled row flags distinctness as unreliable", () => {
    const out = summarizeRowShape(sample(HEADERS, [ROWS[0]!]), SALT);
    expect(out.risks).toContain("single-sample-row");
    for (const col of out.columns) expect(col.distinctness).toBe("n/a");
    expect(out.dedup.notes).toContain("single-sample-row-distinctness-unreliable");
  });
});

describe("esm-review-row-shape — module purity (pure analyser, no I/O / browser / scheduler)", () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const SRC = join(__dirname, "..", "..", "src", "esm", "esm-review-row-shape.ts");
  const raw = readFileSync(SRC, "utf8");
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const importLines = code.split("\n").filter((l) => /^\s*import\b/.test(l));

  it("imports the reader type-only (no fs/zlib runtime pulled in)", () => {
    for (const l of importLines) {
      if (l.includes("esm-review-xlsx-reader")) expect(/^\s*import\s+type\b/.test(l)).toBe(true);
    }
  });

  it("value-imports no browser / upload / status / scheduler / fs modules", () => {
    for (const forbidden of [
      "playwright",
      "../status",
      "../upload",
      "review-export",
      "review-download-save",
      "capture-esm-review",
      "node:fs",
      "node:zlib",
      "node:http",
      "child_process",
    ]) {
      expect(importLines.some((l) => l.includes(forbidden))).toBe(false);
    }
  });

  it("contains no wall-clock / timer / scheduler / writer tokens", () => {
    for (const token of [
      "Date.now",
      "Date.parse",
      "new Date",
      "setInterval",
      "setTimeout",
      "cron",
      "manualSync",
      "scheduler",
      "writeStatus",
      "saveAs",
      "writeFileSync",
    ]) {
      expect(code.includes(token)).toBe(false);
    }
  });
});

// Type-level: the emitted shape never carries a raw-string field.
const _shapeHasNoRawField: SanitizedRowShape = summarizeRowShape(FIXTURE, SALT);
void _shapeHasNoRawField;
