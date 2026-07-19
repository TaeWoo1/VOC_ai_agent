import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { clearLogSink, getLogSink } from "../src/log";
import { decideState } from "../src/status";
import {
  fetchItemAnalysisCount,
  login,
  resolveChannelId,
  submitReplyOutcome,
  uploadReviewBytes,
  uploadReviewFile,
  UploadError,
} from "../src/upload";
import { sanitizeBackendIngest } from "../src/action-window/ingest-handoff";

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures");
const SAMPLE_FILE = resolve(fixtures, "session_login.html"); // any local file; mock ignores content
const SECRET_TOKEN = "supersecret-jwt-value-should-never-be-logged";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("login", () => {
  it("returns the token on 200", async () => {
    const fakeFetch = async () => jsonResponse({ token: SECRET_TOKEN, user: { id: "u1" } });
    const token = await login("http://x", "e", "p", fakeFetch as typeof fetch);
    expect(token).toBe(SECRET_TOKEN);
  });

  it("throws UploadError(login) on 401", async () => {
    const fakeFetch = async () => new Response("no", { status: 401 });
    await expect(login("http://x", "e", "bad", fakeFetch as typeof fetch)).rejects.toMatchObject({
      name: "UploadError",
      stage: "login",
      httpStatus: 401,
    });
  });

  it("throws when token missing", async () => {
    const fakeFetch = async () => jsonResponse({ user: {} });
    await expect(login("http://x", "e", "p", fakeFetch as typeof fetch)).rejects.toBeInstanceOf(UploadError);
  });
});

describe("resolveChannelId", () => {
  it("picks the matching channel code", async () => {
    const fakeFetch = async () =>
      jsonResponse([
        { id: "id-coupang", code: "COUPANG" },
        { id: "id-naver", code: "NAVER" },
      ]);
    const id = await resolveChannelId("http://x", "t", "NAVER", fakeFetch as typeof fetch);
    expect(id).toBe("id-naver");
  });

  it("throws when the code is absent", async () => {
    const fakeFetch = async () => jsonResponse([{ id: "id-coupang", code: "COUPANG" }]);
    await expect(resolveChannelId("http://x", "t", "NAVER", fakeFetch as typeof fetch)).rejects.toMatchObject({
      stage: "resolveChannel",
    });
  });
});

describe("uploadReviewFile", () => {
  it("posts channelId/uploadType/file and returns IngestResult", async () => {
    let captured: { url: string; method?: string; body: FormData } | null = null;
    const fakeFetch = async (url: string | URL | Request, init?: RequestInit) => {
      captured = { url: String(url), method: init?.method, body: init?.body as FormData };
      return jsonResponse({
        syncJobId: "job1",
        uploadType: "REVIEW",
        status: "SUCCESS",
        totalRows: 3,
        successRows: 3,
        skippedRows: 0,
        failedRows: 0,
      });
    };
    const result = await uploadReviewFile("http://x", "t", "chan-1", SAMPLE_FILE, fakeFetch as typeof fetch);
    expect(result.status).toBe("SUCCESS");
    expect(result.successRows).toBe(3);
    expect(captured!.url).toBe("http://x/api/uploads");
    expect(captured!.method).toBe("POST");
    expect(captured!.body.get("channelId")).toBe("chan-1");
    expect(captured!.body.get("uploadType")).toBe("REVIEW");
    expect(captured!.body.get("file")).toBeInstanceOf(Blob);
    // No method passed → field omitted, so the backend records its default (MANUAL_UPLOAD).
    expect(captured!.body.get("method")).toBeNull();
  });

  it("sends method=SELLER_CENTER_EXPORT when the file is a captured export", async () => {
    let captured: { body: FormData } | null = null;
    const fakeFetch = async (_url: string | URL | Request, init?: RequestInit) => {
      captured = { body: init?.body as FormData };
      return jsonResponse({
        syncJobId: "job1",
        uploadType: "REVIEW",
        status: "SUCCESS",
        totalRows: 1,
        successRows: 1,
        skippedRows: 0,
        failedRows: 0,
      });
    };
    await uploadReviewFile("http://x", "t", "chan-1", SAMPLE_FILE,
      fakeFetch as typeof fetch, "SELLER_CENTER_EXPORT");
    expect(captured!.body.get("method")).toBe("SELLER_CENTER_EXPORT");
  });

  it("throws UploadError(upload) on 500", async () => {
    const fakeFetch = async () => new Response("boom", { status: 500 });
    await expect(
      uploadReviewFile("http://x", "t", "chan-1", SAMPLE_FILE, fakeFetch as typeof fetch),
    ).rejects.toMatchObject({ stage: "upload", httpStatus: 500 });
  });
});

