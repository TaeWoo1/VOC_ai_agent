import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  extractDates,
  matchExportScope,
  normalizeDateToken,
  type RequiredRange,
} from "../../src/naver/export-scope-match";

/**
 * The guided import's scope check. Two things matter here and both are about failing in the safe
 * direction: an unreadable picker must NOT read as "the seller chose the wrong window", and anything we
 * cannot positively confirm must NOT read as a match.
 */
describe("normalizeDateToken", () => {
  it("zero-pads a single-digit month and day", () => {
    expect(normalizeDateToken("2026", "6", "1")).toBe("2026-06-01");
  });

  it("rejects impossible calendar values rather than passing corrupt input through", () => {
    expect(normalizeDateToken("2026", "13", "01")).toBeNull();
    expect(normalizeDateToken("2026", "06", "45")).toBeNull();
    expect(normalizeDateToken("2026", "0", "10")).toBeNull();
  });
});

describe("extractDates", () => {
  it.each([
    ["ISO", ["2026-06-16", "2026-06-30"]],
    ["dotted", ["2026.06.16", "2026.06.30"]],
    ["slashed", ["2026/06/16", "2026/06/30"]],
    ["compact", ["20260616", "20260630"]],
    ["Korean", ["2026년 6월 16일", "2026년 6월 30일"]],
  ])("reads the %s date shape", (_label, values) => {
    expect(extractDates(values)).toEqual(["2026-06-16", "2026-06-30"]);
  });

  // A surface may use one combined control or two separate ones; that is a layout choice and must not
  // change what we conclude about the scope.
  it("reads both ends from ONE control holding a whole range", () => {
    expect(extractDates(["2026-06-16 ~ 2026-06-30"])).toEqual(["2026-06-16", "2026-06-30"]);
  });

  it("does not manufacture a compact date out of a delimited one's digits", () => {
    expect(extractDates(["2026-06-16"])).toEqual(["2026-06-16"]);
  });

  it("ignores blank and placeholder values", () => {
    expect(extractDates(["", "   ", "연도-월-일", "yyyy-mm-dd"])).toEqual([]);
  });

  it("de-duplicates and sorts chronologically", () => {
    expect(extractDates(["2026-06-30", "2026-06-16", "2026-06-30"])).toEqual(["2026-06-16", "2026-06-30"]);
  });
});

describe("matchExportScope", () => {
  const required: RequiredRange = { start: "2026-06-16", end: "2026-06-30" };

  it("matches the exact required window", () => {
    expect(matchExportScope(["2026-06-16", "2026-06-30"], required)).toEqual({
      match: "MATCH",
      datesParsed: 2,
      spanDiffers: false,
    });
  });

  it.each([
    ["a wider window", ["2026-06-01", "2026-06-30"]],
    ["a narrower window", ["2026-06-16", "2026-06-20"]],
    ["a different month", ["2026-05-16", "2026-05-31"]],
  ])("reports MISMATCH for %s", (_label, values) => {
    expect(matchExportScope(values, required).match).toBe("MISMATCH");
  });

  // The failure that motivated reading the scope at all: the seller confirms on one view while a
  // different range is what actually exports. An extra date control widens the observed span, so we
  // refuse rather than assume the required window was the one in effect.
  it("treats an extra date control on the page as MISMATCH, not a match", () => {
    const withStrayFilter = ["2026-06-16", "2026-06-30", "2025-01-01"];
    expect(matchExportScope(withStrayFilter, required).match).toBe("MISMATCH");
  });

  it("is UNREADABLE — never MISMATCH — when the picker exposes nothing", () => {
    // An SPA picker that keeps its value off the property we can read is OUR blindness, not evidence the
    // seller picked wrongly; calling it a mismatch would strand a perfectly correct export.
    expect(matchExportScope([], required)).toEqual({ match: "UNREADABLE", datesParsed: 0, spanDiffers: false });
    expect(matchExportScope(["", "  "], required).match).toBe("UNREADABLE");
  });

  it("is UNREADABLE with only one readable end (a half-known range is not a range)", () => {
    expect(matchExportScope(["2026-06-16"], required).match).toBe("UNREADABLE");
  });

  it("never returns MATCH for input it could not read", () => {
    for (const values of [[], [""], ["not a date"], ["2026-13-45"]]) {
      expect(matchExportScope(values, required).match).not.toBe("MATCH");
    }
  });
});

describe("export-scope-match — module boundary", () => {
  const src = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../src/naver/export-scope-match.ts"),
    "utf8",
  );
  const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

  it("is a pure leaf: no imports, no browser, no clock", () => {
    expect(code).not.toMatch(/\bimport\b/);
    expect(code).not.toMatch(/\bDate\b/);
    expect(code).not.toMatch(/playwright|page\.|document\./);
  });

  // The verdict is the ONLY thing allowed to leave the process; a date field on it would carry the
  // seller's own selected values across the boundary that `readExportScope` deliberately keeps them inside.
  it("returns no raw date in its verdict shape", () => {
    const verdict = matchExportScope(["2026-06-16", "2026-06-30"], { start: "2026-06-16", end: "2026-06-30" });
    expect(Object.keys(verdict).sort()).toEqual(["datesParsed", "match", "spanDiffers"]);
    expect(JSON.stringify(verdict)).not.toMatch(/2026/);
  });
});
