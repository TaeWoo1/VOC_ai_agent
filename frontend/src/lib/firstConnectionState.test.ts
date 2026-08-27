import { describe, expect, it } from "vitest";
import { hasAnyConnectedChannel } from "./firstConnectionState";
import type { ChannelMetricRow } from "./types";

function row(orderState: string, inquiryState: string, reviewState: string): ChannelMetricRow {
  return {
    channelCode: "X",
    channelNameKo: "채널",
    orderState,
    revenue: 0,
    orders: 0,
    countedInOrders: false,
    inquiryState,
    inquiries: 0,
    unansweredInquiries: 0,
    countedInInquiries: false,
    reviewState,
    reviews: 0,
    negativeReviews: 0,
    countedInReviews: false,
  } as unknown as ChannelMetricRow;
}

describe("hasAnyConnectedChannel (Pilot Readiness Gate v1 §4)", () => {
  it("a brand-new account — every row NOT_CONNECTED — has connected nothing", () => {
    expect(
      hasAnyConnectedChannel([
        row("NOT_CONNECTED", "NOT_CONNECTED", "NOT_SUPPORTED"),
        row("NOT_CONNECTED", "NOT_CONNECTED", "NOT_CONNECTED"),
        row("NOT_CONNECTED", "NOT_CONNECTED", "NOT_SUPPORTED"),
      ]),
    ).toBe(false);
  });

  it("NOT_SUPPORTED alone is not disconnection — a connected NAVER whose reviews have no path counts", () => {
    expect(hasAnyConnectedChannel([row("OBSERVED_FRESH", "NOT_CONNECTED", "NOT_SUPPORTED")])).toBe(true);
  });

  it("a channel that is connected and returning nothing still counts — ZERO is a reading", () => {
    expect(hasAnyConnectedChannel([row("ZERO", "ZERO", "NOT_SUPPORTED")])).toBe(true);
  });

  it("BLOCKED is a connection with a problem, not an absent connection", () => {
    expect(hasAnyConnectedChannel([row("BLOCKED", "NOT_CONNECTED", "NOT_SUPPORTED")])).toBe(true);
  });

  it("no rows answers false — and the caller uses it only to pick a colour", () => {
    expect(hasAnyConnectedChannel([])).toBe(false);
  });
});
