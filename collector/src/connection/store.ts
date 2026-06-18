/**
 * Local-file persistence for the connection registry. This is the ONLY module in
 * `src/connection/` that touches the filesystem — the model, guard, applier,
 * record, workflow, and registry layers stay pure. No browser, network, backend,
 * DB, or `process.env` here either.
 *
 * On-disk format: a JSON array of `ConnectionRecord` (exactly `registry.toRecords()`).
 * Load failures surface as `ConnectionStoreError` carrying a FIXED category — never
 * the raw file contents or an attacker-controlled invalid value. The store holds
 * only connection records (hash + category + user alias); never raw NAVER
 * identity, URLs, filenames, review data, or customer data.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  createConnectionRegistry,
  registryFromRecords,
  type ConnectionRegistry,
} from "./registry";

/** Fixed, sanitized persistence-error categories. */
export type ConnectionStoreErrorCategory =
  | "STORE_NOT_FOUND"
  | "STORE_MALFORMED_JSON"
  | "STORE_INVALID_RECORD"
  | "STORE_IO_ERROR";

/**
 * A sanitized persistence error. Its message is the category only; an optional
 * `recordErrorCategory` carries the (also-fixed) record parse category. Neither
 * field ever contains raw file contents or an attacker-controlled value.
 */
export class ConnectionStoreError extends Error {
  readonly category: ConnectionStoreErrorCategory;
  readonly recordErrorCategory?: string;

  constructor(category: ConnectionStoreErrorCategory, recordErrorCategory?: string) {
    super(recordErrorCategory ? `${category}: ${recordErrorCategory}` : category);
    this.name = "ConnectionStoreError";
    this.category = category;
    this.recordErrorCategory = recordErrorCategory;
  }
}

/** Narrow an unknown caught value to a fixed store-error category. */
export function connectionStoreErrorCategory(error: unknown): ConnectionStoreErrorCategory {
  if (error instanceof ConnectionStoreError) return error.category;
  if (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "ENOENT"
  ) {
    return "STORE_NOT_FOUND";
  }
  return "STORE_IO_ERROR";
}

/**
 * Deterministic default store path under the collector workspace:
 * `<rootDir>/.connections/connections.json`. Does not read env vars.
 */
export function defaultConnectionStorePath(rootDir: string): string {
  return resolve(rootDir, ".connections", "connections.json");
}

/**
 * Load a registry from a JSON file. A MISSING file yields an empty registry (a
 * fresh install has no connections yet). Malformed JSON or an invalid record set
 * throws a `ConnectionStoreError` with a fixed category — the raw contents are
 * never surfaced.
 */
export function loadConnectionRegistryFromFile(filePath: string): ConnectionRegistry {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT") {
      return createConnectionRegistry();
    }
    throw new ConnectionStoreError("STORE_IO_ERROR");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConnectionStoreError("STORE_MALFORMED_JSON");
  }
  if (!Array.isArray(parsed)) {
    throw new ConnectionStoreError("STORE_MALFORMED_JSON");
  }

  const result = registryFromRecords(parsed);
  if (!result.ok) {
    // result.errorCategory is itself a fixed, sanitized record category.
    throw new ConnectionStoreError("STORE_INVALID_RECORD", result.errorCategory);
  }
  return result.registry;
}

/**
 * Persist a registry to a JSON file (pretty-printed array of records). Creates the
 * parent directory if missing. The write is atomic: serialize to a temp file in
 * the SAME directory, then rename over the final path, so a crash mid-write can
 * never leave a half-written store at `filePath`.
 */
export function saveConnectionRegistryToFile(
  filePath: string,
  registry: ConnectionRegistry,
): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const json = `${JSON.stringify(registry.toRecords(), null, 2)}\n`;
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, json, "utf8");
  renameSync(tmpPath, filePath);
}
