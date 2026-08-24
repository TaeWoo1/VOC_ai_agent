import { describe, expect, it } from "vitest";

import {
  channelBreakdown, coverageSentence, crossChannelTotal, hasObservations, mayClaimCurrent,
  mayReportAbsence, totalQualifier, withTopic,
} from "../../src/operator/group/ChannelCoverage";
import { combineDimensions, groupsBy } from "../../src/operator/group/ProductGrouping";
import { groupingLimitSentence, groupingSupportOf } from "../../src/operator/tools/ToolReachability";
import type { ChannelCoverageRow, ChannelDataState } from "../../src/spring/types";

/**
 * The freshness axis, and the one sentence it exists to make impossible.
 *
 * <b>The case these tests are written from is real and dated.</b> On 2026-08-24 NAVER 문의 was
 * live-proven on two official Commerce API resources — 18 REAL rows, 100% product attribution — and
 * hours later its first routine run was refused at token issuance. From that evening on, exactly two
 * sentences about NAVER 문의 are false and one is true, and a runtime with a single word for "no data"
 * can only produce the false ones.
 */
const ALL_STATES: ChannelDataState[] = [
  "OBSERVED_FRESH", "OBSERVED_FRESHNESS_UNPROVEN", "ZERO", "NOT_SUPPORTED", "NOT_CONNECTED", "BLOCKED",
];

function row(over: Partial<ChannelCoverageRow> = {}): ChannelCoverageRow {
  return {
    channelCode: "NAVER",
    channelNameKo: "네이버 스마트스토어",
    dataType: "INQUIRY",
    state: "OBSERVED_FRESH",
    supported: true,
    verificationStatus: "CONFIRMED",
    connected: true,
    connectionStatus: "CONNECTED",
    routineEnabled: true,
    routinePausedBy: null,
    lastSuccessfulSyncAt: "2026-08-24T05:00:00Z",
    rows: 18,
    openRows: 0,
    newestObservedAt: "2026-08-19T02:00:00Z",
    ...over,
  };
}

describe("absence is a claim", () => {
  it("only a measured zero licenses 없습니다", () => {
    // The rule, stated once so it cannot drift: five of six states mean "we cannot see", and
    // "we cannot see" is not evidence that nothing is there.
    for (const state of ALL_STATES) {
      expect(mayReportAbsence(state), state).toBe(state === "ZERO");
    }
  });

  it("no coverage sentence asserts an absence from a state that cannot prove one", () => {
    // <b>"확인할 수 없습니다" is not "없습니다".</b> One says we could not look, the other says we
    // looked and there is nothing — and the first assertion this test carried failed to tell them
    // apart, which is the same conflation the whole module is about, committed in the test. So the
    // rule is stated as the two shapes: only ZERO may claim the data is absent, and any other
    // sentence containing the word must be reporting an INABILITY.
    const ABSENCE = /(?<!확인할 수 )없습니다/;
    for (const state of ALL_STATES) {
      const sentence = coverageSentence(row({ state, rows: state === "ZERO" ? 0 : 3 }));
      expect(ABSENCE.test(sentence), `${state}: ${sentence}`).toBe(mayReportAbsence(state));
    }
  });

  it("a channel we have never read is not a channel with nothing in it", () => {
    const sentence = coverageSentence(
      row({ state: "OBSERVED_FRESHNESS_UNPROVEN", rows: 0, routineEnabled: false }),
    );
    // The distinction in one clause. Without it "아직 수집하지 못했습니다" would be heard as "0건".
    expect(sentence).toContain("0건이라는 뜻이 아닙니다");
  });
});

describe("the NAVER 문의 case, both halves at once", () => {
  const stalled = row({
    state: "OBSERVED_FRESHNESS_UNPROVEN",
    routineEnabled: false,
    routinePausedBy: "OPERATOR",
    rows: 18,
    newestObservedAt: "2026-08-19T02:00:00Z",
  });

  it("says the rows exist AND that they may not be current", () => {
    const sentence = coverageSentence(stalled);
    expect(sentence).toContain("수집된 이력이 있지만");
    expect(sentence).toContain("18건");
    expect(sentence).toContain("2026-08-19");
    expect(sentence).toContain("최신인지 확인하지 못했습니다");
  });

  it("never calls a live-proven channel unsupported", () => {
    // The sentence the old vocabulary would have produced, and the one thing this row must never say.
    expect(coverageSentence(stalled)).not.toMatch(/제공하지 않습니다/);
    expect(stalled.supported).toBe(true);
  });

  it("its rows may be cited, and may not be called the current state", () => {
    expect(hasObservations(stalled.state)).toBe(true);
    expect(mayClaimCurrent(stalled.state)).toBe(false);
  });

  it("tells the seller whether waiting will fix it", () => {
    // A schedule the RUNTIME paused resumes on reconnect; one a PERSON paused does not. Reporting both
    // as "멈춰 있습니다" would tell a seller to wait for something that will never happen by itself.
    expect(coverageSentence({ ...stalled, routinePausedBy: "OPERATOR" }))
      .toContain("자동 수집이 꺼져 있어");
    expect(coverageSentence({ ...stalled, routinePausedBy: "SYSTEM" }))
      .toContain("자동 수집이 아직 켜져 있지 않아");
  });
});

