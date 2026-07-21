/**
 * **Interactive-calibration reply-row mapping artifact** (pure loader + a hardened 0600 writer).
 *
 * The operator calibrates the live review list by clicking the real target row and its body / date / rating /
 * reply-control elements; the calibration CLI captures ONLY their **relative structural index-paths** within the
 * row (never a NAVER selector/class, never text) and persists them here, under the gitignored `.reply-target/`.
 * The mutating reply run loads this artifact and applies the paths in-page to census + fingerprint the rows.
 *
 * It is bound so it can NEVER be replayed on a different or drifted page:
 *  - `schemaVersion` — a version mismatch fails closed;
 *  - `structuralPageSignature` — an opaque structural fingerprint of the page recomputed at load time; if the
 *    live page no longer matches, fail closed (`PAGE_DRIFT`);
 *  - `expiresAtEpochMs` — a short TTL; once `nowEpochMs` reaches it, fail closed (`EXPIRED`).
 * `nowEpochMs` and the live signature are supplied by the caller (the CLI boundary), never read here, so this
 * module stays pure/offline-testable. The artifact carries NO raw text, date, rating value, URL, or selector.
 */
import { dirname } from "node:path";

/** The canonical GENERIC container groups a row index is relative to — a structural list, never NAVER-specific. */
export const REVIEW_ROW_CONTAINER_GROUPS: readonly string[] = ['[role="row"]', "article", "ul > li", "ol > li", "tr"];

export const ROW_MAPPING_SCHEMA_VERSION = "reply-row-mapping/v2";

/** A relative structural path: child-index steps descended from the row root to a target element. */
export type StructuralPath = readonly number[];

export interface ReplyRowMapping {
  schemaVersion: string;
  /** Opaque structural fingerprint of the page at calibration time; re-checked against the live page on load. */
  structuralPageSignature: string;
  /** Epoch-ms after which the artifact is refused (short TTL). */
  expiresAtEpochMs: number;
  /** Child-index path from `document.body` to the rows' common parent — structural, never a NAVER selector. */
  parentPath: StructuralPath;
  /** Tag name of the row elements (e.g. "DIV"). Rows = the parent's children of this tag — no class/selector. */
  rowTag: string;
  /** The calibrated target row's index among the parent's children of {@link rowTag} (cross-source + drift check). */
  rowIndex: number;
  /** Child-index paths within EACH row to the rating / date / body / reply-control elements. */
  ratingPath: StructuralPath;
  datePath: StructuralPath;
  bodyPath: StructuralPath;
  replyControlPath: StructuralPath;
}

// No EXISTS/no-clobber code: unlike the reply-target bundle (which holds a single-use submissionRef that must
// never be orphaned), a calibration mapping carries no single-use secret — re-calibrating deliberately replaces it.
export type RowMappingErrorCode = "PERMS" | "MALFORMED" | "SCHEMA" | "VERSION" | "PAGE_DRIFT" | "EXPIRED";

export class ReplyRowMappingError extends Error {
  constructor(readonly code: RowMappingErrorCode) {
    super(code);
    this.name = "ReplyRowMappingError";
  }
}

/** Injectable read surface so the loader is unit-testable offline without touching disk. */
export interface RowMappingReadDeps {
  existsSync: (p: string) => boolean;
  statSync: (p: string) => { mode: number };
  readFileSync: (p: string, enc: "utf8") => string;
}

/** Injectable write surface mirroring the hardened owner-only sequence (dir 0700, file 0600, atomic). */
export interface RowMappingWriteDeps {
  existsSync: (p: string) => boolean;
  mkdirSync: (p: string, opts: { recursive: boolean; mode: number }) => void;
  writeFileSync: (p: string, data: string, opts: { mode: number }) => void;
  chmodSync: (p: string, mode: number) => void;
  renameSync: (from: string, to: string) => void;
}

const MAX_PATH_DEPTH = 40;

function requireStructuralPath(v: unknown): StructuralPath {
  if (!Array.isArray(v) || v.length > MAX_PATH_DEPTH) throw new ReplyRowMappingError("SCHEMA");
  for (const step of v) {
    if (typeof step !== "number" || !Number.isInteger(step) || step < 0 || step > 10_000) {
      throw new ReplyRowMappingError("SCHEMA");
    }
  }
  return v as StructuralPath;
}

function requireIndex(v: unknown, max: number): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > max) throw new ReplyRowMappingError("SCHEMA");
  return v;
}

