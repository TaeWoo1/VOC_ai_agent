/**
 * **Action Window ingest handoff — hand the VALIDATED artifact to the existing upload path (R4).**
 *
 * After the ratified quarantine validation, the verified review artifact is handed through the
 * EXISTING SellerOps upload/ingestion path (`/api/uploads` → IngestionService → ReviewRowMapper →
 * dedup → item-analysis) so review rows are actually processed. **No backend capability is added.**
 *
 * PRIVACY BOUNDARY: the rich backend `IngestResult` (status text, `syncJobId`, `errorMessage`,
 * `sampleErrors`, exact counts) is reduced HERE to `{ ok, processed }` — the ONLY shape the engine's
 * downstream reads (`onIngested` inspects `ok`; `processed` is persisted nowhere). Raw ingest
 * identity/text never reaches the driver, the wire back to the FE, or the persisted Operation Run.
 * The multipart filename on the wire is an opaque `artifactRef`-derived name — the platform's
 * suggested filename is never uploaded.
 *
 * The driver never imports this module or `../upload`; the upload capability is INJECTED as an
 * {@link AwIngestUploadFn} callback (mirrors how the quarantine `io` is injected), so the driver
 * stays network-free and its source guard is unchanged. This module IS the one allowed to reach
 * `../upload`; it never throws (a failure degrades to a fail-closed `{ ok:false, processed:0 }`).
 */
import { login, resolveChannelId, uploadReviewBytes, type IngestResult, type UploadMethod } from "../upload";

/** The validated artifact bytes plus the opaque ref already emitted for this download. */
export interface AwIngestSource {
  bytes(): Uint8Array;
  /** The opaque 16-hex ref the engine emitted for this artifact — the ONLY wire-naming input. */
  artifactRef: string;
}

/**
 * Sanitized ingest outcome — the ONLY shape the engine reads. `ok` gates COMPLETED; `processed` is a
 * count of processed rows (0 is a legitimate all-duplicates outcome, never a failure) and is not
 * persisted. No raw status / id / error text is ever present.
 */
export interface AwIngestOutcome {
  ok: boolean;
  processed: number;
}

/** Exact key allow-list — used by the offline no-leak test. */
export const AW_INGEST_OUTCOME_KEYS: ReadonlyArray<keyof AwIngestOutcome> = ["ok", "processed"];

/** The injected upload capability. Provided by the caller (session wiring / CLI), never the driver. */
export type AwIngestUploadFn = (src: AwIngestSource) => Promise<AwIngestOutcome>;

/** Opaque artifact-ref shape (engine contract) — validated BEFORE composing any wire name. */
const ARTIFACT_REF_SHAPE = /^[0-9a-f]{16}$/;

/** Fixed neutral fallback name — used when the ref is not a clean 16-hex (defense-in-depth). */
const NEUTRAL_FALLBACK_NAME = "aw-review-export.xlsx" as const;

/**
 * The neutral, caller-controlled multipart filename — derived ONLY from the opaque ref (never the
 * platform's suggested filename). A malformed ref falls back to a fixed constant so a hostile ref can
 * never compose a path-ish or content-bearing name.
 */
export function neutralUploadName(artifactRef: string): string {
  return ARTIFACT_REF_SHAPE.test(artifactRef) ? `aw-${artifactRef}.xlsx` : NEUTRAL_FALLBACK_NAME;
}

/**
 * Pure: reduce a backend `IngestResult` to the sanitized `{ ok, processed }`. `ok` requires a clean
 * SUCCESS (an all-duplicates re-upload is SUCCESS with 0 processed — a legitimate idempotent
 * completion); PARTIAL / FAILED / any failed row fails closed. `processed` echoes only `successRows`.
 */
export function sanitizeBackendIngest(result: IngestResult): AwIngestOutcome {
  const failed = Number.isFinite(result.failedRows) ? result.failedRows : 0;
  const ok = result.status === "SUCCESS" && failed === 0;
  const processed = ok && Number.isFinite(result.successRows) && result.successRows > 0 ? result.successRows : 0;
  return { ok, processed };
}

export interface BackendIngestUploadOpts {
  baseUrl: string;
  email: string;
  password: string;
  /** Channel code to resolve (default `"NAVER"`). */
  channelCode?: string;
  /** Source provenance recorded by the backend (default `SELLER_CENTER_EXPORT`). */
  method?: UploadMethod;
  /** Injected network; default global `fetch`. Threaded through `upload.ts`. */
  fetchImpl?: typeof fetch;
}

/**
 * Build the real ingest upload capability: `login → resolveChannelId → uploadReviewBytes` (under the
 * neutral name) `→ sanitizeBackendIngest`. Never throws — a login / channel / upload failure degrades
 * to a fail-closed `{ ok:false, processed:0 }` so the run fails closed rather than surfacing an error
 * body. The returned `AwIngestUploadFn` is what the caller injects into the driver's downstream.
 */
export function buildBackendIngestUpload(opts: BackendIngestUploadOpts): AwIngestUploadFn {
  return async (src: AwIngestSource): Promise<AwIngestOutcome> => {
    try {
      const fetchImpl = opts.fetchImpl ?? fetch;
      const token = await login(opts.baseUrl, opts.email, opts.password, fetchImpl);
      const channelId = await resolveChannelId(opts.baseUrl, token, opts.channelCode ?? "NAVER", fetchImpl);
      const result = await uploadReviewBytes(
        opts.baseUrl,
        token,
        channelId,
        src.bytes(),
        neutralUploadName(src.artifactRef),
        fetchImpl,
        opts.method ?? "SELLER_CENTER_EXPORT",
      );
      return sanitizeBackendIngest(result);
    } catch {
      return { ok: false, processed: 0 };
    }
  };
}