describe("each state sends the seller somewhere different", () => {
  it("unsupported, unconnected and blocked are three sentences, not one", () => {
    const unsupported = coverageSentence(row({ state: "NOT_SUPPORTED", supported: false }));
    const unconnected = coverageSentence(row({ state: "NOT_CONNECTED", connected: false }));
    const blocked = coverageSentence(row({ state: "BLOCKED", connectionStatus: "RECONNECT_REQUIRED" }));
    expect(new Set([unsupported, unconnected, blocked]).size).toBe(3);
    // And each names its own remedy, or the difference is decorative.
    expect(unsupported).toContain("채널 자체의 한계");
    expect(unconnected).toContain("연결되어 있지 않아");
    expect(blocked).toContain("다시 연결해 주세요");
  });
});

describe("the breakdown keeps every channel", () => {
  const coverage: ChannelCoverageRow[] = [
    row({ channelCode: "NAVER", state: "OBSERVED_FRESHNESS_UNPROVEN", rows: 18, openRows: 0 }),
    row({ channelCode: "COUPANG", channelNameKo: "쿠팡", state: "OBSERVED_FRESH", rows: 5, openRows: 2 }),
    row({ channelCode: "CAFE24", channelNameKo: "카페24", state: "NOT_CONNECTED", connected: false,
          rows: 0, openRows: 0 }),
    row({ channelCode: "NAVER", dataType: "REVIEW", state: "NOT_SUPPORTED", supported: false, rows: 0 }),
  ];

  it("a channel with nothing is a row, not an omission", () => {
    const rows = channelBreakdown(coverage, "INQUIRY");
    expect(rows.map((r) => r.channelCode)).toEqual(["NAVER", "COUPANG", "CAFE24"]);
    // The one that matters: an omitted channel is counted as a zero by anything that counts what it
    // was given, which is the same false calm one layer up.
    expect(rows.find((r) => r.channelCode === "CAFE24")!.countable).toBe(false);
  });

  it("scope is not breakdown — a scoped question gets one channel", () => {
    expect(channelBreakdown(coverage, "INQUIRY", "NAVER").map((r) => r.channelCode)).toEqual(["NAVER"]);
    expect(channelBreakdown(coverage, "INQUIRY", "naver")).toHaveLength(1);
  });

  it("a data type is never mixed with another", () => {
    const reviews = channelBreakdown(coverage, "REVIEW");
    expect(reviews).toHaveLength(1);
    expect(reviews[0]!.state).toBe("NOT_SUPPORTED");
  });
});

describe("a cross-channel total carries its own qualifier", () => {
  const rows = channelBreakdown([
    row({ channelCode: "NAVER", state: "OBSERVED_FRESHNESS_UNPROVEN", rows: 18, openRows: 0 }),
    row({ channelCode: "COUPANG", channelNameKo: "쿠팡", state: "OBSERVED_FRESH", rows: 5, openRows: 2 }),
    row({ channelCode: "CAFE24", channelNameKo: "카페24", state: "NOT_CONNECTED", connected: false,
          rows: 0, openRows: 0 }),
  ], "INQUIRY");

  it("adds only what could be counted, and says what it left out and why", () => {
    const total = crossChannelTotal(rows);
    expect(total.total).toBe(23);
    expect(total.openTotal).toBe(2);
    expect(total.complete).toBe(false);
    const qualifier = totalQualifier(total)!;
    // Named channels, named reasons: "일부 채널 제외" is not actionable and this is.
    expect(qualifier).toContain("카페24(미연결)");
    expect(qualifier).toContain("네이버");
    expect(qualifier).toContain("최신 여부를 확인하지 못했습니다");
  });

  it("a complete total says nothing extra", () => {
    const clean = channelBreakdown([
      row({ channelCode: "NAVER", state: "OBSERVED_FRESH", rows: 18, openRows: 1 }),
      row({ channelCode: "COUPANG", channelNameKo: "쿠팡", state: "ZERO", rows: 0, openRows: 0 }),
    ], "INQUIRY");
    const total = crossChannelTotal(clean);
    expect(total.complete).toBe(true);
    expect(totalQualifier(total)).toBeNull();
  });

  it("an unsupported channel's zero never joins the sum", () => {
    const withGap = channelBreakdown([
      row({ channelCode: "NAVER", state: "OBSERVED_FRESH", dataType: "REVIEW", rows: 12, openRows: 3 }),
      row({ channelCode: "COUPANG", channelNameKo: "쿠팡", dataType: "REVIEW", state: "NOT_SUPPORTED",
            supported: false, rows: 0, openRows: 0 }),
    ], "REVIEW");
    const total = crossChannelTotal(withGap);
    expect(total.total).toBe(12);
    // Adding a 0 would produce the same number and a different meaning: a sum that reads as complete.
    expect(total.complete).toBe(false);
    expect(total.excluded.map((e) => e.state)).toEqual(["NOT_SUPPORTED"]);
  });
});