describe("uploadReviewBytes", () => {
  const okResult = {
    syncJobId: "job1",
    uploadType: "REVIEW",
    status: "SUCCESS",
    totalRows: 2,
    successRows: 2,
    skippedRows: 0,
    failedRows: 0,
  };

  it("posts the given bytes under the caller-supplied filename (no path/basename involved)", async () => {
    let captured: { url: string; method?: string; body: FormData } | null = null;
    const fakeFetch = async (url: string | URL | Request, init?: RequestInit) => {
      captured = { url: String(url), method: init?.method, body: init?.body as FormData };
      return jsonResponse(okResult);
    };
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    const result = await uploadReviewBytes(
      "http://x", "t", "chan-1", bytes, "aw-00ff00ff00ff00ff.xlsx", fakeFetch as typeof fetch, "SELLER_CENTER_EXPORT",
    );
    expect(result.successRows).toBe(2);
    expect(captured!.url).toBe("http://x/api/uploads");
    expect(captured!.method).toBe("POST");
    expect(captured!.body.get("uploadType")).toBe("REVIEW");
    expect(captured!.body.get("method")).toBe("SELLER_CENTER_EXPORT");
    const file = captured!.body.get("file") as File;
    expect(file).toBeInstanceOf(Blob);
    expect(file.name).toBe("aw-00ff00ff00ff00ff.xlsx");
  });

  it("omits method when not supplied (backend records its default)", async () => {
    let captured: { body: FormData } | null = null;
    const fakeFetch = async (_url: string | URL | Request, init?: RequestInit) => {
      captured = { body: init?.body as FormData };
      return jsonResponse(okResult);
    };
    await uploadReviewBytes("http://x", "t", "chan-1", new Uint8Array([1]), "aw-x.xlsx", fakeFetch as typeof fetch);
    expect(captured!.body.get("method")).toBeNull();
  });

  it("throws UploadError(upload) on a non-2xx response", async () => {
    const fakeFetch = async () => new Response("boom", { status: 500 });
    await expect(
      uploadReviewBytes("http://x", "t", "chan-1", new Uint8Array([1]), "aw-x.xlsx", fakeFetch as typeof fetch),
    ).rejects.toMatchObject({ stage: "upload", httpStatus: 500 });
  });
});

describe("fetchItemAnalysisCount", () => {
  it("returns the length of the org-wide analysis list", async () => {
    const fakeFetch = async () => jsonResponse([{ id: "a" }, { id: "b" }, { id: "c" }]);
    const count = await fetchItemAnalysisCount("http://x", "t", fakeFetch as typeof fetch);
    expect(count).toBe(3);
  });

  it("throws UploadError(itemAnalysis) on non-2xx", async () => {
    const fakeFetch = async () => new Response("err", { status: 503 });
    await expect(fetchItemAnalysisCount("http://x", "t", fakeFetch as typeof fetch)).rejects.toMatchObject({
      stage: "itemAnalysis",
      httpStatus: 503,
    });
  });
});

describe("metadata-only logging", () => {
  beforeEach(() => clearLogSink());

  it("never logs the token, password, or cookies", async () => {
    const fakeFetch = async (url: string | URL | Request) => {
      if (String(url).endsWith("/api/auth/login")) return jsonResponse({ token: SECRET_TOKEN });
      if (String(url).endsWith("/api/channels")) return jsonResponse([{ id: "id-naver", code: "NAVER" }]);
      return jsonResponse({
        syncJobId: "j",
        uploadType: "REVIEW",
        status: "SUCCESS",
        totalRows: 1,
        successRows: 1,
        skippedRows: 0,
        failedRows: 0,
      });
    };
    const token = await login("http://x", "e", "p", fakeFetch as typeof fetch);
    const channelId = await resolveChannelId("http://x", token, "NAVER", fakeFetch as typeof fetch);
    await uploadReviewFile("http://x", token, channelId, SAMPLE_FILE, fakeFetch as typeof fetch);

    const serialized = JSON.stringify(getLogSink());
    expect(serialized).not.toContain(SECRET_TOKEN);
    expect(serialized.toLowerCase()).not.toContain("password");
    expect(serialized.toLowerCase()).not.toContain("cookie");
    // but it should still carry useful metadata
    expect(serialized).toContain("upload.done");
  });

  /**
   * §4.3: the log may carry only the backend's own status enum + coarse row buckets. An exact count or
   * the source filename must never reach it. Asserted as an EXACT key allow-list rather than a substring
   * sweep — `toContain("successRows")` would pass against `successRowsBucket` and prove nothing.
   */
  it("upload.done carries only the status enum and coarse row buckets — no exact counts, no filename", async () => {
    const fakeFetch = async () =>
      jsonResponse({
        syncJobId: "j",
        uploadType: "REVIEW",
        status: "SUCCESS",
        totalRows: 55,
        successRows: 55,
        skippedRows: 0,
        failedRows: 0,
      });
    await uploadReviewFile("http://x", "t", "chan-1", SAMPLE_FILE, fakeFetch as typeof fetch);

    const entry = getLogSink().find((e) => e.event === "upload.done");
    expect(entry).toBeDefined();
    expect(Object.keys(entry!.meta).sort()).toEqual([
      "failedRowsBucket",
      "skippedRowsBucket",
      "status",
      "successRowsBucket",
      "totalRowsBucket",
    ]);
    // The Run-4 shape (55/55/0/0) reduces to buckets; no exact count survives as a value.
    expect(entry!.meta).toMatchObject({
      status: "SUCCESS",
      totalRowsBucket: "tens",
      successRowsBucket: "tens",
      skippedRowsBucket: "zero",
      failedRowsBucket: "zero",
    });
    expect(Object.values(entry!.meta)).not.toContain(55);
    // The source basename never reaches the log (opaque only on the AW path; a real export name here).
    expect(JSON.stringify(getLogSink())).not.toContain(basename(SAMPLE_FILE));
  });

  it("item-analysis.count carries only a coarse bucket, never the exact count", async () => {
    const fakeFetch = async () => jsonResponse([{ id: "a" }, { id: "b" }, { id: "c" }]);
    const count = await fetchItemAnalysisCount("http://x", "t", fakeFetch as typeof fetch);

    // The caller still gets the exact count; only the log is narrowed.
    expect(count).toBe(3);
    const entry = getLogSink().find((e) => e.event === "item-analysis.count");
    expect(entry).toBeDefined();
    expect(Object.keys(entry!.meta)).toEqual(["countBucket"]);
    expect(entry!.meta.countBucket).toBe("few");
  });
});

