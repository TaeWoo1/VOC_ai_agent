import type { SeedReview } from "./FakeReviewSpringClient";

/**
 * Seed reviews. Bodies deliberately embed PII-shaped tokens (a phone number, an email) so the
 * no-leak sweep can prove neither the review body nor the derived draft ever reaches a log
 * line or the durable snapshot.
 */
export const OLDER_REVIEW_REF = "review:11111111-1111-1111-1111-111111111111";
export const NEWER_REVIEW_REF = "review:22222222-2222-2222-2222-222222222222";

export const PHONE_TOKEN = "010-1234-5678";
export const EMAIL_TOKEN = "hong@example.com";

export function twoReviews(): SeedReview[] {
  return [
    {
      actionRef: NEWER_REVIEW_REF,
      rating: 5,
      body: `배송 빠르고 좋아요. 문의는 ${PHONE_TOKEN} 로 주세요.`,
      sourceCreatedDate: "2026-07-20",
      productName: "무선 이어폰",
      channelReplyState: "PENDING",
    },
    {
      actionRef: OLDER_REVIEW_REF,
      rating: 2,
      body: `제품에 하자가 있어요. ${EMAIL_TOKEN} 으로 연락 부탁드립니다.`,
      sourceCreatedDate: "2026-07-18", // older -> prioritized first
      productName: "보조 배터리",
      channelReplyState: "PENDING",
    },
  ];
}
