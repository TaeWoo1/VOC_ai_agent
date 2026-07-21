/**
 * The calibrated-selector store: owner-only modes, atomic replacement, and error categories that never
 * echo the path or the file contents.
 *
 * This module had no test at all, so the 0600 claim, the atomicity claim and the fixed-category claim were
 * all documentation. The mode assertions are skipped on Windows, where POSIX bits do not apply.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  SelectorStoreError,
  defaultSelectorStorePath,
  loadSelectorSpecs,
  saveSelectorSpecs,
  selectorStoreErrorCategory,
} from "../../../src/action-window/reply-submission/chrome-selector-store";
import type { ChromeSelectorSpecs } from "../../../src/action-window/reply-submission/chrome-selector-spec";

const POSIX = process.platform !== "win32";

const SPECS: ChromeSelectorSpecs = {
  userId: [{ strategy: "element-id", selector: "#_gnb_nav > span", stability: "strong" }],
  shopName: [{ strategy: "chrome-ancestry", selector: "#seller-lnb .name", stability: "strong" }],
};

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(resolve(tmpdir(), "aw-sel-store-"));
  file = resolve(dir, ".chrome-selectors", "naver.json");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("defaultSelectorStorePath", () => {
  it("is deterministic and reads no environment", () => {
    expect(defaultSelectorStorePath("/x")).toBe(resolve("/x", ".chrome-selectors", "naver.json"));
  });
});

describe("saveSelectorSpecs", () => {
  it("round-trips through loadSelectorSpecs", () => {
    saveSelectorSpecs(file, SPECS);
    expect(loadSelectorSpecs(file)).toEqual(SPECS);
  });

  it.skipIf(!POSIX)("writes the file 0600 inside a 0700 directory", () => {
    saveSelectorSpecs(file, SPECS);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(resolve(dir, ".chrome-selectors")).mode & 0o777).toBe(0o700);
  });

  it("leaves no .tmp behind", () => {
    saveSelectorSpecs(file, SPECS);
    expect(existsSync(`${file}.tmp`)).toBe(false);
  });

  it.skipIf(!POSIX)("FORCES 0600 over a leftover permissive temp file from a killed run", () => {
    // The regression this exists for. `mode` on writeFileSync applies only when the file is CREATED, so a
    // `naver.json.tmp` surviving a run killed mid-write — and this process waits on two operator prompts
    // of ten to fifteen minutes — was reused at whatever mode it already had and then RENAMED over the
    // real file. The explicit unlink + `wx` + chmodSync is what closes it.
    mkdirSync(resolve(dir, ".chrome-selectors"), { recursive: true });
    writeFileSync(`${file}.tmp`, "stale", { mode: 0o644 });
    chmodSync(`${file}.tmp`, 0o644);
    saveSelectorSpecs(file, SPECS);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(loadSelectorSpecs(file)).toEqual(SPECS);
  });

  it.skipIf(!POSIX)("leaves the PREVIOUS store intact when the write fails", () => {
    // What the temp-file + rename actually buys. A direct `writeFileSync(filePath, …)` truncates the
    // target the moment it opens it, so a failure mid-write destroys a working calibration and the next
    // guided session stops at `no-selectors` with nothing to fall back to. Writing elsewhere and renaming
    // means a failure leaves the old file untouched.
    saveSelectorSpecs(file, SPECS);
    const specDir = resolve(dir, ".chrome-selectors");
    chmodSync(specDir, 0o500); // readable + executable, not writable: the temp create must fail
    try {
      expect(() => saveSelectorSpecs(file, { ...SPECS, userId: [] } as ChromeSelectorSpecs)).toThrow();
      expect(loadSelectorSpecs(file)).toEqual(SPECS);
    } finally {
      chmodSync(specDir, 0o700);
    }
  });

  it("replaces an existing store rather than appending to it", () => {
    saveSelectorSpecs(file, SPECS);
    const next: ChromeSelectorSpecs = {
      userId: [{ strategy: "element-id", selector: "#other", stability: "strong" }],
      shopName: SPECS.shopName,
    };
    saveSelectorSpecs(file, next);
    expect(loadSelectorSpecs(file)).toEqual(next);
  });
});

describe("loadSelectorSpecs", () => {
  it("returns null for a missing file — a fresh install has simply not calibrated yet", () => {
    expect(loadSelectorSpecs(file)).toBeNull();
  });

  it("throws STORE_MALFORMED_JSON without echoing the contents or the path", () => {
    mkdirSync(resolve(dir, ".chrome-selectors"), { recursive: true });
    writeFileSync(file, '{"userId": [ THIS IS NOT JSON secret-shop-name', { mode: 0o600 });
    try {
      loadSelectorSpecs(file);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(SelectorStoreError);
      expect((error as SelectorStoreError).category).toBe("STORE_MALFORMED_JSON");
      const text = `${(error as Error).message} ${(error as Error).stack ?? ""}`;
      expect(text).not.toContain("secret-shop-name");
      expect((error as Error).message).not.toContain(dir);
    }
  });

  it("throws STORE_INVALID_SPEC for JSON that is not a spec pair", () => {
    mkdirSync(resolve(dir, ".chrome-selectors"), { recursive: true });
    writeFileSync(file, JSON.stringify({ userId: [], shopName: [] }), { mode: 0o600 });
    expect(() => loadSelectorSpecs(file)).toThrow(SelectorStoreError);
    try {
      loadSelectorSpecs(file);
    } catch (error) {
      expect((error as SelectorStoreError).category).toBe("STORE_INVALID_SPEC");
    }
  });
});

describe("selectorStoreErrorCategory", () => {
  it("narrows anything to a fixed category, so a report can never carry a raw error", () => {
    expect(selectorStoreErrorCategory(new SelectorStoreError("STORE_INVALID_SPEC"))).toBe("STORE_INVALID_SPEC");
    expect(selectorStoreErrorCategory({ code: "ENOENT" })).toBe("STORE_NOT_FOUND");
    expect(selectorStoreErrorCategory(new Error("EACCES: /Users/someone/.chrome-selectors"))).toBe(
      "STORE_IO_ERROR",
    );
    expect(selectorStoreErrorCategory("nonsense")).toBe("STORE_IO_ERROR");
    expect(selectorStoreErrorCategory(null)).toBe("STORE_IO_ERROR");
  });
});
