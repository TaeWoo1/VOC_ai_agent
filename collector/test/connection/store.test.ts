import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPendingConnection, fingerprintHash } from "../../src/connection/connection";
import { completeManualAccountSelection } from "../../src/connection/workflow";
import { createConnectionRegistry } from "../../src/connection/registry";
import { CONNECTION_SCHEMA_VERSION } from "../../src/connection/record";
import {
  ConnectionStoreError,
  connectionStoreErrorCategory,
  defaultConnectionStorePath,
  loadConnectionRegistryFromFile,
  saveConnectionRegistryToFile,
} from "../../src/connection/store";
import type { CollectorConnection } from "../../src/connection/types";

const NOW = "2026-06-18T00:00:00.000Z";
const FAKE_RAW_IDENTITY = "FAKE_STORE_홍길동테스트_0001";
const ATTACKER = "<script>steal('PII_홍길동_010-0000-0000')</script>";

let dir: string;
let storePath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "conn-store-"));
  storePath = join(dir, ".connections", "connections.json");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function connected(id: string): CollectorConnection {
  return completeManualAccountSelection(
    createPendingConnection({
      connectionId: id,
      platform: "NAVER_SMARTSTORE",
      userProvidedDisplayName: `별칭-${id}`,
      now: NOW,
    }),
    fingerprintHash(`${FAKE_RAW_IDENTITY}-${id}`),
    "commerce-id",
    `별칭-${id}`,
    NOW,
  );
}

describe("defaultConnectionStorePath", () => {
  it("is under .connections/connections.json and independent of env", () => {
    expect(defaultConnectionStorePath("/tmp/collector-root")).toBe(
      "/tmp/collector-root/.connections/connections.json",
    );
  });
});

describe("loadConnectionRegistryFromFile", () => {
  it("returns an empty registry when the file is missing", () => {
    const reg = loadConnectionRegistryFromFile(storePath);
    expect(reg.list()).toEqual([]);
  });

  it("throws a sanitized STORE_MALFORMED_JSON on bad JSON", () => {
    mkdirSync(dirname(storePath), { recursive: true });
    writeFileSync(storePath, "{ not json ", "utf8");
    expect(() => loadConnectionRegistryFromFile(storePath)).toThrowError(ConnectionStoreError);
    try {
      loadConnectionRegistryFromFile(storePath);
    } catch (e) {
      expect((e as ConnectionStoreError).category).toBe("STORE_MALFORMED_JSON");
    }
  });

  it("throws STORE_MALFORMED_JSON when top-level is not an array", () => {
    mkdirSync(dirname(storePath), { recursive: true });
    writeFileSync(storePath, JSON.stringify({ nope: true }), "utf8");
    try {
      loadConnectionRegistryFromFile(storePath);
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as ConnectionStoreError).category).toBe("STORE_MALFORMED_JSON");
    }
  });

  it("throws STORE_INVALID_RECORD on a bad record and does not echo attacker strings", () => {
    mkdirSync(dirname(storePath), { recursive: true });
    // Valid record shape but with an attacker-controlled invalid platform.
    const badRecord = { ...JSON.parse(JSON.stringify(connected("a"))), schemaVersion: 1, platform: ATTACKER };
    writeFileSync(storePath, JSON.stringify([badRecord]), "utf8");
    try {
      loadConnectionRegistryFromFile(storePath);
      throw new Error("should have thrown");
    } catch (e) {
      const err = e as ConnectionStoreError;
      expect(err.category).toBe("STORE_INVALID_RECORD");
      expect(err.recordErrorCategory).toBe("unknown-platform");
      // The error must not carry the attacker string or PII anywhere.
      expect(err.message).not.toContain(ATTACKER);
      expect(JSON.stringify({ message: err.message, category: err.category, rec: err.recordErrorCategory }))
        .not.toContain("PII_홍길동");
    }
  });
});

describe("saveConnectionRegistryToFile", () => {
  it("round-trips multiple connections through save then load", () => {
    const reg = createConnectionRegistry([connected("a"), connected("b")]);
    saveConnectionRegistryToFile(storePath, reg);
    const loaded = loadConnectionRegistryFromFile(storePath);
    expect(loaded.list()).toEqual(reg.list());
  });

  it("creates the parent directory if missing", () => {
    expect(existsSync(dirname(storePath))).toBe(false);
    saveConnectionRegistryToFile(storePath, createConnectionRegistry([connected("a")]));
    expect(existsSync(storePath)).toBe(true);
  });

  it("writes JSON-safe records (array of records with schemaVersion)", () => {
    saveConnectionRegistryToFile(storePath, createConnectionRegistry([connected("a")]));
    const parsed = JSON.parse(readFileSync(storePath, "utf8"));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].schemaVersion).toBe(CONNECTION_SCHEMA_VERSION);
    expect(parsed[0].connectionId).toBe("a");
  });

  it("leaves a valid final file and no leftover temp file after save (atomic)", () => {
    saveConnectionRegistryToFile(storePath, createConnectionRegistry([connected("a")]));
    // Final file is valid and re-loadable.
    expect(loadConnectionRegistryFromFile(storePath).list()).toHaveLength(1);
    // No `.tmp` artifact remains in the store directory.
    const leftovers = readdirSync(dirname(storePath)).filter((f) => f.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
  });

  it("does not persist raw store identity (only the hash + alias)", () => {
    saveConnectionRegistryToFile(storePath, createConnectionRegistry([connected("a")]));
    const onDisk = readFileSync(storePath, "utf8");
    expect(onDisk).not.toContain(FAKE_RAW_IDENTITY);
    expect(onDisk).toContain(fingerprintHash(`${FAKE_RAW_IDENTITY}-a`));
    expect(onDisk).toContain("별칭-a");
  });
});

describe("connectionStoreErrorCategory", () => {
  it("maps ENOENT to STORE_NOT_FOUND and unknown to STORE_IO_ERROR", () => {
    expect(connectionStoreErrorCategory({ code: "ENOENT" })).toBe("STORE_NOT_FOUND");
    expect(connectionStoreErrorCategory(new Error("boom"))).toBe("STORE_IO_ERROR");
    expect(connectionStoreErrorCategory(new ConnectionStoreError("STORE_MALFORMED_JSON"))).toBe(
      "STORE_MALFORMED_JSON",
    );
  });

  it("never echoes a raw error value through the category", () => {
    const cat = connectionStoreErrorCategory(new Error(ATTACKER));
    expect(cat).toBe("STORE_IO_ERROR");
    expect(cat).not.toContain(ATTACKER);
  });
});

describe("persistence boundary", () => {
  it("store.ts is the only connection module that imports fs", () => {
    const moduleDir = join(__dirname, "..", "..", "src", "connection");
    const files = readdirSync(moduleDir).filter((f) => f.endsWith(".ts"));
    for (const f of files) {
      const src = readFileSync(join(moduleDir, f), "utf8");
      const importsFs = /from\s+["']node:fs(\/promises)?["']|from\s+["']fs(\/promises)?["']/.test(src);
      if (f === "store.ts") {
        expect(importsFs).toBe(true);
      } else {
        expect(importsFs, `${f} must remain fs-free`).toBe(false);
      }
    }
  });
});
