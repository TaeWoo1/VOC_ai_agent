import { describe, expect, it } from "vitest";
import { canPublishReply, publishUnavailableReason } from "./inquiryPublish";
import type { InquiryDetail, InquiryReplyCapabilityView, PublishCapabilityView } from "./types";

/**
 * What a seller is told when SellerOps will not press send for them.
 *
 * The sentence matters more than it looks. A seller told "네이버는 지원하지 않습니다" concludes their
 * channel cannot do this and stops asking — but NAVER publishes answer endpoints and the refusal is
 * entirely SellerOps'. The audited capability row is what keeps those two apart, and this is where it
 * reaches the screen.
 */
function capability(over: Partial<PublishCapabilityView> = {}): PublishCapabilityView {
  return { executionEnabled: true, replyAdapterChannelCodes: ["GMARKET"], ...over };
}

function audited(over: Partial<InquiryReplyCapabilityView>): InquiryReplyCapabilityView {
  return {
    channelCode: "NAVER",
    sourceSubtype: null,
    transport: "PLATFORM_SUPPORTED_NOT_IMPLEMENTED",
    reasonKo: "네이버는 상품 문의 답변 등록 API를 제공하지만, reviewnary가 아직 연결하지 않았습니다.",
    evidence: "공식: PUT /v1/contents/qnas/{questionId}",
    ...over,
  };
}

function detail(
  over: Partial<InquiryDetail> = {},
): Pick<InquiryDetail, "channelCode" | "channelNameKo" | "replyCapability" | "status"> {
  return {
    channelCode: "NAVER",
    channelNameKo: "네이버",
    replyCapability: null,
    status: "UNANSWERED",
    ...over,
  };
}

describe("publishUnavailableReason", () => {
  it("says whose limitation it is when the audit answered", () => {
    const reason = publishUnavailableReason(
      detail({ replyCapability: audited({ sourceSubtype: "NAVER_PRODUCT_QNA" }) }),
      capability(),
    );
    expect(reason).toContain("reviewnary가 아직 연결하지 않았습니다");
    // The transport name is an internal vocabulary; a seller reads what it means for them.
    expect(reason).not.toContain("PLATFORM_SUPPORTED_NOT_IMPLEMENTED");
  });

  it("keeps a channel-side limitation distinct from our own", () => {
    const reason = publishUnavailableReason(
      detail({
        replyCapability: audited({
          transport: "UNSUPPORTED",
          reasonKo: "톡톡 문의는 커머스 API에 답변 등록 경로가 없습니다.",
        }),
      }),
      capability(),
    );
    expect(reason).toContain("답변 등록 경로가 없습니다");
    expect(reason).not.toContain("아직 연결하지");
  });

  it("does not present an unaudited channel as unsupported", () => {
    const reason = publishUnavailableReason(
      detail({
        channelCode: "CAFE24",
        channelNameKo: "카페24",
        replyCapability: audited({
          channelCode: "CAFE24",
          transport: "NEEDS_VERIFICATION",
          reasonKo: "카페24 문의 답변 등록 경로는 아직 확인하지 않았습니다. 지원하지 않는다는 뜻은 아닙니다.",
        }),
      }),
      capability(),
    );
    expect(reason).toContain("지원하지 않는다는 뜻은 아닙니다");
  });

  it("falls back to the generic sentence when no audit row came back", () => {
    const reason = publishUnavailableReason(detail(), capability());
    expect(reason).toContain("판매자센터에서 직접 답변");
  });

  it("a deployment that cannot send at all outranks the per-channel answer", () => {
    // Execution disabled is a fact about this deployment, and telling the seller about a channel
    // capability instead would send them to check the wrong thing.
    const reason = publishUnavailableReason(
      detail({ replyCapability: audited({}) }),
      capability({ executionEnabled: false }),
    );
    expect(reason).toContain("지금은 reviewnary가 답변을 대신 등록하지 않습니다");
  });
});

/** A deployment that CAN send on Cafe24 — so the refusal below is about the answer, not the channel. */
function sendable(): PublishCapabilityView {
  return capability({ replyAdapterChannelCodes: ["GMARKET", "CAFE24"] });
}

describe("already answered on the channel", () => {
  it("is not publishable, whatever the channel can do", () => {
    // The seller answered in the Cafe24 admin UI; our comment lane read it and the work item has not
    // settled yet. No capability makes a second answer to the same customer correct.
    expect(canPublishReply(detail({ channelCode: "CAFE24", status: "ANSWERED" }), sendable())).toBe(
      false,
    );
  });

  it("says the customer was already answered, not that the channel is unsupported", () => {
    const reason = publishUnavailableReason(
      detail({ channelCode: "CAFE24", status: "ANSWERED" }),
      sendable(),
    );
    expect(reason).toContain("이미 답변된 문의입니다");
    // Sending them to the seller center would be work that no longer exists.
    expect(reason).not.toContain("판매자센터에서 직접 답변");
  });

  it("still publishes normally when the source has not been answered", () => {
    expect(canPublishReply(detail({ channelCode: "CAFE24", status: "UNANSWERED" }), sendable())).toBe(
      true,
    );
  });
});
