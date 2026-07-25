import { describe, it, expect } from "vitest";
import {
  discoverAvailableRange,
  readSpanCapMonths,
  type RangeControlProbe,
} from "../../src/naver/available-range-discovery";

const probe = (over: Partial<RangeControlProbe> = {}): RangeControlProbe => ({
  minAttrs: [],
  maxAttrs: [],
  noticeTexts: [],
  ...over,
});

/**
 * Available-range discovery. The load-bearing property is that this module refuses to turn a per-query
 * span cap into a claim about how much history exists — the two facts read almost identically on the page
 * and mean completely different things.
 */
describe("readSpanCapMonths", () => {
  it.each([
    ["조회 기간은 최대 3개월입니다", 3],
    ["최대 6개월까지 조회할 수 있습니다", 6],
    ["3개월 이내로 선택해 주세요", 3],
    ["최대 1년", 12],
    ["2년 이내", 24],
  ])("reads %s as a cap", (text, expected) => {
    expect(readSpanCapMonths([text])).toBe(expected);
  });

  // A bare duration appears in ordinary copy and in product names; treating it as a limit would invent a
  // constraint the marketplace never stated.
  it("ignores a bare duration with no 최대/이내/까지 qualifier", () => {
    expect(readSpanCapMonths(["3개월 사용 후기", "6개월 무이자"])).toBeNull();
  });

  it("takes the tightest cap when several are stated (that is the one that will reject an export)", () => {
    expect(readSpanCapMonths(["최대 1년", "최대 3개월"])).toBe(3);
  });

  it("returns null when no notice states a cap", () => {
    expect(readSpanCapMonths([])).toBeNull();
    expect(readSpanCapMonths(["리뷰 목록", "엑셀 다운로드"])).toBeNull();
  });
});

describe("discoverAvailableRange", () => {
  it("reads the range from date-control min/max bounds", () => {
    expect(discoverAvailableRange(probe({ minAttrs: ["2023-08-01"], maxAttrs: ["2026-07-25"] }))).toEqual({
      evidence: "MACHINE_DISCOVERED",
      availableStart: "2023-08-01",
      availableEnd: "2026-07-25",
      maxSpanMonths: null,
      source: "MIN_MAX_ATTR",
    });
  });

  it("normalizes bound shapes the same way the scope matcher does", () => {
    const v = discoverAvailableRange(probe({ minAttrs: ["2023.08.01"], maxAttrs: ["2026년 7월 25일"] }));
    expect(v.availableStart).toBe("2023-08-01");
    expect(v.availableEnd).toBe("2026-07-25");
  });

  it("takes the earliest lower bound and latest upper bound across several controls", () => {
    const v = discoverAvailableRange(
      probe({ minAttrs: ["2024-01-01", "2023-08-01"], maxAttrs: ["2026-07-01", "2026-07-25"] }),
    );
    expect(v.availableStart).toBe("2023-08-01");
    expect(v.availableEnd).toBe("2026-07-25");
  });

  // The whole point of the module: a 3-month query cap says nothing about a store with three years of
  // history, so it must never become the plan's start date.
  it("does NOT derive a range from a span cap — it reports the cap separately", () => {
    const v = discoverAvailableRange(probe({ noticeTexts: ["조회 기간은 최대 3개월입니다"] }));
    expect(v.evidence).toBe("UNREADABLE");
    expect(v.availableStart).toBeNull();
    expect(v.availableEnd).toBeNull();
    expect(v.maxSpanMonths).toBe(3); // kept, because it bounds how wide each export may be
  });

  it("still reports a span cap alongside a successfully read range", () => {
    const v = discoverAvailableRange(
      probe({ minAttrs: ["2023-08-01"], maxAttrs: ["2026-07-25"], noticeTexts: ["최대 3개월까지 조회"] }),
    );
    expect(v.evidence).toBe("MACHINE_DISCOVERED");
    expect(v.maxSpanMonths).toBe(3);
  });

  it("is UNREADABLE when the controls expose no bounds at all", () => {
    expect(discoverAvailableRange(probe()).evidence).toBe("UNREADABLE");
  });

  // With only a `min` we would have to invent the end — almost certainly "today" — and that invented value
  // would be indistinguishable downstream from a measured one.
  it("is UNREADABLE with only one bound (a half-known range is not a range)", () => {
    expect(discoverAvailableRange(probe({ minAttrs: ["2023-08-01"] })).evidence).toBe("UNREADABLE");
    expect(discoverAvailableRange(probe({ maxAttrs: ["2026-07-25"] })).evidence).toBe("UNREADABLE");
  });

  it("is UNREADABLE when the bounds are inverted (a corrupt read, not a range)", () => {
    const v = discoverAvailableRange(probe({ minAttrs: ["2026-07-25"], maxAttrs: ["2023-08-01"] }));
    expect(v.evidence).toBe("UNREADABLE");
    expect(v.availableStart).toBeNull();
  });

  it("never claims MACHINE_DISCOVERED without both dates present", () => {
    for (const p of [probe(), probe({ minAttrs: ["2023-08-01"] }), probe({ noticeTexts: ["최대 1년"] })]) {
      const v = discoverAvailableRange(p);
      if (v.evidence === "MACHINE_DISCOVERED") {
        expect(v.availableStart).not.toBeNull();
        expect(v.availableEnd).not.toBeNull();
      } else {
        expect(v.availableStart).toBeNull();
        expect(v.availableEnd).toBeNull();
      }
    }
  });

  it("surfaces no page text in its verdict", () => {
    const v = discoverAvailableRange(probe({ noticeTexts: ["조회 기간은 최대 3개월입니다"] }));
    expect(JSON.stringify(v)).not.toContain("조회");
  });
});
