import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { clearLogSink, getLogSink } from "../src/log";
import { decideState } from "../src/status";
import { login, resolveChannelId, uploadReviewFile, UploadError } from "../src/upload";

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
  });

  it("throws UploadError(upload) on 500", async () => {
    const fakeFetch = async () => new Response("boom", { status: 500 });
    await expect(
      uploadReviewFile("http://x", "t", "chan-1", SAMPLE_FILE, fakeFetch as typeof fetch),
    ).rejects.toMatchObject({ stage: "upload", httpStatus: 500 });
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
    expect(serialized).toContain("successRows");
  });
});

/**
 * Gated real integration: hits a running local backend. Disabled by default.
 * Run with:  RUN_INTEGRATION=1 NAVER_SAMPLE_XLSX=/abs/review.xlsx npm test
 */
const RUN_INTEGRATION = process.env.RUN_INTEGRATION === "1";
describe("live-backend integration (gated)", () => {
  it.skipIf(!RUN_INTEGRATION)("uploads twice and the second run dedups to zero new rows", async () => {
    const baseUrl = process.env.SELLEROPS_BASE_URL ?? "http://localhost:8080";
    const sample = process.env.NAVER_SAMPLE_XLSX;
    expect(sample, "set NAVER_SAMPLE_XLSX to a real review export").toBeTruthy();

    const token = await login(baseUrl, process.env.SELLEROPS_EMAIL ?? "demo@sellerops.ai", process.env.SELLEROPS_PASSWORD ?? "demo1234");
    const channelId = await resolveChannelId(baseUrl, token, process.env.NAVER_CHANNEL_CODE ?? "NAVER");

    const first = await uploadReviewFile(baseUrl, token, channelId, sample!);
    const second = await uploadReviewFile(baseUrl, token, channelId, sample!);

    expect(decideState({ paired: true, session: "LOGGED_IN", exportOutcome: "CAPTURED", uploadOutcome: "OK" })).toBe("LAST_SUCCESS");
    // Idempotency: the second upload inserts nothing new (리뷰글번호 dedup).
    expect(second.successRows).toBe(0);
    expect(second.skippedRows).toBeGreaterThanOrEqual(first.successRows);
  });
});
