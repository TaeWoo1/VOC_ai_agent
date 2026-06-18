import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseOffsetTimestampToEpochMs } from "../../src/events/offset-timestamp-parser";

describe("parseOffsetTimestampToEpochMs — non-string / empty", () => {
  it("null / undefined / empty / blank → null", () => {
    expect(parseOffsetTimestampToEpochMs(null)).toBeNull();
    expect(parseOffsetTimestampToEpochMs(undefined)).toBeNull();
    expect(parseOffsetTimestampToEpochMs("")).toBeNull();
    expect(parseOffsetTimestampToEpochMs("   ")).toBeNull();
  });
});

describe("parseOffsetTimestampToEpochMs — epoch / offset arithmetic", () => {
  it("anchors at the Unix epoch", () => {
    expect(parseOffsetTimestampToEpochMs("1970-01-01T00:00:00Z")).toBe(0);
    expect(parseOffsetTimestampToEpochMs("1970-01-01T00:00:00.000Z")).toBe(0);
    expect(parseOffsetTimestampToEpochMs("1970-01-01T09:00:00+09:00")).toBe(0);
  });

  it("applies positive and negative offsets correctly", () => {
    expect(parseOffsetTimestampToEpochMs("1970-01-01T00:00:00-05:00")).toBe(18_000_000);
    expect(parseOffsetTimestampToEpochMs("1970-01-01T00:00:00+09:00")).toBe(-32_400_000);
  });

  it("carries milliseconds", () => {
    expect(parseOffsetTimestampToEpochMs("1970-01-01T00:00:00.250Z")).toBe(250);
  });

  it("computes a later date deterministically", () => {
    // 2024-01-01T00:00:00Z = 1704067200000 (known constant)
    expect(parseOffsetTimestampToEpochMs("2024-01-01T00:00:00Z")).toBe(1_704_067_200_000);
  });
});

describe("parseOffsetTimestampToEpochMs — leap day", () => {
  it("accepts a valid leap day", () => {
    expect(parseOffsetTimestampToEpochMs("2024-02-29T00:00:00Z")).not.toBeNull();
  });

  it("rejects an invalid leap day", () => {
    expect(parseOffsetTimestampToEpochMs("2023-02-29T00:00:00Z")).toBeNull();
    expect(parseOffsetTimestampToEpochMs("2100-02-29T00:00:00Z")).toBeNull(); // 2100 not a leap year
  });

  it("accepts a Gregorian 400-year leap day", () => {
    expect(parseOffsetTimestampToEpochMs("2000-02-29T00:00:00Z")).not.toBeNull();
  });
});

describe("parseOffsetTimestampToEpochMs — range validation", () => {
  it("rejects invalid month / day / hour / minute / second", () => {
    expect(parseOffsetTimestampToEpochMs("2026-00-10T00:00:00Z")).toBeNull(); // month 00
    expect(parseOffsetTimestampToEpochMs("2026-13-10T00:00:00Z")).toBeNull(); // month 13
    expect(parseOffsetTimestampToEpochMs("2026-04-31T00:00:00Z")).toBeNull(); // April has 30
    expect(parseOffsetTimestampToEpochMs("2026-06-00T00:00:00Z")).toBeNull(); // day 00
    expect(parseOffsetTimestampToEpochMs("2026-06-18T24:00:00Z")).toBeNull(); // hour 24
    expect(parseOffsetTimestampToEpochMs("2026-06-18T00:60:00Z")).toBeNull(); // minute 60
    expect(parseOffsetTimestampToEpochMs("2026-06-18T00:00:60Z")).toBeNull(); // second 60
  });

  it("rejects out-of-range offsets", () => {
    expect(parseOffsetTimestampToEpochMs("2026-06-18T00:00:00+24:00")).toBeNull();
    expect(parseOffsetTimestampToEpochMs("2026-06-18T00:00:00+09:60")).toBeNull();
  });
});

describe("parseOffsetTimestampToEpochMs — format rejection", () => {
  it("rejects timezone-less, date-only, and malformed forms", () => {
    expect(parseOffsetTimestampToEpochMs("2026-06-18T09:00:00")).toBeNull(); // no zone
    expect(parseOffsetTimestampToEpochMs("2026-06-18")).toBeNull(); // date only
    expect(parseOffsetTimestampToEpochMs("2026-06-18 09:00:00+09:00")).toBeNull(); // space, not T
    expect(parseOffsetTimestampToEpochMs("2026-06-18T09:00:00+0900")).toBeNull(); // offset no colon
    expect(parseOffsetTimestampToEpochMs("2026-06-18T09:00:00KST")).toBeNull(); // named zone
    expect(parseOffsetTimestampToEpochMs("2026-06-18T09:00:00z")).toBeNull(); // lowercase z
    expect(parseOffsetTimestampToEpochMs("2026-06-18T09:00:00.5Z")).toBeNull(); // ms not 3 digits
    expect(parseOffsetTimestampToEpochMs("2026-06-18T09:00:00.5000Z")).toBeNull(); // ms 4 digits
    expect(parseOffsetTimestampToEpochMs("2026-6-18T09:00:00Z")).toBeNull(); // month not 2 digits
  });
});

describe("parseOffsetTimestampToEpochMs — determinism", () => {
  it("repeated calls on the same input return identical results", () => {
    const s = "2026-06-18T09:30:15.123+09:00";
    expect(parseOffsetTimestampToEpochMs(s)).toBe(parseOffsetTimestampToEpochMs(s));
  });
});

describe("module boundary", () => {
  it("imports nothing and uses no Date.* API (no Date.parse/new Date/Date.now/Date.UTC)", () => {
    const src = readFileSync(
      join(__dirname, "..", "..", "src", "events", "offset-timestamp-parser.ts"),
      "utf8",
    );
    const imports = src
      .split("\n")
      .filter((l) => /^\s*import\b/.test(l) || /\bfrom\s+["']/.test(l))
      .join("\n");
    expect(imports.trim()).toBe(""); // pure module, no imports
    // No Date.* usage anywhere in CODE (comments may mention them).
    const code = src
      .split("\n")
      .filter((l) => {
        const t = l.trim();
        return !(t.startsWith("*") || t.startsWith("//") || t.startsWith("/*") || t.startsWith("*/"));
      })
      .join("\n");
    expect(/Date\.parse|new Date\(|Date\.now|Date\.UTC/.test(code)).toBe(false);
    expect(/\bDate\b/.test(code)).toBe(false);
    expect(/generatedAt/.test(code)).toBe(false);
    expect(/process\.env|\bfetch\(|\baxios\b|playwright|openai|anthropic/i.test(code)).toBe(false);
  });
});
