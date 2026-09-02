// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ReviewListArtifact } from "./ReviewListArtifact";
import type { ReviewListArtifact as ReviewList } from "../../../lib/conversation/types";
import { asOfWord, asOfStatus } from "../../../lib/conversation/asOf";

const list: ReviewList = {
  artifactId: "a-1", type: "REVIEW_LIST", title: "최근 7일 들어온 낮은 평점 리뷰",
  scope: { channelCode: null, period: { from: "2026-08-22", to: "2026-08-29", token: "LAST_7_DAYS" }, rating: "LOW" },
  totalCount: 1,
  items: [{ reviewId: "r-1", accountId: "acc", channelCode: "CAFE24", channelNameKo: "카페24", writtenOn: "2026-08-25", rating: 2, negative: true, preview: "접착이 약해요", productId: null, productName: null, to: "/reviews" }],
  freshness: [
    { channelCode: "CAFE24", channelNameKo: "카페24", state: "OBSERVED_FRESH", verdict: "FRESH", lastSuccessfulSyncAt: new Date().toISOString(), newestObservedAt: null },
    { channelCode: "COUPANG", channelNameKo: "쿠팡", state: "OBSERVED_FRESHNESS_UNPROVEN", verdict: "UNPROVEN", lastSuccessfulSyncAt: "2026-08-20T01:00:00Z", newestObservedAt: null },
    { channelCode: "NAVER", channelNameKo: "네이버", state: "NOT_SUPPORTED", verdict: "NOT_CONNECTED", lastSuccessfulSyncAt: null, newestObservedAt: null },
  ],
  freshnessRequired: false, referenceDate: "2026-08-29",
};

describe("review list — compact 「채널 · 언제 기준」 footer", () => {
  it("renders the rows first and one as-of status per observed channel; no warning prose, no mechanism words", () => {
    render(<MemoryRouter><ReviewListArtifact artifact={list} /></MemoryRouter>);
    expect(screen.getByText("접착이 약해요")).toBeInTheDocument();
    const footer = screen.getByRole("list", { name: "채널별 확인 기준" });
    expect(footer.textContent).toContain("쿠팡 · 8월 20일 기준");
    expect(footer.textContent).toMatch(/카페24 · 오늘 \d{2}:\d{2} 기준/);
    expect(footer.textContent).toContain("네이버연결 안 됨");
    expect(footer.textContent).not.toMatch(/최신 수집 확인 안 됨|이 기간 수집 없음|sync|coverage/i);
  });
  it("asOfWord: today keeps the time, older days drop it, another year names the year, nothing → null", () => {
    const ref = new Date("2026-08-29T03:00:00Z");
    expect(asOfWord("2026-08-29T00:12:00Z", ref)).toBe("오늘 09:12");
    expect(asOfWord("2026-08-28T09:40:00Z", ref)).toBe("어제 18:40");
    expect(asOfWord("2026-08-20T01:00:00Z", ref)).toBe("8월 20일");
    expect(asOfWord("2025-12-30T23:00:00Z", ref)).toBe("2025년 12월 31일");
    expect(asOfWord(null, ref)).toBeNull();
    expect(asOfStatus("네이버", null, ref)).toBe("네이버 · 확인 기록 없음");
  });
});

describe("a review with no words — Outcome Artifact v1 §3", () => {
  const starsOnly = (reviewId: string, rating: number | null, productName: string | null = null): ReviewList["items"][number] => ({
    reviewId, accountId: "acc", channelCode: "CAFE24", channelNameKo: "카페24", writtenOn: "2026-08-25",
    rating, negative: false, preview: null, productId: null, productName, to: "/reviews",
  });

  it("is named by the rating it does have, so two of them are not the same row twice", () => {
    render(<MemoryRouter><ReviewListArtifact artifact={{
      ...list, items: [starsOnly("r-1", 5), starsOnly("r-2", 2), starsOnly("r-3", null)],
    }} /></MemoryRouter>);
    expect(screen.getByText("별점 5점만 남긴 리뷰")).toBeInTheDocument();
    expect(screen.getByText("별점 2점만 남긴 리뷰")).toBeInTheDocument();
    // Nothing to tell it apart by is said plainly rather than pretended.
    expect(screen.getByText("내용 없는 리뷰")).toBeInTheDocument();
    // The rating is now the row's NAME, so the badge that repeated it is gone.
    expect(screen.queryByText("★ 5")).toBeNull();
    expect(screen.queryByText("별점만")).toBeNull();
  });

  it("a list that shares one rating is told apart by the product — said in the name, and not twice", () => {
    render(<MemoryRouter><ReviewListArtifact artifact={{
      ...list, items: [starsOnly("r-1", 5, "전선몰딩 1호"), starsOnly("r-2", 5, "생수컵 디스펜서")],
    }} /></MemoryRouter>);
    expect(screen.getByText("별점 5점만 남긴 리뷰 · 전선몰딩 1호")).toBeInTheDocument();
    expect(screen.getByText("별점 5점만 남긴 리뷰 · 생수컵 디스펜서")).toBeInTheDocument();
    // The product left the meta line rather than being said on both.
    expect(screen.queryByText("전선몰딩 1호")).toBeNull();
  });

  it("a review that HAS words keeps its rating badge beside them", () => {
    render(<MemoryRouter><ReviewListArtifact artifact={list} /></MemoryRouter>);
    expect(screen.getByText("접착이 약해요")).toBeInTheDocument();
    expect(screen.getByText("★ 2")).toBeInTheDocument();
  });
});
