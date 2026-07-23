import { readFileSync } from "node:fs";
import type { WorkbookShape } from "./esm-review-schema-shape";
import {
  emptySample,
  unreadableShape,
  workbookRowSampleFromBuffer,
  workbookShapeFromBuffer,
  type WorkbookRowSample,
} from "../xlsx/workbook-shape-read";

/**
 * Dependency-free, READ-ONLY structural reader for an xlsx workbook (Gate 4/5) — the **file-path**
 * half.
 *
 * The parsing itself lives in `../xlsx/workbook-shape-read.ts`, which is buffer-in and uses
 * `node:zlib` ONLY. This module adds the one thing that needs the filesystem: reading the file.
 * The split exists so callers that must not touch `node:fs` — the Action Window's artifact parse
 * gate (`action-window/artifact-parse.ts`) — can reuse the same proven reader instead of a second
 * implementation of the format.
 *
 * It reads **no data row's cell values** in the shape mode; only row 1 (the header) is resolved,
 * and even that is handed to the pure summariser purely to be hashed/categorised (never emitted).
 * ZIP64 / encrypted / unexpected containers fail closed (`workbookReadable:false` + a sanitized
 * reader-risk token) — never a throw to the CLI.
 */

// The pure helpers stay importable from this path — every existing Gate 4/5 caller and test is
// unaffected by the extraction.
export {
  columnLetterToNumber,
  countSheets,
  emptySample,
  extractDataCells,
  parseSharedStrings,
  scanSheetXml,
  unreadableShape,
  workbookRowSampleFromBuffer,
  workbookShapeFromBuffer,
  type DataCell,
  type WorkbookRowSample,
} from "../xlsx/workbook-shape-read";

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
    return unreadableShape(["file-not-found"]);
  }
  return workbookShapeFromBuffer(buf);
}

/**
 * Read an xlsx into a `WorkbookRowSample`: the same structural shape as `readWorkbookShape`
 * PLUS the first ≤`maxDataRows` populated data rows (column-aligned, raw). Never throws to the
 * caller — every failure path yields an unreadable shape with empty samples + a sanitized risk.
 * Reads no more than `maxDataRows` data rows.
 */
export function readWorkbookRowSample(filePath: string, maxDataRows: number): WorkbookRowSample {
  let buf: Buffer;
  try {
    buf = readFileSync(filePath);
  } catch {
    return emptySample(unreadableShape(["file-not-found"]));
  }
  return workbookRowSampleFromBuffer(buf, maxDataRows);
}
