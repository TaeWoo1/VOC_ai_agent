/**
 * **Durable pairing store (file-backed).** Persists only the durable `pairings` slice of a
 * {@link PairingRegistry} to an agent-owned local file with restrictive permissions (dir 0700, file 0600).
 * Pending requests and WS tickets are intentionally NOT persisted (ephemeral, in-memory only).
 *
 * **This is NOT the future marketplace credential Device Vault** (Runtime ADR §3.2). It stores only pairing
 * material — SHA-256 hashes of the bridge pairing tokens (never a plaintext secret, never a marketplace
 * credential, cookie, or session). The plaintext pairing token exists only in browser storage on the
 * frontend and transiently in memory during first delivery.
 *
 * **Durability contract.** {@link FilePairingStore.persist} is crash-atomic AND fsync-durable: it writes a
 * `${filePath}.tmp`, fsyncs it (the pairing bytes reach the platter before the swap), renames it over the
 * real path (an atomic swap), then fsyncs the parent directory (the rename itself survives a power loss).
 * It NEVER throws — a full/permission-denied/IO fault returns a sanitized {@link PairingStorePersistResult}
 * (`failed` + a coarse category) instead, so a failed write can never crash the agent or a request handler.
 * All filesystem access goes through an injected {@link PairingStoreFs} adapter so the durability sequence
 * and its failure modes are hermetically testable without touching a real disk.
 */

import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { PairingRegistry, type Pairing, type PairingRegistryOptions } from "./pairing";

/**
 * The minimal synchronous filesystem surface {@link FilePairingStore} needs. Injected so the atomic +
 * fsync-durable write sequence (and each of its failure modes) can be driven by a fake in hermetic tests —
 * the production default {@link defaultPairingStoreFs} simply forwards to `node:fs`.
 */
export interface PairingStoreFs {
  existsSync(path: string): boolean;
  mkdirSync(path: string, opts: { recursive: true; mode: number }): void;
  writeFileSync(path: string, data: string, opts: { mode: number }): void;
  chmodSync(path: string, mode: number): void;
  /** Open a path and return a file descriptor (`"r"` to fsync an existing file/dir, `"w"` to create). */
  openSync(path: string, flags: "r" | "w"): number;
  fsyncSync(fd: number): void;
  closeSync(fd: number): void;
  renameSync(from: string, to: string): void;
  unlinkSync(path: string): void;
  readFileSync(path: string, encoding: "utf8"): string;
}

/** Production filesystem adapter — a thin pass-through to `node:fs`. */
export const defaultPairingStoreFs: PairingStoreFs = {
  existsSync,
  mkdirSync,
  writeFileSync,
  chmodSync,
  openSync: (path, flags) => openSync(path, flags),
  fsyncSync,
  closeSync,
  renameSync,
  unlinkSync,
  readFileSync,
};

function isPairing(value: unknown): value is Pairing {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.pairingId === "string" &&
    typeof v.origin === "string" &&
    typeof v.tokenHash === "string" &&
    typeof v.createdAtMs === "number" &&
    typeof v.revoked === "boolean"
  );
}

/**
 * **Sanitized outcome of loading the durable store at boot** — counts + a coarse status enum ONLY, never a
 * pairingId, origin, token, or hash. It makes restart recovery of the persisted pairings observable so the
 * boot shell can log it (mirroring how the pure registry returns sweep COUNTS for the shell to log):
 * - `absent` — no store file yet (fresh install / never paired).
 * - `ok` — the store parsed and every entry was a well-formed pairing.
 * - `recovered_partial` — the store parsed but `dropped` malformed entries were skipped; `restored` survived.
 * - `corrupt` — the file was unparseable / not an array; the agent starts with zero pairings (the user re-pairs).
 */
export interface PairingStoreLoadResult {
  status: "absent" | "ok" | "recovered_partial" | "corrupt";
  restored: number;
  dropped: number;
}

/**
 * **Fixed, sanitized categories for a failed persist** — the coarse *kind* of write fault only, never a path,
 * errno string, or any pairing detail. Mirrors the sanitized-error discipline of `connection/store.ts`.
 * - `permission_denied` — EACCES / EPERM / EROFS (the store dir/file is not writable).
 * - `no_space` — ENOSPC / EDQUOT (disk/quota full).
 * - `io_error` — any other filesystem fault.
 */
export type PairingStorePersistFailure = "permission_denied" | "no_space" | "io_error";

/**
 * **Sanitized, deterministic outcome of a {@link FilePairingStore.persist} call.** `ok` means the durable
 * pairings reached disk (fsynced tmp → atomic rename → fsynced dir). `failed` carries only a coarse
 * {@link PairingStorePersistFailure} category — never a path, errno message, or pairing detail — so the
 * transport shell can log/act on a non-durable write without leaking anything. `persist` never throws.
 */
export interface PairingStorePersistResult {
  status: "ok" | "failed";
  reason?: PairingStorePersistFailure;
}

