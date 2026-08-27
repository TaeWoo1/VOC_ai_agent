import { describe, expect, it } from "vitest";
import { sourceSummaryHeadline, sourceSummaryLines } from "./firstSourceSummary";
import type { ChannelCoverageRowView, SyncRunView } from "./types";

function coverage(
  dataType: string,
  state: ChannelCoverageRowView["state"],
  rows = 0,
  channelCode = "CAFE24",
): ChannelCoverageRowView {
  return {
    channelCode,
    channelNameKo: "카페24",
    dataType,
    state,
    supported: state !== "NOT_SUPPORTED",
    verificationStatus: null,
    connected: true,
    connectionStatus: "CONNECTED",
    routineEnabled: true,
    routinePausedBy: null,
    lastSuccessfulSyncAt: null,
    rows,
    openRows: null,
    newestObservedAt: null,
  };
}

function run(dataType: string, successRows: number, status = "SUCCESS", finishedAt = "2026-08-27T01:00:00Z"): SyncRunView {
  return {
    id: `run-${dataType}-${finishedAt}`,
    sellerAccountId: "acct-1",
    channelId: "ch-1",
    dataType,
    trigger: "MANUAL",
    attempt: 1,
    rateLimited: false,
    nextRetryAt: null,
    jobType: "SYNC",
    uploadType: null,
    status,
    totalRows: successRows,
    successRows,
    skippedRows: 0,
    failedRows: 0,
    errorMessage: null,
    startedAt: "2026-08-27T00:59:00Z",
    finishedAt,
  };
}

describe("sourceSummaryLines", () => {
  it("prints a number only from a finished run, never from the stored-row count", () => {
    // 4,000 stored rows and no run: the connection cannot claim it fetched them.
    const [line] = sourceSummaryLines([coverage("INQUIRY", "OBSERVED_FRESHNESS_UNPROVEN", 4000)], [], "CAFE24");
    expect(line.tone).toBe("pending");
    expect(line.count).toBeNull();
    expect(line.sentence).toBe("문의는 아직 확인하지 못했습니다.");
  });

  it("counts what the run handed over", () => {
    const [line] = sourceSummaryLines(
      [coverage("INQUIRY", "OBSERVED_FRESH", 9)],
      [run("INQUIRY", 22)],
      "CAFE24",
    );
    expect(line.tone).toBe("collected");
    expect(line.sentence).toBe("문의 22건을 가져왔습니다.");
  });

  it("says 없습니다 only for a measured ZERO", () => {
    const zero = sourceSummaryLines([coverage("REVIEW", "ZERO")], [], "CAFE24");
    expect(zero[0].sentence).toBe("확인된 리뷰가 없습니다.");
    expect(zero[0].tone).toBe("empty");

    const unproven = sourceSummaryLines([coverage("REVIEW", "OBSERVED_FRESHNESS_UNPROVEN")], [], "CAFE24");
    expect(unproven[0].sentence).not.toContain("없습니다");
  });

  it("separates a channel that does not offer the type from one that is blocked", () => {
    const unsupported = sourceSummaryLines([coverage("REVIEW", "NOT_SUPPORTED")], [], "CAFE24");
    expect(unsupported[0].tone).toBe("unsupported");
    expect(unsupported[0].sentence).toContain("제공하지 않습니다");

    const blocked = sourceSummaryLines([coverage("INQUIRY", "BLOCKED")], [], "CAFE24");
    expect(blocked[0].tone).toBe("blocked");
    expect(blocked[0].sentence).toContain("다시 확인");
  });

  it("reads in 주문 → 문의 → 리뷰 order and ignores other channels", () => {
    const lines = sourceSummaryLines(
      [
        coverage("REVIEW", "ZERO"),
        coverage("INQUIRY", "ZERO"),
        coverage("ORDER_SUMMARY", "ZERO"),
        coverage("INQUIRY", "OBSERVED_FRESH", 5, "NAVER"),
      ],
      [],
      "CAFE24",
    );
    expect(lines.map((l) => l.dataType)).toEqual(["ORDER_SUMMARY", "INQUIRY", "REVIEW"]);
  });

  it("uses the newest terminal run when a data type has several", () => {
    const [line] = sourceSummaryLines(
      [coverage("ORDER_SUMMARY", "OBSERVED_FRESH")],
      [run("ORDER_SUMMARY", 3, "SUCCESS", "2026-08-26T01:00:00Z"), run("ORDER_SUMMARY", 14, "PARTIAL", "2026-08-27T01:00:00Z")],
      "CAFE24",
    );
    expect(line.count).toBe(14);
  });

  it("does not describe a data type the backend did not return", () => {
    expect(sourceSummaryLines([], [], "CAFE24")).toEqual([]);
  });
});

describe("sourceSummaryHeadline", () => {
  it("announces collection when something was collected", () => {
    const lines = sourceSummaryLines([coverage("ORDER_SUMMARY", "OBSERVED_FRESH")], [run("ORDER_SUMMARY", 14)], "CAFE24");
    expect(sourceSummaryHeadline("카페24", lines)).toBe("카페24에서 다음 정보를 가져왔습니다.");
  });

  it("never adds two counts together", () => {
    const lines = sourceSummaryLines(
      [coverage("ORDER_SUMMARY", "OBSERVED_FRESH"), coverage("INQUIRY", "OBSERVED_FRESH")],
      [run("ORDER_SUMMARY", 14), run("INQUIRY", 22)],
      "CAFE24",
    );
    const headline = sourceSummaryHeadline("카페24", lines);
    expect(headline).not.toContain("36");
    expect(lines.map((l) => l.count)).toEqual([14, 22]);
  });

  it("does not call an empty first collection a failure", () => {
    const lines = sourceSummaryLines([coverage("ORDER_SUMMARY", "ZERO")], [], "CAFE24");
    expect(sourceSummaryHeadline("카페24", lines)).toContain("연결이 완료되었습니다");
  });
});

describe("a run that brought nothing back", () => {
  it("is a fact about the collection, not about the shop", () => {
    // Observed on the Demo Org, 2026-08-27: this shape printed 「문의 0건을 확인했습니다」 on a
    // completion screen for an org that holds two Coupang inquiries.
    const [line] = sourceSummaryLines(
      [coverage("INQUIRY", "OBSERVED_FRESHNESS_UNPROVEN", 2)],
      [run("INQUIRY", 0)],
      "CAFE24",
    );
    expect(line.sentence).toBe("새로 가져온 문의는 없습니다.");
    expect(line.sentence).not.toContain("문의가 없습니다");
    expect(line.tone).toBe("empty");
  });
});
