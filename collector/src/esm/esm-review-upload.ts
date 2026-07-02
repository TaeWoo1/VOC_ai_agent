/**
 * ESM+ REVIEW controlled-upload leg — the save → structural-validate → UPLOAD-BEFORE-DELETE → delete
 * cycle, extracted from `capture-esm-review-upload.ts` so it can be exercised by a hermetic offline
 * test (fake `fetch` + fake filesystem + synthetic `.xlsx`), independent of the live Playwright
 * capture gate.
 *
 * It composes two shipped modules and adds NO new backend/fs behavior:
 *   - `saveAndInspectDownload` (`review-download-save.ts`) owns the filesystem and the delete — it saves
 *     the fired download, magic-byte validates it as a real `.xlsx`, runs the injected `uploadFn`
 *     BEFORE the delete but ONLY when the file validated, then deletes it (delete-after-validate).
 *   - `uploadSavedReviewDownload` (`review-upload-diagnostic.ts`) owns the single backend call — it
 *     uploads to `POST /api/uploads` as the **GMARKET** channel, `uploadType=REVIEW`,
 *     `method=SELLER_CENTER_EXPORT`, and folds the backend `IngestResult` into a sanitized
 *     `UploadInspection` (booleans / coarse buckets / a salted job hash — never a raw id / error text /
 *     filename / JWT / row value).
 *
 * The upload INGESTS rows into the backend DB (idempotent via the content-hash dedup), so the report
 * fragment is HONEST: `uploaded`/`backendIngested` are true only when the backend accepted the ingest,
 * and this path NEVER claims `dbMutated:false`. It confirms no mapping or dedup key.
 */
import {
  saveAndInspectDownload,
  type DownloadSaveIo,
  type SaveableDownload,
  type SavedDownloadInspection,
} from "../naver/review-download-save";
import { uploadSavedReviewDownload } from "../naver/review-upload-diagnostic";
import type { CaptureInspection } from "./esm-capture-inspect";

/**
 * The ESM+ channel code the backend registers for Gmarket / Auction (`ReviewDedupKey.versionFor` → v2
 * for this code). A named constant so the upload always targets the ESM+ channel, never NAVER's default.
 */
export const ESM_REVIEW_CHANNEL_CODE = "GMARKET";

/** Dependencies for the ESM+ REVIEW save→upload→delete leg. Network + filesystem are injectable. */
export interface EsmReviewUploadDeps {
  /** The gitignored quarantine directory (e.g. `downloads/esm-diagnostic`). */
  dir: string;
  /** Salt for the basename + backend-job hashes (shared `storageProbeSalt`). */
  salt?: string;
  baseUrl: string;
  email: string;
  password: string;
  /** Injected network; default is the global `fetch`. Threaded to `uploadSavedReviewDownload`. */
  fetchImpl?: typeof fetch;
  /** Injected filesystem ops; default is `node:fs`. Threaded to `saveAndInspectDownload`. */
  io?: DownloadSaveIo;
  /** Override for the structural-sniff head size (test convenience). */
  headBytes?: number;
  /**
   * Optional pre-delete SHAPE inspector (schema-shape / row-shape / composite-key / header quarantine).
   * Runs on the still-present xlsx BEFORE the delete, and only when it validated. Confirms nothing.
   */
  inspectFn?: (path: string) => Promise<CaptureInspection>;
}

/**
 * Save the fired download, structurally validate it, UPLOAD it to the GMARKET REVIEW ingest endpoint
 * BEFORE deleting it (only when it validated as a real `.xlsx`), then delete it. Returns the sanitized
 * `SavedDownloadInspection` — its `uploaded` field carries the backend ingest inspection (present only
 * when the upload ran). Never throws: an upload/login/channel failure degrades to `uploaded:false`; the
 * file is always deleted in `finally`.
 */
export async function saveValidateUploadDeleteEsmReview(
  download: SaveableDownload,
  deps: EsmReviewUploadDeps,
): Promise<SavedDownloadInspection<CaptureInspection>> {
  return saveAndInspectDownload<CaptureInspection>(download, {
    dir: deps.dir,
    salt: deps.salt,
    ...(deps.io ? { io: deps.io } : {}),
    ...(deps.headBytes !== undefined ? { headBytes: deps.headBytes } : {}),
    uploadFn: (p) =>
      uploadSavedReviewDownload(p, {
        baseUrl: deps.baseUrl,
        email: deps.email,
        password: deps.password,
        channelCode: ESM_REVIEW_CHANNEL_CODE,
        salt: deps.salt,
        ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
      }),
    ...(deps.inspectFn ? { inspectFn: deps.inspectFn } : {}),
  });
}

/** The honest upload report fragment surfaced by the CLI. */
export interface EsmReviewUploadReport {
  uploaded: boolean;
  backendIngested: boolean;
}

/**
 * Pure: derive the honest `uploaded`/`backendIngested` markers from the saved-download inspection.
 * `uploaded` (and thus `backendIngested`) is true ONLY when the backend accepted the ingest — a real,
 * higher-consequence DB write. Absent upload → false. This never fabricates a non-mutation claim.
 */
export function buildEsmReviewUploadReport(
  inspection: SavedDownloadInspection<CaptureInspection>,
): EsmReviewUploadReport {
  const uploaded = inspection.uploaded?.uploaded ?? false;
  return { uploaded, backendIngested: uploaded };
}
