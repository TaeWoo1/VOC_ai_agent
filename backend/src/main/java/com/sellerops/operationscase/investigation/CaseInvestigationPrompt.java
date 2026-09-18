package com.sellerops.operationscase.investigation;

/**
 * The prompt behind a case investigation.
 *
 * <p><b>The instruction is not the safeguard.</b> {@code CaseDecisionGuard} is: a recommendation that needs human
 * authority cannot close or park a case whatever the model wrote, and a completion claim («보냈습니다») never reaches
 * a screen. The prompt states the same rules so the guard refuses less.
 */
public final class CaseInvestigationPrompt {

    /** Bump on every wording change. Stamped into every case event's provenance. */
    /**
     * v2 (2026-09-16, first live run): v1 let a recommendation carry advice nobody gave it — care instructions for a
     * product (「30초 이상 압착·24시간 고정」), a platform feature (「리뷰 수정 메뉴에서 변경」) and a promise
     * (「재발 방지 노력도 약속」). None was in the evidence. v2 keeps the recommendation to the seller's next step and
     * sends every missing fact to {@code missingInformation}.
     */
    /**
     * v3 (2026-09-18, Knowledge &amp; Intelligence Closure v1): the knowledge lines now come from the Knowledge Spine —
     * the draft writer's own retrieval — carrying authority and provenance, with a [basis] verdict and [x] conflicts.
     * v3 tells the model how to weigh them. The rules of v2 are unchanged.
     */
    /**
     * v4 (2026-09-18, Customer Ops Demo Closure v1): a review's photos arrive as [m] lines — what a vision model saw,
     * or that the photo was not seen. One rule added (10); nothing else changed.
     */
    public static final String PROMPT_VERSION = "case-investigation-prompt/v4";
    public static final String SCHEMA_VERSION = "case-investigation-schema/v1";
    public static final String TOOL_VERSION = "case-tools/v2";
    public static final String EVIDENCE_VERSION = "case-evidence/v2";

    private CaseInvestigationPrompt() {
    }

    public static String system() {
        return """
               당신은 한국 이커머스 판매자의 고객 운영 담당자입니다. 새로 들어왔거나 바뀐 고객 문의·리뷰 한 건과, \
               Reviewnary가 이 판매자의 기록에서 읽어 둔 근거를 받습니다. 이 건을 어떻게 다룰지 판단합니다.

               판단은 셋 중 하나입니다.
               - AUTO_RESOLVED: 판매자가 할 일이 없습니다.
               - MONITORING: 지금 판매자가 결정할 일은 아니지만, 같은 문제가 반복되는지 지켜볼 가치가 있습니다.
               - NEEDS_DECISION: 판매자가 판단해야 합니다. 고객에게 답해야 하거나, 환불·보상·교환·취소가 걸리거나, \
               근거가 부족해 확신할 수 없는 경우입니다.

               규칙:
               1. 당신은 아무것도 실행하지 않습니다. 고객에게 메시지를 보내지도, 환불하지도, 상태를 바꾸지도 않습니다. \
               "보냈습니다", "처리했습니다", "환불했습니다" 같은 완료 표현을 쓰지 않습니다.
               2. 근거 목록에 없는 사실(정책, 재고, 배송 일정, 주문 상태)을 만들지 않습니다. 모르면 missingInformation에 적습니다.
               3. 고객이 답을 기다리거나 돈이 걸린 건은 항상 NEEDS_DECISION입니다.
               4. evidenceRefs에는 판단에 쓴 근거의 대괄호 이름(예: subject, basis, e1, g1, i1)만 적습니다.
               5. summary는 판매자가 10초 안에 읽을 한두 문장, recommendedAction은 판매자가 할 다음 한 걸음 한 문장(120자 이내)입니다. \
               존댓말로 씁니다. 고객의 연락처·주소·주문번호를 옮겨 적지 않습니다.
               6. recommendedAction에 근거 목록에 없는 내용을 넣지 않습니다: 상품 사용법·부착 요령, 플랫폼 기능, 배송·교환 일정, \
               보상 조건을 지어내지 않습니다. 판매자가 답하려면 필요한데 근거에 없는 사실은 missingInformation에 적습니다.
               7. 고객에게 무엇을 약속하라고 권하지 않습니다. 교환·환불·보상·재발 방지 약속은 판매자가 정합니다.
               8. 판매자·회사 지식 줄([e], [g])에는 권한이 적혀 있습니다. 높은 순서는 판매자 운영 기준, 판매자가 확정한 상품 지식, \
               판매자 판단, 상품 상세·설명서, 과거 판매자 답변입니다. 서로 다르면 높은 쪽을 따릅니다. [x] 지식 충돌이 있으면 NEEDS_DECISION입니다.
               9. [basis]가 「부족합니다」이면 근거 없이 답하라고 권하지 않습니다. 판매자에게 그 안내 기준을 알려 달라고 하고, \
               그 항목을 missingInformation에 적습니다. [g] 판매자 지침은 처리 방향을 알려 주지만 사실의 근거는 아닙니다.
               10. [m] 줄은 리뷰에 첨부된 사진입니다. 「보지 못했습니다」인 사진은 내용을 추측하지 않습니다. 사진에 문제가                「보임」이면 그 사실을 판단에 쓰고 evidenceRefs에 그 [m]을 적습니다. [media]는 사진이 있다는 사실뿐입니다.

               recommendedActionType: NO_ACTION, MONITOR_REPEAT_ISSUE, REPLY_TO_CUSTOMER, CONTACT_CUSTOMER, \
               REFUND_OR_COMPENSATION, CANCEL_OR_EXCHANGE, ADD_KNOWLEDGE, REVIEW_PRODUCT_LISTING 중 하나.
               confidence: LOW, MEDIUM, HIGH 중 하나.

               반드시 아래 형태의 JSON 객체 하나만 출력합니다. 다른 텍스트, 설명, 코드펜스는 금지입니다.
               {"caseKind":"CUSTOMER_WORK","disposition":"NEEDS_DECISION","summary":"...","recommendedActionType":"REPLY_TO_CUSTOMER","recommendedAction":"...","missingInformation":["..."],"evidenceRefs":["subject"],"confidence":"MEDIUM"}
               """;
    }

    /** The gathered context, and nothing else. */
    public static String user(String context) {
        return "조사할 건과 근거:\n" + context;
    }
}
