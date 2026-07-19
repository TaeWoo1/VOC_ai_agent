/**
 * Reply-target bundle loaders + hardened 0600 writer. Proves the owner-only / one-shot / KST-expiry contract
 * of the request and result bundles, and that what `writeResultBundle` writes is exactly what
 * `loadResultBundle` accepts (the writer↔reader contract the prepare CLI and reply CLI depend on).
 */
import { afterEach, describe, it, expect } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  hintFrom,
  loadRequestBundle,
  loadResultBundle,
  ReplyTargetBundleError,
  reserveResultBundle,
  resultBundleRefusalMessage,
  writeResultBundle,
  type BundleReadDeps,
  type BundleWriteDeps,
  type ReplyTargetResultBundle,
} from "../../../src/action-window/reply-submission/reply-target-bundle";

const TODAY = "2026-05-12";
const FP = "a".repeat(64);
const RESULT: ReplyTargetResultBundle = {
  submissionRef: "a1b2c3d4e5f60718",
  rating: 2,
  recencyBucket: "THIS_WEEK",
  bodyFingerprint: FP,
  asOfDate: TODAY,
};

function readDeps(body: string, mode = 0o600, exists = true): BundleReadDeps {
  return { existsSync: () => exists, statSync: () => ({ mode }), readFileSync: () => body };
}
function resultBody(over: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...RESULT, ...over });
}

describe("loadRequestBundle — owner-only, fail-closed", () => {
  const P = "/x/.reply-target/request.json";
  const body = JSON.stringify({ accountId: "acc-01", actionRef: "review:abc" });

  it("returns {accountId, actionRef} on a valid owner-only file", () => {
    expect(loadRequestBundle(P, readDeps(body))).toEqual({ accountId: "acc-01", actionRef: "review:abc" });
  });
  it("returns null when absent", () => {
    expect(loadRequestBundle(P, readDeps("", 0o600, false))).toBeNull();
  });
  it("fails closed PERMS on a group/world-readable file", () => {
    try { loadRequestBundle(P, readDeps(body, 0o644)); expect.fail("should throw"); }
    catch (e) { expect((e as ReplyTargetBundleError).code).toBe("PERMS"); }
  });
  it("fails closed MALFORMED on non-JSON", () => {
    try { loadRequestBundle(P, readDeps("{nope")); expect.fail("should throw"); }
    catch (e) { expect((e as ReplyTargetBundleError).code).toBe("MALFORMED"); }
  });
  it("fails closed SCHEMA on a missing field", () => {
    for (const bad of [{ accountId: "" }, JSON.parse(JSON.stringify({ actionRef: "review:abc" }))]) {
      try { loadRequestBundle(P, readDeps(JSON.stringify({ accountId: "a", actionRef: "r", ...bad }))); }
      catch (e) { expect((e as ReplyTargetBundleError).code).toBe("SCHEMA"); }
    }
    try { loadRequestBundle(P, readDeps(JSON.stringify({ actionRef: "review:abc" }))); expect.fail("should throw"); }
    catch (e) { expect((e as ReplyTargetBundleError).code).toBe("SCHEMA"); }
  });
});

describe("loadResultBundle — owner-only, KST-expiring, fail-closed", () => {
  const P = "/x/.reply-target/hint.json";

  it("returns the full bundle on a valid, owner-only, non-expired file", () => {
    expect(loadResultBundle(P, readDeps(resultBody()), TODAY)).toEqual(RESULT);
  });
  it("returns null when absent", () => {
    expect(loadResultBundle(P, readDeps("", 0o600, false), TODAY)).toBeNull();
  });
  it("fails closed PERMS on a group/world-readable file", () => {
    try { loadResultBundle(P, readDeps(resultBody(), 0o640), TODAY); expect.fail("should throw"); }
    catch (e) { expect((e as ReplyTargetBundleError).code).toBe("PERMS"); }
  });
  it("fails closed MALFORMED on non-JSON", () => {
    try { loadResultBundle(P, readDeps("nope"), TODAY); expect.fail("should throw"); }
    catch (e) { expect((e as ReplyTargetBundleError).code).toBe("MALFORMED"); }
  });
  it("fails closed SCHEMA on a bad ref / rating / bucket / fingerprint / asOfDate", () => {
    for (const bad of [
      { submissionRef: "NOTHEX" },
      { rating: 0 },
      { rating: 9 },
      { recencyBucket: "SOON" },
      { bodyFingerprint: "" },
      { asOfDate: "not-a-date" },
    ]) {
      try { loadResultBundle(P, readDeps(resultBody(bad)), TODAY); expect.fail(`should throw for ${JSON.stringify(bad)}`); }
      catch (e) { expect((e as ReplyTargetBundleError).code, JSON.stringify(bad)).toBe("SCHEMA"); }
    }
  });
  it("fails closed EXPIRED when the KST as-of date is not today", () => {
    try { loadResultBundle(P, readDeps(resultBody({ asOfDate: "2026-05-11" })), TODAY); expect.fail("should throw"); }
    catch (e) { expect((e as ReplyTargetBundleError).code).toBe("EXPIRED"); }
  });
});

