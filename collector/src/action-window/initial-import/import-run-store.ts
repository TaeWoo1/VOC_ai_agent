/**
 * **Import run store (ISOLATED, v2).** One sanitized JSON marker per import run under a gitignored
 * `.import-runs/` dot-dir, written atomically, kept SEPARATE from `.operation-runs/` (v1 export) and
 * `.reply-runs/` (v2 reply) so both audited stores stay byte-for-byte untouched.
 *
 * ## Restart recovery: ABANDON, and the reason is NOT the reply runtime's reason
 *
 * The reply store parks because a reply POST is not idempotent. An import ingest **is** idempotent — it
 * dedups on `(org, channel, 리뷰글번호)` and the server 409s a second ingest for a consumed ticket — so
 * the obvious conclusion is "therefore import can resume". That conclusion is wrong, and the reason is
 * worth stating because it is easy to re-derive incorrectly:
 *
 *   **Resuming would require persisting the launch ref to disk.** An `importRef` is a single-use
 *   authorization for an ingest; writing one into a marker file makes it a credential at rest, and the
 *   whole point of the ticket design is that the wire and the agent never hold a durable authorization.
 *   Making the seller re-run one segment is a smaller cost than that.
 *
 * So recovery marks every non-terminal record ABANDONED and re-drives nothing. **The segment is not
 * lost:** the server holds the plan, the segment states and the coverage, so the next run picks the same
 * remaining segment up with a freshly minted ticket. Resumption authority lives on the server, which is
 * where it belongs — the agent's marker is an audit record, not a checkpoint.
 *
 * Sanitized: an opaque runId, a semantic channel code, a stage enum, a boolean, an opaque artifact ref
 * and an opaque marker. **Never** a launch ref, filename, path, URL, selector, or date. A
 * prohibited-content gate refuses anything else before it reaches disk.
 */
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { findProhibitedFields } from "../../../../contracts/action-window/v2/index";
import { IMPORT_TERMINAL_STAGES, type ImportStage } from "./import-stages";

export const IMPORT_RUN_SCHEMA_VERSION = 1;

/** A sanitized, audit-only import-run marker. NOT a resumable engine snapshot. */
export interface ImportRunRecord {
  schemaVersion: number;
  /** Runtime-assigned opaque run identity (`run_<hex>`). */
  runId: string;
  channelCode: string;
  stage: ImportStage;
  /**
   * Whether the seller's clicks had already produced a download when the run stopped. Recorded because
   * it is the difference between "the seller lost six clicks" and "the seller lost nothing", which is
   * what an operator needs to know when they look at an abandoned run.
   */
  artifactDetected: boolean;
  /** Opaque 16-hex artifact reference. NEVER a filename or path. Absent until a download is detected. */
  artifactRef?: string;
  /** Set once recovery has abandoned this run. Never re-driven afterwards. */
  abandoned: boolean;
  /** Opaque monotonic marker (never wall-clock). */
  updatedAt: string;
}

export type ImportRunStoreErrorCategory =
  | "STORE_MALFORMED_JSON"
  | "STORE_INVALID_RECORD"
  | "STORE_PROHIBITED_CONTENT"
  | "STORE_INVALID_RUN_ID"
  | "STORE_IO_ERROR";

export class ImportRunStoreError extends Error {
  constructor(readonly category: ImportRunStoreErrorCategory) {
    super(category);
    this.name = "ImportRunStoreError";
  }
}

/** Deterministic default location — agent-owned, gitignored, separate from the other two stores. */
export function defaultImportRunDirFor(rootDir: string): string {
  return resolve(rootDir, ".import-runs");
}

function assertSafeRunId(runId: string): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(runId)) throw new ImportRunStoreError("STORE_INVALID_RUN_ID");
}

function pathFor(dir: string, runId: string): string {
  assertSafeRunId(runId);
  return join(dir, `${runId}.json`);
}

function validate(record: ImportRunRecord): void {
  if (
    typeof record.runId !== "string" ||
    typeof record.channelCode !== "string" ||
    typeof record.stage !== "string" ||
    typeof record.artifactDetected !== "boolean" ||
    typeof record.abandoned !== "boolean" ||
    typeof record.updatedAt !== "string"
  ) {
    throw new ImportRunStoreError("STORE_INVALID_RECORD");
  }
  if (record.artifactRef !== undefined && !/^[0-9a-f]{16}$/.test(record.artifactRef)) {
    throw new ImportRunStoreError("STORE_INVALID_RECORD");
  }
  // The gate that stops a launch ref, a path, or a date from reaching disk by accident.
  const prohibited = findProhibitedFields(record as unknown as Record<string, unknown>);
  if (prohibited.length > 0) throw new ImportRunStoreError("STORE_PROHIBITED_CONTENT");
}

/** Atomic write: temp file + rename, restrictive perms. */
export function saveImportRun(dir: string, record: ImportRunRecord): void {
  validate(record);
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    const target = pathFor(dir, record.runId);
    const temp = `${target}.tmp`;
    writeFileSync(temp, JSON.stringify(record, null, 2), { mode: 0o600 });
    renameSync(temp, target);
    chmodSync(target, 0o600);
  } catch (err) {
    if (err instanceof ImportRunStoreError) throw err;
    throw new ImportRunStoreError("STORE_IO_ERROR");
  }
}

export function readImportRun(dir: string, runId: string): ImportRunRecord | null {
  const target = pathFor(dir, runId);
  if (!existsSync(target)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(target, "utf8"));
  } catch {
    throw new ImportRunStoreError("STORE_MALFORMED_JSON");
  }
  const record = parsed as ImportRunRecord;
  validate(record);
  return record;
}

export function listImportRuns(dir: string): ImportRunRecord[] {
  if (!existsSync(dir)) return [];
  const out: ImportRunRecord[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    try {
      const record = readImportRun(dir, name.slice(0, -5));
      if (record) out.push(record);
    } catch {
      // A malformed marker is not a reason to fail startup — it is an audit record, and one unreadable
      // file must not stop the agent from serving a fresh run.
      continue;
    }
  }
  return out;
}

export function removeImportRun(dir: string, runId: string): void {
  const target = pathFor(dir, runId);
  if (existsSync(target)) unlinkSync(target);
}

/**
 * Abandon every interrupted run. Nothing is re-driven — see the module note on why idempotent ingest
 * does NOT make resumption the right call.
 *
 * @returns the abandoned run ids, split by whether the seller had already produced a download, so the
 *     agent can log the two cases separately: one cost them nothing, the other cost them an export.
 */
export function recoverImportRuns(
  dir: string,
  now: () => string,
): { abandoned: string[]; abandonedAfterDownload: string[] } {
  const abandoned: string[] = [];
  const abandonedAfterDownload: string[] = [];
  for (const record of listImportRuns(dir)) {
    if (record.abandoned) continue;
    if (IMPORT_TERMINAL_STAGES.includes(record.stage)) continue;
    saveImportRun(dir, { ...record, abandoned: true, updatedAt: now() });
    abandoned.push(record.runId);
    if (record.artifactDetected) abandonedAfterDownload.push(record.runId);
  }
  return { abandoned, abandonedAfterDownload };
}