/**
 * Gated real integration: hits a running local backend. Disabled by default.
 * Run with:
 *   RUN_INTEGRATION=1 NAVER_SAMPLE_XLSX=/abs/synthetic_review.xlsx npm test
 *
 * NAVER_SAMPLE_XLSX MUST point to a SYNTHETIC NAVER-shaped export (fake rows with
 * unique 리뷰글번호 ids) — never a real seller-center export. This test ingests the
 * file into the local dev DB, so real customer data must not be used. No NAVER
 * credentials and no live NAVER access are involved — only the local SellerOps
 * login + the synthetic file.
 */
const RUN_INTEGRATION = process.env.RUN_INTEGRATION === "1";
describe("submitReplyOutcome", () => {
  const BODY = {
    commandId: "outcome-run_deadbeef01",
    submissionRef: "a1b2c3d4e5f60718",
    operatorOutcome: "SUBMISSION_ABORTED",
    awRunRef: "run_deadbeef01",
  };

  it("POSTs to the outcome path with the bearer + body and returns the idempotent record result", async () => {
    let captured: { url?: string; body?: string; auth?: string } = {};
    const fakeFetch = (async (url: string, init: RequestInit) => {
      captured = {
        url,
        body: String(init.body),
        auth: (init.headers as Record<string, string>).authorization,
      };
      return jsonResponse({ actionRef: "review:abc", recorded: true, replayed: false });
    }) as unknown as typeof fetch;

    const res = await submitReplyOutcome("http://x", "tok", "acc-1", "review:abc", BODY, fakeFetch);
    expect(res).toEqual({ actionRef: "review:abc", recorded: true, replayed: false });
    expect(captured.url).toBe("http://x/api/seller-accounts/acc-1/attention/items/review%3Aabc/reply/outcome");
    expect(captured.auth).toBe("Bearer tok");
    expect(JSON.parse(captured.body ?? "{}")).toMatchObject({
      commandId: BODY.commandId,
      submissionRef: BODY.submissionRef,
      operatorOutcome: "SUBMISSION_ABORTED",
      awRunRef: "run_deadbeef01",
    });
  });

  it("surfaces an idempotent replay (replayed:true) unchanged", async () => {
    const fakeFetch = (async () => jsonResponse({ actionRef: "review:abc", recorded: true, replayed: true })) as unknown as typeof fetch;
    expect(await submitReplyOutcome("http://x", "tok", "acc", "review:abc", BODY, fakeFetch)).toMatchObject({ replayed: true });
  });

  it("throws UploadError(replyOutcome) on a 409 conflict", async () => {
    const fakeFetch = (async () => new Response("conflict", { status: 409 })) as unknown as typeof fetch;
    await expect(submitReplyOutcome("http://x", "tok", "acc", "review:abc", BODY, fakeFetch)).rejects.toMatchObject({
      name: "UploadError",
      stage: "replyOutcome",
      httpStatus: 409,
    });
  });
});

