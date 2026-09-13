import { describe, expect, it } from "vitest";
import { hasAnyConnectedChannel, homeFirstUseState } from "./homeFirstUse";
import type { ChannelMetricRow } from "./types";

/**
 * One channel row. `connected` is the SERVER's account fact and is now a parameter rather than
 * something these states imply — Data-bearing Channel Home v1 separated the two, because a row can
 * exist with nothing connected (an uploaded review) and a connection can exist with no rows.
 * `connectable` defaults true: these fixtures are the product's own three unless a test says otherwise.
 */
function row(orderState: string, inquiryState: string, reviewState: string,
             connected = true): ChannelMetricRow {
  return {
    channelCode: "X",
    channelNameKo: "채널",
    connected,
    connectable: true,
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

describe("hasAnyConnectedChannel — the account fact, not an inference from data states", () => {
  it("a brand-new account has connected nothing", () => {
    expect(
      hasAnyConnectedChannel([
        row("NOT_CONNECTED", "NOT_CONNECTED", "NOT_SUPPORTED", false),
        row("NOT_CONNECTED", "NOT_CONNECTED", "NOT_CONNECTED", false),
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

  /**
   * The reason this stopped being derived from the enums. A held row now survives the connection
   * branch of `ChannelCoverageService.stateOf` (an uploaded review is real whether or not anything
   * was connected), so `OBSERVED_FRESHNESS_UNPROVEN` no longer implies an account — and reading it as
   * one would tell a seller they had connected a channel they never connected.
   */
  it("rows without a connection are rows, not a connection", () => {
    expect(hasAnyConnectedChannel([
      { ...row("NOT_CONNECTED", "NOT_CONNECTED", "OBSERVED_FRESHNESS_UNPROVEN", false), reviews: 2 },
    ])).toBe(false);
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
    expect(homeFirstUseState([row("NOT_CONNECTED", "NOT_CONNECTED", "NOT_SUPPORTED", false)]).kind)
      .toBe("NO_CHANNEL");
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

  /**
   * Agent-native Core Boundary v1 — a review can arrive without a connection.
   *
   * `POST /api/uploads` is addressed by channel and takes no seller account, so a manual CSV and a
   * seller-center export land on a channel whose coverage row truthfully says `NOT_CONNECTED` while
   * carrying rows. Measured 2026-09-13: an org with two uploaded Cafe24 reviews reported
   * `reviews=2, reviewState=NOT_CONNECTED` and this derivation answered `NO_CHANNEL`, so the home
   * told a seller with work waiting that they had not started.
   */
  /**
   * A channel nobody connected, carrying rows this org uploaded — the measured shape.
   *
   * The review state is `OBSERVED_FRESHNESS_UNPROVEN` because that is now what the server says for
   * rows held without a connection: they are real and their freshness cannot be proven. `connected`
   * is false, which is the separate fact.
   */
  const uploadedOnto = (reviews: number): ChannelMetricRow =>
    ({ ...row("NOT_CONNECTED", "NOT_CONNECTED",
              reviews > 0 ? "OBSERVED_FRESHNESS_UNPROVEN" : "NOT_CONNECTED", false),
       reviews }) as ChannelMetricRow;

  it("is WORKING when rows are held and nothing is connected — an upload is not a connection", () => {
    const state = homeFirstUseState([uploadedOnto(2), row("NOT_CONNECTED", "NOT_CONNECTED", "NOT_SUPPORTED", false)]);
    expect(state.kind).toBe("WORKING");
    // And still no connections: the list is of connections, and there are none to name.
    expect(state.connected).toEqual([]);
  });

  it("still says NO_CHANNEL when nothing is connected AND nothing is held", () => {
    expect(homeFirstUseState([uploadedOnto(0)]).kind).toBe("NO_CHANNEL");
  });

  it("keeps 「연결된 채널이 없습니다」 truthful — holding uploads is not having connected", () => {
    // The two questions came apart here, so the boolean stops borrowing the first-use kind.
    expect(hasAnyConnectedChannel([uploadedOnto(2)])).toBe(false);
  });
});
