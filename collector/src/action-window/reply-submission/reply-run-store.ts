/**
 * **Reply-submission run store (ISOLATED, v2).** A minimal sanitized file store for reply-submission
 * runs, kept deliberately SEPARATE from the export `run-store.ts` / `.operation-runs/` so the audited
 * v1 export store is byte-for-byte untouched. One JSON file per run under a gitignored `.reply-runs/`
 * dot-dir, written atomically (temp + rename, restrictive perms), mirroring the collector store
 * discipline (`run-store.ts`, `connection/store.ts`).
 *
 * The record is intentionally tiny — an audit marker, not a resumable engine snapshot. Restart
 * recovery for a reply run is **PARKED, never resumed**: a reply POST is not idempotent, so an
 * interrupted run is NEVER reconstructed into a driving session. {@link recoverReplyRuns} marks every
 * non-terminal record PARKED and returns the runIds; nothing is re-driven, and the operator continues
 * only by starting a fresh run with a freshly minted `submissionRef`.
 *
 * Sanitized: the record carries only an opaque runId, a semantic channel code, a stage ENUM, a boolean,
 * and an opaque marker — never a selector, URL, path, reply text, or `submissionRef` binding. A
 * prohibited-content gate on save (v2 `findProhibitedFields`) refuses anything else before disk.
 */
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { findProhibitedFields } from "../../../../contracts/action-window/v2/index";
import { REPLY_TERMINAL_STAGES, type ReplyPlanKind, type ReplyRunMode, type ReplyStage } from "./reply-stages";

// v2: the record now also carries the run's non-sensitive identity (`mode`, `planKind`) so restart
// recovery can NEVER default a run to FULL_SUBMIT / legacy. Bumped from v1 → v2.
export const REPLY_RUN_SCHEMA_VERSION = 2;

const REPLY_RUN_MODES: readonly ReplyRunMode[] = ["FULL_SUBMIT", "ABORT_REHEARSAL"];
const REPLY_PLAN_KINDS: readonly ReplyPlanKind[] = ["LEGACY", "GUIDED"];

/** A sanitized, audit-only reply-run marker. NOT a resumable engine snapshot. */
export interface ReplyRunRecord {
  schemaVersion: number;
  /** Runtime-assigned opaque run identity (`run_<hex>`). */
  runId: string;
  /** Semantic channel code (e.g. `naver`). */
  channelCode: string;
  /** Last persisted stage enum. */
  stage: ReplyStage;
  /**
   * The run's mode. Non-sensitive identity, persisted so recovery/reconstruction can never LAUNDER an
   * `ABORT_REHEARSAL` run into a submit-capable `FULL_SUBMIT` one.
   */
  mode: ReplyRunMode;
  /** The run's step-plan kind. Non-sensitive identity, persisted alongside `mode`. */
  planKind: ReplyPlanKind;
  /** Set true once restart recovery has PARKED this run — it is never re-driven again. */
  parked: boolean;
  /** Opaque monotonic marker (never wall-clock). */
  updatedAt: string;
}

export type ReplyRunStoreErrorCategory =
  | "STORE_MALFORMED_JSON"
  | "STORE_INVALID_RECORD"
  | "STORE_PROHIBITED_CONTENT"
  | "STORE_INVALID_RUN_ID"
  | "STORE_IO_ERROR";

export class ReplyRunStoreError extends Error {
  constructor(readonly category: ReplyRunStoreErrorCategory) {
    super(category);
    this.name = "ReplyRunStoreError";
  }
}

/** Deterministic default location (agent-owned dot-dir, gitignored, SEPARATE from `.operation-runs`). */
export function defaultReplyRunDirFor(rootDir: string): string {
  return resolve(rootDir, ".reply-runs");
}

function assertSafeRunId(runId: string): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(runId)) throw new ReplyRunStoreError("STORE_INVALID_RUN_ID");
}

function runFilePath(dir: string, runId: string): string {
  assertSafeRunId(runId);
  return join(dir, `${runId}.json`);
}

const STAGES: readonly ReplyStage[] = [
  "PREPARE_SESSION", "LOCATE_ROW", "HIGHLIGHT_ROW", "WAIT_FOR_ROW_OPEN",
  "LOCATE_COMPOSER", "HIGHLIGHT_COMPOSER", "WAIT_FOR_SUBMIT",
  "OPERATOR_REPORTED", "FAILED", "CANCELLED", "PAUSED",
];

/**
 * Structural validation — reject anything that is not a well-formed sanitized marker. `mode`/`planKind`
 * are REQUIRED and validated against their enums: a record missing/!valid on either FAILS CLOSED rather
 * than defaulting, so recovery can never infer `FULL_SUBMIT`/`LEGACY` for a run whose identity was lost.
 */
