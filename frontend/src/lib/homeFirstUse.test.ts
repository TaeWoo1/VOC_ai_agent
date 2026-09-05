import { describe, expect, it } from "vitest";
import { hasAnyConnectedChannel, homeFirstUseState } from "./homeFirstUse";
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

describe("hasAnyConnectedChannel — one derivation, shared with homeFirstUseState (Pilot Readiness Gate v1 §4)", () => {
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

/**
 * <b>The three-state rule, pinned on both sides of the wire.</b>
 *
 * Agent Procedure Layer v1 §3. The same question — «what kind of morning is this?» — is answered here
 * from `metrics.channels` (the numbers this page already holds) and in the runtime from
 * `GET /api/channels/coverage` (`agent-runtime/src/operator/capability/SellerReadiness.ts`). The two
 * derivations cannot share code: `frontend/` and `agent-runtime/` are separate packages with no shared
 * module, and `contracts/` is not built into either. What CAN be shared is the rule, so it is written
 * out here as a table and asserted, and the runtime's own suite asserts the same three rows. A change
 * on one side that breaks the rule fails on that side with the other side named.
 *
 * The rule, in full: nothing connected ⇒ NO_CHANNEL · connected and holding nothing ⇒ NO_DATA ·
 * connected and holding anything ⇒ WORKING. `NOT_SUPPORTED` is never counted as «not connected», and
 * a backlog older than any window is data held.
 */
describe("the three-state rule, shared with agent-runtime's SellerReadiness", () => {
  it("nothing connected ⇒ NO_CHANNEL", () => {
    expect(homeFirstUseState([row("NOT_CONNECTED", "NOT_CONNECTED", "NOT_SUPPORTED")]).kind).toBe("NO_CHANNEL");
  });

  it("connected and holding nothing ⇒ NO_DATA — and NOT_SUPPORTED alone is not disconnection", () => {
    expect(homeFirstUseState([row("ZERO", "ZERO", "NOT_SUPPORTED")]).kind).toBe("NO_DATA");
  });

  it("connected and holding anything ⇒ WORKING, whenever those rows arrived", () => {
    expect(homeFirstUseState([{ ...row("ZERO", "ZERO", "OBSERVED_FRESH"), reviews: 4 }]).kind).toBe("WORKING");
    // The backlog is windowless: an org whose inquiries all predate the window still holds them.
    expect(homeFirstUseState([{ ...row("ZERO", "OBSERVED_FRESH", "NOT_SUPPORTED"), unansweredInquiries: 3 }]).kind)
      .toBe("WORKING");
  });
});