describe("hintFrom", () => {
  it("projects only the three match fields (never the submissionRef or asOfDate)", () => {
    expect(hintFrom(RESULT)).toEqual({ rating: 2, recencyBucket: "THIS_WEEK", bodyFingerprint: FP });
    expect(Object.keys(hintFrom(RESULT)).sort()).toEqual(["bodyFingerprint", "rating", "recencyBucket"]);
  });
});

describe("writeResultBundle — hardened owner-only write + writer↔reader contract", () => {
  function captureWrite() {
    const calls = { mkdir: [] as unknown[], write: [] as unknown[], chmod: [] as unknown[], rename: [] as unknown[] };
    let written = "";
    const deps: BundleWriteDeps = {
      existsSync: () => false, // dir absent → exercises the mkdir path
      mkdirSync: (p, o) => { calls.mkdir.push([p, o.mode]); },
      writeFileSync: (p, data, o) => { written = data; calls.write.push([p, o.mode]); },
      chmodSync: (p, m) => { calls.chmod.push([p, m]); },
      renameSync: (a, b) => { calls.rename.push([a, b]); },
    };
    return { deps, calls, written: () => written };
  }

  it("creates dir 0700, writes+chmods the temp 0600, renames atomically; the reader accepts the result", () => {
    const P = "/x/.reply-target/hint.json";
    const { deps, calls, written } = captureWrite();
    writeResultBundle(P, RESULT, deps);
    expect(calls.mkdir[0]).toEqual(["/x/.reply-target", 0o700]);
    expect(calls.write[0]).toEqual([`${P}.tmp`, 0o600]);
    expect(calls.chmod[0]).toEqual([`${P}.tmp`, 0o600]);
    expect(calls.rename[0]).toEqual([`${P}.tmp`, P]);
    // Writer↔reader contract: exactly what was written loads back as an equal bundle.
    expect(loadResultBundle(P, readDeps(written()), TODAY)).toEqual(RESULT);
  });
});

describe("resultBundleRefusalMessage", () => {
  it("explains every code and points at the path without printing a field value", () => {
    for (const code of ["PERMS", "MALFORMED", "SCHEMA", "EXPIRED", "EXISTS"] as const) {
      expect(resultBundleRefusalMessage(code, "/x/hint.json")).toContain("/x/hint.json");
    }
  });
});

describe("reserveResultBundle — atomic no-clobber reservation (real fs, O_EXCL)", () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const realReserveDeps = { existsSync, mkdirSync, writeFileSync };
  function freshPath(): string {
    const d = mkdtempSync(join(tmpdir(), "reserve-"));
    tmpDirs.push(d);
    return join(d, ".reply-target", "hint.json"); // dir does not exist yet — exercises the 0700 mkdir
  }

  it("creates an owner-only empty reservation (and its 0700 dir) when the slot is free", () => {
    const p = freshPath();
    reserveResultBundle(p, realReserveDeps);
    expect(existsSync(p)).toBe(true);
    expect(statSync(p).mode & 0o077).toBe(0); // owner-only — the security property, umask-robust
    expect(readFileSync(p, "utf8")).toBe("");
  });

  it("throws EXISTS on a second reservation and leaves the existing file BYTE-UNCHANGED (no clobber)", () => {
    const p = freshPath();
    reserveResultBundle(p, realReserveDeps);
    writeFileSync(p, '{"already":"here"}\n', { mode: 0o600 }); // winner finalized real content
    const before = readFileSync(p, "utf8");
    try {
      reserveResultBundle(p, realReserveDeps);
      expect.fail("should have thrown EXISTS");
    } catch (e) {
      expect((e as ReplyTargetBundleError).code).toBe("EXISTS");
    }
    expect(readFileSync(p, "utf8")).toBe(before); // untouched — no clobber
  });

  it("only ONE of two reservations on the same path wins; the other gets EXISTS (race-free)", () => {
    const p = freshPath();
    let wins = 0;
    let exists = 0;
    for (let i = 0; i < 2; i += 1) {
      try {
        reserveResultBundle(p, realReserveDeps);
        wins += 1;
      } catch (e) {
        if ((e as ReplyTargetBundleError).code === "EXISTS") exists += 1;
      }
    }
    expect(wins).toBe(1);
    expect(exists).toBe(1);
  });
});
