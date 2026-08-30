package com.sellerops.knowledge;

import java.util.EnumSet;
import java.util.Set;

/**
 * The closed operating topics a question or a document can be ABOUT — the applicability axis the
 * lexical scorer does not have (Retrieval &amp; Grounding Correctness v1, 2026-08-30).
 *
 * <p><b>Why a topic beside a score.</b> 「배송 기간」 against a note titled 「교환 및 반품 안내」 that
 * mentions 반품 배송비 clears every lexical gate: 배송 is a real word the passage really contains.
 * The passage is still not evidence for the question, and no threshold separates the two — the
 * overlap is genuine. What separates them is that the question is about one operating topic and the
 * document declares another. That declaration is read from two closed places only: the document's
 * own type ({@code OrgKnowledgeType}) and its title, through the same word table the question is
 * read with. No model, no morphology service, no inference from the body.
 *
 * <p><b>Conservative by construction.</b> A document that declares no topic (a FAQ, a description,
 * 「자주 묻는 질문」) is never rejected; a question that names no topic rejects nothing; only when BOTH
 * sides name topics and the sets are disjoint is a passage {@link RetrievalOutcome#NOT_APPLICABLE}.
 * That is the whole gate. It cannot admit a passage — only refuse one the scorer admitted.
 *
 * <p>The word table is the one the Agent lane's POLICY routing already uses (`inquiryOps.ts`
 * {@code POLICY_TOPIC_WORDS}) and the one {@code InquiryKnowledgeNeed} scans for a policy axis,
 * written once here so the composer, the two knowledge services and the runtime agree on what
 * 「배송」 means.
 */
public enum KnowledgeTopic {

    SHIPPING("배송", "배송", "택배", "출고", "발송", "도착", "배달"),
    EXCHANGE_RETURN("교환·반품·환불", "교환", "반품", "환불", "반송"),
    CANCELLATION("주문 취소", "취소"),
    PAYMENT("결제", "결제", "입금", "무통장", "카드결제"),
    TAX_INVOICE("세금계산서", "세금계산서", "계산서"),
    CASH_RECEIPT("현금영수증", "현금영수증", "영수증");

    private final String labelKo;
    private final String[] words;

    KnowledgeTopic(String labelKo, String... words) {
        this.labelKo = labelKo;
        this.words = words;
    }

    /** The seller's word for the topic — 「배송 기준」, 「교환·반품·환불 기준」. */
    public String labelKo() {
        return labelKo;
    }

    /** Every topic the text names. Substring match on the closed table; empty when it names none. */
    public static Set<KnowledgeTopic> of(String text) {
        Set<KnowledgeTopic> found = EnumSet.noneOf(KnowledgeTopic.class);
        if (text == null || text.isBlank()) {
            return found;
        }
        for (KnowledgeTopic topic : values()) {
            for (String word : topic.words) {
                if (text.contains(word)) {
                    found.add(topic);
                    break;
                }
            }
        }
        // 세금계산서 contains 계산서 and 현금영수증 contains 영수증: the longer, more specific word wins
        // its own topic; the shorter one is dropped only when it was reached through the longer.
        if (found.contains(TAX_INVOICE) && text.contains("세금계산서") && !text.replace("세금계산서", "").contains("계산서")) {
            found.remove(CASH_RECEIPT);
        }
        return found;
    }

    /**
     * May a document declared about {@code source} ground a question about {@code question}?
     *
     * <p>True unless both sides name topics and share none. Symmetric, deterministic, and unable to
     * admit anything: it only ever turns a lexical hit into a refusal.
     */
    public static boolean applicable(Set<KnowledgeTopic> question, Set<KnowledgeTopic> source) {
        if (question == null || question.isEmpty() || source == null || source.isEmpty()) {
            return true;
        }
        for (KnowledgeTopic topic : question) {
            if (source.contains(topic)) {
                return true;
            }
        }
        return false;
    }
}
