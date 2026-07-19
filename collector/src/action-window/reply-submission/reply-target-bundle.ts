/**
 * **Permission-restricted, one-shot reply-target bundles** (pure loaders + a hardened 0600 writer).
 *
 * Two owner-only files under the gitignored `.reply-target/`, so that accountId / actionRef / submissionRef
 * never travel on argv/stdout (shell history, process listings, terminal scrollback):
 *  - the **request bundle** `{accountId, actionRef}` — the prepare CLI's input;
 *  - the **result bundle** `{submissionRef, rating, recencyBucket, bodyFingerprint, asOfDate}` — the prepare
 *    CLI's output and the reply CLI's ONLY input, consumed (unlinked) once.
 *
 * The result bundle is bound to an explicit KST `asOfDate` (the date the backend computed the recency bucket
 * against) and the reply CLI treats it as EXPIRED once the current KST date differs — a stale recency bucket
 * can never drive a run. Loaders are pure and fail closed; `nowKstDate` is supplied by the CLI boundary (the
 * only place a wall-clock is allowed), never read here.
 */
import { dirname } from "node:path";
import type { RecencyBucket, ReplyTargetHint } from "./reply-surface";

export interface ReplyTargetRequestBundle {
  accountId: string;
  actionRef: string;
}

export interface ReplyTargetResultBundle {
  submissionRef: string;
  rating: number;
  recencyBucket: RecencyBucket;
  bodyFingerprint: string;
  /** The KST calendar date (YYYY-MM-DD) the recency bucket was computed against. */
  asOfDate: string;
}

export type BundleErrorCode = "PERMS" | "MALFORMED" | "SCHEMA" | "EXPIRED";

export class ReplyTargetBundleError extends Error {
  constructor(readonly code: BundleErrorCode) {
    super(code);
    this.name = "ReplyTargetBundleError";
  }
}

/** Injectable read surface so loaders are unit-testable offline without touching disk. */
export interface BundleReadDeps {
  existsSync: (p: string) => boolean;
  statSync: (p: string) => { mode: number };
  readFileSync: (p: string, enc: "utf8") => string;
}

/** Injectable write surface mirroring the hardened owner-only sequence (dir 0700, file 0600, atomic). */
export interface BundleWriteDeps {
  existsSync: (p: string) => boolean;
  mkdirSync: (p: string, opts: { recursive: boolean; mode: number }) => void;
  writeFileSync: (p: string, data: string, opts: { mode: number }) => void;
  chmodSync: (p: string, mode: number) => void;
  renameSync: (from: string, to: string) => void;
}

const RECENCY_BUCKETS: readonly RecencyBucket[] = ["TODAY", "THIS_WEEK", "OLDER"];
const KST_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Refuse a group/world-readable file. Owner-only (`mode & 0o077 === 0`) is required for either bundle. */
function assertOwnerOnly(path: string, deps: BundleReadDeps): void {
  if ((deps.statSync(path).mode & 0o077) !== 0) throw new ReplyTargetBundleError("PERMS");
}

function parseObject(path: string, deps: BundleReadDeps): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(deps.readFileSync(path, "utf8"));
  } catch {
    throw new ReplyTargetBundleError("MALFORMED");
  }
  if (typeof parsed !== "object" || parsed === null) throw new ReplyTargetBundleError("MALFORMED");
  return parsed as Record<string, unknown>;
}

function requireStr(v: unknown, max: number): string {
  if (typeof v !== "string" || v.length === 0 || v.length > max) throw new ReplyTargetBundleError("SCHEMA");
  return v;
}

/** Read the owner-only request bundle. Returns null when absent (nothing to prepare). Fails closed otherwise. */
export function loadRequestBundle(path: string, deps: BundleReadDeps): ReplyTargetRequestBundle | null {
  if (!deps.existsSync(path)) return null;
  assertOwnerOnly(path, deps);
  const r = parseObject(path, deps);
  return { accountId: requireStr(r.accountId, 64), actionRef: requireStr(r.actionRef, 256) };
}

