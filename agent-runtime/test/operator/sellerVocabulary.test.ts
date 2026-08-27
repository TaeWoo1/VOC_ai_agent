/**
 * TC-ENUM-01/02 — a finding sentence carries seller words for closed backend tokens, and no token at all
 * when the vocabulary does not know one. See `src/operator/sellerVocabulary.ts` for the QA sighting.
 */
import { describe, expect, it } from "vitest";
import { channelLabel, moneyLabel, sellingStatusLabel } from "../../src/operator/sellerVocabulary";

describe("seller-facing vocabulary", () => {
  it("names the channel in Korean when the row carries the name, and falls back to the code", () => {
    expect(channelLabel({ channelCode: "COUPANG", channelNameKo: "쿠팡" })).toBe("쿠팡");
    expect(channelLabel({ channelCode: "COUPANG", channelNameKo: null })).toBe("COUPANG");
  });

  it("formats money with grouping and the currency as a word", () => {
    expect(moneyLabel(14500, "KRW")).toBe("14,500원");
    expect(moneyLabel(14500, null)).toBe("14,500");
    expect(moneyLabel(12.5, "USD")).toBe("12.5 USD");
  });

  it("maps selling status to the same words the product screen uses, and refuses to guess", () => {
    expect(sellingStatusLabel("SELLING")).toBe("판매중");
    expect(sellingStatusLabel("SUSPENDED")).toBe("판매중지·품절");
    expect(sellingStatusLabel("ENDED")).toBe("판매종료");
    expect(sellingStatusLabel("UNKNOWN")).toBeNull();
    expect(sellingStatusLabel("ACTIVE")).toBeNull();
    expect(sellingStatusLabel(null)).toBeNull();
  });
});
