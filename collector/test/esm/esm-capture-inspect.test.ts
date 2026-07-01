import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  DEFAULT_ROW_SAMPLE_ROWS,
  MAX_ROW_SAMPLE_ROWS,
  MIN_ROW_SAMPLE_ROWS,
  buildCaptureInspectFn,
  clampRowSampleRows,
  deriveCaptureStop,
  parseRowSampleRowsArg,
} from "../../src/esm/esm-capture-inspect";
import type { SanitizedRowShape } from "../../src/esm/esm-review-row-shape";
import type { SanitizedSchemaShape } from "../../src/esm/esm-review-schema-shape";

// ---- minimal stored-ZIP xlsx builder (mirrors the reader test) ----------------------
function storedZip(files: Array<{ name: string; content: string }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, "utf8");
    const data = Buffer.from(f.content, "utf8");
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    const localRecord = Buffer.concat([lh, nameBuf, data]);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([ch, nameBuf]));
    locals.push(localRecord);
    offset += localRecord.length;
  }
  const localBlob = Buffer.concat(locals);
  const centralBlob = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBlob.length, 12);
  eocd.writeUInt32LE(localBlob.length, 16);
  return Buffer.concat([localBlob, centralBlob, eocd]);
}

const dir = mkdtempSync(join(tmpdir(), "esm-capture-inspect-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// A structurally valid xlsx with a header + 2 fake data rows (SAFE fake values).
const VALID_XLSX = join(dir, "valid.xlsx");
writeFileSync(
  VALID_XLSX,
  storedZip([
    { name: "xl/workbook.xml", content: `<workbook><sheets><sheet name="reviews" sheetId="1"/></sheets></workbook>` },
    {
      name: "xl/worksheets/sheet1.xml",
      content: `<worksheet><dimension ref="A1:B3"/><sheetData>
        <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
        <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>5</v></c></row>
        <row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3"><v>4</v></c></row>
      </sheetData></worksheet>`,
    },
    {
      name: "xl/sharedStrings.xml",
      content: `<sst><si><t>리뷰내용</t></si><si><t>평점</t></si><si><t>좋아요</t></si><si><t>그냥</t></si></sst>`,
    },
  ]),
);
const NOT_XLSX = join(dir, "nope.xlsx");
writeFileSync(NOT_XLSX, "not a zip");

describe("parseRowSampleRowsArg / clampRowSampleRows", () => {
  it("defaults to 3 when absent or malformed", () => {
    expect(parseRowSampleRowsArg([])).toBe(DEFAULT_ROW_SAMPLE_ROWS);
    expect(parseRowSampleRowsArg(["--row-sample-rows", "abc"])).toBe(DEFAULT_ROW_SAMPLE_ROWS);
    expect(DEFAULT_ROW_SAMPLE_ROWS).toBe(3);
  });
  it("reads `--row-sample-rows N` and `=N`", () => {
    expect(parseRowSampleRowsArg(["--row-sample-rows", "4"])).toBe(4);
    expect(parseRowSampleRowsArg(["--row-sample-rows=2"])).toBe(2);
  });
  it("clamps into [1,5]", () => {
    expect(parseRowSampleRowsArg(["--row-sample-rows=0"])).toBe(MIN_ROW_SAMPLE_ROWS);
    expect(parseRowSampleRowsArg(["--row-sample-rows=99"])).toBe(MAX_ROW_SAMPLE_ROWS);
    expect(clampRowSampleRows(-3)).toBe(1);
    expect(clampRowSampleRows(7)).toBe(5);
    expect(clampRowSampleRows(Number.NaN)).toBe(DEFAULT_ROW_SAMPLE_ROWS);
  });
});

describe("buildCaptureInspectFn", () => {
  it("returns undefined when BOTH flags are off (Gate 3 path unchanged)", () => {
    expect(
      buildCaptureInspectFn({ inspectSchemaShape: false, probeRowShape: false, rowSampleRows: 3, salt: "s" }),
    ).toBeUndefined();
  });

  it("computes only schemaShape when only --inspect-schema-shape is set", async () => {
    const fn = buildCaptureInspectFn({ inspectSchemaShape: true, probeRowShape: false, rowSampleRows: 3, salt: "s" })!;
    const out = await fn(VALID_XLSX);
    expect(out.schemaShape?.workbookReadable).toBe(true);
    expect(out.rowShape).toBeNull();
  });

  it("computes only rowShape when only --probe-row-shape is set", async () => {
    const fn = buildCaptureInspectFn({ inspectSchemaShape: false, probeRowShape: true, rowSampleRows: 3, salt: "s" })!;
    const out = await fn(VALID_XLSX);
    expect(out.schemaShape).toBeNull();
    expect(out.rowShape?.workbookReadable).toBe(true);
    expect(out.rowShape?.minimalRowsInspected).toBe(true);
  });

  it("computes both shapes when both flags are set, with no raw value leaking", async () => {
    const fn = buildCaptureInspectFn({ inspectSchemaShape: true, probeRowShape: true, rowSampleRows: 3, salt: "s" })!;
    const out = await fn(VALID_XLSX);
    expect(out.schemaShape?.workbookReadable).toBe(true);
    expect(out.rowShape?.workbookReadable).toBe(true);
    expect(out.compositeKeys).toBeNull();
    const json = JSON.stringify(out);
    for (const raw of ["리뷰내용", "평점", "좋아요", "그냥"]) expect(json).not.toContain(raw);
    expect(out.rowShape?.rawCellLeak).toBe(false);
    expect(out.rowShape?.dedupKeyConfirmed).toBe(false);
    expect(out.schemaShape?.schemaMappingConfirmed).toBe(false);
  });

  it("computes only compositeKeys when only --emit-composite-key is set", async () => {
    const fn = buildCaptureInspectFn({
      inspectSchemaShape: false,
      probeRowShape: false,
      rowSampleRows: 3,
      salt: "s",
      emitCompositeKey: true,
      channel: "esmplus",
    })!;
    const out = await fn(VALID_XLSX);
    expect(out.schemaShape).toBeNull();
    expect(out.rowShape).toBeNull();
    expect(out.compositeKeys?.workbookReadable).toBe(true);
    expect(out.compositeKeys?.channel).toBe("esmplus");
    expect(out.compositeKeys?.dedupKeyConfirmed).toBe(false);
    // No raw header/cell value from the fixture leaks through the key set.
    const json = JSON.stringify(out.compositeKeys);
    for (const raw of ["리뷰내용", "평점", "좋아요", "그냥"]) expect(json).not.toContain(raw);
  });

  it("still returns undefined when ALL THREE flags are off (Gate 3 path unchanged)", () => {
    expect(
      buildCaptureInspectFn({ inspectSchemaShape: false, probeRowShape: false, rowSampleRows: 3, salt: "s", emitCompositeKey: false }),
    ).toBeUndefined();
  });
});

describe("deriveCaptureStop — precedence (fail-closed)", () => {
  const okSchema = { workbookReadable: true } as unknown as SanitizedSchemaShape;
  const okRow = { workbookReadable: true } as unknown as SanitizedRowShape;
  const badRow = { workbookReadable: false } as unknown as SanitizedRowShape;

  const base = {
    fileStructure: "xlsx-valid" as const,
    inspectSchemaShape: false,
    schemaShape: null,
    probeRowShape: false,
    rowShape: null,
    deleteFailed: false,
  };

  it("returns null when valid and no inspector failed", () => {
    expect(deriveCaptureStop(base)).toBeNull();
  });
  it("unrecognized structure wins first", () => {
    expect(deriveCaptureStop({ ...base, fileStructure: "unrecognized" })).toBe("unrecognized-format");
  });
  it("schema inspect fails closed before row-shape and delete", () => {
    expect(deriveCaptureStop({ ...base, inspectSchemaShape: true, schemaShape: null })).toBe("schema-inspect-failed");
  });
  it("row-shape fails closed when probed and unreadable", () => {
    expect(deriveCaptureStop({ ...base, probeRowShape: true, rowShape: badRow })).toBe("row-shape-inspect-failed");
    expect(deriveCaptureStop({ ...base, probeRowShape: true, rowShape: null })).toBe("row-shape-inspect-failed");
  });
  it("row-shape check is SKIPPED when --probe-row-shape is off", () => {
    expect(deriveCaptureStop({ ...base, probeRowShape: false, rowShape: badRow })).toBeNull();
  });
  it("delete failure is surfaced last", () => {
    expect(
      deriveCaptureStop({ ...base, inspectSchemaShape: true, schemaShape: okSchema, probeRowShape: true, rowShape: okRow, deleteFailed: true }),
    ).toBe("delete-failed");
  });
});

describe("esm-capture-inspect — module purity (no browser / upload / status / scheduler / wall-clock)", () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const SRC = join(__dirname, "..", "..", "src", "esm", "esm-capture-inspect.ts");
  const raw = readFileSync(SRC, "utf8");
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const importLines = code.split("\n").filter((l) => /^\s*import\b/.test(l));

  it("value-imports no browser / upload / status / scheduler / fs modules", () => {
    for (const forbidden of [
      "playwright",
      "../status",
      "../upload",
      "review-download-save",
      "review-upload",
      "node:fs",
      "node:http",
      "child_process",
    ]) {
      expect(importLines.some((l) => l.includes(forbidden))).toBe(false);
    }
  });

  it("contains no click / download / writer / scheduler / wall-clock tokens", () => {
    for (const token of [
      ".click(",
      'waitForEvent("download")',
      "saveAs",
      "writeStatus",
      "uploadReviewFile",
      "manualSync",
      "scheduler",
      "setInterval",
      "setTimeout",
      "cron",
      "Date.now",
      "new Date",
    ]) {
      expect(code.includes(token)).toBe(false);
    }
  });
});
