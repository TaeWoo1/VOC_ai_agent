/**
 * **Durable pairing store (file-backed).** Persists only the durable `pairings` slice of a
 * {@link PairingRegistry} to an agent-owned local file with restrictive permissions (dir 0700, file 0600).
 * Pending requests and WS tickets are intentionally NOT persisted (ephemeral, in-memory only).
 *
 * **This is NOT the future marketplace credential Device Vault** (Runtime ADR §3.2). It stores only pairing
 * material — SHA-256 hashes of the bridge pairing tokens (never a plaintext secret, never a marketplace
 * credential, cookie, or session). The plaintext pairing token exists only in browser storage on the
 * frontend and transiently in memory during first delivery.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { PairingRegistry, type Pairing, type PairingRegistryOptions } from "./pairing";

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

export class FilePairingStore {
  readonly registry: PairingRegistry;
  /** How the durable store loaded at construction — a sanitized restart-recovery signal for the boot shell. */
  readonly loadResult: PairingStoreLoadResult;
  private readonly filePath: string;

  constructor(filePath: string, opts: PairingRegistryOptions) {
    this.filePath = filePath;
    this.registry = new PairingRegistry(opts);
    this.removeStaleTmp(); // a crash mid-persist can leave `${filePath}.tmp` behind — never inherit it
    const { pairings, result } = this.readFromDisk();
    this.registry.load(pairings);
    this.loadResult = result;
  }

  /** Best-effort startup cleanup of an orphaned atomic-write temp file (interrupted {@link persist}). */
  private removeStaleTmp(): void {
    const tmp = `${this.filePath}.tmp`;
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      /* best-effort: an un-removable orphan is harmless — the next persist overwrites it */
    }
  }

  private readFromDisk(): { pairings: Pairing[]; result: PairingStoreLoadResult } {
    if (!existsSync(this.filePath)) {
      return { pairings: [], result: { status: "absent", restored: 0, dropped: 0 } };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.filePath, "utf8"));
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

  /** Persist the current durable pairings atomically with 0600 perms. Call after confirm/revoke. */
  persist(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.registry.exportPairings()), { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, this.filePath);
  }
}
