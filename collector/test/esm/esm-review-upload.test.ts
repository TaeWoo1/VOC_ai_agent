import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildEsmReviewUploadReport,
  ESM_REVIEW_CHANNEL_CODE,
  saveValidateUploadDeleteEsmReview,
} from "../../src/esm/esm-review-upload";
import { UPLOAD_INSPECTION_KEYS } from "../../src/naver/review-upload-diagnostic";
import type { SaveableDownload } from "../../src/naver/review-download-save";

// ── Raw secrets that MUST be stripped from the sanitized report ──────────────────────────────────
const RAW_JWT = "RAW-JWT-TOKEN-xyz";
const RAW_STORE_IN_FILENAME = "SECRETSTORE";
const RAW_FILENAME = `리뷰관리_${RAW_STORE_IN_FILENAME}_2026.xlsx`;
const RAW_SYNC_JOB_ID = "RAW-JOB-ID-98765";
const RAW_ERROR_MESSAGE = "RAW_ERROR_홍길동_010-1234-5678";
const RAW_SAMPLE_ERROR = "RAW_SAMPLE_ROW_CELL_VALUE";
const GMARKET_CHANNEL_ID = "chan-gmarket-uuid-0001";

// A structurally-valid .xlsx head: ZIP local-header magic (50 4B 03 04) + the OOXML marker. No real
// cell — enough to pass the magic-byte sniff in review-download-save.ts.
const XLSX_BYTES = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from("xl/ mimetype [Content_Types].xml stub-not-a-real-cell", "utf8"),
]);
const NOT_XLSX_BYTES = Buffer.from("plain text, no zip magic, definitely not an xlsx", "utf8");

interface UploadCall {
  channelId: unknown;
  uploadType: unknown;
  method: unknown;
  fileWasBlob: boolean;
  fileExistedDuringUpload: boolean;
}

/** A fake fired download whose saveAs writes the given bytes to the real quarantine path. */
function fakeDownload(bytes: Buffer, onSave: (path: string) => void): SaveableDownload {
  return {
    suggestedFilename: () => RAW_FILENAME,
    async saveAs(path: string): Promise<void> {
      onSave(path);
      writeFileSync(path, bytes);
    },
  };
}

interface FakeBackendOpts {
  loginOk?: boolean;
  ingest?: Record<string, unknown>;
  savedPathRef: { path: string };
  uploadCalls: UploadCall[];
  urlsHit: string[];
}

/** A hermetic backend: login → channels(GMARKET) → uploads. Inspects the multipart upload form. */
function makeFakeFetch(opts: FakeBackendOpts): typeof fetch {
  const impl = async (input: unknown, init?: { body?: unknown }): Promise<unknown> => {
    const url = String(input);
    opts.urlsHit.push(url);
    if (url.endsWith("/api/auth/login")) {
      return {
        ok: opts.loginOk ?? true,
        status: opts.loginOk === false ? 401 : 200,
        json: async () => ({ token: RAW_JWT }),
      };
    }
    if (url.endsWith("/api/channels")) {
      return {
        ok: true,
        status: 200,
        json: async () => [
          { id: "chan-naver", code: "NAVER" },
          { id: GMARKET_CHANNEL_ID, code: "GMARKET" },
        ],
      };
    }
    if (url.endsWith("/api/uploads")) {
      const form = init?.body as FormData;
      const file = form.get("file");
      opts.uploadCalls.push({
        channelId: form.get("channelId"),
        uploadType: form.get("uploadType"),
        method: form.get("method"),
        fileWasBlob: file instanceof Blob,
        // The file must still be on disk while the upload runs — proof of upload-before-delete.
        fileExistedDuringUpload: existsSync(opts.savedPathRef.path),
      });
      return { ok: true, status: 200, json: async () => opts.ingest ?? {} };
    }
    throw new Error(`unexpected url ${url}`);
  };
  return impl as unknown as typeof fetch;
}

