/**
 * **Action Window artifact quarantine — controlled TEMPORARY save for validation only (R4, D-021).**
 *
 * Implements the ratified quarantine-save validation posture: a detected download artifact may be
 * saved to a gitignored quarantine directory STRICTLY to validate it structurally (extension
 * category + OOXML/ZIP magic sniff), and is then DELETED (`delete-after-validate`). No filename,
 * path, URL, or file content ever crosses the wire, the persisted store, or logs — the verdict is
 * booleans only, and the quarantine basename derives ONLY from the opaque nonce-seeded
 * `artifactRef` (the platform's suggested filename is read once for the extension-category boolean
 * and discarded; it never influences a name, a hash, or any output).
 *
 * FAIL-CLOSED CLEANUP POLICY: `valid` requires `deleted`. A quarantine file that could not be
 * removed is a posture violation — the run fails `ARTIFACT_INVALID` and resumes through the human
 * checkpoint rather than silently retaining data on disk.
 *
 * This is the ONLY Action Window module that touches `node:fs` or a download's `saveAs`. The pure
 * structural sniff is REUSED from the proven diagnostic precedent (`review-download-save.ts`) —
 * the save/delete orchestration is deliberately re-authored here (D-013) because the diagnostic's
 * basename hashes the raw filename and its inspection surface carries upload-diagnostic vocabulary
 * this slice must not import.
 *
 * Errors are swallowed structurally: fs error messages embed absolute paths, so no error text is
 * ever captured, returned, or logged — a failure only flips the corresponding boolean.
 */
