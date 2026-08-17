import { describe, expect, it } from "vitest";
import { isProductChannel, PRODUCT_CHANNEL_CODES, visibleChannels } from "./productChannels";
import { mockChannels } from "./mocks";

describe("productChannels — the seller-visible channel set", () => {
  it("is exactly NAVER / COUPANG / CAFE24", () => {
    expect([...PRODUCT_CHANNEL_CODES]).toEqual(["NAVER", "COUPANG", "CAFE24"]);
    expect(isProductChannel("NAVER")).toBe(true);
    expect(isProductChannel("GMARKET")).toBe(false);
    expect(isProductChannel(null)).toBe(false);
    expect(isProductChannel(undefined)).toBe(false);
  });

  it("narrows the demo catalog to the three product channels, keeping catalog order", () => {
    const codes = visibleChannels(mockChannels()).map((c) => c.code);
    expect(codes).toEqual(["COUPANG", "NAVER", "CAFE24"]);
  });
});
