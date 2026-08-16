// Demo fixtures are a claim about what the product can do.
//
// The capability fixtures made two claims the product cannot back. `mockCapabilityOverview` answered
// every channel outside CAFE24 from one generic shape where REVIEW was `supported: true, CONFIRMED`,
// so demo mode printed 확인됨 for Coupang 상품평 — a data type Coupang publishes no API for. And
// `mockCapabilities` returned `[]` for everyone, which the 수집 설정 section reads as "default-allowed"
// and renders as a switchable cadence, on the two marketplaces that cannot have one.
//
// Both are the overclaiming direction, arriving through a fixture rather than through the model.
import { describe, expect, it } from "vitest";
import { mockCapabilities, mockCapabilityOverview } from "./mocks";

function reviewOf(channelCode: string) {
  const review = mockCapabilityOverview(channelCode).dataTypes.find((d) => d.dataType === "REVIEW");
  if (!review) {
    throw new Error(`the demo overview for ${channelCode} has no REVIEW row at all`);
  }
  return review;
}

describe("demo capability fixtures", () => {
  it("does not claim Coupang 상품평 are collected by an API that does not exist", () => {
    const review = reviewOf("COUPANG");
    expect(review.supported).toBe(false);
    expect(review.verificationStatus).not.toBe("CONFIRMED");
  });

  it("carries the route Coupang 상품평 really arrive by, and the gap that goes with it", () => {
    // Both halves, the same pair the real backend answers with: how they are collected, and what the
    // marketplace never offered. A fixture with only the first is the overclaim in miniature.
    expect(reviewOf("COUPANG").acquisitionPaths).toEqual([
      { method: "ACTION_WINDOW", verificationStatus: "LIVE_PROVEN" },
    ]);
    expect(mockCapabilityOverview("COUPANG").unsupportedScopes).toContainEqual({
      code: "REVIEW_API",
      label: "리뷰 API 없음 (쿠팡 미제공)",
    });
  });

  it("says NAVER 리뷰 are unsupported without inventing a route for them", () => {
    const review = reviewOf("NAVER");
    expect(review.supported).toBe(false);
    // NAVER's supervised review export is a real precedent and is in neither registry. A demo is not
    // where it gets promoted — the honest answer here is 미지원 and nothing more.
    expect(review.acquisitionPaths).toBeUndefined();
    expect(mockCapabilityOverview("NAVER").unsupportedScopes).toEqual([]);
  });

  it("claims for NAVER only the data type its connector actually serves", () => {
    // `NaverApiConnector` serves ORDER_SUMMARY and says so; its own note calls INQUIRY deferred, and
    // the seeded table agrees. 문의 확인됨 was a second overclaim written one line from the one this
    // fixture was being changed to remove.
    const byType = Object.fromEntries(
      mockCapabilityOverview("NAVER").dataTypes.map((d) => [d.dataType, d]),
    );
    expect(byType.ORDER_SUMMARY.verificationStatus).toBe("CONFIRMED");
    expect(byType.INQUIRY.supported).toBe(false);
  });

  it("leaves the one channel whose connector really does serve reviews alone", () => {
    // CAFE24 only. Its review capability is live-verified through the 구매후기 board, which is why it
    // is the single channel allowed to say 확인됨 about reviews here.
    expect(reviewOf("CAFE24").supported).toBe(true);
    expect(reviewOf("CAFE24").verificationStatus).toBe("CONFIRMED");
    // And its documented exclusions are still its own.
    expect(mockCapabilityOverview("CAFE24").unsupportedScopes.map((s) => s.code)).toContain("BOARD_9");
  });

  it("never says 확인됨 for a channel nobody has verified", () => {
    // The generic branch claimed CONFIRMED on all three data types for every remaining channel. None
    // of them has a connector that could produce that: the default resolution is `MockApiConnector`,
    // which supplies no verification map at all, so 확인 필요 is the true answer — and GMARKET's own
    // skeleton connector serves nothing whatsoever.
    for (const code of ["GMARKET", "ELEVENST", "SSG", "LOTTEON"]) {
      const overview = mockCapabilityOverview(code);
      expect(overview.dataTypes).not.toHaveLength(0);
      for (const cap of overview.dataTypes) {
        expect(cap.verificationStatus).not.toBe("CONFIRMED");
      }
    }
  });

  it("stops the demo offering a 리뷰 cadence where none can exist", () => {
    for (const code of ["COUPANG", "NAVER"]) {
      expect(mockCapabilities(code)).toEqual([
        {
          channelCode: code,
          connectorClass: "API",
          dataType: "REVIEW",
          supported: false,
          verificationStatus: "UNSUPPORTED",
          notes: null,
        },
      ]);
    }
  });

  it("keeps the permissive default for every other channel", () => {
    // An empty list means default-allowed, which is what the real table says about a channel it has
    // no rows for. Narrowing that here would gate the demo on a fact nobody asserted.
    expect(mockCapabilities("CAFE24")).toEqual([]);
    expect(mockCapabilities("GMARKET")).toEqual([]);
  });
});
