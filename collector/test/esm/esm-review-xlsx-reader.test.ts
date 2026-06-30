import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  columnLetterToNumber,
  countSheets,
  extractDataCells,
  parseSharedStrings,
  readWorkbookRowSample,
  readWorkbookShape,
  scanSheetXml,
} from "../../src/esm/esm-review-xlsx-reader";

// ---- a minimal, real STORED (uncompressed) ZIP builder — exercises the ZIP plumbing ----

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

const WORKBOOK_ONE_SHEET = `<?xml version="1.0"?><workbook><sheets><sheet name="reviews" sheetId="1" r:id="rId1"/></sheets></workbook>`;

const dir = mkdtempSync(join(tmpdir(), "esm-xlsx-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function writeXlsx(name: string, files: Array<{ name: string; content: string }>): string {
  const p = join(dir, name);
  writeFileSync(p, storedZip(files));
  return p;
}

// ---- pure XML scanners --------------------------------------------------------------

describe("columnLetterToNumber", () => {
  it("maps column letters to 1-based indices", () => {
    expect(columnLetterToNumber("A")).toBe(1);
    expect(columnLetterToNumber("Z")).toBe(26);
    expect(columnLetterToNumber("AA")).toBe(27);
    expect(columnLetterToNumber("AB")).toBe(28);
  });
});

describe("countSheets", () => {
  it("counts <sheet> definitions", () => {
    expect(countSheets(WORKBOOK_ONE_SHEET)).toBe(1);
    expect(
      countSheets(`<workbook><sheets><sheet name="a"/><sheet name="b"/><sheet name="c"/></sheets></workbook>`),
    ).toBe(3);
    expect(countSheets(`<workbook><sheets/></workbook>`)).toBe(0);
  });
});

describe("parseSharedStrings", () => {
  it("resolves <si>/<t> entries (incl. rich-run concatenation)", () => {
    const xml = `<sst><si><t>리뷰글번호</t></si><si><t>평점</t></si><si><r><t>리뷰</t></r><r><t>내용</t></r></si></sst>`;
    expect(parseSharedStrings(xml)).toEqual(["리뷰글번호", "평점", "리뷰내용"]);
  });
  it("decodes xml entities", () => {
    expect(parseSharedStrings(`<sst><si><t>a&amp;b &lt;x&gt;</t></si></sst>`)).toEqual(["a&b <x>"]);
  });
});

describe("scanSheetXml", () => {
  it("counts rows, reads dimension width, and extracts header-row cells", () => {
    const xml = `<worksheet><dimension ref="A1:C3"/><sheetData>
      <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>
      <row r="2"><c r="A2" t="s"><v>3</v></c></row>
      <row r="3"><c r="A3" t="s"><v>4</v></c></row>
    </sheetData></worksheet>`;
    const scan = scanSheetXml(xml);
    expect(scan.rowCount).toBe(3);
    expect(scan.dimensionColumns).toBe(3);
    expect(scan.firstRowCells).toHaveLength(3);
    expect(scan.firstRowCells[0]).toEqual({ type: "s", v: "0", inline: null });
  });
  it("handles inlineStr header cells", () => {
    const xml = `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Rating</t></is></c></row></sheetData></worksheet>`;
    const scan = scanSheetXml(xml);
    expect(scan.firstRowCells[0]!.inline).toBe("Rating");
  });

  it("maxDataRows=0 (default) leaves the header path unchanged and collects no data rows", () => {
    const xml = `<worksheet><sheetData>
      <row r="1"><c r="A1" t="s"><v>0</v></c></row>
      <row r="2"><c r="A2" t="s"><v>1</v></c></row>
    </sheetData></worksheet>`;
    expect(scanSheetXml(xml).dataRows).toBeUndefined();
  });

  it("maxDataRows>0 collects the first N populated, column-aware data rows (skipping the header)", () => {
    const xml = `<worksheet><dimension ref="A1:C4"/><sheetData>
      <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>
      <row r="2"><c r="A2" t="s"><v>3</v></c><c r="C2" t="s"><v>4</v></c></row>
      <row r="3"/>
      <row r="4"><c r="B4" t="s"><v>5</v></c></row>
    </sheetData></worksheet>`;
    const scan = scanSheetXml(xml, 5);
    // Header (row 1) excluded; blank row 3 (self-closing) skipped; rows 2 and 4 captured.
    expect(scan.dataRows).toHaveLength(2);
    // Row 2 cells carry their 1-based column index (A=1, C=3) — B is simply absent.
    expect(scan.dataRows![0]!.map((c) => c.col)).toEqual([1, 3]);
    expect(scan.dataRows![1]!.map((c) => c.col)).toEqual([2]);
  });
});

describe("extractDataCells", () => {
  it("reads each cell's 1-based column, type, and value", () => {
    const cells = extractDataCells(`<c r="A2" t="s"><v>7</v></c><c r="C2" t="inlineStr"><is><t>hi</t></is></c>`);
    expect(cells).toEqual([
      { col: 1, type: "s", v: "7", inline: null },
      { col: 3, type: "inlineStr", v: null, inline: "hi" },
    ]);
  });
});

describe("readWorkbookRowSample — first-N data rows, column-aligned", () => {
  const WB = WORKBOOK_ONE_SHEET;
  // shared indices: 0-2 headers, 3-8 data values (incl. fake PII-like values).
  const shared = `<sst>` +
    `<si><t>리뷰내용</t></si><si><t>평점</t></si><si><t>구매자휴대폰</t></si>` +
    `<si><t>정말좋아요</t></si><si><t>배송빨라요</t></si>` +
    `</sst>`;
  const sheet = `<worksheet><dimension ref="A1:C4"/><sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>
    <row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2"><v>5</v></c><c r="C2"><v>01011112222</v></c></row>
    <row r="3"><c r="A3" t="s"><v>4</v></c><c r="B3"><v>4</v></c></row>
  </sheetData></worksheet>`;

  it("returns column-aligned header + sample rows when maxDataRows>0", () => {
    const p = writeXlsx("rowsample.xlsx", [
      { name: "xl/workbook.xml", content: WB },
      { name: "xl/worksheets/sheet1.xml", content: sheet },
      { name: "xl/sharedStrings.xml", content: shared },
    ]);
    const s = readWorkbookRowSample(p, 3);
    expect(s.workbookReadable).toBe(true);
    expect(s.columnCount).toBe(3);
    expect(s.headerCells).toEqual(["리뷰내용", "평점", "구매자휴대폰"]);
    expect(s.sampleRows).toHaveLength(2);
    expect(s.sampleRows[0]).toEqual(["정말좋아요", "5", "01011112222"]);
    // Column C empty on row 3 ⇒ null in that column (column alignment preserved).
    expect(s.sampleRows[1]).toEqual(["배송빨라요", "4", null]);
  });

  it("maxDataRows=0 reads no data rows (header-only handoff)", () => {
    const p = writeXlsx("rowsample0.xlsx", [
      { name: "xl/workbook.xml", content: WB },
      { name: "xl/worksheets/sheet1.xml", content: sheet },
      { name: "xl/sharedStrings.xml", content: shared },
    ]);
    const s = readWorkbookRowSample(p, 0);
    expect(s.sampleRows).toEqual([]);
    expect(s.headerCells).toHaveLength(3);
  });

  it("unreadable input → empty samples + sanitized risk (no throw)", () => {
    const s = readWorkbookRowSample(join(dir, "nope.xlsx"), 3);
    expect(s.workbookReadable).toBe(false);
    expect(s.sampleRows).toEqual([]);
    expect(s.readerRisks).toContain("file-not-found");
  });
});

// ---- end-to-end readWorkbookShape over a real stored-ZIP xlsx ------------------------

describe("readWorkbookShape — real stored-ZIP xlsx", () => {
  it("reads sheet/row/column shape and resolves ONLY the header row", () => {
    const sheet = `<worksheet><dimension ref="A1:C3"/><sheetData>
      <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>
      <row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2" t="s"><v>4</v></c></row>
      <row r="3"><c r="A3" t="s"><v>5</v></c></row>
    </sheetData></worksheet>`;
    // indices 3..5 are DATA-row strings (PII-like) the reader must never surface.
    const shared = `<sst><si><t>리뷰글번호</t></si><si><t>평점</t></si><si><t>리뷰내용</t></si><si><t>구매자휴대폰</t></si><si><t>정말좋아요</t></si><si><t>홍길동</t></si></sst>`;
    const p = writeXlsx("ok.xlsx", [
      { name: "xl/workbook.xml", content: WORKBOOK_ONE_SHEET },
      { name: "xl/worksheets/sheet1.xml", content: sheet },
      { name: "xl/sharedStrings.xml", content: shared },
    ]);
    const shape = readWorkbookShape(p);
    expect(shape.workbookReadable).toBe(true);
    expect(shape.sheetCount).toBe(1);
    expect(shape.selectedSheetIndex).toBe(0);
    expect(shape.rowCount).toBe(3);
    expect(shape.columnCount).toBe(3);
    // ONLY the header row (row 1) is resolved — data-row strings are not read.
    expect(shape.headers).toEqual(["리뷰글번호", "평점", "리뷰내용"]);
    expect(shape.headers).not.toContain("구매자휴대폰");
    expect(shape.headers).not.toContain("정말좋아요");
    expect(shape.headers).not.toContain("홍길동");
  });

  it("empty worksheet → readable, zero rows, no headers", () => {
    const p = writeXlsx("empty.xlsx", [
      { name: "xl/workbook.xml", content: WORKBOOK_ONE_SHEET },
      { name: "xl/worksheets/sheet1.xml", content: `<worksheet><sheetData/></worksheet>` },
    ]);
    const shape = readWorkbookShape(p);
    expect(shape.workbookReadable).toBe(true);
    expect(shape.rowCount).toBe(0);
    expect(shape.headers).toEqual([]);
  });

  it("not a ZIP container → unreadable + sanitized risk", () => {
    const p = join(dir, "plain.txt");
    writeFileSync(p, "this is not a zip");
    const shape = readWorkbookShape(p);
    expect(shape.workbookReadable).toBe(false);
    expect(shape.readerRisks).toContain("not-zip-container");
  });

  it("zip without a workbook part → unreadable + sanitized risk", () => {
    const p = writeXlsx("nowb.xlsx", [{ name: "docProps/core.xml", content: "<x/>" }]);
    const shape = readWorkbookShape(p);
    expect(shape.workbookReadable).toBe(false);
    expect(shape.readerRisks).toContain("no-workbook-part");
  });

  it("missing file → unreadable + sanitized risk (no throw)", () => {
    const shape = readWorkbookShape(join(dir, "does-not-exist.xlsx"));
    expect(shape.workbookReadable).toBe(false);
    expect(shape.readerRisks).toContain("file-not-found");
  });
});
