import { unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { IngestResult } from "../../src/upload";
import {
  countBucket,
  ingestStatusCategory,
  sanitizeIngest,
  uploadSavedReviewDownload,
  UPLOAD_INSPECTION_KEYS,
} from "../../src/naver/review-upload-diagnostic";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = join(__dirname, "..", "..", "src", "naver", "review-upload-diagnostic.ts");

/** A clean backend ingest result. */
function ingestOk(over: Partial<IngestResult> = {}): IngestResult {
  return {
    syncJobId: "job-0001",
    uploadType: "REVIEW",
    status: "COMPLETED",
    totalRows: 532,
    successRows: 530,
    skippedRows: 2,
    failedRows: 0,
    ...over,
  };
}

/** A fake `fetch` that answers login → channels → uploads. */
function makeFetch(ingest: IngestResult, opts: { uploadStatus?: number } = {}): typeof fetch {
  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const impl = async (url: unknown): Promise<Response> => {
    const u = String(url);
    if (u.endsWith("/api/auth/login")) return json({ token: "test-jwt" });
    if (u.endsWith("/api/channels")) return json([{ id: "id-naver", code: "NAVER" }]);
    if (u.endsWith("/api/uploads")) {
      const status = opts.uploadStatus ?? 200;
      return status === 200 ? json(ingest) : new Response("upload error", { status });
    }
    return new Response("not found", { status: 404 });
  };
  return impl as unknown as typeof fetch;
}

/** Write a tiny synthetic file so the real `uploadReviewFile` (readFile) has bytes to send. */
function withTempFile(run: (path: string) => Promise<void>): Promise<void> {
  const path = join(tmpdir(), `upl-diag-${process.pid}-${Math.abs(Math.round(performance.now()))}.xlsx`);
  writeFileSync(path, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]));
  return run(path).finally(() => {
    try {
      unlinkSync(path);
    } catch {
      /* best effort */
    }
  });
}

const BASE_OPTS = { baseUrl: "http://localhost:8080", email: "demo@sellerops.ai", password: "demo1234", salt: "s" };

describe("countBucket — coarse, monotonic, never the exact count", () => {
  it("buckets row counts", () => {
    expect(countBucket(0)).toBe("zero");
    expect(countBucket(-5)).toBe("zero");
    expect(countBucket(Number.NaN)).toBe("zero");
    expect(countBucket(1)).toBe("one");
    expect(countBucket(2)).toBe("few");
    expect(countBucket(9)).toBe("few");
    expect(countBucket(10)).toBe("tens");
    expect(countBucket(99)).toBe("tens");
    expect(countBucket(100)).toBe("hundreds");
    expect(countBucket(999)).toBe("hundreds");
    expect(countBucket(1000)).toBe("thousands_plus");
  });
});

describe("ingestStatusCategory — fixed enum, never echoes the raw string", () => {
  it("maps known statuses", () => {
    expect(ingestStatusCategory("COMPLETED")).toBe("COMPLETED");
    expect(ingestStatusCategory("completed")).toBe("COMPLETED");
    expect(ingestStatusCategory("SUCCESS")).toBe("COMPLETED");
    expect(ingestStatusCategory("done")).toBe("COMPLETED");
    expect(ingestStatusCategory("PARTIAL")).toBe("PARTIAL");
    expect(ingestStatusCategory("FAILED")).toBe("FAILED");
    expect(ingestStatusCategory("error")).toBe("FAILED");
  });
  it("maps unknown/empty to UNKNOWN", () => {
    expect(ingestStatusCategory("PENDING")).toBe("UNKNOWN");
    expect(ingestStatusCategory("")).toBe("UNKNOWN");
    expect(ingestStatusCategory(undefined)).toBe("UNKNOWN");
    expect(ingestStatusCategory(null)).toBe("UNKNOWN");
  });
});

