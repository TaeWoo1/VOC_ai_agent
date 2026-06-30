import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import type { WorkbookShape } from "./esm-review-schema-shape";

/**
 * Dependency-free, READ-ONLY structural reader for an xlsx workbook (Gate 4).
 *
 * An xlsx is a ZIP of XML parts. This reader opens the file, walks the ZIP central
 * directory, inflates ONLY the parts needed for *shape* (`xl/workbook.xml`, the first
 * worksheet, and `xl/sharedStrings.xml`), and scans them with bounded regex to count
 * sheets / rows / columns and to resolve the HEADER row's text. It reads **no data
 * row's cell values** — only row 1 (the header) is resolved, and even that is handed to
 * the pure summariser purely to be hashed/categorised (never emitted).
 *
 * Uses only Node built-ins (`node:fs`, `node:zlib`) so it adds NO dependency and keeps
 * `package.json`/lock unchanged. ZIP64 / encrypted / unexpected containers fail closed
 * (`workbookReadable:false` + a sanitized reader-risk token) — never a throw to the CLI.
 */

const LFH_SIG = 0x04034b50; // local file header
const CDH_SIG = 0x02014b50; // central directory header
const EOCD_SIG = 0x06054b50; // end of central directory

/** Walk the ZIP central directory; return name → decompressed bytes, or null if not a ZIP. */
function readZipEntries(buf: Buffer): Map<string, Buffer> | null {
  if (buf.length < 22) return null;
  // xlsx starts with a local file header "PK\x03\x04".
  if (buf.readUInt32LE(0) !== LFH_SIG) return null;

  // Find the End Of Central Directory record (scan back over the optional comment).
  let eocd = -1;
  const minPos = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= minPos; i -= 1) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;

  const entryCount = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  // 0xffff/0xffffffff sentinels mean ZIP64 — not supported here (fail closed upstream).
  if (entryCount === 0xffff || cdOffset === 0xffffffff) return null;

  const entries = new Map<string, Buffer>();
  let p = cdOffset;
  for (let n = 0; n < entryCount; n += 1) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CDH_SIG) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);

    if (localOffset + 30 <= buf.length && buf.readUInt32LE(localOffset) === LFH_SIG) {
      const lNameLen = buf.readUInt16LE(localOffset + 26);
      const lExtraLen = buf.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + lNameLen + lExtraLen;
      const comp = buf.subarray(dataStart, dataStart + compSize);
      let content: Buffer;
      try {
        content = method === 0 ? Buffer.from(comp) : inflateRawSync(comp);
      } catch {
        content = Buffer.alloc(0);
      }
      entries.set(name, content);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Minimal XML entity decode — enough for header text resolution. */
function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, "&");
}

/** Pure: number of `<sheet>` definitions in `xl/workbook.xml`. */
export function countSheets(workbookXml: string): number {
  const m = workbookXml.match(/<sheet\b[^>]*\/?>/g);
  return m ? m.length : 0;
}

/** Pure: resolve the shared-strings table (`xl/sharedStrings.xml`) into an index→text array. */
export function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  const siRe = /<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = siRe.exec(xml)) !== null) {
    const inner = m[1] ?? "";
    let text = "";
    const tRe = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
    let t: RegExpExecArray | null;
    while ((t = tRe.exec(inner)) !== null) text += decodeXml(t[1] ?? "");
    out.push(text);
  }
  return out;
}

const COL_RE = /([A-Za-z]+)\d+/;

/** Pure: spreadsheet column letters → 1-based index ("A"→1, "Z"→26, "AA"→27). */
export function columnLetterToNumber(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

interface SheetScan {
  rowCount: number;
  dimensionColumns: number | null;
  firstRowCells: Array<{ type: string | null; v: string | null; inline: string | null }>;
}

/** Pure: scan a worksheet's XML for row count, declared column width, and the header row's cells. */
export function scanSheetXml(sheetXml: string): SheetScan {
  const rowCount = (sheetXml.match(/<row\b/g) ?? []).length;

  let dimensionColumns: number | null = null;
  const dim = /<dimension\s+ref="([^"]+)"/.exec(sheetXml);
  if (dim) {
    const parts = dim[1]!.split(":");
    const startCol = COL_RE.exec(parts[0] ?? "");
    const endCol = COL_RE.exec(parts[parts.length - 1] ?? "");
    if (startCol && endCol) {
      dimensionColumns = columnLetterToNumber(endCol[1]!) - columnLetterToNumber(startCol[1]!) + 1;
    }
  }

  const firstRow = /<row\b[^>]*>([\s\S]*?)<\/row>/.exec(sheetXml);
  const firstRowCells: SheetScan["firstRowCells"] = [];
  if (firstRow) {
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let c: RegExpExecArray | null;
    while ((c = cellRe.exec(firstRow[1]!)) !== null) {
      const attrs = c[1] ?? "";
      const body = c[2] ?? "";
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? null;
      const v = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? null;
      const inlineBlock = /<is>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? null;
      let inline: string | null = null;
      if (inlineBlock !== null) {
        inline = "";
        const tRe = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
        let t: RegExpExecArray | null;
        while ((t = tRe.exec(inlineBlock)) !== null) inline += decodeXml(t[1] ?? "");
      }
      firstRowCells.push({ type, v, inline });
    }
  }
  return { rowCount, dimensionColumns, firstRowCells };
}

