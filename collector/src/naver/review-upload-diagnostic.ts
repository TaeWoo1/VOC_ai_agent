/**
 * CONTROLLED BACKEND UPLOAD of a validated diagnostic review download — the deliberate, honestly
 * reported crossing of "a real captured export is never uploaded" (collector `CLAUDE.md` §4.2).
 *
 * After the supervised approved-index click fires a real download and `review-download-save.ts`
 * structurally validates it as a real `.xlsx`, this module uploads that quarantine file to the
 * SellerOps backend's existing `POST /api/uploads` and folds the backend `IngestResult` into a
 * sanitized `UploadInspection`. It is strictly diagnostic, but materially higher-consequence than
 * the prior observe/save/delete legs:
 *
 *   - It is the ONLY diagnostic caller of `upload.ts` (`login` → `resolveChannelId` →
 *     `uploadReviewFile`). The upload INGESTS the rows into the backend DB (a real state change,
 *     idempotent via `리뷰글번호` dedup) — so the honest report says `uploaded:true` and the CLI emits
 *     `backendIngested:true`; it never claims `dbMutated:false` on this path.
 *   - It writes NO collector status, NO `LAST_SUCCESS`, never touches `node:fs`, never calls
 *     `saveAs`, and drives no page action. The local quarantine file is still deleted by the save
 *     module after this returns (delete-after-validate).
 *   - All output is sanitized — fixed enums / booleans / coarse count buckets / a salted 16-hex
 *     hash. The raw backend `errorMessage`/`sampleErrors` bodies, the raw `syncJobId`, the file
 *     path/name, the JWT, and any row content are NEVER returned or logged.
 *
 * The network is injectable (`fetchImpl`, threaded through the real `upload.ts` functions) so the
 * full login→channel→upload cycle is hermetically testable with an in-memory fake `fetch`.
 */
import { login, resolveChannelId, uploadReviewFile, type IngestResult } from "../upload";
import { messageFingerprint } from "./export-click-signals";

/** Sanitized category of the backend ingest status — never the raw status string. */
export type IngestStatusCategory = "COMPLETED" | "PARTIAL" | "FAILED" | "UNKNOWN";

/** Coarse row-count bucket — never the exact count. */
export type RowCountBucket = "zero" | "one" | "few" | "tens" | "hundreds" | "thousands_plus";

/** Sanitized inspection of a backend ingest. Every leaf is non-sensitive. */
export interface UploadInspection {
  /** True only when the backend accepted the upload (an ingest result was returned). */
  uploaded: boolean;
  ingestStatusCategory: IngestStatusCategory;
  /** Salted one-way hash of the backend `syncJobId` — never the raw id. Empty when absent/failed. */
  syncJobIdHash: string;
  totalRowsBucket: RowCountBucket;
  successRowsBucket: RowCountBucket;
  skippedRowsBucket: RowCountBucket;
  failedRowsBucket: RowCountBucket;
  /** The backend returned a non-empty error message (the TEXT is never surfaced). */
  hasErrorMessage: boolean;
  /** The backend returned at least one sample error (the CONTENT is never surfaced). */
  sampleErrorPresent: boolean;
}

/** Exact top-level key allow-list — used by the offline no-leak test. */
export const UPLOAD_INSPECTION_KEYS: ReadonlyArray<keyof UploadInspection> = [
  "uploaded",
  "ingestStatusCategory",
  "syncJobIdHash",
  "totalRowsBucket",
  "successRowsBucket",
  "skippedRowsBucket",
  "failedRowsBucket",
  "hasErrorMessage",
  "sampleErrorPresent",
];

export interface UploadSavedReviewOpts {
  baseUrl: string;
  email: string;
  password: string;
  /** Channel code to resolve (default `"NAVER"`). */
  channelCode?: string;
  /** Salt for the `syncJobId` hash (shared `storageProbeSalt`). */
  salt?: string;
  /** Injected network; default is the global `fetch`. Threaded through the real `upload.ts`. */
  fetchImpl?: typeof fetch;
}

/** Pure: coarse row-count bucket (never the exact count). */
export function countBucket(n: number): RowCountBucket {
  if (!Number.isFinite(n) || n <= 0) return "zero";
  if (n === 1) return "one";
  if (n <= 9) return "few";
  if (n <= 99) return "tens";
  if (n <= 999) return "hundreds";
  return "thousands_plus";
}

/** Pure: map the backend's raw status string to a fixed category — never echoes the string. */
export function ingestStatusCategory(raw: string | undefined | null): IngestStatusCategory {
  const s = (raw ?? "").toLowerCase();
  if (/complete|success|done|\bok\b/.test(s)) return "COMPLETED";
  if (/partial/.test(s)) return "PARTIAL";
  if (/fail|error/.test(s)) return "FAILED";
  return "UNKNOWN";
}

/** Pure: fold a backend `IngestResult` into a sanitized inspection (no raw status/id/error text). */
export function sanitizeIngest(result: IngestResult, salt?: string): UploadInspection {
  return {
    uploaded: true,
    ingestStatusCategory: ingestStatusCategory(result.status),
    syncJobIdHash: result.syncJobId ? messageFingerprint(salt, result.syncJobId) : "",
    totalRowsBucket: countBucket(result.totalRows),
    successRowsBucket: countBucket(result.successRows),
    skippedRowsBucket: countBucket(result.skippedRows),
    failedRowsBucket: countBucket(result.failedRows),
    hasErrorMessage: typeof result.errorMessage === "string" && result.errorMessage.length > 0,
    sampleErrorPresent: Array.isArray(result.sampleErrors) && result.sampleErrors.length > 0,
  };
}

/** Sanitized inspection for an upload that never reached an accepted ingest (login/channel/upload). */
function failedUploadInspection(): UploadInspection {
  return {
    uploaded: false,
    ingestStatusCategory: "FAILED",
    syncJobIdHash: "",
    totalRowsBucket: "zero",
    successRowsBucket: "zero",
    skippedRowsBucket: "zero",
    failedRowsBucket: "zero",
    hasErrorMessage: false,
    sampleErrorPresent: false,
  };
}

/**
 * Upload an already-saved+validated review download to the backend, returning a sanitized
 * inspection. Never throws — a login/channel/upload failure degrades to a sanitized
 * `uploaded:false` record. Writes no status, never deletes/saves the file (the save module owns
 * the quarantine lifecycle).
 */
export async function uploadSavedReviewDownload(
  filePath: string,
  opts: UploadSavedReviewOpts,
): Promise<UploadInspection> {
  try {
    const fetchImpl = opts.fetchImpl ?? fetch;
    const token = await login(opts.baseUrl, opts.email, opts.password, fetchImpl);
    const channelId = await resolveChannelId(opts.baseUrl, token, opts.channelCode ?? "NAVER", fetchImpl);
    // The quarantined file is a captured NAVER review export, not a human upload.
    const result = await uploadReviewFile(opts.baseUrl, token, channelId, filePath, fetchImpl,
      "SELLER_CENTER_EXPORT");
    return sanitizeIngest(result, opts.salt);
  } catch {
    return failedUploadInspection();
  }
}