describe("sanitizeIngest — folds IngestResult to sanitized buckets/hash, never raw content", () => {
  it("buckets rows + hashes the syncJobId", () => {
    const insp = sanitizeIngest(ingestOk(), "salt");
    expect(insp.uploaded).toBe(true);
    expect(insp.ingestStatusCategory).toBe("COMPLETED");
    expect(insp.syncJobIdHash).toMatch(/^[a-f0-9]{16}$/);
    expect(insp.totalRowsBucket).toBe("hundreds");
    expect(insp.successRowsBucket).toBe("hundreds");
    expect(insp.skippedRowsBucket).toBe("few");
    expect(insp.failedRowsBucket).toBe("zero");
    expect(insp.hasErrorMessage).toBe(false);
    expect(insp.sampleErrorPresent).toBe(false);
  });

  it("flags error presence WITHOUT echoing the error text, and allow-lists every key", () => {
    const hostile = ingestOk({
      syncJobId: "job-행복마켓-1234567",
      status: "PARTIAL",
      errorMessage: "행 12: 리뷰 '최악이에요 환불해주세요' 파싱 실패",
      sampleErrors: [{ row: 12, raw: "구매자 홍길동 010-1234-5678" }],
    });
    const insp = sanitizeIngest(hostile, "salt");
    const out = JSON.stringify(insp);
    expect(out.includes("행복마켓")).toBe(false);
    expect(out.includes("1234567")).toBe(false);
    expect(out.includes("최악")).toBe(false);
    expect(out.includes("홍길동")).toBe(false);
    expect(out.includes("010-1234")).toBe(false);
    expect(insp.ingestStatusCategory).toBe("PARTIAL");
    expect(insp.hasErrorMessage).toBe(true);
    expect(insp.sampleErrorPresent).toBe(true);
    for (const k of Object.keys(insp)) {
      expect((UPLOAD_INSPECTION_KEYS as readonly string[]).includes(k)).toBe(true);
    }
  });
});

describe("uploadSavedReviewDownload — login → channel → upload, sanitized inspection", () => {
  it("uploads a saved file and returns a sanitized accepted inspection", async () => {
    await withTempFile(async (path) => {
      const r = await uploadSavedReviewDownload(path, {
        ...BASE_OPTS,
        fetchImpl: makeFetch(ingestOk({ totalRows: 3, successRows: 3, skippedRows: 0, failedRows: 0 })),
      });
      expect(r.uploaded).toBe(true);
      expect(r.ingestStatusCategory).toBe("COMPLETED");
      expect(r.totalRowsBucket).toBe("few");
      expect(r.syncJobIdHash).toMatch(/^[a-f0-9]{16}$/);
    });
  });

  it("degrades to uploaded:false on an upload-endpoint failure, never throws", async () => {
    await withTempFile(async (path) => {
      const r = await uploadSavedReviewDownload(path, {
        ...BASE_OPTS,
        fetchImpl: makeFetch(ingestOk(), { uploadStatus: 500 }),
      });
      expect(r.uploaded).toBe(false);
      expect(r.ingestStatusCategory).toBe("FAILED");
      expect(r.syncJobIdHash).toBe("");
    });
  });

  it("degrades to uploaded:false when the file does not exist (readFile fails), never throws", async () => {
    const r = await uploadSavedReviewDownload(join(tmpdir(), "does-not-exist-xyz.xlsx"), {
      ...BASE_OPTS,
      fetchImpl: makeFetch(ingestOk()),
    });
    expect(r.uploaded).toBe(false);
  });
});

describe("review-upload-diagnostic.ts — strict upload-module source guard", () => {
  const raw = readFileSync(SRC_PATH, "utf8");
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("CALLS uploadReviewFile EXACTLY ONCE (the only diagnostic backend upload)", () => {
    // one import reference + one call site = two mentions; the CALL must be unique.
    expect((code.match(/uploadReviewFile\s*\(/g) ?? []).length).toBe(1);
    expect((code.match(/\buploadReviewFile\b/g) ?? []).length).toBe(2);
  });

  it("writes no status, sets no LAST_SUCCESS, mutates no local fs, saves nothing", () => {
    expect(/writeStatus/.test(code)).toBe(false);
    expect(/decideState/.test(code)).toBe(false);
    expect(/runExport/.test(code)).toBe(false);
    expect(/LAST_SUCCESS|lastCollectedAt/.test(code)).toBe(false);
    expect(/\.saveAs\s*\(/.test(code)).toBe(false);
    expect(/\bmkdirSync\b|\bunlinkSync\b|\bwriteFileSync\b|node:fs/.test(code)).toBe(false);
  });

  it("drives no page action and emits nothing itself", () => {
    expect(/\.click\s*\(/.test(code)).toBe(false);
    expect(/\.evaluate\s*\(|\.goto\s*\(|\.fill\s*\(/.test(code)).toBe(false);
    expect(/console\./.test(code)).toBe(false);
  });

  it("never echoes raw backend fields (status/syncJobId/errorMessage/sampleErrors only via sanitize)", () => {
    // The sanitized record exposes a hash + category + buckets + booleans — assert the raw response
    // fields are only ever READ to fold, never re-emitted as their own output keys.
    expect(/syncJobIdHash/.test(code)).toBe(true);
    expect(/hasErrorMessage/.test(code)).toBe(true);
    expect(/sampleErrorPresent/.test(code)).toBe(true);
  });
});
