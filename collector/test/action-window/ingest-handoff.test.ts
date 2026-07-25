/**
 * Unit tests for the Action Window ingest handoff (R4): reduce a backend `IngestResult` to the
 * sanitized `{ ok, processed }` the engine reads, compose the neutral wire filename from the opaque
 * ref only, and drive the real `login → resolveChannelId → uploadReviewBytes` hookup hermetically
 * with an in-memory fake `fetch`. Also covers the fail-closed degradation (never throws) and the
 * module's own source guard (reaches `../upload` and ONLY that; no browser, no click, no console,
 * no channel-specific diagnostic vocabulary).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  AW_INGEST_OUTCOME_KEYS,
  buildBackendIngestUpload,
  buildSegmentIngestUpload,
  neutralUploadName,
  sanitizeBackendIngest,
  type AwIngestSource,
} from "../../src/action-window/ingest-handoff";
import type { IngestResult } from "../../src/upload";

const REF = "00ff00ff00ff00ff"; // opaque 16-hex artifact ref
const PK_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04]); // arbitrary artifact payload

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function ingestResult(over: Partial<IngestResult>): IngestResult {
  return {
    syncJobId: "job-secret-id",
    uploadType: "REVIEW",
    status: "SUCCESS",
    totalRows: 3,
    successRows: 3,
    skippedRows: 0,
    failedRows: 0,
    errorMessage: null,
    sampleErrors: [],
    ...over,
  };
}

/** A fake backend routing login/channels/uploads; captures the upload multipart body. */
function fakeBackend(opts: { uploadResult?: IngestResult; uploadStatus?: number; loginStatus?: number } = {}) {
  const captured: { uploadForm?: FormData } = {};
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/api/auth/login")) {
      if (opts.loginStatus && opts.loginStatus !== 200) return new Response("no", { status: opts.loginStatus });
      return jsonResponse({ token: "tok-should-never-leak" });
    }
    if (u.endsWith("/api/channels")) return jsonResponse([{ id: "chan-naver", code: "NAVER" }]);
    if (u.endsWith("/api/uploads")) {
      captured.uploadForm = init?.body as FormData;
      if (opts.uploadStatus && opts.uploadStatus !== 200) return new Response("boom", { status: opts.uploadStatus });
      return jsonResponse(opts.uploadResult ?? ingestResult({}));
    }
    return new Response("nope", { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, captured };
}

const source = (): AwIngestSource => ({ bytes: () => PK_BYTES, artifactRef: REF });

describe("sanitizeBackendIngest", () => {
  it("clean SUCCESS → ok with the processed row count", () => {
    expect(sanitizeBackendIngest(ingestResult({ status: "SUCCESS", successRows: 3, failedRows: 0 }))).toEqual({
      ok: true,
      processed: 3,
    });
  });

  it("all-duplicates SUCCESS (0 success, skips) → ok with processed 0 (idempotent, not a failure)", () => {
    expect(
      sanitizeBackendIngest(ingestResult({ status: "SUCCESS", successRows: 0, skippedRows: 5, failedRows: 0 })),
    ).toEqual({ ok: true, processed: 0 });
  });

  it("PARTIAL fails closed", () => {
    expect(sanitizeBackendIngest(ingestResult({ status: "PARTIAL", successRows: 2, failedRows: 1 }))).toEqual({
      ok: false,
      processed: 0,
    });
  });

  it("FAILED fails closed", () => {
    expect(sanitizeBackendIngest(ingestResult({ status: "FAILED", successRows: 0, failedRows: 3 }))).toEqual({
      ok: false,
      processed: 0,
    });
  });

  it("SUCCESS with a stray failed row still fails closed (defensive)", () => {
    expect(sanitizeBackendIngest(ingestResult({ status: "SUCCESS", successRows: 2, failedRows: 1 }))).toEqual({
      ok: false,
      processed: 0,
    });
  });

  it("SUCCESS with a non-finite (unreadable) failed count fails closed — never a fake success", () => {
    for (const failedRows of [NaN, Number.POSITIVE_INFINITY, undefined as unknown as number]) {
      expect(sanitizeBackendIngest(ingestResult({ status: "SUCCESS", successRows: 3, failedRows }))).toEqual({
        ok: false,
        processed: 0,
      });
    }
  });

  it("SUCCESS with failedRows exactly 0 stays ok — the finite-zero boundary is pinned", () => {
    expect(sanitizeBackendIngest(ingestResult({ status: "SUCCESS", successRows: 3, failedRows: 0 }))).toEqual({
      ok: true,
      processed: 3,
    });
  });

  it("returns only the allow-listed keys — no status/id/error text", () => {
    const outcome = sanitizeBackendIngest(ingestResult({ errorMessage: "raw backend error", syncJobId: "raw-id" }));
    expect(Object.keys(outcome).sort()).toEqual([...AW_INGEST_OUTCOME_KEYS].sort());
    expect(JSON.stringify(outcome)).not.toContain("raw");
  });
});

