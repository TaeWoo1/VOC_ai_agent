/**
 * **Durable pairing-store WRITE-PATH tests** — hermetic, in-memory (no real disk, no network, no browser).
 * They lock the durability + failure contract of {@link FilePairingStore.persist} via an injected
 * {@link PairingStoreFs} fake:
 *  - the happy path is atomic AND fsync-durable in the RIGHT order (write tmp → fsync tmp → rename → fsync dir);
 *  - the written pairings round-trip back through a re-constructed store;
 *  - every filesystem fault returns a sanitized {@link PairingStorePersistResult} (`failed` + a coarse
 *    category) WITHOUT throwing, leaves the existing store file intact, and cleans up the partial tmp;
 *  - a directory-fsync refusal (platform-dependent) is tolerated — the rename already made the write atomic;
 *  - the result never carries a path, errno string, or any pairing detail.
 */
import { describe, it, expect } from "vitest";
import { dirname } from "node:path";
import {
  FilePairingStore,
  type PairingStoreFs,
  type PairingStorePersistResult,
} from "../../src/bridge/pairing-store";

const now = () => 1_000_000;

function fsErr(code: string): NodeJS.ErrnoException {
  const e = new Error(code) as NodeJS.ErrnoException;
  e.code = code;
  return e;
}

/** An in-memory {@link PairingStoreFs} that records the call order and can inject a fault at each write step. */
class FakeFs implements PairingStoreFs {
  files = new Map<string, string>();
  dirs = new Set<string>();
  calls: Array<{ op: string; path: string }> = [];
  private fdPaths = new Map<number, string>();
  private nextFd = 10;
  /** Injectable faults — set any to a thrower to simulate that step failing. */
  onWriteFile: (() => void) | undefined;
  onFsyncFile: (() => void) | undefined;
  onOpenDir: (() => void) | undefined;

  existsSync(path: string): boolean {
    return this.files.has(path) || this.dirs.has(path);
  }
  mkdirSync(path: string): void {
    this.calls.push({ op: "mkdir", path });
    this.dirs.add(path);
  }
  writeFileSync(path: string, data: string): void {
    this.calls.push({ op: "writeFile", path });
    this.onWriteFile?.(); // may throw BEFORE the bytes land — matches a failed write
    this.files.set(path, data);
  }
  chmodSync(path: string): void {
    this.calls.push({ op: "chmod", path });
  }
  openSync(path: string, _flags: "r" | "w"): number {
    if (this.dirs.has(path)) this.onOpenDir?.(); // directory fsync open
    this.calls.push({ op: "open", path });
    const fd = this.nextFd++;
    this.fdPaths.set(fd, path);
    return fd;
  }
  fsyncSync(fd: number): void {
    const path = this.fdPaths.get(fd) ?? "?";
    this.calls.push({ op: "fsync", path });
    if (this.files.has(path)) this.onFsyncFile?.(); // a FILE fsync (dirs live in `dirs`, never `files`)
  }
  closeSync(fd: number): void {
    this.fdPaths.delete(fd);
  }
  renameSync(from: string, to: string): void {
    this.calls.push({ op: "rename", path: `${from}->${to}` });
    const v = this.files.get(from);
    if (v === undefined) throw fsErr("EIO");
    this.files.delete(from);
    this.files.set(to, v);
  }
  unlinkSync(path: string): void {
    this.calls.push({ op: "unlink", path });
    this.files.delete(path);
  }
  readFileSync(path: string): string {
    const v = this.files.get(path);
    if (v === undefined) throw fsErr("EIO");
    return v;
  }
}

const PATH = "/store/.bridge/pairings.json";
const TMP = `${PATH}.tmp`;
const DIR = dirname(PATH);

/** A store with one confirmed pairing in memory, backed by the given fake fs (nothing persisted yet). */
function storeWithPairing(fs: FakeFs): FilePairingStore {
  const store = new FilePairingStore(PATH, { now }, fs);
  const req = store.registry.requestPairing("http://localhost:5173", "ws");
  if (!req.ok) throw new Error(`requestPairing rejected: ${req.reason}`); // not what this suite is about
  expect(store.registry.confirmPairing(req.requestId, "allow").ok).toBe(true);
  return store;
}

