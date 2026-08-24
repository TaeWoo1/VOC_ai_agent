package com.sellerops.inquiry.draft;

import java.util.EnumSet;
import java.util.Set;

/**
 * What an inquiry would have to be answered FROM — a measuring instrument, not a feature.
 *
 * <p><b>Why this exists.</b> "69건 중 몇 건을 이제 근거 기반으로 처리할 수 있는가" cannot be answered by
 * counting how many drafts came back grounded, because that number conflates two very different
 * failures: a question this architecture cannot reach at all, and a question it can reach the moment
 * someone writes the policy. Classifying what each question NEEDS, and separately measuring what the
 * retrieval FOUND, separates "the design is wrong" from "the library is empty".
 *
 * <p><b>It is not shipped as a product behaviour.</b> Nothing routes on it, no screen shows it, and
 * no draft is written differently because of it. It is read by the coverage audit and by nothing
 * else. Keyword classification of Korean customer text is a blunt instrument — good enough to size a
 * backlog, not good enough to decide what a seller sends.
 *
 * <p><b>Deterministic and offline.</b> No model call. The same inquiry classifies the same way on
 * every run, which is what makes a before/after comparison a measurement rather than an anecdote.
 */
public enum InquiryKnowledgeNeed {

    /** 상품의 사양·사용법·호환을 물었다. 상품 지식이 있어야 답한다. */
    PRODUCT_KNOWLEDGE_NEEDED,

    /** 배송·취소·교환·결제·증빙 규정을 물었다. 운영 정책이 있어야 답한다. */
    ORG_POLICY_NEEDED,

    /** 이 주문이 지금 어떤 상태인지 물었다. 정책만으로는 답할 수 없다. */
    ORDER_CONTEXT_NEEDED,

    /** 위 중 둘 이상이 함께 필요하다. */
    MULTI_SOURCE,

    /** 어느 축으로도 분류되지 않는다 — 이 구조가 아직 답할 수 없는 것. */
    CURRENTLY_UNANSWERABLE;

    /** 상품의 무엇을 묻는 말. */
    private static final String[] PRODUCT_WORDS = {
        "사이즈", "규격", "치수", "크기", "길이", "폭", "두께", "지름", "색상", "컬러", "재질", "소재",
        "무게", "용량", "성분", "호환", "사용법", "설치", "시공", "조립", "세척", "관리", "보관", "스펙",
        "방수", "내열", "몇 mm", "몇mm", "몇 cm", "몇cm",
    };

    /** 회사가 어떻게 하는지 묻는 말. */
    private static final String[] POLICY_WORDS = {
        "세금계산서", "현금영수증", "계산서", "영수증", "증빙", "사업자", "부가세",
        "교환", "반품", "환불", "취소 규정", "취소 정책", "반송", "왕복", "배송비", "택배비",
        "결제", "입금", "무통장", "카드", "적립", "쿠폰", "도서산간", "제주",
    };

    /** 이 주문이 지금 어떤지 묻는 말. */
    private static final String[] ORDER_WORDS = {
        "언제 오", "언제 도착", "언제 발송", "언제 배송", "배송 언제", "출고", "송장", "운송장", "배송조회",
        "주문번호", "주문 번호", "결제했", "입금했", "주문했", "취소됐", "취소되었", "취소 처리",
        "환불됐", "환불되었", "환불 처리", "아직 안", "언제쯤",
    };

    /**
     * Classify one question by what it asks for.
     *
     * <p>Reads title and body text only, and returns a category — never a product, never an order,
     * never an answer. Nothing acts on the result.
     */
    public static InquiryKnowledgeNeed of(String title, String body) {
        String text = ((title == null ? "" : title) + " " + (body == null ? "" : body));
        Set<InquiryKnowledgeNeed> needs = EnumSet.noneOf(InquiryKnowledgeNeed.class);
        if (containsAny(text, ORDER_WORDS)) {
            needs.add(ORDER_CONTEXT_NEEDED);
        }
        if (containsAny(text, POLICY_WORDS)) {
            needs.add(ORG_POLICY_NEEDED);
        }
        if (containsAny(text, PRODUCT_WORDS)) {
            needs.add(PRODUCT_KNOWLEDGE_NEEDED);
        }
        if (needs.isEmpty()) {
            return CURRENTLY_UNANSWERABLE;
        }
        return needs.size() > 1 ? MULTI_SOURCE : needs.iterator().next();
    }

    private static boolean containsAny(String text, String[] words) {
        for (String word : words) {
            if (text.contains(word)) {
                return true;
            }
        }
        return false;
    }
}
