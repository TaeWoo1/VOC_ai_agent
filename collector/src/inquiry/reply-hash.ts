/**
 * **Approved-reply canonicalization + hashing** (pure, offline).
 *
 * Binds the whole approval → execution → verification chain to the EXACT approved reply. Canonicalization
 * preserves the meaningful text — it only:
 *  - applies Unicode NFC, and
 *  - normalizes line endings (CRLF / lone CR → LF).
 * It preserves ALL other whitespace, line breaks, and leading/trailing spaces, so two replies that differ in
 * any meaningful character (a different line break, an extra space) canonicalize — and therefore hash —
 * differently, while a pure CRLF-vs-LF difference is treated as identical.
 *
 * The canonical form is used as BOTH the value hashed into `approvedReplyHash` AND the exact private payload
 * sent to the executor, so the ActionIntent fingerprint, private payload, executor hash, and verifier
 * expected hash all derive from one canonical value. `node:crypto` only; no clock, no I/O.
 */

import { createHash } from "node:crypto";

/** Canonicalize an approved reply: NFC + line-ending normalization only. All other whitespace preserved. */
export function canonicalizeApprovedReply(text: string): string {
  return text.normalize("NFC").replace(/\r\n?/g, "\n");
}

/** SHA-256 hex of the canonical approved reply — a fingerprint, never the raw text. */
export function approvedReplyHash(text: string): string {
  return createHash("sha256").update(canonicalizeApprovedReply(text), "utf8").digest("hex");
}
