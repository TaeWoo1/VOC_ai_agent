import { describe, expect, it } from "vitest";
import {
  collectionLines,
  hasAnythingToShow,
  preparedLine,
  problemLine,
  reviewWorkLine,
  watchLine,
} from "./operationsHome";
import type {
  ChannelCoverageRowView,
  HomePreparedWork,
  HomeRepeatedProblems,
  HomeReviewAttention,
} from "./types";

function reviews(over: Partial<HomeReviewAttention> = {}): HomeReviewAttention {
  return { needsAttentionUndecided: 13, needsAttentionTotal: 15, watchTotal: 122, rows: [], ...over };
}
function problems(over: Partial<HomeRepeatedProblems> = {}): HomeRepeatedProblems {
  return { decidable: 1, observing: 19, rows: [], ...over };
}
function prepared(over: Partial<HomePreparedWork> = {}): HomePreparedWork {
  return { reviewRepliesApproved: 4, inquiryDraftsReady: 2, rows: [], ...over };
}
function row(over: Partial<ChannelCoverageRowView> = {}): ChannelCoverageRowView {
  return {
    channelCode: "NAVER",
    channelNameKo: "네이버 스마트스토어",
    dataType: "REVIEW",
    state: "OBSERVED_FRESH",
    supported: true,
    verificationStatus: null,
    connected: true,
    connectionStatus: "CONNECTED",
    routineEnabled: true,
    routinePausedBy: null,
    lastSuccessfulSyncAt: "2026-09-08T03:06:57Z",
    rows: 100,
    openRows: 3,
    newestObservedAt: "2026-09-08T03:00:00Z",
    ...over,
  } as ChannelCoverageRowView;
}

describe("지금 확인할 리뷰", () => {
  it("asks for work using the undecided count, not the tier's size", () => {
    expect(reviewWorkLine(reviews())).toContain("13건");
    expect(reviewWorkLine(reviews())).not.toContain("15건");
  });

  /**
   * A tier is a read-time function of the review, so deciding one does not change it. Reporting the
   * tier as the work number would keep asking for work already finished — the finished state gets its
   * own sentence instead of silence, which would read as 「읽지 못했다」.
   */
  it("says the work is finished when the tier is decided rather than repeating its size", () => {
    const line = reviewWorkLine(reviews({ needsAttentionUndecided: 0 }));
    expect(line).toContain("모두 판단하셨습니다");
    expect(line).not.toMatch(/\d/);
  });

  it("says plainly when the tier itself is empty", () => {
    expect(reviewWorkLine(reviews({ needsAttentionUndecided: 0, needsAttentionTotal: 0 })))
      .toBe("지금 확인이 필요한 리뷰는 없습니다.");
  });

  /**
   * WATCH is an observation, never a task, and never added to the work number. It is also not printed
   * at zero: a row reading 「지켜보는 리뷰 0건」 is the screen filling space.
   */
  it("states 지켜보기 apart from the work, and not at all when there is none", () => {
    expect(watchLine(reviews())).toContain("122건");
    expect(watchLine(reviews())).toContain("반복 문제로 모입니다");
    expect(watchLine(reviews({ watchTotal: 0 }))).toBeNull();
  });

  it("never adds the two review numbers together", () => {
    const all = `${reviewWorkLine(reviews())} ${watchLine(reviews())}`;
    // 13 + 122 = 135, and 15 + 122 = 137. Neither is a thing anybody counted.
    expect(all).not.toContain("135");
    expect(all).not.toContain("137");
  });
});

describe("반복 문제", () => {
  it("asks only about problems that are somebody's move", () => {
    expect(problemLine(problems())).toContain("1건");
    expect(problemLine(problems())).not.toContain("19건");
  });

  /**
   * 관찰 중 is stated, never drawn as pending work. Measured on this org: 19 observed against one
   * that is anybody's move — a line reading 「반복 문제 20건」 beside a task list would make twenty
   * observations look like twenty jobs.
   */
  it("reports 관찰 중 as watching, and only once nothing needs a decision", () => {
    const line = problemLine(problems({ decidable: 0 }));
    expect(line).toContain("판단이 필요한 반복 문제는 없습니다");
    expect(line).toContain("19건을 지켜보고 있습니다");
  });

  it("says nothing has gathered when there is nothing", () => {
    expect(problemLine(problems({ decidable: 0, observing: 0 }))).toBe("아직 모인 반복 문제가 없습니다.");
  });
});

