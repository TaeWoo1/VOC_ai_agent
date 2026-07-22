/**
 * **Loader for the shared golden review-export artifact** (`contracts/review-export/naver/v1`).
 *
 * The collector half of the spine's joint: it reads the SAME committed workbook the backend's
 * `ReviewAcquisitionSpineTest` ingests, and the SAME `expected-rows.json` both sides assert against.
 * Test scope on purpose — `collector/src/action-window/**` gains no filesystem reader, and the
 * quarantine module stays the only Action Window module that touches `node:fs`. Callers that want the
 * fixture page to serve real bytes pass `base64()` in as `FixtureHtmlOptions.reviewExportBase64`.
 *
 * Fails LOUDLY. A missing file or a `fileSha256` mismatch throws rather than degrading, because a
 * silently different artifact would leave every downstream assertion technically green and
 * meaningless — the whole point of a committed fixture is that both ports saw identical bytes.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The contract directory, shared with the backend test by relative path from the repo root. */
export const REVIEW_EXPORT_CONTRACT_DIR = resolve(HERE, "../../../contracts/review-export/naver/v1");
export const REVIEW_EXPORT_FIXTURE_PATH = resolve(REVIEW_EXPORT_CONTRACT_DIR, "naver-review-export-v1.xlsx");
const EXPECTED_ROWS_PATH = resolve(REVIEW_EXPORT_CONTRACT_DIR, "expected-rows.json");

export interface ExpectedRow {
  channelReviewId: string;
  sku: string;
  product: string;
  rating: number;
  body: string;
  reviewDate: string;
  reviewIdFingerprint: string;
}

export interface ExpectedRows {
  contract: string;
  file: string;
  fileSha256: string;
  sheetName: string;
  headers: string[];
  unmappedHeaders: string[];
  unmappedSentinels: Record<string, string>;
  window: { from: string; to: string };
  expectedIngest: { status: string; successRows: number; skippedRows: number; failedRows: number };
  expectedReingest: { status: string; successRows: number; skippedRows: number; failedRows: number };
  rows: ExpectedRow[];
}

/** The contract's expected-rows declaration. */
export function expectedRows(): ExpectedRows {
  return JSON.parse(readFileSync(EXPECTED_ROWS_PATH, "utf8")) as ExpectedRows;
}

/**
 * The committed artifact's bytes, verified against the contract's `fileSha256`. Every consumer goes
 * through here, so no test can accidentally assert against a locally-regenerated workbook.
 */
export function reviewExportBytes(): Uint8Array {
  const bytes = readFileSync(REVIEW_EXPORT_FIXTURE_PATH);
  const actual = createHash("sha256").update(bytes).digest("hex");
  const declared = expectedRows().fileSha256;
  if (actual !== declared) {
    throw new Error(
      `review-export/naver/v1: the committed artifact does not match the contract's fileSha256. ` +
        `Regenerating the workbook is a deliberate, visible event — update expected-rows.json (and the SPEC) in the same change.`,
    );
  }
  return new Uint8Array(bytes);
}

/** Base64 of the verified artifact — the form the fixture page takes. */
export function reviewExportBase64(): string {
  return Buffer.from(reviewExportBytes()).toString("base64");
}