describe("esm-review-upload — hermetic save → validate → upload-before-delete → delete", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "esm-upload-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const baseDeps = (fetchImpl: typeof fetch) => ({
    dir: join(dir, "esm-diagnostic"),
    salt: "unit-test-salt",
    baseUrl: "http://backend.test",
    email: "collector@test",
    password: "pw",
    fetchImpl,
  });

  it("uploads a VALID xlsx to GMARKET/REVIEW/SELLER_CENTER_EXPORT, before deleting the raw file", async () => {
    const savedPathRef = { path: "" };
    const uploadCalls: UploadCall[] = [];
    const urlsHit: string[] = [];
    const fetchImpl = makeFakeFetch({
      savedPathRef,
      uploadCalls,
      urlsHit,
      ingest: {
        syncJobId: RAW_SYNC_JOB_ID,
        uploadType: "REVIEW",
        status: "COMPLETED",
        totalRows: 12,
        successRows: 10,
        skippedRows: 2,
        failedRows: 0,
        errorMessage: RAW_ERROR_MESSAGE,
        sampleErrors: [RAW_SAMPLE_ERROR],
      },
    });
    const download = fakeDownload(XLSX_BYTES, (p) => (savedPathRef.path = p));

    const inspection = await saveValidateUploadDeleteEsmReview(download, baseDeps(fetchImpl));
    const report = buildEsmReviewUploadReport(inspection);

    // Validation passed → upload ran → sanitized success.
    expect(inspection.xlsxReadable).toBe(true);
    expect(report.uploaded).toBe(true);
    expect(report.backendIngested).toBe(true);
    expect(inspection.uploaded?.ingestStatusCategory).toBe("COMPLETED");

    // Channel/type/method + the file reached the backend as a Blob.
    expect(uploadCalls).toHaveLength(1);
    expect(uploadCalls[0]!.channelId).toBe(GMARKET_CHANNEL_ID); // resolved from code "GMARKET"
    expect(uploadCalls[0]!.uploadType).toBe("REVIEW");
    expect(uploadCalls[0]!.method).toBe("SELLER_CENTER_EXPORT");
    expect(uploadCalls[0]!.fileWasBlob).toBe(true);

    // Ordering: the file existed on disk DURING the upload, and is gone AFTER (delete-after-validate).
    expect(uploadCalls[0]!.fileExistedDuringUpload).toBe(true);
    expect(existsSync(savedPathRef.path)).toBe(false);
    expect(inspection.fileRetained).toBe(false);
    expect(inspection.deleteFailed).toBe(false);
  });

  it("does NOT upload a payload that fails xlsx validation (and still deletes it)", async () => {
    const savedPathRef = { path: "" };
    const uploadCalls: UploadCall[] = [];
    const urlsHit: string[] = [];
    const fetchImpl = makeFakeFetch({ savedPathRef, uploadCalls, urlsHit });
    const download = fakeDownload(NOT_XLSX_BYTES, (p) => (savedPathRef.path = p));

    const inspection = await saveValidateUploadDeleteEsmReview(download, baseDeps(fetchImpl));
    const report = buildEsmReviewUploadReport(inspection);

    expect(inspection.xlsxReadable).toBe(false);
    // uploadFn never fired → no backend call at all → no uploaded inspection.
    expect(uploadCalls).toHaveLength(0);
    expect(urlsHit).toHaveLength(0);
    expect(inspection.uploaded).toBeUndefined();
    expect(report.uploaded).toBe(false);
    expect(report.backendIngested).toBe(false);
    // The invalid file is still cleaned up.
    expect(existsSync(savedPathRef.path)).toBe(false);
  });

  it("degrades a backend/login failure to sanitized uploaded:false / backendIngested:false, file deleted", async () => {
    const savedPathRef = { path: "" };
    const uploadCalls: UploadCall[] = [];
    const urlsHit: string[] = [];
    const fetchImpl = makeFakeFetch({ savedPathRef, uploadCalls, urlsHit, loginOk: false });
    const download = fakeDownload(XLSX_BYTES, (p) => (savedPathRef.path = p));

    const inspection = await saveValidateUploadDeleteEsmReview(download, baseDeps(fetchImpl));
    const report = buildEsmReviewUploadReport(inspection);

    // File validated (uploadFn ran) but the backend login failed → degraded, not thrown.
    expect(inspection.xlsxReadable).toBe(true);
    expect(inspection.uploaded).toBeDefined();
    expect(inspection.uploaded?.uploaded).toBe(false);
    expect(report.uploaded).toBe(false);
    expect(report.backendIngested).toBe(false);
    expect(uploadCalls).toHaveLength(0); // never reached /api/uploads
    // Delete-after-validate still holds on the failure path.
    expect(existsSync(savedPathRef.path)).toBe(false);
  });

  it("leaks NO raw path / filename / JWT / backend error / row value into the sanitized report", async () => {
    const savedPathRef = { path: "" };
    const uploadCalls: UploadCall[] = [];
    const urlsHit: string[] = [];
    const fetchImpl = makeFakeFetch({
      savedPathRef,
      uploadCalls,
      urlsHit,
      ingest: {
        syncJobId: RAW_SYNC_JOB_ID,
        uploadType: "REVIEW",
        status: "PARTIAL",
        totalRows: 5,
        successRows: 3,
        skippedRows: 1,
        failedRows: 1,
        errorMessage: RAW_ERROR_MESSAGE,
        sampleErrors: [RAW_SAMPLE_ERROR],
      },
    });
    const download = fakeDownload(XLSX_BYTES, (p) => (savedPathRef.path = p));

    const inspection = await saveValidateUploadDeleteEsmReview(download, baseDeps(fetchImpl));

    // The report the CLI emits: the saved-download inspection + the honest upload markers.
    const emitted = JSON.stringify({
      mode: "capture-upload",
      savedDownload: inspection,
      ...buildEsmReviewUploadReport(inspection),
    });

    for (const secret of [
      savedPathRef.path, // absolute quarantine path
      RAW_STORE_IN_FILENAME, // raw filename fragment
      RAW_FILENAME,
      RAW_JWT, // backend auth token
      RAW_SYNC_JOB_ID, // raw backend job id (only a salted hash may appear)
      RAW_ERROR_MESSAGE, // raw backend error text
      RAW_SAMPLE_ERROR, // raw sample-error / row value
    ]) {
      expect(emitted.includes(secret)).toBe(false);
    }

    // Positive: the sanitized ingest inspection is present, uses ONLY allow-listed keys, and reports
    // the error/ sample presence as booleans (never the text).
    const uploaded = inspection.uploaded!;
    expect(Object.keys(uploaded).every((k) => (UPLOAD_INSPECTION_KEYS as readonly string[]).includes(k))).toBe(true);
    expect(uploaded.hasErrorMessage).toBe(true);
    expect(uploaded.sampleErrorPresent).toBe(true);
    expect(uploaded.ingestStatusCategory).toBe("PARTIAL");
    expect(typeof uploaded.syncJobIdHash).toBe("string");
    expect(uploaded.syncJobIdHash).not.toBe(RAW_SYNC_JOB_ID);
  });

  it("targets the GMARKET channel by construction", () => {
    expect(ESM_REVIEW_CHANNEL_CODE).toBe("GMARKET");
  });
});
