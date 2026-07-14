/**
 * **Durable pairing-store load-recovery tests** — hermetic, filesystem-only (no network, no browser, no `ws`).
 * They lock the sanitized restart-recovery contract of {@link FilePairingStore}: an absent / ok / partially
 * malformed / corrupt store each yields the right coarse status + counts (never a pairingId/origin/hash), the
 * durable pairings actually survive a construct→persist→re-construct round-trip, and an orphaned atomic-write
 * temp file left by an interrupted persist is cleaned up at boot rather than inherited.
 */
import { afterEach, describe, it, expect } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { FilePairingStore, type PairingStoreLoadResult } from "../../src/bridge/pairing-store";
import type { Pairing } from "../../src/bridge/pairing";

const dirs: string[] = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

/** A fresh temp store path (its parent dir does not yet exist beyond the tmp root). */
function storePath(): string {
  const dir = mkdtempSync(join(tmpdir(), `pairing-store-${randomUUID()}-`));
  dirs.push(dir);
  return join(dir, ".bridge", "pairings.json");
}

const now = () => 1_000_000;

function validPairing(i: number): Pairing {
  return { pairingId: `pid-${i}`, origin: "http://localhost:5173", tokenHash: `${i}`.repeat(64), createdAtMs: 1, revoked: false };
}

/** Write the store file (and its parent dir) with the given raw JSON text. */
function seedStore(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function load(path: string): PairingStoreLoadResult {
  return new FilePairingStore(path, { now }).loadResult;
}

describe("FilePairingStore load recovery", () => {
  it("reports `absent` with zero counts when no store file exists yet (fresh install)", () => {
    const store = new FilePairingStore(storePath(), { now });
    expect(store.loadResult).toEqual({ status: "absent", restored: 0, dropped: 0 });
    expect(store.registry.listPairings()).toHaveLength(0);
  });

  it("reports `ok` and restores every well-formed pairing", () => {
    const path = storePath();
    seedStore(path, JSON.stringify([validPairing(1), validPairing(2)]));
    const store = new FilePairingStore(path, { now });
    expect(store.loadResult).toEqual({ status: "ok", restored: 2, dropped: 0 });
    expect(store.registry.listPairings().map((p) => p.pairingId).sort()).toEqual(["pid-1", "pid-2"]);
  });

  it("reports `recovered_partial` and skips malformed entries while keeping the valid ones", () => {
    const path = storePath();
    seedStore(path, JSON.stringify([validPairing(1), { pairingId: "x" /* missing fields */ }, 42, null]));
    const store = new FilePairingStore(path, { now });
    expect(store.loadResult).toEqual({ status: "recovered_partial", restored: 1, dropped: 3 });
    expect(store.registry.listPairings().map((p) => p.pairingId)).toEqual(["pid-1"]);
  });

  it("reports `corrupt` (zero counts) for unparseable JSON without crashing", () => {
    const path = storePath();
    seedStore(path, "{ this is not json");
    const store = new FilePairingStore(path, { now });
    expect(store.loadResult).toEqual({ status: "corrupt", restored: 0, dropped: 0 });
    expect(store.registry.listPairings()).toHaveLength(0);
  });

  it("reports `corrupt` when the top-level JSON is not an array", () => {
    const path = storePath();
    seedStore(path, JSON.stringify({ pairings: [validPairing(1)] }));
    expect(load(path)).toEqual({ status: "corrupt", restored: 0, dropped: 0 });
  });

  it("never surfaces a pairingId/origin/hash in the sanitized load result (counts + enum only)", () => {
    const path = storePath();
    seedStore(path, JSON.stringify([validPairing(7)]));
    const keys = Object.keys(load(path)).sort();
    expect(keys).toEqual(["dropped", "restored", "status"]);
  });

  it("survives a persist → re-construct round-trip (durable pairing continuity across restart)", () => {
    const path = storePath();
    const first = new FilePairingStore(path, { now });
    const req = first.registry.requestPairing("http://localhost:5173", "ws");
    expect(first.registry.confirmPairing(req.requestId, "allow").ok).toBe(true);
    first.persist();

    const reloaded = new FilePairingStore(path, { now });
    expect(reloaded.loadResult).toEqual({ status: "ok", restored: 1, dropped: 0 });
    expect(reloaded.registry.hasActivePairing()).toBe(true);
  });

  it("removes an orphaned `${path}.tmp` left by an interrupted persist, at construction", () => {
    const path = storePath();
    seedStore(path, JSON.stringify([validPairing(1)]));
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, "half-written-garbage");
    expect(existsSync(tmp)).toBe(true);

    const store = new FilePairingStore(path, { now });
    expect(existsSync(tmp)).toBe(false); // cleaned at boot
    expect(store.loadResult.status).toBe("ok"); // the real store still loaded normally
    // The real store file is untouched by the cleanup.
    expect(JSON.parse(readFileSync(path, "utf8"))).toHaveLength(1);
  });
});
