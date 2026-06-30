/**
 * OFFLINE ESM+ REVIEW — Gate 4 workbook SCHEMA-SHAPE inspection.
 *
 *   npm run inspect-esm-review-xlsx -- --xlsx /abs/path/to/quarantined.xlsx
 *
 * Strictly offline + read-only: it opens a locally-supplied (quarantined) xlsx, reads its
 * STRUCTURE only (sheet/row/column/header shape) via the dependency-free reader, and prints
 * a sanitized schema-shape summary. It launches NO browser, performs NO click/download/
 * upload/API/DB/status write, and runs NO scheduler. It reads no data-row cell values.
 *
 * SANITISED OUTPUT ONLY — booleans / coarse buckets / structural counts / fixed category
 * labels / salted header hashes. It NEVER prints the file path, the filename, raw headers,
 * raw cell values, or any identifier. Gate 4 confirms NO schema mapping and NO dedup key
 * (both stay NEEDS_VERIFICATION); it marks NO `CONFIRMED` capability and performs NO ingest.
 */
import { loadConfig } from "../config";
import { log } from "../log";
import { parseXlsxPathArg, summarizeSchemaShape } from "../esm/esm-review-schema-shape";
import { readWorkbookShape } from "../esm/esm-review-xlsx-reader";

function main(): void {
  const args = process.argv.slice(2);
  const xlsxPath = parseXlsxPathArg(args);
  if (xlsxPath === null || xlsxPath.trim().length === 0) {
    // Note: no path is echoed even on the error path.
    console.error("Gate 4 requires an explicit local xlsx path: --xlsx <path>.");
    process.exit(4);
    return;
  }

  const cfg = loadConfig();
  const shape = readWorkbookShape(xlsxPath);
  const summary = summarizeSchemaShape(shape, cfg.storageProbeSalt);

  console.log(JSON.stringify({ mode: "schema-shape", ...summary }, null, 2));
  log("esm.review.schema-shape", {
    workbookReadable: summary.workbookReadable,
    sheetCount: summary.sheetCount,
    rowCountBucket: summary.rowCountBucket,
    columnCount: summary.columnCount,
    headerCount: summary.headerCount,
    riskCount: summary.risks.length,
  });
}

main();
