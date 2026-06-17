import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { log } from "./log";

/** Mirror of the backend `IngestResult` record (only the fields the collector reads). */
export interface IngestResult {
  syncJobId: string;
  uploadType: string;
  status: string;
  totalRows: number;
  successRows: number;
  skippedRows: number;
  failedRows: number;
  errorMessage?: string | null;
  sampleErrors?: unknown[];
}

export class UploadError extends Error {
  constructor(
    message: string,
    readonly stage: "login" | "resolveChannel" | "upload" | "itemAnalysis",
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "UploadError";
  }
}

type FetchImpl = typeof fetch;

/**
 * Authenticate against the SellerOps backend and return a JWT. For the POC the
 * collector uses SellerOps dev credentials; the productized path replaces this
 * with a revocable collector/pairing token (separate slice). Either way, no NAVER
 * credential is ever involved.
 */
export async function login(
  baseUrl: string,
  email: string,
  password: string,
  fetchImpl: FetchImpl = fetch,
): Promise<string> {
  const res = await fetchImpl(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new UploadError("login failed", "login", res.status);
  const data = (await res.json()) as { token?: string };
  if (!data.token) throw new UploadError("login response missing token", "login", res.status);
  log("login.ok", { baseUrl });
  return data.token;
}

/** Resolve a channel code (e.g. "NAVER") to its channel id for this org. */
export async function resolveChannelId(
  baseUrl: string,
  token: string,
  code: string,
  fetchImpl: FetchImpl = fetch,
): Promise<string> {
  const res = await fetchImpl(`${baseUrl}/api/channels`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new UploadError("channels fetch failed", "resolveChannel", res.status);
  const channels = (await res.json()) as Array<{ id: string; code: string }>;
  const match = channels.find((c) => c.code === code);
  if (!match) throw new UploadError(`channel not found: ${code}`, "resolveChannel");
  log("channel.resolved", { code });
  return match.id;
}

/**
 * Count stored analyses for this org via `GET /api/item-analysis`. Used by the
 * gated integration test to assert item-analysis enrichment fired only for newly
 * inserted rows (delta after a fresh upload; no delta after a duplicate upload).
 */
export async function fetchItemAnalysisCount(
  baseUrl: string,
  token: string,
  fetchImpl: FetchImpl = fetch,
): Promise<number> {
  const res = await fetchImpl(`${baseUrl}/api/item-analysis`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new UploadError("item-analysis fetch failed", "itemAnalysis", res.status);
  const rows = (await res.json()) as unknown[];
  log("item-analysis.count", { count: rows.length });
  return rows.length;
}

/**
 * Upload a captured review export to the existing `/api/uploads` endpoint as a
 * REVIEW file. The backend runs the existing ReviewRowMapper → dedup →
 * item-analysis; re-uploading the same file is idempotent (리뷰글번호 dedup).
 */
export async function uploadReviewFile(
  baseUrl: string,
  token: string,
  channelId: string,
  filePath: string,
  fetchImpl: FetchImpl = fetch,
): Promise<IngestResult> {
  const bytes = await readFile(filePath);
  const form = new FormData();
  form.append("channelId", channelId);
  form.append("uploadType", "REVIEW");
  form.append("file", new Blob([new Uint8Array(bytes)]), basename(filePath));

  const res = await fetchImpl(`${baseUrl}/api/uploads`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) throw new UploadError("upload failed", "upload", res.status);
  const result = (await res.json()) as IngestResult;
  log("upload.done", {
    filename: basename(filePath),
    status: result.status,
    totalRows: result.totalRows,
    successRows: result.successRows,
    skippedRows: result.skippedRows,
    failedRows: result.failedRows,
  });
  return result;
}
