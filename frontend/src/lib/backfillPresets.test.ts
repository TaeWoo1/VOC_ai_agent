import { describe, expect, it } from "vitest";
import { resolvePresetRange, toIsoDate, validateBackfill } from "./backfillPresets";

describe("toIsoDate", () => {
  it("formats a date as a local yyyy-MM-dd with zero padding", () => {
    expect(toIsoDate(new Date(2026, 4, 3))).toBe("2026-05-03"); // month is 0-based
    expect(toIsoDate(new Date(2026, 11, 25))).toBe("2026-12-25");
  });
});

describe("resolvePresetRange", () => {
  const today = new Date(2026, 5, 26); // 2026-06-26

  it("today is a single day", () => {
    expect(resolvePresetRange("today", today)).toEqual({ from: "2026-06-26", to: "2026-06-26" });
  });

  it("recent3 spans today plus the two prior days", () => {
    expect(resolvePresetRange("recent3", today)).toEqual({ from: "2026-06-24", to: "2026-06-26" });
  });

  it("recent7 spans today plus the six prior days", () => {
    expect(resolvePresetRange("recent7", today)).toEqual({ from: "2026-06-20", to: "2026-06-26" });
  });

  it("custom passes the caller's range through", () => {
    expect(resolvePresetRange("custom", today, { from: "2026-01-01", to: "2026-03-31" })).toEqual({
      from: "2026-01-01",
      to: "2026-03-31",
    });
  });

  it("custom with no typed range yields empty bounds", () => {
    expect(resolvePresetRange("custom", today)).toEqual({ from: "", to: "" });
  });
});

describe("validateBackfill", () => {
  const range = { from: "2026-05-01", to: "2026-05-31" };

  it("rejects an empty data-type selection", () => {
    const result = validateBackfill(range, []);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("데이터 유형");
  });

  it("rejects a missing date bound", () => {
    expect(validateBackfill({ from: "", to: "2026-05-31" }, ["REVIEW"]).ok).toBe(false);
    expect(validateBackfill({ from: "2026-05-01", to: "" }, ["REVIEW"]).ok).toBe(false);
  });

  it("rejects an inverted range", () => {
    const result = validateBackfill({ from: "2026-05-31", to: "2026-05-01" }, ["REVIEW"]);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("늦을 수 없습니다");
  });

  it("accepts a valid selection (incl. a single-day range)", () => {
    expect(validateBackfill(range, ["REVIEW", "INQUIRY"]).ok).toBe(true);
    expect(validateBackfill({ from: "2026-05-10", to: "2026-05-10" }, ["ORDER_SUMMARY"]).ok).toBe(true);
  });
});
