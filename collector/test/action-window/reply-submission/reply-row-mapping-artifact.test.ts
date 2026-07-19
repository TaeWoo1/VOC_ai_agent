/**
 * Reply-row calibration artifact — the fail-closed loader + hardened 0600 writer. Proves the owner-only /
 * page-bound (structural signature) / short-expiry contract, and that what `writeRowMapping` writes is exactly
 * what `loadRowMapping` accepts (the writer↔reader contract the calibration CLI and reply CLI depend on).
 */
import { describe, it, expect } from "vitest";
import {
  loadRowMapping,
  ReplyRowMappingError,
  rowMappingRefusalMessage,
  writeRowMapping,
  ROW_MAPPING_SCHEMA_VERSION,
  type ReplyRowMapping,
  type RowMappingReadDeps,
  type RowMappingWriteDeps,
} from "../../../src/action-window/reply-submission/reply-row-mapping-artifact";

const SIG = "sig_abc123";
const NOW = 1_000_000;
const MAPPING: ReplyRowMapping = {
  schemaVersion: ROW_MAPPING_SCHEMA_VERSION,
  structuralPageSignature: SIG,
  expiresAtEpochMs: NOW + 60_000,
  parentPath: [0, 1],
  rowTag: "DIV",
  rowIndex: 3,
  ratingPath: [1, 0],
  datePath: [2],
  bodyPath: [1, 2],
  replyControlPath: [3, 0],
};

function readDeps(body: string, mode = 0o600, exists = true): RowMappingReadDeps {
  return { existsSync: () => exists, statSync: () => ({ mode }), readFileSync: () => body };
}
function body(over: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...MAPPING, ...over });
}

describe("loadRowMapping — owner-only, page-bound, short-lived, fail-closed", () => {
  const P = "/x/.reply-target/row-mapping.json";

  it("returns the mapping on a valid owner-only, on-page, non-expired artifact", () => {
    expect(loadRowMapping(P, readDeps(body()), NOW, SIG)).toEqual(MAPPING);
  });
  it("returns null when absent", () => {
    expect(loadRowMapping(P, readDeps("", 0o600, false), NOW, SIG)).toBeNull();
  });
  it("fails closed PERMS on a group/world-readable file", () => {
    expect(() => loadRowMapping(P, readDeps(body(), 0o644), NOW, SIG)).toThrow(ReplyRowMappingError);
    try { loadRowMapping(P, readDeps(body(), 0o644), NOW, SIG); } catch (e) { expect((e as ReplyRowMappingError).code).toBe("PERMS"); }
  });
  it("fails closed MALFORMED on non-JSON", () => {
    try { loadRowMapping(P, readDeps("{nope"), NOW, SIG); expect.fail("should throw"); }
    catch (e) { expect((e as ReplyRowMappingError).code).toBe("MALFORMED"); }
  });
  it("fails closed VERSION on a schema-version mismatch", () => {
    try { loadRowMapping(P, readDeps(body({ schemaVersion: "reply-row-mapping/v0" })), NOW, SIG); expect.fail("should throw"); }
    catch (e) { expect((e as ReplyRowMappingError).code).toBe("VERSION"); }
  });
  it("fails closed SCHEMA on bad container/index/paths", () => {
    for (const bad of [
      { parentPath: "nope" },
      { rowTag: "" },
      { rowTag: "div" },
      { rowTag: 123 },
      { rowIndex: -1 },
      { ratingPath: "nope" },
      { bodyPath: [1, -2] },
      { replyControlPath: [1, 2.5] },
      { structuralPageSignature: "" },
      { expiresAtEpochMs: "soon" },
    ]) {
      try { loadRowMapping(P, readDeps(body(bad)), NOW, SIG); expect.fail(`should throw for ${JSON.stringify(bad)}`); }
      catch (e) { expect((e as ReplyRowMappingError).code, JSON.stringify(bad)).toBe("SCHEMA"); }
    }
  });
  it("fails closed PAGE_DRIFT when the live signature no longer matches the calibrated one", () => {
    try { loadRowMapping(P, readDeps(body()), NOW, "sig_different"); expect.fail("should throw"); }
    catch (e) { expect((e as ReplyRowMappingError).code).toBe("PAGE_DRIFT"); }
  });
  it("fails closed EXPIRED once now has reached the short TTL", () => {
    try { loadRowMapping(P, readDeps(body()), NOW + 60_000, SIG); expect.fail("should throw"); }
    catch (e) { expect((e as ReplyRowMappingError).code).toBe("EXPIRED"); }
  });
});

describe("writeRowMapping — hardened owner-only write + writer↔reader contract", () => {
  it("creates dir 0700, writes+chmods the temp 0600, renames atomically; the reader accepts the result", () => {
    const calls = { mkdir: [] as unknown[], write: [] as unknown[], chmod: [] as unknown[], rename: [] as unknown[] };
    let written = "";
    const deps: RowMappingWriteDeps = {
      existsSync: () => false,
      mkdirSync: (p, o) => { calls.mkdir.push([p, o.mode]); },
      writeFileSync: (p, data, o) => { written = data; calls.write.push([p, o.mode]); },
      chmodSync: (p, m) => { calls.chmod.push([p, m]); },
      renameSync: (a, b) => { calls.rename.push([a, b]); },
    };
    const P = "/x/.reply-target/row-mapping.json";
    writeRowMapping(P, MAPPING, deps);
    expect(calls.mkdir[0]).toEqual(["/x/.reply-target", 0o700]);
    expect(calls.write[0]).toEqual([`${P}.tmp`, 0o600]);
    expect(calls.chmod[0]).toEqual([`${P}.tmp`, 0o600]);
    expect(calls.rename[0]).toEqual([`${P}.tmp`, P]);
    expect(loadRowMapping(P, readDeps(written), NOW, SIG)).toEqual(MAPPING);
  });
});

describe("rowMappingRefusalMessage", () => {
  it("explains every code and names the path", () => {
    for (const code of ["PERMS", "MALFORMED", "SCHEMA", "VERSION", "PAGE_DRIFT", "EXPIRED"] as const) {
      expect(rowMappingRefusalMessage(code, "/x/row-mapping.json")).toContain("/x/row-mapping.json");
    }
  });
});
