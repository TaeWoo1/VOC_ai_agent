/**
 * Runner-side custody of a downloaded file, on a REAL temp filesystem: stable-wait, read, SHA-256, structural
 * validation, delete-before-ingest, upload from memory, and the cleanup on every failure path.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handoffHostFile, sha256Hex, waitForStableFile, defaultHandoffIo } from "../../src/aside/host-file-handoff";
import type { AwIngestSource } from "../../src/action-window/ingest-handoff";
import { fixtureExportBytes, FIXTURE_EXPORT_NAME } from "../support/aside-fixture";
import { expectedRows } from "../support/review-export-fixture";

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aside-handoff-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function uploadSpy(ok = true, processed = 5) {
  const seen: { bytes: Uint8Array; artifactRef: string; scopeEvidence?: string }[] = [];
  const upload = async (src: AwIngestSource) => {
    seen.push({ bytes: src.bytes(), artifactRef: src.artifactRef, scopeEvidence: src.scopeEvidence });
    return { ok, processed };
  };
  return { upload, seen };
}

describe("host file handoff", () => {
  it("read → sha256 → validate → delete → upload(bytes) → ACK; the file is gone and the hash is the fixture's", async () => {
    const path = join(dir, "downloaded.xlsx");
    const bytes = fixtureExportBytes();
    writeFileSync(path, bytes);
    const { upload, seen } = uploadSpy(true, 5);
    const r = await handoffHostFile(path, { runId: "run_000000000001", suggestedName: FIXTURE_EXPORT_NAME, scopeEvidence: "MACHINE_MATCHED", upload, stableProbeMs: 10 });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.sha256).toBe(expectedRows().fileSha256);
    expect(r.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(r.bytes).toBe(bytes.length);
    expect(r.processed).toBe(5);
    expect(r.artifactRef).toMatch(/^[0-9a-f]{16}$/);
    expect(existsSync(path)).toBe(false);
    expect(seen).toHaveLength(1);
    expect(Buffer.from(seen[0]!.bytes).equals(Buffer.from(bytes))).toBe(true);
    expect(seen[0]!.artifactRef).toBe(r.artifactRef);
    expect(seen[0]!.scopeEvidence).toBe("MACHINE_MATCHED");
  });

  it("the SHA-256 is deterministic across two custody cycles of the same bytes", async () => {
    const a = join(dir, "a.xlsx");
    const b = join(dir, "b.xlsx");
    writeFileSync(a, fixtureExportBytes());
    writeFileSync(b, fixtureExportBytes());
    const { upload } = uploadSpy();
    const ra = await handoffHostFile(a, { runId: "run_000000000001", suggestedName: FIXTURE_EXPORT_NAME, scopeEvidence: "MACHINE_MATCHED", upload, stableProbeMs: 10 });
    const rb = await handoffHostFile(b, { runId: "run_000000000002", suggestedName: FIXTURE_EXPORT_NAME, scopeEvidence: "MACHINE_MATCHED", upload, stableProbeMs: 10 });
    expect(ra.ok && rb.ok && ra.sha256 === rb.sha256).toBe(true);
    // The artifact ref is run-scoped: same bytes, different runs, different refs.
    expect(ra.ok && rb.ok && ra.artifactRef !== rb.artifactRef).toBe(true);
  });

  it("a file that never appears → TRANSFER_FAILED, nothing uploaded", async () => {
    const { upload, seen } = uploadSpy();
    const r = await handoffHostFile(join(dir, "missing.xlsx"), { runId: "run_000000000001", suggestedName: FIXTURE_EXPORT_NAME, scopeEvidence: "MACHINE_MATCHED", upload, stableWaitMs: 60, stableProbeMs: 10 });
    expect(r).toMatchObject({ ok: false, failure: { code: "TRANSFER_FAILED", stage: "TRANSFER" } });
    expect(seen).toHaveLength(0);
  });

  it("bytes that are not an xlsx → ARTIFACT_INVALID, file deleted, nothing uploaded", async () => {
    const path = join(dir, "not-really.xlsx");
    writeFileSync(path, Buffer.from("<html>login page</html>"));
    const { upload, seen } = uploadSpy();
    const r = await handoffHostFile(path, { runId: "run_000000000001", suggestedName: FIXTURE_EXPORT_NAME, scopeEvidence: "MACHINE_MATCHED", upload, stableProbeMs: 10 });
    expect(r).toMatchObject({ ok: false, failure: { code: "ARTIFACT_INVALID", stage: "VALIDATE" }, deleted: true });
    expect(existsSync(path)).toBe(false);
    expect(seen).toHaveLength(0);
  });

  it("a wrong extension category → ARTIFACT_INVALID even with xlsx bytes (the same two checks the quarantine makes)", async () => {
    const path = join(dir, "export.csv");
    writeFileSync(path, fixtureExportBytes());
    const { upload, seen } = uploadSpy();
    const r = await handoffHostFile(path, { runId: "run_000000000001", suggestedName: "export.csv", scopeEvidence: "MACHINE_MATCHED", upload, stableProbeMs: 10 });
    expect(r).toMatchObject({ ok: false, failure: { code: "ARTIFACT_INVALID" } });
    expect(existsSync(path)).toBe(false);
    expect(seen).toHaveLength(0);
  });

  it("an ingest that does not ACK → INGEST_FAILED; the file was already deleted (no raw export lingers)", async () => {
    const path = join(dir, "downloaded.xlsx");
    writeFileSync(path, fixtureExportBytes());
    const { upload } = uploadSpy(false, 0);
    const r = await handoffHostFile(path, { runId: "run_000000000001", suggestedName: FIXTURE_EXPORT_NAME, scopeEvidence: "OPERATOR_CONFIRMED", upload, stableProbeMs: 10 });
    expect(r).toMatchObject({ ok: false, failure: { code: "INGEST_FAILED", stage: "INGEST" }, deleted: true });
    expect(existsSync(path)).toBe(false);
  });

  it("a file that cannot be deleted fails BEFORE ingest (ARTIFACT_INVALID at CLEANUP), nothing uploaded", async () => {
    const path = join(dir, "sticky.xlsx");
    writeFileSync(path, fixtureExportBytes());
    const { upload, seen } = uploadSpy();
    const io = { ...defaultHandoffIo, remove: () => {} };
    const r = await handoffHostFile(path, { runId: "run_000000000001", suggestedName: FIXTURE_EXPORT_NAME, scopeEvidence: "MACHINE_MATCHED", upload, io, stableProbeMs: 10 });
    expect(r).toMatchObject({ ok: false, failure: { code: "ARTIFACT_INVALID", stage: "CLEANUP" }, deleted: false });
    expect(seen).toHaveLength(0);
  });

  it("waits for the size to settle (a download still being written is not read early)", async () => {
    const path = join(dir, "growing.xlsx");
    const bytes = fixtureExportBytes();
    writeFileSync(path, bytes.subarray(0, 10));
    setTimeout(() => writeFileSync(path, bytes), 1);
    const size = await waitForStableFile(path, defaultHandoffIo, 2_000, 40);
    expect(size).toBe(bytes.length);
    expect(sha256Hex(bytes)).toBe(expectedRows().fileSha256);
  });
});