describe("neutralUploadName", () => {
  it("derives an opaque name from a clean 16-hex ref", () => {
    expect(neutralUploadName(REF)).toBe(`aw-${REF}.xlsx`);
  });

  it("falls back to a fixed constant for any malformed ref (no path/content composition)", () => {
    for (const bad of ["../etc/passwd", "AABBCCDDEEFF0011", "0123456789abcde", "0123456789abcdef0", ""]) {
      expect(neutralUploadName(bad)).toBe("aw-review-export.xlsx");
    }
  });
});

describe("buildBackendIngestUpload (hermetic)", () => {
  it("logs in, resolves the channel, uploads under the NEUTRAL name, returns the sanitized outcome", async () => {
    const { fetchImpl, captured } = fakeBackend({});
    const upload = buildBackendIngestUpload({ baseUrl: "http://x", email: "e", password: "p", fetchImpl });
    const outcome = await upload(source());

    expect(outcome).toEqual({ ok: true, processed: 3 });
    expect(captured.uploadForm!.get("channelId")).toBe("chan-naver");
    expect(captured.uploadForm!.get("uploadType")).toBe("REVIEW");
    expect(captured.uploadForm!.get("method")).toBe("SELLER_CENTER_EXPORT");
    const file = captured.uploadForm!.get("file") as File;
    expect(file).toBeInstanceOf(Blob);
    // The wire filename is the opaque ref-derived name — never a platform-supplied filename.
    expect(file.name).toBe(`aw-${REF}.xlsx`);
  });

  it("fails closed (never throws) when the upload is rejected", async () => {
    const { fetchImpl } = fakeBackend({ uploadStatus: 500 });
    const upload = buildBackendIngestUpload({ baseUrl: "http://x", email: "e", password: "p", fetchImpl });
    await expect(upload(source())).resolves.toEqual({ ok: false, processed: 0 });
  });

  it("fails closed (never throws) when login fails", async () => {
    const { fetchImpl } = fakeBackend({ loginStatus: 401 });
    const upload = buildBackendIngestUpload({ baseUrl: "http://x", email: "e", password: "bad", fetchImpl });
    await expect(upload(source())).resolves.toEqual({ ok: false, processed: 0 });
  });

  it("maps an all-duplicates backend result to a COMPLETED-eligible outcome", async () => {
    const { fetchImpl } = fakeBackend({
      uploadResult: ingestResult({ status: "SUCCESS", successRows: 0, skippedRows: 4, failedRows: 0 }),
    });
    const upload = buildBackendIngestUpload({ baseUrl: "http://x", email: "e", password: "p", fetchImpl });
    await expect(upload(source())).resolves.toEqual({ ok: true, processed: 0 });
  });
});

/** A fake backend routing login + the guided-run segment ingest; captures the multipart body and URL. */
function fakeSegmentBackend(
  opts: { attempt?: Record<string, unknown>; ingestStatus?: number; loginStatus?: number } = {},
) {
  const captured: { url?: string; form?: FormData } = {};
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/api/auth/login")) {
      if (opts.loginStatus && opts.loginStatus !== 200) return new Response("no", { status: opts.loginStatus });
      return jsonResponse({ token: "tok-should-never-leak" });
    }
    if (u.includes("/api/imports/reviews/launches/") && u.endsWith("/ingest")) {
      captured.url = u;
      captured.form = init?.body as FormData;
      if (opts.ingestStatus && opts.ingestStatus !== 200) return new Response("boom", { status: opts.ingestStatus });
      return jsonResponse(
        opts.attempt ?? { attemptNo: 1, result: "SUCCEEDED", syncJobId: "job-x", rowsNew: 4, rowsDuplicate: 1, rowsFailed: 0 },
      );
    }
    return new Response("nope", { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, captured };
}