function parseRecord(raw: unknown): ReplyRunRecord {
  if (typeof raw !== "object" || raw === null) throw new ReplyRunStoreError("STORE_INVALID_RECORD");
  const r = raw as Record<string, unknown>;
  if (r.schemaVersion !== REPLY_RUN_SCHEMA_VERSION) throw new ReplyRunStoreError("STORE_INVALID_RECORD");
  if (typeof r.runId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(r.runId)) throw new ReplyRunStoreError("STORE_INVALID_RECORD");
  if (typeof r.channelCode !== "string" || r.channelCode.length === 0) throw new ReplyRunStoreError("STORE_INVALID_RECORD");
  if (typeof r.stage !== "string" || !STAGES.includes(r.stage as ReplyStage)) throw new ReplyRunStoreError("STORE_INVALID_RECORD");
  if (typeof r.mode !== "string" || !REPLY_RUN_MODES.includes(r.mode as ReplyRunMode)) throw new ReplyRunStoreError("STORE_INVALID_RECORD");
  if (typeof r.planKind !== "string" || !REPLY_PLAN_KINDS.includes(r.planKind as ReplyPlanKind)) throw new ReplyRunStoreError("STORE_INVALID_RECORD");
  if (typeof r.parked !== "boolean") throw new ReplyRunStoreError("STORE_INVALID_RECORD");
  if (typeof r.updatedAt !== "string") throw new ReplyRunStoreError("STORE_INVALID_RECORD");
  return {
    schemaVersion: r.schemaVersion,
    runId: r.runId,
    channelCode: r.channelCode,
    stage: r.stage as ReplyStage,
    mode: r.mode as ReplyRunMode,
    planKind: r.planKind as ReplyPlanKind,
    parked: r.parked,
    updatedAt: r.updatedAt,
  };
}

/** Persist one reply-run marker atomically. Refuses (fail closed) rather than writing prohibited content. */
export function saveReplyRun(dir: string, record: ReplyRunRecord): void {
  const json = JSON.stringify(record, null, 2);
  const onDisk: unknown = JSON.parse(json);
  if (findProhibitedFields(onDisk).length > 0) throw new ReplyRunStoreError("STORE_PROHIBITED_CONTENT");
  parseRecord(onDisk); // shape check before disk
  const filePath = runFilePath(dir, record.runId);
  try {
    mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
    const tmp = `${filePath}.tmp`;
    writeFileSync(tmp, json, { encoding: "utf8", mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, filePath);
  } catch {
    throw new ReplyRunStoreError("STORE_IO_ERROR");
  }
}

/** Load one reply-run marker. Missing file → null; malformed/invalid → sanitized error. */
export function loadReplyRun(dir: string, runId: string): ReplyRunRecord | null {
  const filePath = runFilePath(dir, runId);
  if (!existsSync(filePath)) return null;
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    throw new ReplyRunStoreError("STORE_IO_ERROR");
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new ReplyRunStoreError("STORE_MALFORMED_JSON");
  }
  return parseRecord(parsedJson);
}

/** List persisted reply runIds (filenames only). Missing dir → empty. */
export function listReplyRunIds(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json") && !f.endsWith(".tmp"))
      .map((f) => f.slice(0, -".json".length))
      .filter((id) => /^[A-Za-z0-9_-]{1,128}$/.test(id))
      .sort();
  } catch {
    throw new ReplyRunStoreError("STORE_IO_ERROR");
  }
}

/** Remove one reply-run marker (idempotent). */
export function deleteReplyRun(dir: string, runId: string): void {
  const filePath = runFilePath(dir, runId);
  try {
    if (existsSync(filePath)) unlinkSync(filePath);
  } catch {
    throw new ReplyRunStoreError("STORE_IO_ERROR");
  }
}

/** A stage that has not reached a terminal AND has not already been parked → eligible for PARK-on-restart. */
function isRecoverable(record: ReplyRunRecord): boolean {
  return !record.parked && !REPLY_TERMINAL_STAGES.includes(record.stage);
}

/**
 * Restart recovery: mark every non-terminal, not-yet-parked reply run as **PARKED** and return their
 * runIds. It NEVER reconstructs a driving session and NEVER re-drives a submit — a reply POST is not
 * idempotent. The operator continues only by starting a fresh run with a freshly minted `submissionRef`.
 * Idempotent: a second call finds the runs already parked and returns nothing new.
 */
export function recoverReplyRuns(dir: string, now: () => string): { parked: string[] } {
  const parked: string[] = [];
  for (const runId of listReplyRunIds(dir)) {
    const record = loadReplyRun(dir, runId);
    if (record && isRecoverable(record)) {
      saveReplyRun(dir, { ...record, parked: true, updatedAt: now() });
      parked.push(runId);
    }
  }
  return { parked };
}