describe("FilePairingStore.persist — durability + failure contract", () => {
  it("persists atomically and fsync-durably in order: write tmp → fsync tmp → rename → fsync dir", () => {
    const fs = new FakeFs();
    const store = storeWithPairing(fs);

    const result = store.persist();
    expect(result).toEqual<PairingStorePersistResult>({ status: "ok" });

    const writeTmp = fs.calls.findIndex((c) => c.op === "writeFile" && c.path === TMP);
    const fsyncTmp = fs.calls.findIndex((c) => c.op === "fsync" && c.path === TMP);
    const rename = fs.calls.findIndex((c) => c.op === "rename");
    const fsyncDir = fs.calls.findIndex((c) => c.op === "fsync" && c.path === DIR);
    expect(writeTmp).toBeGreaterThanOrEqual(0);
    expect(fsyncTmp).toBeGreaterThan(writeTmp); // data durable BEFORE the swap
    expect(rename).toBeGreaterThan(fsyncTmp); // atomic swap AFTER the fsync
    expect(fsyncDir).toBeGreaterThan(rename); // the rename entry is itself made durable
    // The swap consumed the tmp; only the real file remains.
    expect(fs.files.has(TMP)).toBe(false);
    expect(fs.files.has(PATH)).toBe(true);
  });

  it("round-trips the durable pairings back through a re-constructed store (same fake fs)", () => {
    const fs = new FakeFs();
    const store = storeWithPairing(fs);
    expect(store.persist()).toEqual({ status: "ok" });

    const reloaded = new FilePairingStore(PATH, { now }, fs);
    expect(reloaded.loadResult).toEqual({ status: "ok", restored: 1, dropped: 0 });
    expect(reloaded.registry.hasActivePairing()).toBe(true);
  });

  it("returns failed:permission_denied on EACCES WITHOUT throwing, and leaves the existing store intact", () => {
    const fs = new FakeFs();
    // Seed a prior durable store so we can prove a failed persist does not corrupt it.
    const first = storeWithPairing(fs);
    expect(first.persist().status).toBe("ok");
    const durable = fs.files.get(PATH);

    const second = storeWithPairing(fs);
    fs.onWriteFile = () => { throw fsErr("EACCES"); };
    expect(() => second.persist()).not.toThrow();
    expect(second.persist()).toEqual({ status: "failed", reason: "permission_denied" });

    expect(fs.files.get(PATH)).toBe(durable); // the real file is untouched — rename never ran
    expect(fs.files.has(TMP)).toBe(false); // no orphan tmp left behind
  });

  it("maps ENOSPC → no_space and an unknown code → io_error", () => {
    const enospc = new FakeFs();
    const a = storeWithPairing(enospc);
    enospc.onWriteFile = () => { throw fsErr("ENOSPC"); };
    expect(a.persist()).toEqual({ status: "failed", reason: "no_space" });

    const weird = new FakeFs();
    const b = storeWithPairing(weird);
    weird.onWriteFile = () => { throw fsErr("EBADF"); };
    expect(b.persist()).toEqual({ status: "failed", reason: "io_error" });
  });

  it("cleans up the partial tmp when the fault happens AFTER the tmp was written (fsync fails)", () => {
    const fs = new FakeFs();
    const store = storeWithPairing(fs);
    fs.onFsyncFile = () => { throw fsErr("EIO"); };

    expect(store.persist()).toEqual({ status: "failed", reason: "io_error" });
    expect(fs.calls.some((c) => c.op === "unlink" && c.path === TMP)).toBe(true); // partial tmp removed
    expect(fs.files.has(TMP)).toBe(false);
    expect(fs.files.has(PATH)).toBe(false); // rename never happened — no store file materialized
  });

  it("tolerates a directory-fsync refusal (some platforms) — the atomic rename already succeeded", () => {
    const fs = new FakeFs();
    const store = storeWithPairing(fs);
    fs.onOpenDir = () => { throw fsErr("EINVAL"); }; // e.g. a filesystem that refuses opening a dir to fsync

    expect(store.persist()).toEqual({ status: "ok" });
    expect(fs.files.has(PATH)).toBe(true); // the pairings still landed via the atomic swap
    expect(fs.files.has(TMP)).toBe(false);
  });

  it("never surfaces a path, errno string, or pairing detail — only {status} or {status,reason}", () => {
    const fs = new FakeFs();
    const store = storeWithPairing(fs);
    fs.onWriteFile = () => { throw fsErr("EACCES"); };
    const failed = store.persist();
    expect(Object.keys(failed).sort()).toEqual(["reason", "status"]);
    expect(["permission_denied", "no_space", "io_error"]).toContain(failed.reason);

    const ok = new FakeFs();
    expect(Object.keys(storeWithPairing(ok).persist())).toEqual(["status"]);
  });
});
