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

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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

export class FilePairingStore {
  readonly registry: PairingRegistry;
  private readonly filePath: string;

  constructor(filePath: string, opts: PairingRegistryOptions) {
    this.filePath = filePath;
    this.registry = new PairingRegistry(opts);
    this.registry.load(this.readFromDisk());
  }

  private readFromDisk(): Pairing[] {
    if (!existsSync(this.filePath)) return [];
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.filePath, "utf8"));
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isPairing);
    } catch {
      // A corrupt store must not crash the agent; start with no pairings (the user re-pairs).
      return [];
    }
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
