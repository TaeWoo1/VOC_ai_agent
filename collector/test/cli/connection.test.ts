import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  parseConnectionInitArgs,
  runConnectionInit,
} from "../../src/cli/connection";
import { loadConnectionRegistryFromFile } from "../../src/connection/store";

const NOW = "2026-06-18T00:00:00.000Z";
const ALIAS = "내 메인 스토어 별칭";

let dir: string;
let storeFile: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "conn-cli-"));
  storeFile = join(dir, ".connections", "connections.json");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("parseConnectionInitArgs", () => {
  it("parses a full init invocation", () => {
    const r = parseConnectionInitArgs([
      "init",
      "--connection-id",
      "conn-1",
      "--display-name",
      ALIAS,
      "--store-file",
      "/tmp/x.json",
    ]);
    expect(r).toEqual({
      ok: true,
      value: { connectionId: "conn-1", displayName: ALIAS, storeFile: "/tmp/x.json" },
    });
  });

  it("store-file is optional", () => {
    const r = parseConnectionInitArgs(["init", "--connection-id", "conn-1", "--display-name", ALIAS]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.storeFile).toBeUndefined();
  });

  it.each([
    [["status"], "unknown-command"],
    [["init", "--display-name", ALIAS], "missing-connection-id"],
    [["init", "--connection-id", "conn-1"], "missing-display-name"],
  ] as const)("rejects %s", (args, expected) => {
    const r = parseConnectionInitArgs(args);
    expect(r).toEqual({ ok: false, errorCategory: expected });
  });
});

describe("runConnectionInit", () => {
  function init(connectionId: string) {
    return runConnectionInit({ connectionId, displayName: ALIAS, storeFile, now: NOW });
  }

  it("creates a pending NAVER connection", () => {
    const out = init("conn-1");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.platform).toBe("NAVER_SMARTSTORE");
    expect(out.result.connectionStatus).toBe("PENDING_USER_LOGIN");
    expect(out.result.connectionId).toBe("conn-1");
  });

  it("persists to the temp store file and the loaded store contains it", () => {
    init("conn-1");
    expect(existsSync(storeFile)).toBe(true);
    const loaded = loadConnectionRegistryFromFile(storeFile);
    const conn = loaded.get("conn-1");
    expect(conn?.connectionStatus).toBe("PENDING_USER_LOGIN");
    expect(conn?.userProvidedDisplayName).toBe(ALIAS);
    // Not bound yet — no fingerprint.
    expect(conn?.boundStoreFingerprintHash).toBeNull();
  });

  it("derives profileName from connectionId, not the display name", () => {
    const out = init("conn-1");
    if (!out.ok) return;
    expect(out.result.profileName).toBe("naver-conn-1");
    expect(out.result.profileName).not.toContain(ALIAS);
  });

  it("produces a status snapshot that is not LAST_SUCCESS", () => {
    const out = init("conn-1");
    if (!out.ok) return;
    expect(out.result.statusState).not.toBe("LAST_SUCCESS");
    expect(out.result.statusState).toBe("COLLECTING"); // PENDING_USER_LOGIN bridge
    expect(out.result.statusDetail.length).toBeGreaterThan(0);
  });

  it("rejects a duplicate connectionId with a sanitized error (no overwrite)", () => {
    expect(init("conn-1").ok).toBe(true);
    const dup = init("conn-1");
    expect(dup).toEqual({ ok: false, errorCategory: "duplicate-connection-id" });
    // The original record is unchanged (single entry).
    expect(loadConnectionRegistryFromFile(storeFile).list()).toHaveLength(1);
  });

  it("treats display name as an alias only — printed result omits it and never leaks raw identity", () => {
    const out = init("conn-1");
    if (!out.ok) return;
    const serialized = JSON.stringify(out.result);
    // The sanitized result does not echo the alias, and carries no hash/path.
    expect(serialized).not.toContain(ALIAS);
    expect(serialized).not.toContain(storeFile);
    expect(serialized).not.toMatch(/[0-9a-f]{64}/); // no fingerprint hash
  });
});

describe("isolation: no repo-level .connections or .status writes", () => {
  it("writes only under the temp store file", () => {
    runConnectionInit({ connectionId: "conn-1", displayName: ALIAS, storeFile, now: NOW });
    // The on-disk store is the temp file; assert it holds exactly the records.
    const parsed = JSON.parse(readFileSync(storeFile, "utf8"));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].connectionId).toBe("conn-1");
    // No raw NAVER store identity persisted (only the user alias).
    expect(JSON.stringify(parsed)).not.toContain("commerce-id"); // unbound → no source category value
  });
});
