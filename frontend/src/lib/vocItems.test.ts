import { describe, expect, it } from "vitest";
import type { AttentionSignal, OperatorVocItem } from "./types";
import {
  PREVIEW_PLACEHOLDER,
  drilldownParams,
  previewText,
  replyStatusLabel,
  vocItemKey,
} from "./vocItems";

function signal(type: string, sourceType: string): AttentionSignal {
  return { type, severity: "HIGH", count: 1, label: type, description: "", sourceType, channel: "카페24" };
}

function item(signalType: string): OperatorVocItem {
  return {
    channelCode: "CAFE24",
    channelNameKo: "카페24",
    sourceType: "REVIEW",
    rating: 2,
    replyStatus: "UNKNOWN",
    sourceCreatedDate: "2026-05-10",
    collectedDate: "2026-05-30",
    signalType,
    safePreview: null,
  };
}

describe("drilldownParams", () => {
  it("passes the signal TYPE (not sourceType) plus the window", () => {
    const range = { from: "2026-05-01", to: "2026-05-31" };
    expect(drilldownParams(signal("LOW_RATING_REVIEW", "REVIEW"), range)).toEqual({
      type: "LOW_RATING_REVIEW",
      from: "2026-05-01",
      to: "2026-05-31",
    });
  });

  it("distinguishes two signals that share a sourceType", () => {
    const range = { from: "a", to: "b" };
    expect(drilldownParams(signal("LOW_RATING_REVIEW", "REVIEW"), range).type).toBe("LOW_RATING_REVIEW");
    expect(drilldownParams(signal("NEW_REVIEW", "REVIEW"), range).type).toBe("NEW_REVIEW");
  });

  it("routes each spike type to its own drill-down, never colliding", () => {
    const range = { from: "2026-06-20", to: "2026-06-26" };
    // The two spike lenses are distinct TYPES (not one type + sourceType), so the
    // type-only drill-down stays unambiguous and the list keys cannot collide.
    const review = drilldownParams(signal("RECENT_REVIEW_SPIKE_CANDIDATE", "REVIEW"), range);
    const inquiry = drilldownParams(signal("RECENT_INQUIRY_SPIKE_CANDIDATE", "INQUIRY"), range);
    expect(review.type).toBe("RECENT_REVIEW_SPIKE_CANDIDATE");
    expect(inquiry.type).toBe("RECENT_INQUIRY_SPIKE_CANDIDATE");
    expect(review.type).not.toBe(inquiry.type);
  });
});

describe("vocItemKey", () => {
  it("is unique across pages and indexes", () => {
    const it0 = item("NEW_REVIEW");
    expect(vocItemKey(it0, 0, 0)).toBe("NEW_REVIEW-0-0");
    expect(vocItemKey(it0, 1, 0)).not.toBe(vocItemKey(it0, 0, 0));
    expect(vocItemKey(it0, 0, 1)).not.toBe(vocItemKey(it0, 0, 0));
  });
});

describe("replyStatusLabel", () => {
  it("maps known statuses", () => {
    expect(replyStatusLabel("PENDING").text).toBe("미답변");
    expect(replyStatusLabel("ANSWERED").text).toBe("답변 완료");
  });

  it("falls back to UNKNOWN for an unrecognized status", () => {
    expect(replyStatusLabel("WHATEVER")).toEqual(replyStatusLabel("UNKNOWN"));
  });
});

describe("previewText", () => {
  it("returns the sanitized preview when present", () => {
    expect(previewText("배송 빨라요 [전화번호] 문의")).toEqual({
      text: "배송 빨라요 [전화번호] 문의",
      isPlaceholder: false,
    });
  });

  it("returns the placeholder when null", () => {
    expect(previewText(null)).toEqual({ text: PREVIEW_PLACEHOLDER, isPlaceholder: true });
  });

  it("returns the placeholder when empty or whitespace", () => {
    expect(previewText("").isPlaceholder).toBe(true);
    expect(previewText("   ").isPlaceholder).toBe(true);
  });
});