import { mkdirSync, openSync, readSync, closeSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { sniffXlsxReadable } from "../naver/review-download-save";
import { extensionCategory } from "../naver/review-export";

/** Every quarantine file this module creates carries this prefix — the sweep removes only these. */
export const QUARANTINE_PREFIX = "aw-quarantine-" as const;

/**
 * Default gitignored quarantine directory for the agent-owned temporary validation saves
 * (`<collector>/.aw-quarantine/`, mirroring the `.operation-runs/` dot-dir). Agent-local only,
 * never committed; the delete-after-validate posture leaves it empty between runs.
 */
export function defaultQuarantineDirFor(rootDir: string): string {
  return resolve(rootDir, ".aw-quarantine");
}
/** The ratified retention posture (D-021): the saved file exists only for the validation window. */
export const QUARANTINE_RETENTION_POLICY = "delete-after-validate" as const;

/** How many leading bytes the structural sniff reads (matches the diagnostic precedent). */
const DEFAULT_HEAD_BYTES = 64 * 1024;
/** Opaque artifact-ref shape (engine contract) — validated BEFORE any path composition. */
const ARTIFACT_REF_SHAPE = /^[0-9a-f]{16}$/;

/** Minimal surface of a real browser download (Playwright `Download` satisfies this). */
export interface SaveableDownloadLike {
  suggestedFilename(): string;
  saveAs(path: string): Promise<void>;
}

/** Minimal surface of a byte-carrying synthetic download (pure fixtures satisfy this). */
export interface ByteDownloadLike {
  suggestedFilename(): string;
  bytes(): Uint8Array;
}

/** Injectable filesystem ops — default is `node:fs`-backed; tests pass fakes. */
export interface QuarantineIo {
  ensureDir(dir: string): void;
  writeFile(path: string, bytes: Uint8Array): void;
  readHead(path: string, maxBytes: number): Uint8Array;
  /** MUST tolerate a missing file (force-remove semantics) — a failed save is not a failed delete. */
  removeFile(path: string): void;
  /** Entry basenames of `dir`; `[]` when the directory is missing. */
  listDir(dir: string): readonly string[];
}

export interface QuarantineOpts {
  /** The gitignored quarantine directory. */
  dir: string;
  /** The opaque 16-hex ref already emitted for this artifact — the ONLY naming input. */
  artifactRef: string;
  io?: QuarantineIo;
  headBytes?: number;
}

/**
 * Sanitized validation verdict — booleans only, allow-listed by {@link QUARANTINE_VERDICT_KEYS}.
 * `valid` is the fail-closed conjunction: saved AND extensionOk AND magicOk AND deleted.
 */
export interface QuarantineVerdict {
  saved: boolean;
  extensionOk: boolean;
  magicOk: boolean;
  deleted: boolean;
  valid: boolean;
}

/** Exact key allow-list — used by the offline no-leak test. */
export const QUARANTINE_VERDICT_KEYS: ReadonlyArray<keyof QuarantineVerdict> = [
  "saved",
  "extensionOk",
  "magicOk",
  "deleted",
  "valid",
];

/** The real `node:fs`-backed io used when none is injected. */
const defaultIo: QuarantineIo = {
  ensureDir(dir: string): void {
    mkdirSync(dir, { recursive: true });
  },
  writeFile(path: string, bytes: Uint8Array): void {
    writeFileSync(path, bytes);
  },
  readHead(path: string, maxBytes: number): Uint8Array {
    const fd = openSync(path, "r");
    try {
      const buf = Buffer.alloc(maxBytes);
      const read = readSync(fd, buf, 0, maxBytes, 0);
      return buf.subarray(0, read);
    } finally {
      closeSync(fd);
    }
  },
  removeFile(path: string): void {
    rmSync(path, { force: true });
  },
  listDir(dir: string): readonly string[] {
    try {
      return readdirSync(dir);
    } catch {
      return [];
    }
  },
};

/** Pure: the quarantine basename — derived ONLY from the opaque ref + the derived category. */
export function quarantineBasenameFor(artifactRef: string, category: string): string {
  const ext = category === "unknown" ? "bin" : category;
  return `${QUARANTINE_PREFIX}${artifactRef}.${ext}`;
}

function allFalse(): QuarantineVerdict {
  return { saved: false, extensionOk: false, magicOk: false, deleted: false, valid: false };
}

/**
 * Shared core: save the artifact into quarantine via `persist`, sniff the head, then ALWAYS
 * attempt the delete. Never throws; never captures error text.
 */
async function quarantineValidateCore(
  suggestedFilename: () => string,
  persist: (path: string) => Promise<void>,
  opts: QuarantineOpts,
): Promise<QuarantineVerdict> {
  if (!ARTIFACT_REF_SHAPE.test(opts.artifactRef)) return allFalse();
  const io = opts.io ?? defaultIo;
  const headBytes = opts.headBytes ?? DEFAULT_HEAD_BYTES;
  // The suggested filename is read ONCE, reduced to the category boolean, and discarded.
  const category = extensionCategory(suggestedFilename());
  const extensionOk = category === "xlsx";
  const path = join(opts.dir, quarantineBasenameFor(opts.artifactRef, category));
  let saved = false;
  let magicOk = false;
  try {
    io.ensureDir(opts.dir);
    await persist(path);
    saved = true;
    magicOk = sniffXlsxReadable(io.readHead(path, headBytes));
  } catch {
    // Structural failure only — the booleans above stay false; no error text is captured.
  }
  let deleted = false;
  try {
    io.removeFile(path);
    deleted = true;
  } catch {
    deleted = false;
  }
  return { saved, extensionOk, magicOk, deleted, valid: saved && extensionOk && magicOk && deleted };
}

/** Validate a REAL browser download (its own `saveAs` writes the quarantine file). */
export function quarantineValidateDownload(
  download: SaveableDownloadLike,
  opts: QuarantineOpts,
): Promise<QuarantineVerdict> {
  return quarantineValidateCore(
    () => download.suggestedFilename(),
    (path) => download.saveAs(path),
    opts,
  );
}

/** Validate a byte-carrying synthetic download (pure fixture path — written via the io). */
export function quarantineValidateBytes(source: ByteDownloadLike, opts: QuarantineOpts): Promise<QuarantineVerdict> {
  const io = opts.io ?? defaultIo;
  return quarantineValidateCore(
    () => source.suggestedFilename(),
    (path) => {
      io.writeFile(path, source.bytes());
      return Promise.resolve();
    },
    opts,
  );
}

/**
 * Crash-window hygiene: remove any leftover quarantine files (ONLY entries carrying the module's
 * own prefix — nothing else in the directory is touched). Best-effort; never throws.
 */
export function sweepQuarantine(dir: string, io: QuarantineIo = defaultIo): void {
  for (const name of io.listDir(dir)) {
    if (!name.startsWith(QUARANTINE_PREFIX)) continue;
    try {
      io.removeFile(join(dir, name));
    } catch {
      // Best-effort: a locked leftover is retried on the next sweep.
    }
  }
}
