/**
 * **Operation Run file store (R3).** The ONLY module in `src/action-window/` that touches the
 * filesystem — the domain (`operation-run.ts`), engine, and session stay pure. Mirrors the proven
 * collector store discipline (`connection/store.ts`, `bridge/pairing-store.ts`):
 *
 *  - one JSON file per run under an agent-owned dot-dir (default `<collector>/.operation-runs/`,
 *    gitignored), written atomically (temp file in the same dir + rename) with restrictive perms;
 *  - strict allow-list parse on load (schema version, contract-valid events/view, gapless audit
 *    order) — a corrupt or tampered record never half-loads;
 *  - sanitized error categories only — an error message never carries file contents;
 *  - a prohibited-content gate on SAVE as well as load: a record that contains any prohibited
 *    field (selector/URL/path/credential/page content — see the contract's `findProhibitedFields`)
 *    is refused BEFORE it reaches disk. Nothing prohibited can be persisted, structurally.
 */
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { findProhibitedFields } from "../../../contracts/action-window/v1/index";
import { parseOperationRun, type OperationRun, type OperationRunParseError } from "./operation-run";

export type OperationRunStoreErrorCategory =
  | "STORE_MALFORMED_JSON"
  | "STORE_INVALID_RECORD"
  | "STORE_PROHIBITED_CONTENT"
  | "STORE_INVALID_RUN_ID"
  | "STORE_IO_ERROR";

/** Sanitized store error: the message is the category (+ parse code) only — never file contents. */
export class OperationRunStoreError extends Error {
  constructor(
    readonly category: OperationRunStoreErrorCategory,
    parseError?: OperationRunParseError,
  ) {
    super(parseError ? `${category}:${parseError}` : category);
    this.name = "OperationRunStoreError";
  }
}

/** Deterministic default location (agent-owned dot-dir next to `.status`/`.connections`). */
export function defaultOperationRunDirFor(rootDir: string): string {
  return resolve(rootDir, ".operation-runs");
}

/** runIds become filenames — accept only opaque id characters, never path syntax. */
function assertSafeRunId(runId: string): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(runId)) throw new OperationRunStoreError("STORE_INVALID_RUN_ID");
}

function runFilePath(dir: string, runId: string): string {
  assertSafeRunId(runId);
  return join(dir, `${runId}.json`);
}

/** Persist one run atomically. Refuses (fail closed) rather than writing a non-conforming record. */
export function saveOperationRun(dir: string, run: OperationRun): void {
  // Round-trip through JSON first: what is validated is exactly what lands on disk.
  const json = JSON.stringify(run, null, 2);
  const onDisk: unknown = JSON.parse(json);
  if (findProhibitedFields(onDisk).length > 0) throw new OperationRunStoreError("STORE_PROHIBITED_CONTENT");
  const parsed = parseOperationRun(onDisk);
  if (!parsed.ok) throw new OperationRunStoreError("STORE_INVALID_RECORD", parsed.error);

  const filePath = runFilePath(dir, run.runId);
  try {
    mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
    const tmp = `${filePath}.tmp`;
    writeFileSync(tmp, json, { encoding: "utf8", mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, filePath);
  } catch {
    throw new OperationRunStoreError("STORE_IO_ERROR");
  }
}

/** Load one run. Missing file → null; malformed/invalid/prohibited content → sanitized error. */
export function loadOperationRun(dir: string, runId: string): OperationRun | null {
  const filePath = runFilePath(dir, runId);
  if (!existsSync(filePath)) return null;
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    throw new OperationRunStoreError("STORE_IO_ERROR");
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new OperationRunStoreError("STORE_MALFORMED_JSON");
  }
  const parsed = parseOperationRun(parsedJson);
  if (!parsed.ok) {
    if (parsed.error === "PROHIBITED_CONTENT") throw new OperationRunStoreError("STORE_PROHIBITED_CONTENT");
    throw new OperationRunStoreError("STORE_INVALID_RECORD", parsed.error);
  }
  return parsed.run;
}

/** List the persisted runIds (filenames only — nothing is parsed). Missing dir → empty. */
export function listOperationRunIds(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json") && !f.endsWith(".tmp"))
      .map((f) => f.slice(0, -".json".length))
      .filter((id) => /^[A-Za-z0-9_-]{1,128}$/.test(id))
      .sort();
  } catch {
    throw new OperationRunStoreError("STORE_IO_ERROR");
  }
}

/** Remove one persisted run (idempotent — missing file is a no-op). */
export function deleteOperationRun(dir: string, runId: string): void {
  const filePath = runFilePath(dir, runId);
  try {
    if (existsSync(filePath)) unlinkSync(filePath);
  } catch {
    throw new OperationRunStoreError("STORE_IO_ERROR");
  }
}