/**
 * Read the owner-only result bundle and validate it against `nowKstDate`. Returns null when absent. Fails
 * closed (throws {@link ReplyTargetBundleError}) on group/world-readable perms, malformed JSON, a schema
 * violation, or expiry (`asOfDate !== nowKstDate`). The returned bundle is the run's sole source of the
 * submissionRef and hint — nothing here is ever read from argv.
 */
export function loadResultBundle(
  path: string,
  deps: BundleReadDeps,
  nowKstDate: string,
): ReplyTargetResultBundle | null {
  if (!deps.existsSync(path)) return null;
  assertOwnerOnly(path, deps);
  const r = parseObject(path, deps);
  const submissionRef = r.submissionRef;
  if (typeof submissionRef !== "string" || !/^[0-9a-f]{16}$/.test(submissionRef)) {
    throw new ReplyTargetBundleError("SCHEMA");
  }
  const rating = r.rating;
  if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new ReplyTargetBundleError("SCHEMA");
  }
  if (typeof r.recencyBucket !== "string" || !RECENCY_BUCKETS.includes(r.recencyBucket as RecencyBucket)) {
    throw new ReplyTargetBundleError("SCHEMA");
  }
  const bodyFingerprint = requireStr(r.bodyFingerprint, 128);
  if (typeof r.asOfDate !== "string" || !KST_DATE.test(r.asOfDate)) throw new ReplyTargetBundleError("SCHEMA");
  // Bound to an explicit KST as-of date; a stale bucket (a new KST day) is refused, never silently used.
  if (r.asOfDate !== nowKstDate) throw new ReplyTargetBundleError("EXPIRED");
  return {
    submissionRef,
    rating,
    recencyBucket: r.recencyBucket as RecencyBucket,
    bodyFingerprint,
    asOfDate: r.asOfDate,
  };
}

/** The privacy-safe match hint (no submissionRef, no asOfDate) threaded to the engine/driver. */
export function hintFrom(bundle: ReplyTargetResultBundle): ReplyTargetHint {
  return {
    rating: bundle.rating,
    recencyBucket: bundle.recencyBucket,
    bodyFingerprint: bundle.bodyFingerprint,
  };
}

/**
 * Write the result bundle owner-only and atomically: dir 0700, temp file 0600 (chmod-forced past a permissive
 * umask), then an atomic rename. The bundle is a transient one-shot (re-mintable), so durability fsync is not
 * required — the security property (0600, no partial file) is.
 */
export function writeResultBundle(path: string, bundle: ReplyTargetResultBundle, deps: BundleWriteDeps): void {
  const dir = dirname(path);
  if (!deps.existsSync(dir)) deps.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp`;
  deps.writeFileSync(tmp, JSON.stringify(bundle) + "\n", { mode: 0o600 });
  deps.chmodSync(tmp, 0o600);
  deps.renameSync(tmp, path);
}

/** Operator-facing refusal for a present-but-unusable result bundle (no field VALUE is ever printed). */
export function resultBundleRefusalMessage(code: BundleErrorCode, path: string): string {
  const why: Record<BundleErrorCode, string> = {
    PERMS: "the file is group/world-readable — re-create it owner-only (chmod 600)",
    MALFORMED: "the file is not valid JSON",
    SCHEMA: "the file fails schema validation (submissionRef, rating 1..5, recencyBucket, bodyFingerprint, asOfDate)",
    EXPIRED: "the bundle's KST as-of date is not today — its recency bucket is stale; re-prepare a fresh bundle",
  };
  return [
    `Refusing: the reply-target bundle at ${path} is unusable — ${why[code]}.`,
    "  - The bundle is the ONLY source of the submissionRef and hint — never argv/env/stdout.",
    "  - Re-run prepare-reply-target to mint a fresh submissionRef and write a bound, owner-only bundle.",
  ].join("\n");
}
