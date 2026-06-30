import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  columnLetterToNumber,
  countSheets,
  parseSharedStrings,
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
