import { describe, expect, it } from "vitest";
import type { AttentionSignal, OperatorVocItem } from "./types";
import {
  PREVIEW_PLACEHOLDER,
  PRODUCT_PLACEHOLDER,
  TRIAGE_OPTIONS,
  UNCLASSIFIED,
  UNCLASSIFIED_LABEL,
  categoryChip,
  facetOptions,
  asTriageDisposition,
  drilldownParams,
  previewText,
  productLabel,
  replyStatusLabel,
  vocItemKey,
} from "./vocItems";

/**
 * An attention signal fixture, on a channel that exists.
 *
 * `channel` is `channel.getNameKo()` resolved upstream, so it can only ever be a catalog
 * string. This said "카페24" — an abbreviation the channels table does not hold (it has
 * "카페24 자사몰"), two lines above the fixture below that argues a fixture is a claim.
 * NAVER, to match the row fixture and the file's subject.
 */
function signal(type: string, sourceType: string): AttentionSignal {
  return {
    type,
    severity: "HIGH",
    count: 1,
    label: type,
    description: "",
    sourceType,
    channel: "네이버 스마트스토어",
  };
}

/**
 * A NAVER review row, source-faithful.
 *
 * This file only exercises `vocItemKey`, which reads `signalType` — but the fixture is kept
 * honest anyway, because a fixture is a claim. It said CAFE24 while carrying a product name
 * and a "UNKNOWN" reply status: `Cafe24VocItemSource` hardcodes productName null, and the
 * community store's status is a real column, never that token. NAVER is the source where a
 * name and a null status are both true.
 */