describe("the axes are declared, including where they cross and fail", () => {
  it("the channel axis is answerable where a per-channel read exists, and only there", () => {
    expect(groupingSupportOf("INQUIRY_VOLUME", "CHANNEL")).toBe("SUPPORTED");
    expect(groupingSupportOf("REVIEW_SIGNAL", "CHANNEL")).toBe("SUPPORTED");
    // A repeat is a signature cluster and carries neither product nor channel — same fact, both axes.
    expect(groupingSupportOf("REPEAT_PATTERN", "CHANNEL")).toBe("NO_CHANNEL_ATTRIBUTION");
    expect(groupingSupportOf("REPEAT_PATTERN", "PRODUCT")).toBe("NO_PRODUCT_ATTRIBUTION");
  });

  it("both axes working does not make their cross work", () => {
    // REVIEW_SIGNAL is SUPPORTED on each axis alone and unsupported on the cross: the reads that
    // attribute evidence to a product return a product id and a count and no channel, and a product's
    // listings say where it is SOLD, not where a given review arrived from.
    expect(groupingSupportOf("REVIEW_SIGNAL", "PRODUCT")).toBe("SUPPORTED");
    expect(groupingSupportOf("REVIEW_SIGNAL", "CHANNEL")).toBe("SUPPORTED");
    expect(groupingSupportOf("REVIEW_SIGNAL", "PRODUCT_CHANNEL")).toBe("NO_CHANNEL_ATTRIBUTION");
  });

  it("the cross failure gets its own sentence, not the product one", () => {
    const cross = groupingLimitSentence("REVIEW_SIGNAL", "NO_CHANNEL_ATTRIBUTION")!;
    expect(cross).toContain("상품과 채널을 교차해서 나눌 수 없습니다");
    // And it is not the same sentence as the product-axis failure, or the seller cannot tell which
    // axis is missing — which is the whole reason the vocabulary is closed.
    expect(cross).not.toEqual(groupingLimitSentence("REVIEW_SIGNAL", "NO_PRODUCT_ATTRIBUTION"));
  });
});

describe("the sentences read like Korean", () => {
  it("the topic particle agrees with the noun", () => {
    // Live 2026-08-24 the total qualifier printed "쿠팡는". Small, and the kind of seam that makes a
    // generated answer read as generated to the seller it is written for.
    expect(withTopic("쿠팡")).toBe("쿠팡은");
    expect(withTopic("네이버 스마트스토어")).toBe("네이버 스마트스토어는");
    expect(withTopic("카페24 자사몰")).toBe("카페24 자사몰은");
    // A latin code or a digit takes the default rather than guessing at its pronunciation.
    expect(withTopic("CAFE24")).toBe("CAFE24는");
  });

  it("no coverage sentence leaves a mis-agreeing particle", () => {
    for (const state of ALL_STATES) {
      const sentence = coverageSentence(row({ channelNameKo: "쿠팡", state, rows: state === "ZERO" ? 0 : 3 }));
      expect(sentence, state).not.toContain("쿠팡는");
    }
  });
});

describe("the channel axis is not the channel scope", () => {
  it("both axes can be on at once", () => {
    expect(combineDimensions(true, true)).toBe("PRODUCT_CHANNEL");
    expect(groupsBy("PRODUCT_CHANNEL", "PRODUCT")).toBe(true);
    expect(groupsBy("PRODUCT_CHANNEL", "CHANNEL")).toBe(true);
  });

  it("one axis being off never turns the other off", () => {
    expect(groupsBy("CHANNEL", "PRODUCT")).toBe(false);
    expect(groupsBy("CHANNEL", "CHANNEL")).toBe(true);
    expect(groupsBy("PRODUCT", "CHANNEL")).toBe(false);
    expect(groupsBy("NONE", "PRODUCT")).toBe(false);
  });
});
