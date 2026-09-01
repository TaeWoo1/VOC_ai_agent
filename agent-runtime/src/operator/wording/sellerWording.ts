/**
 * Seller-facing Response Hygiene v1 (2026-08-30) — the closed vocabulary every seller-facing sentence
 * of the Agent lane is built from.
 *
 * <b>Why one file.</b> The graph nodes, the conversation composer and the draft artifact were each
 * choosing their own words for the same four facts (a rule is missing · exists but says nothing about
 * this · exists but does not apply · was found), and the same internal token (an evidence kind, a
 * provenance stamp, a planner's sentence) could reach the seller through any of them. What a seller
 * reads is decided HERE and nowhere else; the trace, the evidence refs and the judge keep their own
 * internal values untouched.
 *
 * Nothing here is a model call and nothing here reads a store: closed tables, bounded excerpts, and a
 * few regexes over strings this repository wrote.
 */
import type { RetrievalOutcome } from "../../spring/types";

/* ───────────────────────────── source labels ───────────────────────────── */

/**
 * The seller's word for where a piece of evidence came from. A kind not in this table is 「자료」 —
 * never the kind's own token.
 */
export const SOURCE_LABEL: Readonly<Record<string, string>> = {
  REVIEW_LIST: "리뷰", REVIEW_ISSUE: "반복되는 리뷰 문제", ISSUE_EVIDENCE: "리뷰 근거", NEGATIVE_REVIEW: "부정 리뷰",
  ORDER_SUMMARY: "주문 정보", ORDER_FACT: "주문 정보",
  INQUIRY: "문의", INBOX_COUNT: "답변이 필요한 문의", REPEATED_INQUIRY: "반복 문의", GROUPING_GAP: "확인 범위",
  CUSTOMER_MEMORY: "과거 사례", CHANNEL_COVERAGE: "채널 수집 상태", HUMAN_ACTION: "필요한 작업",
  PRODUCT_FACT: "상품 정보", PRODUCT_LISTING: "상품 정보", PRODUCT_VARIANT: "상품 정보", PRODUCT_KNOWLEDGE_DOC: "상품 정보",
  PRODUCT_KNOWLEDGE_GAP: "상품 정보", PRODUCT_SIGNAL: "상품 신호",
  ORG_POLICY: "운영 정책", ORG_POLICY_GAP: "운영 정책",
  COMPANY_PROFILE: "회사 정보", COMPANY_PROFILE_GAP: "회사 정보",
  PAST_ANSWER: "과거 승인 답변", PAST_ANSWER_GAP: "과거 승인 답변",
};

/** The seller's word for what a planner need was about — for 「확인하지 못한 항목」, never the need's question. */
export const NEED_KIND_LABEL: Readonly<Record<string, string>> = {
  REVIEW_SIGNAL: "리뷰", INQUIRY_VOLUME: "문의", CUSTOMER_HISTORY: "과거 사례", ORDER_HISTORY: "주문 정보",
  PRODUCT_FACT: "상품 정보", PRODUCT_LISTING: "상품 정보", PRODUCT_VARIANT: "상품 정보", PRODUCT_KNOWLEDGE_DOC: "상품 정보",
  POLICY: "운영 정책", COMPANY_PROFILE: "회사 정보", PAST_ANSWER: "과거 승인 답변", CHANNEL_COVERAGE: "채널 수집 상태",
  PRODUCT_CATALOG: "상품 목록",
};

/**
 * A label is seller-safe when it reads as words, not as a token: no ALL_CAPS identifier, no provenance
 * punctuation (`:` `|` `/`), no uuid. Labels that fail are replaced by the kind's word.
 */
export function isSellerSafeLabel(label: string | null | undefined): label is string {
  if (!label) return false;
  if (/[A-Z][A-Z0-9_]{2,}/.test(label)) return false;
  if (/[:|/\\{}<>]/.test(label)) return false;
  if (/[0-9a-f]{8}-[0-9a-f]{4}-/i.test(label)) return false;
  return true;
}

