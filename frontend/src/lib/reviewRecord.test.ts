// The shared answer to "does this channel keep a 상품평 record, and where is it". Two surfaces read
// it — the channel list and the channel workspace — so these are the rules that keep them agreeing.
import { describe, it, expect } from "vitest";
import {
  hasReviewRecord,
  reviewEntryLabel,
  reviewRecordPath,
  reviewRecordSummary,
} from "./reviewRecord";

describe("hasReviewRecord", () => {
  it("is true for each product channel — every one keeps a review record", () => {
    for (const code of ["NAVER", "COUPANG", "CAFE24"]) {
      expect(hasReviewRecord(code)).toBe(true);
    }
  });

  it("is false for every other channel, and for a channel that has not loaded", () => {
    for (const code of ["GMARKET", "ESM", "", "coupang"]) {
      expect(hasReviewRecord(code)).toBe(false);
    }
    expect(hasReviewRecord(null)).toBe(false);
    expect(hasReviewRecord(undefined)).toBe(false);
  });
});

describe("reviewRecordPath", () => {
  it("is the 리뷰 surface, keyed by account", () => {
    expect(reviewRecordPath("acc-1")).toBe("/reviews/acc-1");
  });
});

describe("reviewEntryLabel", () => {
  it("carries the count when the count is known, in the product's word", () => {
    expect(reviewEntryLabel(22)).toBe("리뷰 22개 보기");
    expect(reviewEntryLabel(22, "NAVER")).toBe("리뷰 22개 보기");
  });

  it("uses the channel's own word where it has one (Coupang: 상품평)", () => {
    expect(reviewEntryLabel(22, "COUPANG")).toBe("상품평 22개 보기");
  });

  it("says zero rather than hiding an empty record", () => {
    expect(reviewEntryLabel(0)).toBe("리뷰 0개 보기");
  });

  it("drops the number when it is unknown, and never invents a zero", () => {
    for (const unknown of [null, undefined, Number.NaN, -1, 1.5]) {
      expect(reviewEntryLabel(unknown)).toBe("리뷰 보기");
    }
  });
});

describe("reviewRecordSummary", () => {
  it("states the collected total", () => {
    expect(reviewRecordSummary(22)).toContain("22개");
  });

  it("explains an empty record instead of reading as a failure", () => {
    const empty = reviewRecordSummary(0);
    expect(empty).toContain("아직 수집된 리뷰가 없습니다");
    expect(empty).toContain("수집");
    expect(reviewRecordSummary(0, "COUPANG")).toContain("아직 수집된 상품평이 없습니다");
  });

  it("admits an unreadable count while still promising the list opens", () => {
    const unknown = reviewRecordSummary(null);
    expect(unknown).toContain("확인하지 못했습니다");
    expect(unknown).toContain("목록은 그대로 열 수 있습니다");
  });
});
