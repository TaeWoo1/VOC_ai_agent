/**
 * Pure **candidate-signature** primitive for the ESM+ REVIEW scheduled beta
 * (M-Sync-1.5A) — the net-new safety mechanism that makes an *unattended* click
 * safe against a same-count export-control swap (plan §5 / §5a).
 *
 * Today the only cross-run safety is the live "exactly one actionable candidate
 * in the allowlisted frame" invariant, which cannot detect a control that was
 * swapped for a different one while the actionable count stayed 1. This module
 * adds a **versioned, salted fingerprint** of the approved export candidate: it
 * is computed once during a supervised approval and compared on every scheduled
 * run. **Mismatch → the caller must set `UI_CHANGED` and fire ZERO clicks.**
 *
 * **Pure only, and leak-proof by construction (Policy A):** the input is a
 * SANITIZED `CandidateShape` (coarse category / booleans / a coarse label-shape
 * descriptor) — never raw DOM text, selectors, labels, URLs, headers, seller IDs,
 * or marketplace IDs. So `JSON.stringify` of any signature/record is leak-free.
 *
 * **M-Sync-1.5A ships compute + compare + the record type + an abstract store
 * interface + an in-memory adapter ONLY.** No encryption, no key isolation, no
 * database, no filesystem, no `.status` write, no backend API, no migration — the
 * production persistence adapter is a later, separately-approved slice.
 */

import { createHash } from "node:crypto";
import type { FrameCandidateCategory } from "./esm-capture-gate";
import type { SanitizedAccountRef } from "../connection/sync-state";

/**
 * The signature **schema version**. Bump on ANY change to `CandidateShape`, the
 * canonical serialization, or the hash algorithm. A stored record whose
 * `schemaVersion` differs from this NEVER matches — forcing a fresh supervised
 * re-approval rather than trusting a signature computed under old rules.
 */
export const CANDIDATE_SIGNATURE_SCHEMA_VERSION = 1;

/** Where an export candidate lives; the safe-click policy requires `allowlisted-frame`. */
export type CandidateScope = "top-document" | "allowlisted-frame" | "same-origin-frame" | "none";

/** Coarse token-count bucket of an accessible label (never the label text). */
export type LabelTokenBucket = "one" | "few" | "many";

/** Dominant script class of an accessible label (never the label text). */
export type LabelScript = "hangul" | "latin" | "mixed" | "other";

/**
 * A SANITIZED coarse descriptor of a candidate's accessible label. Carries NO raw
 * text — only a token-count bucket, a script class, and whether an export-wording
 * token was present. Supplied by the (later) live extraction layer; this module
 * only hashes it.
 */
export interface CandidateLabelShape {
  tokenCountBucket: LabelTokenBucket;
  script: LabelScript;
  /** An export-wording token (엑셀/다운로드/내려받기/excel/download/xlsx/csv…) was present. */
  hasExportWord: boolean;
}

/**
 * The SANITIZED shape a signature is computed from (plan §5a): the candidate's
 * coarse category, its actionable flag, the frame scope it was found in, and the
 * coarse label-shape descriptor. No raw identifiers of any kind.
 */
export interface CandidateShape {
  category: FrameCandidateCategory;
  actionable: boolean;
  scope: CandidateScope;
  labelShape: CandidateLabelShape;
}

/**
 * A persisted signature record. Carries ONLY: the schema version, the versioned
 * salted signature, an explicit approval timestamp (ISO — no wall-clock read
 * here), and a hash-only account reference. No raw identity, ever.
 */
export interface CandidateSignatureRecord {
  schemaVersion: number;
  signature: string;
  /** ISO-8601 approval time — supplied by the caller; this module never reads the clock. */
  approvedAt: string;
  account: SanitizedAccountRef;
}

/**
 * Compute the versioned, salted signature of a sanitized candidate shape. Salted
 * (per the collector's `storageProbeSalt` convention) so signatures are one-way
 * and not comparable across tenants; versioned so an algorithm change invalidates
 * old records. Fails closed on an empty salt — mirrors the diagnostics-salt rule.
 */
export function computeCandidateSignature(shape: CandidateShape, salt: string): string {
  if (salt.length === 0) {
    throw new Error("computeCandidateSignature: a non-empty salt is required (fail-closed)");
  }
  // Ordered array form avoids separator ambiguity (matches compositeHash convention).
  const parts: readonly (string | number | boolean)[] = [
    CANDIDATE_SIGNATURE_SCHEMA_VERSION,
    shape.category,
    shape.actionable,
    shape.scope,
    shape.labelShape.tokenCountBucket,
    shape.labelShape.script,
    shape.labelShape.hasExportWord,
  ];
  return createHash("sha256")
    .update(`${salt} ${JSON.stringify(parts)}`)
    .digest("hex")
    .slice(0, 32);
}

/** Build an approval record for a candidate shape. `approvedAt` is caller-supplied (explicit). */
export function buildCandidateSignatureRecord(
  shape: CandidateShape,
  account: SanitizedAccountRef,
  salt: string,
  approvedAt: string,
): CandidateSignatureRecord {
  return {
    schemaVersion: CANDIDATE_SIGNATURE_SCHEMA_VERSION,
    signature: computeCandidateSignature(shape, salt),
    approvedAt,
    account,
  };
}

/**
 * True ONLY when the record was written under the current schema version AND its
 * signature exactly equals the live shape's freshly-computed signature. A schema
 * bump, or any drift in the sanitized shape, yields `false` → the caller must set
 * `UI_CHANGED` and fire zero clicks.
 */
export function candidateSignatureMatches(
  record: CandidateSignatureRecord,
  liveShape: CandidateShape,
  salt: string,
): boolean {
  if (record.schemaVersion !== CANDIDATE_SIGNATURE_SCHEMA_VERSION) return false;
  return record.signature === computeCandidateSignature(liveShape, salt);
}

// ── Storage interface + in-memory test adapter (NO real persistence in 1.5A) ──────────────────────

/**
 * Abstract, account-scoped signature store. M-Sync-1.5A defines only this
 * interface + the in-memory adapter below; the production adapter (encrypted,
 * server-side, account-key-isolated) is a later separately-approved slice.
 */
export interface CandidateSignatureStore {
  load(account: SanitizedAccountRef): Promise<CandidateSignatureRecord | null>;
  save(record: CandidateSignatureRecord): Promise<void>;
}

/** The account-scoping key: the durable connection id (never raw store/account identity). */
function accountKey(account: SanitizedAccountRef): string {
  return account.connectionId;
}

/**
 * In-memory, account-scoped adapter — for tests and the 1.5B fake runtime only.
 * No filesystem, no DB, no encryption. Keyed by the sanitized connection id.
 */
export class InMemoryCandidateSignatureStore implements CandidateSignatureStore {
  private readonly byAccount = new Map<string, CandidateSignatureRecord>();

  async load(account: SanitizedAccountRef): Promise<CandidateSignatureRecord | null> {
    return this.byAccount.get(accountKey(account)) ?? null;
  }

  async save(record: CandidateSignatureRecord): Promise<void> {
    this.byAccount.set(accountKey(record.account), record);
  }
}
