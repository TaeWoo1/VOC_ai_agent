/**
 * Owner-only local persistence for the calibrated chrome selector specs.
 *
 * The ONLY fs-touching module for this contract. It stores SPECIFICATIONS and nothing
 * else: no observed user id, no shop name, no page text. A spec says where to look; the
 * values read through it live in memory for the length of one comparison.
 *
 * Load failures surface as fixed categories — never the file contents, never the path —
 * so a hand-edited or corrupted store cannot smuggle a string back out through an error.
 */

import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseSelectorSpecs, type ChromeSelectorSpecs } from "./chrome-selector-spec";

export type SelectorStoreErrorCategory =
  | "STORE_NOT_FOUND"
  | "STORE_MALFORMED_JSON"
  | "STORE_INVALID_SPEC"
  | "STORE_IO_ERROR";

export class SelectorStoreError extends Error {
  readonly category: SelectorStoreErrorCategory;
  constructor(category: SelectorStoreErrorCategory) {
    super(category);
    this.name = "SelectorStoreError";
    this.category = category;
  }
}

/** `<collectorRoot>/.chrome-selectors/naver.json`. Deterministic; reads no env. */
export function defaultSelectorStorePath(rootDir: string): string {
  return resolve(rootDir, ".chrome-selectors", "naver.json");
}

/**
 * Load the specs. A MISSING file is `null` rather than an error — a fresh install has
 * simply not run discovery yet, and the caller reports that as "run discovery first".
 * Anything present but unreadable throws a fixed category.
 */
export function loadSelectorSpecs(filePath: string): ChromeSelectorSpecs | null {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT") return null;
    throw new SelectorStoreError("STORE_IO_ERROR");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SelectorStoreError("STORE_MALFORMED_JSON");
  }
  const specs = parseSelectorSpecs(parsed);
  if (specs === null) throw new SelectorStoreError("STORE_INVALID_SPEC");
  return specs;
}

/**
 * Atomic owner-only write: temp file in the same directory, then rename over.
 *
 * The temp path is UNLINKED first, then created exclusively (`wx`). The unlink is the
 * load-bearing part and is mutation-proven: `mode` on `writeFileSync` applies only when
 * the file is CREATED, so a leftover `naver.json.tmp` — and this process waits on two
 * operator prompts of ten to fifteen minutes each, so being killed mid-write is ordinary
 * — would otherwise be reused at whatever mode it already had and then promoted to the
 * real file by the rename.
 *
 * `wx` and `chmodSync` are defence in depth, and named as such rather than dressed up: a
 * umask can only clear permission bits, never add them, so with the unlink in place
 * neither changes the resulting mode. They guard the narrower cases — a symlink planted
 * at this fixed, predictable path, and a race between the unlink and the create.
 */
export function saveSelectorSpecs(filePath: string, specs: ChromeSelectorSpecs): void {
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
  const json = `${JSON.stringify(specs, null, 2)}\n`;
  const tmp = `${filePath}.tmp`;
  try {
    unlinkSync(tmp);
  } catch {
    /* nothing to clear */
  }
  writeFileSync(tmp, json, { mode: 0o600, flag: "wx" });
  chmodSync(tmp, 0o600);
  renameSync(tmp, filePath);
}

/** Narrow an unknown caught value to a fixed category, for a sanitized report. */
export function selectorStoreErrorCategory(error: unknown): SelectorStoreErrorCategory {
  if (error instanceof SelectorStoreError) return error.category;
  if (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "ENOENT"
  ) {
    return "STORE_NOT_FOUND";
  }
  return "STORE_IO_ERROR";
}
