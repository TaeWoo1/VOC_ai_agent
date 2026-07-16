import { describe, expect, it } from "vitest";
import type { AttentionSignal, OperatorVocItem } from "./types";
import {
  PREVIEW_PLACEHOLDER,
  PRODUCT_PLACEHOLDER,
  drilldownParams,
  previewText,
  productLabel,
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
    productName: "가을 니트 가디건 CHARCOAL",
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

describe("productLabel", () => {
  it("returns a named product as-is — not truncated, not redacted", () => {
    // productName is seller-authored catalog text with no customer PII, so unlike
    // safePreview it is NOT sanitized on either side. A model number must survive.
    expect(productLabel("가을 니트 가디건 CHARCOAL 2026")).toEqual({
      text: "가을 니트 가디건 CHARCOAL 2026",
      isPlaceholder: false,
    });
  });

  it("returns the frontend-owned placeholder when the product context is null", () => {
    expect(productLabel(null)).toEqual({ text: PRODUCT_PLACEHOLDER, isPlaceholder: true });
    // Pinned as a literal: the copy must say the NAME is unknown, not that the product
    // is absent. The backend's null means "no name available", NOT "no product here",
    // so wording like "상품 미지정" would contradict the contract it renders.
    expect(PRODUCT_PLACEHOLDER).toBe("상품명 미상");
  });

  it("treats a blank name as no name rather than rendering an empty label", () => {
    // The backend contract is a real name or null, never "" — but a blank would
    // otherwise render as an invisible label, which reads as a broken row.
    expect(productLabel("").isPlaceholder).toBe(true);
    expect(productLabel("   ").isPlaceholder).toBe(true);
  });

  it("trims surrounding whitespace so the label cannot render mis-indented", () => {
    expect(productLabel("  리넨 와이드 팬츠 M  ").text).toBe("리넨 와이드 팬츠 M");
  });

  it("is independent of the preview: either can be absent without the other", () => {
    // The two nulls mean different things (no name available vs. suppressed/empty
    // text) and must not be collapsed into one "empty row" state.
    expect(productLabel(null).isPlaceholder).toBe(true);
    expect(previewText("배송 빨라요").isPlaceholder).toBe(false);
    expect(productLabel("리넨 와이드 팬츠 M").isPlaceholder).toBe(false);
    expect(previewText(null).isPlaceholder).toBe(true);
    expect(PRODUCT_PLACEHOLDER).not.toBe(PREVIEW_PLACEHOLDER);
  });
});