/**
 * Read the owner-only calibration artifact and validate it against the live page. Returns null when absent.
 * Fails closed (throws {@link ReplyRowMappingError}) on group/world-readable perms, malformed JSON, a schema
 * violation, a version mismatch, page drift (`livePageSignature !== stored`), or expiry (`nowEpochMs` reached
 * `expiresAtEpochMs`). Both `nowEpochMs` and `livePageSignature` are supplied by the CLI boundary.
 */
export function loadRowMapping(
  path: string,
  deps: RowMappingReadDeps,
  nowEpochMs: number,
  livePageSignature: string,
): ReplyRowMapping | null {
  if (!deps.existsSync(path)) return null;
  if ((deps.statSync(path).mode & 0o077) !== 0) throw new ReplyRowMappingError("PERMS");
  let parsed: unknown;
  try {
    parsed = JSON.parse(deps.readFileSync(path, "utf8"));
  } catch {
    throw new ReplyRowMappingError("MALFORMED");
  }
  if (typeof parsed !== "object" || parsed === null) throw new ReplyRowMappingError("MALFORMED");
  const r = parsed as Record<string, unknown>;

  if (r.schemaVersion !== ROW_MAPPING_SCHEMA_VERSION) throw new ReplyRowMappingError("VERSION");
  if (typeof r.structuralPageSignature !== "string" || r.structuralPageSignature.length === 0 || r.structuralPageSignature.length > 128) {
    throw new ReplyRowMappingError("SCHEMA");
  }
  if (typeof r.expiresAtEpochMs !== "number" || !Number.isFinite(r.expiresAtEpochMs)) {
    throw new ReplyRowMappingError("SCHEMA");
  }
  if (typeof r.rowTag !== "string" || !/^[A-Z][A-Z0-9-]{0,19}$/.test(r.rowTag)) throw new ReplyRowMappingError("SCHEMA");
  const mapping: ReplyRowMapping = {
    schemaVersion: ROW_MAPPING_SCHEMA_VERSION,
    structuralPageSignature: r.structuralPageSignature,
    expiresAtEpochMs: r.expiresAtEpochMs,
    parentPath: requireStructuralPath(r.parentPath),
    rowTag: r.rowTag,
    rowIndex: requireIndex(r.rowIndex, 100_000),
    ratingPath: requireStructuralPath(r.ratingPath),
    datePath: requireStructuralPath(r.datePath),
    bodyPath: requireStructuralPath(r.bodyPath),
    replyControlPath: requireStructuralPath(r.replyControlPath),
  };

  // Bindings checked AFTER the shape is valid, so a drifted/expired artifact is reported precisely.
  if (mapping.structuralPageSignature !== livePageSignature) throw new ReplyRowMappingError("PAGE_DRIFT");
  if (nowEpochMs >= mapping.expiresAtEpochMs) throw new ReplyRowMappingError("EXPIRED");
  return mapping;
}

/**
 * Write the calibration artifact owner-only and atomically: dir 0700, temp file 0600 (chmod-forced past a
 * permissive umask), then an atomic rename. The artifact is a transient, re-calibratable one-shot, so fsync
 * durability is not required — the security property (0600, no partial file) is.
 */
export function writeRowMapping(path: string, mapping: ReplyRowMapping, deps: RowMappingWriteDeps): void {
  const dir = dirname(path);
  if (!deps.existsSync(dir)) deps.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp`;
  deps.writeFileSync(tmp, JSON.stringify(mapping) + "\n", { mode: 0o600 });
  deps.chmodSync(tmp, 0o600);
  deps.renameSync(tmp, path);
}

/** Operator-facing refusal for an unusable calibration artifact (no field VALUE is ever printed). */
export function rowMappingRefusalMessage(code: RowMappingErrorCode, path: string): string {
  const why: Record<RowMappingErrorCode, string> = {
    PERMS: "the file is group/world-readable — re-calibrate it owner-only (chmod 600)",
    MALFORMED: "the file is not valid JSON",
    SCHEMA: "the file fails schema validation (containerGroup, rowIndex, structural paths)",
    VERSION: "the artifact schema version does not match this build — re-calibrate",
    PAGE_DRIFT: "the live page no longer matches the calibrated structure — re-calibrate on the current page",
    EXPIRED: "the calibration artifact has expired — re-calibrate a fresh one",
  };
  return [
    `Refusing: the reply-row calibration artifact at ${path} is unusable — ${why[code]}.`,
    "  - It holds only relative structural paths + page-binding fields — never a selector, text, rating, or date.",
    "  - Re-run calibrate-reply-target on the live review list to write a fresh, page-bound, owner-only artifact.",
  ].join("\n");
}