/** Map a caught filesystem error to its fixed, sanitized persist-failure category. */
function persistFailureCategory(error: unknown): PairingStorePersistFailure {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (code === "EACCES" || code === "EPERM" || code === "EROFS") return "permission_denied";
  if (code === "ENOSPC" || code === "EDQUOT") return "no_space";
  return "io_error";
}

export class FilePairingStore {
  readonly registry: PairingRegistry;
  /** How the durable store loaded at construction — a sanitized restart-recovery signal for the boot shell. */
  readonly loadResult: PairingStoreLoadResult;
  private readonly filePath: string;
  private readonly fs: PairingStoreFs;

  constructor(filePath: string, opts: PairingRegistryOptions, fs: PairingStoreFs = defaultPairingStoreFs) {
    this.filePath = filePath;
    this.fs = fs;
    this.registry = new PairingRegistry(opts);
    this.removeStaleTmp(); // a crash mid-persist can leave `${filePath}.tmp` behind — never inherit it
    const { pairings, result } = this.readFromDisk();
    this.registry.load(pairings);
    this.loadResult = result;
  }

  /** Best-effort startup cleanup of an orphaned atomic-write temp file (interrupted {@link persist}). */
  private removeStaleTmp(): void {
    this.tryRemove(`${this.filePath}.tmp`);
  }

  /** Best-effort unlink — an un-removable file is harmless (the next persist overwrites it). */
  private tryRemove(path: string): void {
    try {
      if (this.fs.existsSync(path)) this.fs.unlinkSync(path);
    } catch {
      /* best-effort: an un-removable orphan is harmless — the next persist overwrites it */
    }
  }

  private readFromDisk(): { pairings: Pairing[]; result: PairingStoreLoadResult } {
    if (!this.fs.existsSync(this.filePath)) {
      return { pairings: [], result: { status: "absent", restored: 0, dropped: 0 } };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(this.fs.readFileSync(this.filePath, "utf8"));
    } catch {
      // A corrupt store must not crash the agent; start with no pairings (the user re-pairs).
      return { pairings: [], result: { status: "corrupt", restored: 0, dropped: 0 } };
    }
    if (!Array.isArray(parsed)) {
      return { pairings: [], result: { status: "corrupt", restored: 0, dropped: 0 } };
    }
    const pairings = parsed.filter(isPairing);
    const dropped = parsed.length - pairings.length;
    return {
      pairings,
      result: { status: dropped > 0 ? "recovered_partial" : "ok", restored: pairings.length, dropped },
    };
  }

  /**
   * Persist the current durable pairings crash-atomically AND fsync-durably. Call after confirm/revoke.
   * Sequence: write `${filePath}.tmp` (0600) → fsync it → chmod 0600 (force perms past umask) → atomic
   * rename over the real path → fsync the parent directory. NEVER throws: a fault returns a sanitized
   * {@link PairingStorePersistResult} (`failed` + coarse category) and cleans up the partial tmp, so the
   * existing store file (if any) is left intact and the caller decides how to react to a non-durable write.
   */
  persist(): PairingStorePersistResult {
    const tmp = `${this.filePath}.tmp`;
    try {
      const dir = dirname(this.filePath);
      if (!this.fs.existsSync(dir)) this.fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const json = JSON.stringify(this.registry.exportPairings());
      this.fs.writeFileSync(tmp, json, { mode: 0o600 });
      this.fs.chmodSync(tmp, 0o600); // force 0600 past a permissive umask
      this.fsyncPath(tmp); // the pairing bytes are on the platter BEFORE the swap
      this.fs.renameSync(tmp, this.filePath); // atomic swap — a crash never leaves a half-written store
      this.fsyncDir(dir); // make the rename itself durable across a power loss (best-effort per platform)
      return { status: "ok" };
    } catch (error) {
      // A failed persist must never crash the agent or a request handler. Remove the partial tmp so a stale
      // orphan is not left behind, and report a sanitized category the caller can log/act on.
      this.tryRemove(tmp);
      return { status: "failed", reason: persistFailureCategory(error) };
    }
  }

  /** fsync a just-written file so its contents are durable before it is renamed into place. */
  private fsyncPath(path: string): void {
    const fd = this.fs.openSync(path, "r");
    try {
      this.fs.fsyncSync(fd);
    } finally {
      this.fs.closeSync(fd);
    }
  }

  /**
   * fsync the parent directory so the rename entry itself is durable. Best-effort: some platforms refuse a
   * directory fsync (its failure is swallowed) — the rename is already atomic, so this only upgrades a
   * power-loss guarantee and must never turn a successful swap into a reported failure.
   */
  private fsyncDir(dir: string): void {
    try {
      const fd = this.fs.openSync(dir, "r");
      try {
        this.fs.fsyncSync(fd);
      } finally {
        this.fs.closeSync(fd);
      }
    } catch {
      /* directory fsync is unsupported/refused on some platforms; the rename is already atomic */
    }
  }
}