/** The seller's word for a product fact's source stamp (`NAVER:PRODUCT_API:v1`, `DERIVED:INGEST`, …). */
export function factSourceLabel(source: string | null | undefined): string {
  const s = (source ?? "").toUpperCase();
  if (s.includes("PRODUCT_API")) return "채널 상품 정보";
  if (s.includes("DERIVED")) return "상품 등록 정보";
  if (s.startsWith("SELLER") || s.includes("KNOWLEDGE")) return "판매자 등록 정보";
  return "채널 정보";
}

/* ───────────────────────────── retrieval outcomes ───────────────────────────── */

export type RetrievalLane = "POLICY" | "PRODUCT" | "PAST_ANSWER";

/**
 * The one sentence per (lane, outcome). 「없다」(ABSENT), 「찾지 못했다」(NO_RELEVANT_EVIDENCE) and
 * 「바로 적용하기 어렵다」(NOT_APPLICABLE) are three facts and never mix. `topic` is the seller's word
 * for the operating topic when the question named one (「배송」); `subject` names the product for the
 * PRODUCT lane. FOUND has no sentence here — a found passage speaks for itself.
 */
export function retrievalSentence(
  lane: RetrievalLane, outcome: Exclude<RetrievalOutcome, "FOUND">,
  opts: { topic?: string | null; subject?: string | null; documents?: number | null } = {},
): string {
  const topic = opts.topic?.trim() || null;
  const subject = opts.subject?.trim() || null;
  switch (lane) {
    case "POLICY":
      switch (outcome) {
        case "ABSENT": return `등록된 ${topic ?? "운영"} 기준이 아직 없습니다.`;
        case "NO_RELEVANT_EVIDENCE": return "등록된 운영 정책에서 이 질문에 맞는 근거를 찾지 못했습니다.";
        case "NOT_APPLICABLE": return `${topic ? `${topic} 기준` : "관련 기준"}은 등록되어 있지만 이 문의에 바로 적용하기 어렵습니다.`;
      }
      break;
    case "PRODUCT": {
      const who = subject ? `${subject}에 ` : "";
      switch (outcome) {
        case "ABSENT": return `${who}등록된 상품 정보가 아직 없습니다. 상품 화면에서 설명·FAQ·사용법을 추가하면 답변에 쓸 수 있습니다.`;
        case "NO_RELEVANT_EVIDENCE":
          return `${subject ? `${subject}의 ` : ""}등록된 상품 정보${opts.documents != null ? `(${opts.documents}건)` : ""}에서 이 질문에 맞는 근거를 찾지 못했습니다.`;
        case "NOT_APPLICABLE":
          return `${who}관련 상품 정보는 등록되어 있지만 이 문의에 바로 적용하기 어렵습니다.`;
      }
      break;
    }
    case "PAST_ANSWER":
      switch (outcome) {
        case "ABSENT": return "저장된 과거 답변이 아직 없습니다.";
        case "NO_RELEVANT_EVIDENCE": return "저장된 과거 답변에서 이 질문에 맞는 것을 찾지 못했습니다.";
        case "NOT_APPLICABLE":
          return "저장된 과거 답변은 있지만 이 문의에 바로 적용하기 어렵습니다.";
      }
      break;
  }
  return "확인한 근거가 없습니다.";
}

/** The seller's word for an org rule kind — shared with the finding that quotes the rule. */
export function quotedRule(kindLabel: string, title: string, content: string): string {
  return `등록된 ${kindLabel} 기준 「${title}」: ${excerpt(content)}`;
}

/* ───────────────────────────── bounded quotation ───────────────────────────── */

/** How much of a seller's own document a chat sentence quotes. The full text lives on its screen. */
export const EXCERPT_CHARS = 160;

/**
 * The head of a text, cut at a sentence end when one falls inside the bound, with an ellipsis when
 * something was left out. Whitespace is collapsed; nothing is rephrased.
 */
export function excerpt(text: string | null | undefined, max: number = EXCERPT_CHARS): string {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const head = flat.slice(0, max);
  const cut = Math.max(head.lastIndexOf(". "), head.lastIndexOf("다. "), head.lastIndexOf("요. "));
  const kept = cut >= max * 0.4 ? head.slice(0, cut + 1) : head.replace(/\s+\S*$/, "");
  return `${kept.trim()}…`;
}

