import type { SeedInquiry } from "./FakeSpringClient";

/**
 * Seed inquiries. Titles/bodies deliberately embed PII-shaped tokens (a phone number,
 * an email) so the no-leak sweep can prove none of them ever reach a log line.
 */
export const OLDER_WORK_ITEM = "11111111-1111-1111-1111-111111111111";
export const NEWER_WORK_ITEM = "22222222-2222-2222-2222-222222222222";

export const PHONE_TOKEN = "010-1234-5678";
export const EMAIL_TOKEN = "hong@example.com";

export function twoInquiries(): SeedInquiry[] {
  return [
    {
      workItemId: NEWER_WORK_ITEM,
      inquiryId: "aaaa1111-0000-0000-0000-000000000001",
      sellerAccountId: "acct-1",
      channelId: "chan-1",
      title: `사이즈 문의 ${PHONE_TOKEN}`,
      details: `색상 옵션 관련 문의드립니다. 연락처 ${PHONE_TOKEN}`,
      receivedAt: "2026-07-20T09:00:00Z",
    },
    {
      workItemId: OLDER_WORK_ITEM,
      inquiryId: "aaaa1111-0000-0000-0000-000000000002",
      sellerAccountId: "acct-1",
      channelId: "chan-1",
      title: `환불 요청 ${PHONE_TOKEN}`,
      details: `주문 ${EMAIL_TOKEN} 관련 환불 부탁드립니다.`,
      receivedAt: "2026-07-18T09:00:00Z", // older -> should be prioritized first
    },
  ];
}
