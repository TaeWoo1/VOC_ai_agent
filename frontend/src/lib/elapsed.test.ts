import { describe, expect, it } from "vitest";
import { elapsedSince } from "./elapsed";
import { waitedLabel } from "./inquiryWorkflow";

const NOW = new Date("2026-08-24T12:00:00Z");

/**
 * The two formatters must never put two different NUMBERS on one fact.
 *
 * `relativeTime` reads the clock itself, so it is compared here through the shared ladder rather
 * than by freezing time: what these assert is that both renderers walk the same rungs.
 */
describe("one elapsed ladder", () => {
  it("has a minute rung, which is the one waitedLabel was missing", () => {
    expect(elapsedSince("2026-08-24T11:43:00Z", NOW)).toEqual({ unit: "minute", value: 17 });
    expect(waitedLabel("2026-08-24T11:43:00Z", NOW)).toBe("17분째");
  });

  it("has a week rung, which is the one relativeTime was missing", () => {
    expect(elapsedSince("2026-08-14T12:00:00Z", NOW)).toEqual({ unit: "week", value: 1 });
    expect(waitedLabel("2026-08-14T12:00:00Z", NOW)).toBe("1주째");
  });

  it("floors every rung, so elapsed time is never over-stated", () => {
    expect(elapsedSince("2026-08-23T22:20:00Z", NOW)).toEqual({ unit: "hour", value: 13 });
  });

  it("is null for a future or unparseable instant rather than a negative count", () => {
    expect(elapsedSince("2026-08-25T12:00:00Z", NOW)).toBeNull();
    expect(elapsedSince("not a date", NOW)).toBeNull();
    expect(elapsedSince(null, NOW)).toBeNull();
  });

  it("stops counting past a year, where the number stops being information", () => {
    expect(elapsedSince("2015-03-01T00:00:00Z", NOW)).toEqual({ unit: "overYear", value: 0 });
    expect(waitedLabel("2015-03-01T00:00:00Z", NOW)).toBe("1년 넘음");
  });
});
