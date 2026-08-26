// The pure decisions behind the inquiry reply-publish surface. No React, no I/O.
//
// This is the seller-facing side of the ONE marketplace WRITE this product has, so every rule that
// decides whether a send control exists at all lives here, in one readable place, rather than being
// spread across a component's JSX. The component renders what these say; it decides nothing.

import type { InquiryDetail, PublishCapabilityView, PublishOutcomeCategory, PublishStatusView } from "./types";

/**
 * Whether the "채널에 답변 등록" path may be offered for THIS inquiry.
 *
 * Three conditions, and all three are the backend's own answers rather than this screen's guesses:
 *
 *  1. **the deployment can send at all** — `executionEnabled`, which is `sellerops.inquiry.publish
 *     .execution-enabled` and is false by default. Off, no adapter bean exists and the core fails
 *     closed, so a send control would be a button that cannot work;
 *  2. **this channel has a reply adapter** — `replyAdapterChannelCodes`. Coupang's additionally
 *     requires its own connector flag, so "we can send" and "we can send HERE" are different facts
 *     and the capability read reports them separately;
 *  3. **the inquiry belongs to that channel** — an inquiry whose channel is not in the list is
 *     answered in the seller center, and saying otherwise would promise a path that 404s at dispatch.
 *
 * Fails CLOSED on a capability read that did not land: `null` means "we do not know", and offering a
 * marketplace write on a guess is the one thing this surface must never do.
 */
export function canPublishReply(
  detail: Pick<InquiryDetail, "channelCode" | "status">,
  capability: PublishCapabilityView | null,
): boolean {
  // Already answered on the marketplace, by anyone. The backend refuses this at the last gate before
  // the write (ALREADY_ANSWERED), so offering the button here would walk the seller through approval
  // only to fail — and if a stale AI draft is sitting there, it invites them to answer a customer
  // twice. Checked first because no capability makes a second answer correct.
  if (answeredElsewhere(detail)) return false;
  if (!capability || !capability.executionEnabled) return false;
  const code = detail.channelCode;
  return !!code && capability.replyAdapterChannelCodes.includes(code);
}

/**
 * Whether the SOURCE says this customer has already been answered.
 *
 * <p>The work item can still be OPEN or PROPOSED when this is true: a seller answering in the Cafe24
 * admin UI leaves a comment that our routine sweep now reads, and the item only settles on the next
 * collection. The screen must not keep asking for work the customer no longer needs.
 */
export function answeredElsewhere(detail: Pick<InquiryDetail, "status">): boolean {
  return detail.status === "ANSWERED";
}

/**
 * Why the send path is not offered — the sentence the seller reads instead of a button.
 *
 * Each reason is a different thing for them to do, which is why they are not one message: "this
 * channel is answered in the seller center" is permanent and actionable, and "this deployment cannot
 * send yet" is neither. Returns null when the path IS available.
 */
export function publishUnavailableReason(
  detail: Pick<InquiryDetail, "channelCode" | "channelNameKo" | "replyCapability" | "status">,
  capability: PublishCapabilityView | null,
): string | null {
  if (canPublishReply(detail, capability)) return null;
  // First, because it is about the customer rather than about us. Telling someone "이 채널은
  // 판매자센터에서 답변해 주세요" about a question that has already been answered sends them to do
  // work that no longer exists.
  if (answeredElsewhere(detail)) {
    return "이미 답변된 문의입니다. 판매자님이 채널에서 직접 답변하신 내용이 확인되었습니다.";
  }
  const channel = detail.channelNameKo ?? "이 채널";
  if (!capability) {
    return "답변 등록이 가능한지 확인하지 못했습니다. 답변은 판매자센터에서 직접 등록해 주세요.";
  }
  if (!capability.executionEnabled) {
    return "이 환경에서는 reviewnary가 답변을 대신 등록하지 않습니다. [초안 복사]로 옮겨 판매자센터에 등록해 주세요.";
  }
  // The audited answer for THIS channel and THIS source resource, when the server sent one. It says
  // whose limitation this is, and that is the part a seller acts on: told "네이버는 지원하지 않습니다"
  // they conclude their channel cannot do it and stop asking, when the endpoint exists and SellerOps
  // simply has not connected it. The transport NAME is never shown — only what it means for them.
  const audited = detail.replyCapability?.reasonKo;
  if (audited) {
    return `${audited} [초안 복사]로 옮겨 판매자센터에 등록해 주세요.`;
  }
  return `${channel} 문의는 판매자센터에서 직접 답변해 주세요. [초안 복사]로 옮겨 쓰실 수 있습니다.`;
}

/** Whether a draft version may still be edited — once an approval is bound, the content is frozen. */
export function canEditDraft(status: PublishStatusView | null): boolean {
  return status === null;
}

/**
 * The seller-facing sentence for a publish outcome.
 *
 * `CHECKING_REQUIRED` is deliberately NOT "실패": it is the DELIVERY_UNKNOWN case — the request left
 * and nobody observed the answer — and the product's rule there is verify, never resend. Telling the
 * seller it failed is how a duplicate reply gets sent by hand.
 */
export function publishCategoryLabel(category: PublishOutcomeCategory): string {
  switch (category) {
    case "PUBLISHING":
      return "등록 중입니다. 잠시 후 상태를 확인해 주세요.";
    case "COMPLETED":
      return "답변이 등록되었습니다.";
    case "CHECKING_REQUIRED":
      return "등록 여부를 확인하는 중입니다. 다시 보내지 않고 채널 상태만 다시 조회합니다.";
    case "RETRYABLE":
      return "일시적인 문제로 등록되지 않았습니다. 다시 시도할 수 있습니다.";
    case "PERMANENT":
      return "등록할 수 없습니다. 판매자센터에서 직접 답변해 주세요.";
  }
}

/** Whether "다시 시도" should be offered. Never for a permanent failure, and never for a completed one. */
export function canResumePublish(status: PublishStatusView | null): boolean {
  return status !== null && (status.category === "RETRYABLE" || status.category === "PUBLISHING");
}

/** Whether "상태 다시 확인" should be offered — the verify-only path, which never resends. */
export function canVerifyPublish(status: PublishStatusView | null): boolean {
  return status !== null && (status.category === "CHECKING_REQUIRED" || status.category === "PUBLISHING");
}

/**
 * Classify a confirm-publish failure into what the seller should do.
 *
 * 409 is the one that matters and the one a generic "다시 시도해 주세요" would hide: the draft moved
 * after they read it, so the approval they just gave describes content that is no longer there. The
 * only correct response is to re-read the draft and approve the version actually on screen.
 */
export function classifyPublishError(status: number | undefined): { message: string; shouldRefresh: boolean } {
  if (status === 409) {
    return {
      message: "초안이 그 사이 변경되었습니다. 내용을 다시 확인한 뒤 등록해 주세요.",
      shouldRefresh: true,
    };
  }
  if (status === 404) {
    return { message: "이 문의를 찾을 수 없습니다. 목록에서 다시 열어 주세요.", shouldRefresh: true };
  }
  if (status === 503) {
    return { message: "지금은 답변을 등록할 수 없습니다. 판매자센터에서 직접 등록해 주세요.", shouldRefresh: false };
  }
  return { message: "답변을 등록하지 못했습니다. 잠시 후 다시 시도해 주세요.", shouldRefresh: false };
}