describe("live-backend integration (gated)", () => {
  it.skipIf(!RUN_INTEGRATION)(
    "uploads twice: first inserts + enriches, second dedups with no new analyses",
    async () => {
      const baseUrl = process.env.SELLEROPS_BASE_URL ?? "http://localhost:8080";
      const sample = process.env.NAVER_SAMPLE_XLSX;
      expect(sample, "set NAVER_SAMPLE_XLSX to a SYNTHETIC review export (not a real one)").toBeTruthy();

      const token = await login(
        baseUrl,
        process.env.SELLEROPS_EMAIL ?? "demo@sellerops.ai",
        process.env.SELLEROPS_PASSWORD ?? "demo1234",
      );
      const channelId = await resolveChannelId(baseUrl, token, process.env.NAVER_CHANNEL_CODE ?? "NAVER");

      // Baseline → upload #1 → measure enrichment delta.
      const beforeCount = await fetchItemAnalysisCount(baseUrl, token);
      const first = await uploadReviewFile(baseUrl, token, channelId, sample!);
      const afterFirstCount = await fetchItemAnalysisCount(baseUrl, token);

      expect(first.status).toBe("SUCCESS");
      expect(first.failedRows).toBe(0);
      expect(first.successRows).toBeGreaterThan(0);
      expect(
        decideState({ paired: true, session: "LOGGED_IN", exportOutcome: "CAPTURED", uploadOutcome: "OK" }),
      ).toBe("LAST_SUCCESS");
      // Item-analysis enrichment fired for exactly the newly inserted rows.
      expect(afterFirstCount - beforeCount).toBe(first.successRows);

      // Upload #2 (same file) → dedup, and no new analyses for duplicates.
      const second = await uploadReviewFile(baseUrl, token, channelId, sample!);
      const afterSecondCount = await fetchItemAnalysisCount(baseUrl, token);

      expect(second.successRows).toBe(0);
      expect(second.skippedRows).toBeGreaterThanOrEqual(first.successRows);
      expect(afterSecondCount).toBe(afterFirstCount);
    },
  );

  /**
   * Action Window ingest handoff against the real backend, self-generating a SYNTHETIC CSV (no
   * xlsx-writer dependency; the backend `FileParser` parses CSV via the same ReviewRowMapper/dedup
   * path). Unique `리뷰글번호` ids (nonce per run) guarantee the first upload inserts and the second
   * dedups — avoiding a dedup false-empty from ids already in the dev DB. Proves the sanitized
   * `{ ok, processed }` reduction on a REAL `IngestResult` and the idempotent re-upload.
   */
  it.skipIf(!RUN_INTEGRATION)(
    "ingest handoff: synthetic CSV inserts then dedups, sanitized to { ok, processed }",
    async () => {
      const baseUrl = process.env.SELLEROPS_BASE_URL ?? "http://localhost:8080";
      const token = await login(
        baseUrl,
        process.env.SELLEROPS_EMAIL ?? "demo@sellerops.ai",
        process.env.SELLEROPS_PASSWORD ?? "demo1234",
      );
      const channelId = await resolveChannelId(baseUrl, token, process.env.NAVER_CHANNEL_CODE ?? "NAVER");

      // Synthetic review CSV with unique external ids (리뷰글번호) so re-upload dedups deterministically.
      const rows = [0, 1, 2].map((n) => ({ id: `awfx-${randomUUID()}`, n }));
      const header = "상품명,내용,별점,작성일,리뷰글번호";
      const body = rows.map((r) => `합성상품,합성 리뷰 본문 ${r.n},5,2026-01-0${r.n + 1},${r.id}`).join("\n");
      const csv = new TextEncoder().encode(`${header}\n${body}\n`);
      const name = `aw-synthetic-${randomUUID().slice(0, 8)}.csv`;

      const before = await fetchItemAnalysisCount(baseUrl, token);
      const first = sanitizeBackendIngest(
        await uploadReviewBytes(baseUrl, token, channelId, csv, name, fetch, "SELLER_CENTER_EXPORT"),
      );
      const afterFirst = await fetchItemAnalysisCount(baseUrl, token);
      expect(first.ok).toBe(true);
      expect(first.processed).toBeGreaterThan(0);
      expect(afterFirst - before).toBe(first.processed);

      // Re-upload the identical rows → all-duplicates: still ok, but 0 processed and no new analyses.
      const second = sanitizeBackendIngest(
        await uploadReviewBytes(baseUrl, token, channelId, csv, name, fetch, "SELLER_CENTER_EXPORT"),
      );
      const afterSecond = await fetchItemAnalysisCount(baseUrl, token);
      expect(second.ok).toBe(true);
      expect(second.processed).toBe(0);
      expect(afterSecond).toBe(afterFirst);
    },
  );
});