/* ───────────────────────────── planner text → seller sentence ───────────────────────────── */

/**
 * What the seller reads when the planner refused (`supported=false`). The planner's `rationale` is a
 * model sentence — possibly 반말, possibly about objects and targets — and never leaves the trace. It
 * is read only to pick one of a few closed sentences.
 */
export function unsupportedSentence(rationale: string | null | undefined): string {
  const r = rationale ?? "";
  if (/(대상|객체|어떤 문의|어느 문의|문의가 지정|문의를 지정|특정되지|지정되지)/.test(r)) {
    return "어떤 문의를 확인할지 먼저 선택해 주세요. 방금 본 목록에서 「첫 번째 거」처럼 말씀해 주시면 됩니다.";
  }
  if (/(상품이 지정|어떤 상품|어느 상품|상품을 특정)/.test(r)) {
    return "어떤 상품에 대한 질문인지 알려주세요.";
  }
  if (/(전송|발송|보내|등록해|제출|삭제|수정해|변경)/.test(r)) {
    return "이 대화에서는 조회와 초안 준비까지만 도와드립니다. 보내거나 바꾸는 일은 승인 단계를 거쳐 화면에서 진행합니다.";
  }
  return "이 요청은 아직 도와드리기 어렵습니다. 문의·리뷰·상품·주문 중 무엇을 확인할지 알려주세요.";
}

export type ClarificationKind = "INQUIRY" | "PRODUCT" | "PERIOD" | "CHANNEL" | "GENERAL";

/** Which closed question a planner clarification is — read from its text, never repeated from it. */
export function clarificationKindOf(reason: string | null | undefined): ClarificationKind {
  const r = reason ?? "";
  if (/(어떤 문의|어느 문의|문의를 지정|문의가 지정|문의를 특정|문의가 특정|어떤 건|어느 건|대상 문의)/.test(r)) return "INQUIRY";
  if (/(어떤 상품|어느 상품|상품을 지정|상품이 지정|상품을 특정|상품명)/.test(r)) return "PRODUCT";
  if (/(기간|언제|며칠|날짜)/.test(r)) return "PERIOD";
  if (/(채널|네이버|쿠팡|카페24)/.test(r)) return "CHANNEL";
  return "GENERAL";
}

/** The seller-facing question for a clarification kind. Short, 존댓말, closed. */
export function clarificationSentence(kind: ClarificationKind): string {
  switch (kind) {
    case "INQUIRY": return "어떤 문의를 확인할지 알려주세요. 방금 본 목록에서 「첫 번째 거」처럼 말씀해 주시면 됩니다.";
    case "PRODUCT": return "어떤 상품에 대한 질문인지 알려주세요.";
    case "PERIOD": return "어느 기간을 볼지 알려주세요. 예: 오늘, 최근 7일.";
    case "CHANNEL": return "어느 채널을 볼지 알려주세요. 네이버·쿠팡·카페24 중 하나, 또는 전체입니다.";
    case "GENERAL": return "무엇을 확인할지 조금 더 구체적으로 알려주세요. 문의·리뷰·상품·주문 중 하나를 말씀해 주시면 됩니다.";
  }
}

/* ───────────────────────────── leak guard ───────────────────────────── */

/**
 * Tokens that must never reach a seller-facing string. Used by the string-regression tests and by
 * the composer's last-resort guard on planner-authored text.
 */
export const INTERNAL_TOKEN = /\b(CUSTOMER_MEMORY|PRODUCT_KNOWLEDGE(_DOC|_GAP)?|ORG_POLICY(_GAP)?|PAST_ANSWER(_GAP)?|COMPANY_PROFILE(_GAP)?|NO_ANSWER_BASIS|NEEDS_CLARIFICATION|GROUNDED|INQUIRY_OPS|PRODUCT_OPS|REVIEW_OPS|ORDER_OPS|REPORT_OPS|WORKING_SET|PRODUCT_API|SellerOps)\b|[A-Z]+:[A-Z_]+:v\d|work[ -]?item|\/api\//;
