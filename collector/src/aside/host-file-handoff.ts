/**
 * **Runner-side custody of a file Aside downloaded — read, hash, validate, delete, then ingest from memory.**
 *
 * Aside's download lands on the seller's real filesystem (discovery §7: `download.path()` is a host path under
 * the user's Downloads). The Runner is an ordinary host process, so it takes custody of that file directly:
 *
 *   wait until the file exists and its size is stable
 *   → read the bytes → SHA-256 → structural validation (xlsx category + OOXML magic, the SAME sniff the
 *     quarantine uses) → **delete the file** → hand the bytes to the injected ingest capability (the existing
 *     launch-ref-bound backend upload, `ingest-handoff.buildSegmentIngestUpload`) → reduce the ACK.
 *
 * The delete comes BEFORE the upload on purpose — it is the quarantine's `delete-after-validate` posture,
 * applied to a file we did not name: the seller's machine keeps no raw export (PD-6), and a file that could
 * not be removed fails the run before any row is written, exactly as an undeletable quarantine file does. The
 * upload runs from memory. No parser runs here (PD-8): the bytes go to the backend's canonical parser as-is.
 *
 * Failure cleanup: every early return removes the file best-effort first. The only artifacts this module ever
 * leaves behind are the ones it could not delete, and those are reported, never silently retained.
 *
 * Sanitized: the path, the suggested filename, and the bytes stay in-process. What leaves is a code, a hash,
 * and a byte count.
 */
import { createHash } from "node:crypto";
import { readFileSync, rmSync, statSync } from "node:fs";
import { sniffXlsxReadable } from "../naver/review-download-save";
import { extensionCategory } from "../naver/review-export";
import { artifactRefFor } from "../action-window/artifact";
import type { AwIngestUploadFn } from "../action-window/ingest-handoff";
import type { ScopeEvidenceWire } from "../action-window/scope-evidence";
import type { ExecutionFailure } from "../action-window/initial-import/execution-provider";

/** Injectable filesystem ops — default `node:fs`; tests may pass fakes (the real-fs tests use a temp dir). */
export interface HandoffIo {
  /** Byte size, or null when the file does not exist. */
  size(path: string): number | null;
  read(path: string): Uint8Array;
  /** MUST tolerate a missing file. */
  remove(path: string): void;
  sleep(ms: number): Promise<void>;
}

export const defaultHandoffIo: HandoffIo = {
  size(path) {
    try {
      return statSync(path).size;
    } catch {
      return null;
    }
  },
  read(path) {
    return new Uint8Array(readFileSync(path));
  },
  remove(path) {
    rmSync(path, { force: true });
  },
  sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  },
};

export interface HostFileHandoffOpts {
  /** Opaque run identity — part of the artifact ref derivation, never the name of anything on disk. */
  runId: string;
  /** The suggested filename the browser reported. Read once for the extension category, then discarded. */
  suggestedName: string;
  scopeEvidence: ScopeEvidenceWire;
  upload: AwIngestUploadFn;
  io?: HandoffIo;
  /** How long to wait for the file to appear and settle. */
  stableWaitMs?: number;
  /** Interval between size probes; two equal consecutive non-zero reads mean "settled". */
  stableProbeMs?: number;
}

export type HostFileHandoffResult =
  | { ok: true; artifactRef: string; sha256: string; bytes: number; processed: number; deleted: true }
  | { ok: false; failure: ExecutionFailure; sha256?: string; bytes?: number; deleted: boolean };

const HEAD_BYTES = 64 * 1024;

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Wait until the file exists and two consecutive size reads agree (non-zero). `null` when it never settles. */
export async function waitForStableFile(path: string, io: HandoffIo, waitMs: number, probeMs: number): Promise<number | null> {
  const deadline = Date.now() + waitMs;
  let last: number | null = null;
  while (Date.now() <= deadline) {
    const size = io.size(path);
    if (size !== null && size > 0 && last === size) return size;
    last = size;
    await io.sleep(probeMs);
  }
  return null;
}

function removeQuietly(io: HandoffIo, path: string): boolean {
  try {
    io.remove(path);
    return true;
  } catch {
    return false;
  }
}

export async function handoffHostFile(hostPath: string, opts: HostFileHandoffOpts): Promise<HostFileHandoffResult> {
  const io = opts.io ?? defaultHandoffIo;
  const size = await waitForStableFile(hostPath, io, opts.stableWaitMs ?? 10_000, opts.stableProbeMs ?? 250);
  if (size === null) {
    const deleted = removeQuietly(io, hostPath);
    return { ok: false, failure: { code: "TRANSFER_FAILED", stage: "TRANSFER", recoverable: false }, deleted };
  }
  let bytes: Uint8Array;
  try {
    bytes = io.read(hostPath);
  } catch {
    const deleted = removeQuietly(io, hostPath);
    return { ok: false, failure: { code: "TRANSFER_FAILED", stage: "TRANSFER", recoverable: false }, deleted };
  }
  const sha256 = sha256Hex(bytes);
  // The same two structural checks the quarantine applies, on the same inputs: category from the suggested
  // name (read once, then discarded) and the OOXML magic from the head.
  const category = extensionCategory(opts.suggestedName);
  const structurallyOk = category === "xlsx" && sniffXlsxReadable(bytes.subarray(0, HEAD_BYTES));
  if (!structurallyOk) {
    const deleted = removeQuietly(io, hostPath);
    return { ok: false, failure: { code: "ARTIFACT_INVALID", stage: "VALIDATE", recoverable: false }, sha256, bytes: bytes.length, deleted };
  }
  // Delete BEFORE ingest: the seller's machine keeps no raw export, and an undeletable file fails the run
  // before any row is written.
  if (!removeQuietly(io, hostPath) || io.size(hostPath) !== null) {
    return { ok: false, failure: { code: "ARTIFACT_INVALID", stage: "CLEANUP", recoverable: false }, sha256, bytes: bytes.length, deleted: false };
  }
  const artifactRef = artifactRefFor([opts.runId, "aside", sha256]);
  const outcome = await opts.upload({ bytes: () => bytes, artifactRef, scopeEvidence: opts.scopeEvidence });
  if (!outcome.ok) {
    return { ok: false, failure: { code: "INGEST_FAILED", stage: "INGEST", recoverable: false }, sha256, bytes: bytes.length, deleted: true };
  }
  return { ok: true, artifactRef, sha256, bytes: bytes.length, processed: outcome.processed, deleted: true };
}
