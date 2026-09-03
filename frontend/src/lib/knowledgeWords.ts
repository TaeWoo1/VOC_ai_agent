/**
 * <b>The words a seller reads about knowledge, in one place.</b>
 * (Knowledge Setup & Inbox UX v1 §1)
 *
 * The storage vocabulary is `SHIPPING_POLICY`, `DRAFT_GAP`, `chunk`, `passage`, `SELLER_ENTERED_
 * KNOWLEDGE`. None of it belongs on a screen a shop owner reads, and three screens were each
 * choosing their own Korean for the same enum — so 「운영 정책 / 답변 기준」 and 「운영 기준」 were the
 * same rows under two names, and neither said the other existed.
 *
 * Nothing here changes an internal meaning. It is a rendering table, and an unknown token renders
 * as nothing rather than as itself: a seller must never be shown a constant.
 */
import type { KnowledgeSourceType, OrgKnowledgeType } from "./types";

/** A stored type token — one of the two enums, depending on the corpus. */
export type KnowledgeTopicValue = KnowledgeSourceType | OrgKnowledgeType;

/** What a company-wide rule is about. Mirrors `OrgKnowledgeType`. */
export const ORG_TOPICS: Array<{ value: OrgKnowledgeType; label: string; hint: string }> = [
  { value: "SHIPPING_POLICY", label: "배송", hint: "출고까지 걸리는 기간, 배송비, 도서산간" },
  { value: "CANCELLATION_POLICY", label: "주문 취소", hint: "언제까지, 어떤 방법으로 취소되는지" },
  { value: "EXCHANGE_REFUND_POLICY", label: "교환·반품·환불", hint: "기간, 조건, 배송비 부담" },
  { value: "PAYMENT_POLICY", label: "결제", hint: "결제 수단, 입금 확인, 부분 결제" },
  { value: "TAX_INVOICE", label: "세금계산서", hint: "발행 조건과 필요한 서류" },
  { value: "CASH_RECEIPT", label: "현금영수증", hint: "발급 조건과 신청 방법" },
  { value: "GENERAL_CS_FAQ", label: "공통 안내", hint: "위에 없는, 자주 묻는 것" },
  { value: "OTHER", label: "기타", hint: "아직 분류하지 않은 기준" },
];

/** What a product fact is about. Mirrors `KnowledgeSourceType`. */
export const PRODUCT_TOPICS: Array<{ value: KnowledgeSourceType; label: string; hint: string }> = [
  { value: "DESCRIPTION", label: "상품 설명", hint: "이 상품이 무엇인지, 어떤 점이 다른지" },
  { value: "FAQ", label: "자주 묻는 질문", hint: "고객이 반복해서 묻는 것과 그 답" },
  { value: "USAGE", label: "사용법", hint: "사용·설치·보관 방법" },
  { value: "POLICY", label: "정책", hint: "교환·반품·배송·A/S 기준" },
  { value: "LINK", label: "참고 자료", hint: "상세페이지 주소와 옮겨 적은 내용" },
];

/** The seller-facing name of a stored type, or null when we have no name for it. */
export function topicLabel(kind: string | null | undefined): string | null {
  if (!kind) return null;
  const hit = [...ORG_TOPICS, ...PRODUCT_TOPICS].find((t) => (t.value as string) === kind);
  return hit ? hit.label : null;
}

/**
 * The operating rule an ASKED topic would be filed under.
 *
 * <b>Two vocabularies, and they are not the same one.</b> `KnowledgeTopic` says what a customer's
 * question is about (`SHIPPING`); `OrgKnowledgeType` says what a stored rule is about
 * (`SHIPPING_POLICY`). Handing the first straight to the write endpoint is a 500 — measured on
 * 2026-09-03, 「제주도인데 배송이 며칠 걸리나요?」 → 「저장하지 못했습니다」 with `SHIPPING` on the
 * wire — so the crossing is written down here rather than assumed anywhere.
 *
 * A topic with no rule type returns null and the editor opens on its own default: a token this
 * table has no name for must never reach the wire.
 */
export function ruleTypeForAskedTopic(topic: string | null | undefined): OrgKnowledgeType | null {
  switch (topic) {
    case "SHIPPING": return "SHIPPING_POLICY";
    case "EXCHANGE_RETURN": return "EXCHANGE_REFUND_POLICY";
    case "CANCELLATION": return "CANCELLATION_POLICY";
    case "PAYMENT": return "PAYMENT_POLICY";
    case "TAX_INVOICE": return "TAX_INVOICE";
    case "CASH_RECEIPT": return "CASH_RECEIPT";
    default: return null;
  }
}

/** Where a piece of knowledge applies. The only two scopes v1 has. */
export function scopeLabel(scope: string, productName: string | null | undefined): string {
  return scope === "PRODUCT" ? (productName ?? "이 상품") : "회사 전체";
}

/**
 * Why something is waiting for the seller.
 *
 * The two origins call for different reading, which is why they are two groups rather than one
 * list: 「정보 필요」 is a question reviewnary could not answer, and the seller writes the answer;
 * 「확인할 후보」 is a sentence the seller has already written many times, and they confirm it.
 */
export function originLabel(origin: string): string {
  if (origin === "DRAFT_GAP") return "정보 필요";
  if (origin === "REPEATED_ANSWER") return "확인할 후보";
  return "확인 필요";
}