/** Resolve the header row's cells to text, using the shared-strings table where referenced. */
function resolveHeaders(cells: SheetScan["firstRowCells"], shared: readonly string[]): string[] {
  const out: string[] = [];
  for (const cell of cells) {
    let text = "";
    if (cell.type === "s" && cell.v !== null) {
      const idx = Number.parseInt(cell.v, 10);
      text = Number.isInteger(idx) ? (shared[idx] ?? "") : "";
    } else if (cell.type === "inlineStr" && cell.inline !== null) {
      text = cell.inline;
    } else if (cell.v !== null) {
      // t="str" (formula string) or a literal numeric/boolean header.
      text = decodeXml(cell.v);
    }
    if (text.trim().length > 0) out.push(text);
  }
  return out;
}

function unreadable(risks: string[]): WorkbookShape {
  return {
    workbookReadable: false,
    sheetCount: 0,
    selectedSheetIndex: null,
    rowCount: 0,
    columnCount: 0,
    headers: [],
    readerRisks: risks,
  };
}

/** First worksheet part path, preferring `sheet1.xml`, else the lowest-numbered sheet. */
function firstWorksheetName(entries: Map<string, Buffer>): string | null {
  if (entries.has("xl/worksheets/sheet1.xml")) return "xl/worksheets/sheet1.xml";
  const sheets = [...entries.keys()]
    .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))
    .sort((a, b) => {
      const na = Number.parseInt(a.replace(/\D+/g, ""), 10);
      const nb = Number.parseInt(b.replace(/\D+/g, ""), 10);
      return na - nb;
    });
  return sheets[0] ?? null;
}

/**
 * Read a local xlsx file into a sanitisable `WorkbookShape`. Never throws to the caller:
 * a missing file, a non-ZIP container, ZIP64, or a corrupt part each yields
 * `workbookReadable:false` + a sanitized reader-risk token. Reads no data-row values.
 */
export function readWorkbookShape(filePath: string): WorkbookShape {
  let buf: Buffer;
  try {
    buf = readFileSync(filePath);
  } catch {
    return unreadable(["file-not-found"]);
  }
  if (buf.length < 4 || buf.readUInt32LE(0) !== LFH_SIG) return unreadable(["not-zip-container"]);

  const entries = readZipEntries(buf);
  if (entries === null) return unreadable(["zip-parse-failed-or-zip64"]);

  const workbookPart = entries.get("xl/workbook.xml");
  if (!workbookPart) return unreadable(["no-workbook-part"]);
  const sheetCount = countSheets(workbookPart.toString("utf8"));

  const sheetName = firstWorksheetName(entries);
  if (sheetName === null) {
    return {
      workbookReadable: true,
      sheetCount,
      selectedSheetIndex: null,
      rowCount: 0,
      columnCount: 0,
      headers: [],
      readerRisks: ["no-worksheet"],
    };
  }

  const shared = entries.has("xl/sharedStrings.xml")
    ? parseSharedStrings(entries.get("xl/sharedStrings.xml")!.toString("utf8"))
    : [];
  const scan = scanSheetXml(entries.get(sheetName)!.toString("utf8"));
  const headers = resolveHeaders(scan.firstRowCells, shared);
  const columnCount = scan.dimensionColumns ?? scan.firstRowCells.length;

  return {
    workbookReadable: true,
    sheetCount,
    selectedSheetIndex: 0,
    rowCount: scan.rowCount,
    columnCount,
    headers,
    readerRisks: [],
  };
}