function item(signalType: string): OperatorVocItem {
  return {
    channelCode: "NAVER",
    channelNameKo: "네이버 스마트스토어",
    sourceType: "REVIEW",
    productName: "가을 니트 가디건 CHARCOAL",
    rating: 2,
    // An export carries no reply state.
    replyStatus: null,
    sourceCreatedDate: "2026-05-10",
    collectedDate: "2026-05-30",
    signalType,
    safePreview: null,
    actionRef: "review:6f1c8b1e-0000-4000-8000-000000000001",
    triageDisposition: null,
    hasReplyPreparation: false,
    category: "배송",
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
    // Null is the ingested-review (NAVER) case — an export carries no reply state, so the
    // source sends null rather than guessing. It lands on the same 상태 미상 chip as an
    // unrecognised token, which is honest for both: the status is not known.
    expect(replyStatusLabel(null)).toEqual(replyStatusLabel("UNKNOWN"));
    expect(replyStatusLabel(null).text).toBe("상태 미상");
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

describe("triage copy", () => {
  it("offers exactly the three dispositions, most-demanding first", () => {
    // Order is the array's, not the enum's — a UI decision, pinned so a backend enum
    // reorder cannot silently reshuffle the operator's buttons. Labels pinned as literals:
    // the backend ships enum NAMES, which are a contract, not copy, so a wording change is
    // a decision that must be visible here.
    expect(TRIAGE_OPTIONS.map((o) => o.value)).toEqual([
      "RESPONSE_NEEDED",
      "MONITOR",
      "NO_ACTION",
    ]);
    expect(TRIAGE_OPTIONS.map((o) => o.label)).toEqual(["대응 필요", "지켜보기", "조치 불필요"]);
  });
});

describe("asTriageDisposition", () => {
  it("accepts exactly the dispositions this client can render", () => {
    for (const option of TRIAGE_OPTIONS) {
      expect(asTriageDisposition(option.value)).toBe(option.value);
    }
  });

  it("rejects anything else, so an unknown value cannot reach the UI as a decision", () => {
    // The failure this prevents is silent: an unrecognised disposition would land in state
    // and render as "판단 전" — no decision at all — after a SUCCESSFUL save, so the
    // operator concludes their click did nothing.
    expect(asTriageDisposition("RESPONSE_NEEDED_LATER")).toBeNull(); // a future value
    expect(asTriageDisposition("response_needed")).toBeNull(); // case matters on the wire
    expect(asTriageDisposition("PROPOSED")).toBeNull(); // the other pipeline's vocabulary
    expect(asTriageDisposition("")).toBeNull();
  });

  it("rejects a missing or non-string value rather than coercing it", () => {
    // A 200 with a malformed body is exactly the case the TypeScript type does not cover:
    // it is a claim about the code, not about the bytes.
    expect(asTriageDisposition(undefined)).toBeNull();
    expect(asTriageDisposition(null)).toBeNull();
    expect(asTriageDisposition(0)).toBeNull();
    expect(asTriageDisposition({ disposition: "MONITOR" })).toBeNull();
  });

  it("derives its accepted set from the options, so the two cannot drift", () => {
    // Not a second hand-written list: a disposition the UI offers but the validator
    // rejects would make the control refuse its own successful writes.
    for (const option of TRIAGE_OPTIONS) {
      expect(asTriageDisposition(option.value)).not.toBeNull();
    }
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

describe("categoryChip", () => {
  it("renders the server's own label — there is no second vocabulary here", () => {
    expect(categoryChip("배송")?.text).toBe("배송");
    expect(categoryChip("기타")?.text).toBe("기타");
  });

  it("renders NOTHING when no analysis exists — not a placeholder, not 기타", () => {
    // Unlike productLabel, whose null still implies a product exists ("상품명 미상" is true),
    // a null category implies nothing at all: the row was simply never analyzed. Any visible
    // fallback would be read as a finding about the review. And it must never borrow 기타,
    // which is a verdict the analyzer actually reached.
    expect(categoryChip(null)).toBeNull();
    expect(categoryChip("")).toBeNull();
    expect(categoryChip("   ")).toBeNull();
  });

  it("still renders an unrecognised value rather than hiding a writer-side bug", () => {
    // It is derived metadata, never customer text, so showing it is safe — and hiding it
    // would make a category the analyzer emits but the facet cannot name invisible on the
    // one surface most likely to reveal it.
    expect(categoryChip("배송지연")?.text).toBe("배송지연");
  });
});

describe("facetOptions", () => {
  it("keeps the server's order and appends the unclassified bucket last", () => {
    // The unclassified bucket is a coverage state, not a subject, so it never interleaves
    // with real categories.
    expect(
      facetOptions([{ category: "배송", count: 2 }, { category: "품질", count: 1 }], 3),
    ).toEqual([
      { value: "배송", label: "배송", count: 2 },
      { value: "품질", label: "품질", count: 1 },
      { value: UNCLASSIFIED, label: UNCLASSIFIED_LABEL, count: 3 },
    ]);
  });

  it("omits empty buckets — the list is this window, not a catalogue", () => {
    expect(facetOptions([{ category: "배송", count: 0 }], 0)).toEqual([]);
  });

  it("offers the unclassified bucket whenever it has rows, so they stay reachable", () => {
    // These are exactly the rows no category filter can ever surface. Without this option an
    // operator who picks any facet has no way back to them except clearing the filter.
    expect(facetOptions([], 4)).toEqual([
      { value: UNCLASSIFIED, label: UNCLASSIFIED_LABEL, count: 4 },
    ]);
  });

  it("keeps an ACTIVE filter visible even when this window has none of it", () => {
    // The drill-down survives a window change, so a category chosen over one window can outlive
    // its rows in the next. Dropping the option would leave an empty list whose only cause is a
    // filter the operator can no longer see — or clear.
    expect(facetOptions([{ category: "품질", count: 2 }], 0, "배송")).toEqual([
      { value: "품질", label: "품질", count: 2 },
      { value: "배송", label: "배송", count: 0 },
    ]);
  });

  it("does not duplicate an active filter that is already present", () => {
    expect(facetOptions([{ category: "배송", count: 2 }], 0, "배송")).toEqual([
      { value: "배송", label: "배송", count: 2 },
    ]);
  });

  it("labels the sentinel with FE-owned copy and never sends that copy as a value", () => {
    // The wire value is the ASCII sentinel; the Korean label is ours. Sending the label back
    // would be an unrecognised category, which the server answers with a 400.
    const [option] = facetOptions([], 1);
    expect(option.value).toBe("unclassified");
    expect(option.label).toBe("분류 전");
  });
});