describe("buildSegmentIngestUpload (hermetic)", () => {
  const LAUNCH = "9a8b7c6d5e4f3021";

  it("posts to the launch ref's ingest endpoint under the NEUTRAL name, with the scope evidence", async () => {
    const { fetchImpl, captured } = fakeSegmentBackend();
    const outcome = await buildSegmentIngestUpload({
      baseUrl: "http://backend", email: "e", password: "p", launchRef: LAUNCH,
      scopeEvidence: () => "MACHINE_MATCHED", fetchImpl,
    })(source());

    // rowsNew=4 processed; the duplicate is accounted for but not "processed"
    expect(outcome).toEqual({ ok: true, processed: 4 });
    expect(captured.url).toBe(`http://backend/api/imports/reviews/launches/${LAUNCH}/ingest`);
    expect(captured.form?.get("scopeEvidence")).toBe("MACHINE_MATCHED");
    // the platform's suggested filename can carry store/date identity and is never sent
    expect((captured.form?.get("file") as File).name).toBe(`aw-${REF}.xlsx`);
    // the runtime never names the segment — the ref does
    expect(captured.form?.get("segmentId")).toBeNull();
    expect(captured.form?.get("channelId")).toBeNull();
  });

  // The evidence is only knowable once the seller has actually set the dates, which is long after this
  // capability is built — so it must be read at ingest time, not captured at construction.
  it("reads the scope evidence at ingest time, not when the capability was built", async () => {
    const { fetchImpl, captured } = fakeSegmentBackend();
    let evidence: "MACHINE_MATCHED" | "OPERATOR_CONFIRMED" = "MACHINE_MATCHED";
    const ingest = buildSegmentIngestUpload({
      baseUrl: "http://backend", email: "e", password: "p", launchRef: LAUNCH,
      scopeEvidence: () => evidence, fetchImpl,
    });
    evidence = "OPERATOR_CONFIRMED"; // the read-back turned out to be unreadable
    await ingest(source());
    expect(captured.form?.get("scopeEvidence")).toBe("OPERATOR_CONFIRMED");
  });

  it("maps an all-duplicates re-import to an ok outcome (idempotent, not a failure)", async () => {
    const { fetchImpl } = fakeSegmentBackend({
      attempt: { attemptNo: 2, result: "SUCCEEDED", syncJobId: "job-y", rowsNew: 0, rowsDuplicate: 6, rowsFailed: 0 },
    });
    expect(
      await buildSegmentIngestUpload({
        baseUrl: "http://backend", email: "e", password: "p", launchRef: LAUNCH,
        scopeEvidence: () => "MACHINE_MATCHED", fetchImpl,
      })(source()),
    ).toEqual({ ok: true, processed: 0 });
  });

  it("fails closed on a FAILED attempt — a recorded failure is not a completion", async () => {
    const { fetchImpl } = fakeSegmentBackend({
      attempt: { attemptNo: 1, result: "FAILED", rowsNew: 0, rowsDuplicate: 0, rowsFailed: 3, errorMessage: "bad file" },
    });
    expect(
      await buildSegmentIngestUpload({
        baseUrl: "http://backend", email: "e", password: "p", launchRef: LAUNCH,
        scopeEvidence: () => "MACHINE_MATCHED", fetchImpl,
      })(source()),
    ).toEqual({ ok: false, processed: 0 });
  });

  it.each([
    ["the ingest is rejected", { ingestStatus: 409 }],
    ["login fails", { loginStatus: 401 }],
  ])("fails closed (never throws) when %s", async (_label, over) => {
    const { fetchImpl } = fakeSegmentBackend(over);
    await expect(
      buildSegmentIngestUpload({
        baseUrl: "http://backend", email: "e", password: "p", launchRef: LAUNCH,
        scopeEvidence: () => "MACHINE_MATCHED", fetchImpl,
      })(source()),
    ).resolves.toEqual({ ok: false, processed: 0 });
  });

  it("returns only the allow-listed keys — no attempt id, sync job, or error text", async () => {
    const { fetchImpl } = fakeSegmentBackend({
      attempt: { attemptNo: 1, result: "FAILED", syncJobId: "job-secret", errorMessage: "raw backend text" },
    });
    const outcome = await buildSegmentIngestUpload({
      baseUrl: "http://backend", email: "e", password: "p", launchRef: LAUNCH,
      scopeEvidence: () => "OPERATOR_CONFIRMED", fetchImpl,
    })(source());
    expect(Object.keys(outcome).sort()).toEqual(["ok", "processed"]);
    expect(JSON.stringify(outcome)).not.toContain("job-secret");
    expect(JSON.stringify(outcome)).not.toContain("raw backend text");
  });
});

describe("ingest-handoff module — source guard", () => {
  const srcPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../src/action-window/ingest-handoff.ts");
  const stripComments = (code: string): string =>
    code
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*)/.test(line))
      .join("\n");

  it("reaches no browser/click/console path and no channel-specific diagnostic vocabulary", () => {
    const code = stripComments(readFileSync(srcPath, "utf8"));
    const bannedTokens = [
      /playwright/i,
      /waitForEvent/,
      /saveAs/,
      /\.click\s*\(/,
      /dispatchEvent\s*\(/,
      /console\./,
      /node:fs/,
      /node:net/,
      /node:http/,
      /child_process/,
      /fetch\s*\(/,
      /exceljs|xlsx-populate|sheetjs/i,
    ];
    for (const re of bannedTokens) expect(re.test(code), `ingest-handoff.ts :: ${re}`).toBe(false);

    const importStatements = code.match(/import[\s\S]*?from\s*["'][^"']+["']/g) ?? [];
    const bannedImports = [/review-upload-diagnostic/, /messageFingerprint/, /runExport/, /naver-fixture/];
    for (const statement of importStatements) {
      for (const re of bannedImports) {
        expect(re.test(statement), `ingest-handoff.ts import :: ${re}`).toBe(false);
      }
    }
    // The one allowed reach: the existing upload client (this module is NOT the driver).
    expect(code).toMatch(/from\s*["']\.\.\/upload["']/);
  });
});