describe("준비된 작업", () => {
  /**
   * The two counts are joined, never summed: 「4건」과 「2건」은 사실 둘이고 「6건」은 아무도 읽지 않은
   * 셋째다.
   */
  it("names each prepared record separately and never totals them", () => {
    const line = preparedLine(prepared()) ?? "";
    expect(line).toContain("승인하신 리뷰 답변 4건");
    expect(line).toContain("초안이 준비된 문의 2건");
    expect(line).not.toContain("6건");
  });

  it("returns nothing when nothing is prepared, so the area cannot grow to fill space", () => {
    expect(preparedLine(prepared({ reviewRepliesApproved: 0, inquiryDraftsReady: 0 }))).toBeNull();
  });
});

describe("최근 수집 상태", () => {
  it("collapses a channel's types into one line and reports the newest success", () => {
    const lines = collectionLines([
      row({ dataType: "REVIEW", lastSuccessfulSyncAt: "2026-09-05T00:00:00Z" }),
      row({ dataType: "INQUIRY", lastSuccessfulSyncAt: "2026-09-08T03:06:57Z" }),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].sentence).toBe("마지막 수집 2026-09-08");
    expect(lines[0].warn).toBe(false);
  });

  /**
   * A channel is described by its worst state — a seller asking 「수집이 잘 되고 있나」 needs to hear
   * about the type that is not. Averaging three states would produce a fourth nobody computed.
   */
  it("lets the channel's worst state speak", () => {
    const lines = collectionLines([
      row({ dataType: "REVIEW", state: "OBSERVED_FRESH" }),
      row({ dataType: "INQUIRY", state: "BLOCKED" }),
    ]);
    expect(lines[0].sentence).toContain("지금은 수집하지 못하고 있습니다");
    expect(lines[0].warn).toBe(true);
  });

  it("marks unproven freshness without calling it a failure", () => {
    const lines = collectionLines([row({ state: "OBSERVED_FRESHNESS_UNPROVEN" })]);
    expect(lines[0].sentence).toContain("최신 여부를 확인하지 못했습니다");
    expect(lines[0].warn).toBe(true);
    expect(lines[0].sentence).not.toContain("실패");
  });

  it("tells an unconnected channel apart from one that has collected nothing", () => {
    expect(collectionLines([row({ connected: false })])[0].sentence)
      .toBe("아직 연결되지 않았습니다.");
    expect(collectionLines([row({ lastSuccessfulSyncAt: null })])[0].sentence)
      .toBe("아직 가져온 기록이 없습니다.");
  });

  /**
   * No provider technical name reaches a seller sentence — no connector class, no data-type token,
   * no error code. The channel's own Korean name and a date are all these lines carry.
   */
  it("never leaks a technical name into the sentence", () => {
    const lines = collectionLines([
      row({ state: "BLOCKED" }),
      row({ dataType: "ORDER_SUMMARY", channelCode: "CAFE24", channelNameKo: "카페24" }),
    ]);
    for (const line of lines) {
      expect(line.sentence).not.toMatch(/NAVER|CAFE24|COUPANG|ORDER_SUMMARY|INQUIRY|REVIEW|Connector|GW\./);
    }
  });

  it("skips a data type the channel does not offer rather than reporting it as missing", () => {
    expect(collectionLines([row({ supported: false })])).toHaveLength(0);
  });
});

describe("whether to draw the areas at all", () => {
  /**
   * Four empty headings on a fresh account would describe a product the seller has not started using.
   */
  it("has nothing to show for an account with no work and no connection", () => {
    expect(hasAnythingToShow(
      reviews({ needsAttentionUndecided: 0, needsAttentionTotal: 0, watchTotal: 0 }),
      problems({ decidable: 0, observing: 0 }),
      prepared({ reviewRepliesApproved: 0, inquiryDraftsReady: 0 }),
      [row({ connected: false })],
    )).toBe(false);
  });

  it("draws once anything at all is true — including a merely connected channel", () => {
    expect(hasAnythingToShow(
      reviews({ needsAttentionUndecided: 0, needsAttentionTotal: 0, watchTotal: 0 }),
      problems({ decidable: 0, observing: 0 }),
      prepared({ reviewRepliesApproved: 0, inquiryDraftsReady: 0 }),
      [row()],
    )).toBe(true);
  });
});
