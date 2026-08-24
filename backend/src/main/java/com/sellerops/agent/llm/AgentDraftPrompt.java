package com.sellerops.agent.llm;

/**
 * The prompt behind {@code POST /api/agent/inquiry-draft}, versioned so a run can say which one
 * produced it.
 *
 * <p><b>Structured output is a requirement, not a convenience.</b> The graph node that consumes this
 * has to put a category and a reply body into typed state; a model answering in prose would either
 * be parsed by guesswork or silently dropped. So the system turn states one JSON object with three
 * named fields and nothing else, and {@link AgentDraftResponseParser} refuses anything that is not
 * exactly that — the model does not get to widen its own contract.
 *
 * <p><b>The category vocabulary is CLOSED and interpolated from the rule drafter's own list</b>, for
 * the reason {@code TriagePrompt} interpolates its vocabularies from enums: a prompt that names its
 * options in prose drifts from the code that consumes them, and the first symptom is a category the
 * frontend has no label for. A category outside the list is a refusal, not a new category.
 *
 * <p><b>What the seller's content is used for, said to the model.</b> The instruction is explicit
 * that this is a STARTER draft for a human to edit and send themselves — SellerOps posts nothing —
 * so the model is not asked to promise a resolution, quote a policy, commit to a date, or invent an
 * order state it cannot see.
 */
public final class AgentDraftPrompt {

    /** Bump on every wording change. It is stamped into the provenance the run records. */
    public static final String PROMPT_VERSION = "agent-draft-prompt/v5";

    /**
     * The closed set of reply categories, in the rule drafter's own order.
     *
     * <p>Kept identical to {@code RuleBasedDraftProvider.RULES} + its general fallback so the two
     * providers are interchangeable behind the seam: a run that falls back mid-flight must produce a
     * category the same UI can label.
     */
    public static final String[] CATEGORIES = {
        "delivery_status_reply",
        "exchange_return_reply",
        "stock_restock_reply",
        "product_info_reply",
        "general_reply",
    };

    private AgentDraftPrompt() {
    }

    /** The system turn. Deterministic over {@link #CATEGORIES} — no clock, no locale, no run id. */
    public static String system() {
        return """
               당신은 한국 이커머스 판매자의 운영 보조입니다. 판매자가 받은 고객 문의 하나를 읽고, \
               판매자가 그대로 쓰거나 고쳐 쓸 수 있는 답변 초안을 한국어로 작성합니다.

               규칙:
               - 이 초안은 사람이 검토하고 직접 전송합니다. 시스템이 대신 전송하지 않습니다.
               - 확인되지 않은 사실(주문 상태, 재고 수량, 배송 일자, 환불 금액, 정책 조항)을 지어내지 마세요. \
               확인 후 안내하겠다고 쓰세요.
               - 「판매자가 등록한 근거」가 주어지면 그 내용만 근거로 쓰세요. 거기 없는 사양·수치·기간·\
               조건은 쓰지 마세요. 근거가 비어 있으면 그것만으로 답을 만들지 말고 확인 후 안내하겠다고 쓰세요.
               - 근거는 [상품 정보] [운영 정책] [과거 답변]로 구분되어 있습니다. 상품의 사양은 [상품 정보]에서만, \
               배송·취소·교환·증빙 같은 회사 규정은 [운영 정책]에서만 가져오세요. [과거 답변]은 이 판매자가 전에 한 \
               답변이며, 지금 이 고객의 사실이 아닙니다 -- 표현을 맞추는 데 쓰고 사실의 출처로 쓰지 마세요. \
               특히 [과거 답변]에 있는 "오늘 출고", "내일 도착" 같은 문장은 그때 그 주문의 사정이지 \
               이 주문의 사정도, 회사의 기준도 아닙니다.
               - 다음은 근거에 그렇게 적혀 있지 않는 한 절대 쓰지 마세요: 환불이 가능하다는 단정, 취소가 \
               완료되었다는 단정, 배송/도착 날짜 약속, 재고가 있다는 단정, 출시 예정 약속.
               - 「주문 상태」는 이 주문에 대해 채널이 말해 준 사실이며, 정책과 다른 종류의 근거입니다. \
               확인된 값이 없으면 이 주문이 어떤 상태인지 쓰지 말고, 확인 후 안내하겠다고 쓰세요.
               - 「주문 상태」가 결제 완료라고만 되어 있으면 결제까지만 확인된 것입니다 -- 발송·도착·배송 \
               중 무엇도 그로부터 따라 나오지 않습니다. [운영 정책]에 평균 발송 기준이 있으면 그 기준은 \
               일반 안내로 쓸 수 있지만, 이 주문이 언제 출발하거나 도착한다고는 쓰지 마세요.
               - 「주문 상태」가 확인 시점 기준이라고 적혀 있으면 그 시점을 함께 밝히고, 지금 상태라고 \
               단정하지 마세요.
               - 발급·처리·완료 가능 여부(정책)와 이 주문에서 실제로 그렇게 되었는지(주문 상태)는 \
               다른 사실입니다. 정책만 있을 때 이 주문에서 완료되었다고 쓰지 마세요.
               - 「주문 상태」의 결제·취소·발송은 서로 다른 세 가지 사실입니다. 하나가 확인되었다고 \
               나머지를 추론하지 마세요. 「발송 상태는 확인되지 않았습니다」는 발송되지 않았다는 뜻이 \
               아니라 모른다는 뜻입니다.
               - 「취소되지 않은 것으로 확인됩니다」라고 적혀 있을 때만 취소되지 않았다고 쓸 수 있습니다. \
               취소에 대한 언급이 없으면 취소 여부를 쓰지 마세요.
               - 「발송은 아직 시작되지 않았습니다」는 상태이지 일정이 아닙니다. 언제 출발하는지는 \
               그로부터 따라 나오지 않습니다.
               - 보상, 할인, 예외 처리를 약속하지 마세요.
               - 고객의 이름, 연락처, 주소를 초안에 넣지 마세요.
               - 2~4문장, 존댓말, 인사와 마무리를 포함합니다.

               category 는 다음 중 정확히 하나여야 합니다: %s

               반드시 아래 형태의 JSON 객체 하나만 출력하세요. 다른 텍스트, 설명, 코드펜스는 금지입니다.
               {"category":"<위 목록 중 하나>","title":"<답변 제목>","comments":"<답변 본문>"}
               """
                .formatted(String.join(", ", CATEGORIES));
    }

    /**
     * The user turn — <b>the payload floor</b>.
     *
     * <p>Exactly three values of the seller's content leave: the inquiry's own {@code title} and
     * {@code details}, and the seller-authored product knowledge retrieved for this question. Not the
     * buyer's name, not an order id, not a work-item / inquiry / product / source / chunk UUID, not
     * the org, not the channel, not the phase, not a timestamp, not a retrieval score.
     * {@code AgentDraftPayloadFloorTest} asserts this on the serialized request bytes rather than on
     * this method's intent, which is the only way the floor stays true after the next edit.
     *
     * <p><b>Why the floor moved.</b> v1 sent the question and nothing else, so every factual answer
     * the model could give was invented — which the rules then forbade, leaving "확인 후 안내드리겠습니다"
     * as the only honest draft. Grounding requires that the grounds be present. The knowledge is the
     * seller's own writing about their own product; it is a narrower class of content than the
     * customer text already in {@code details}, and it carries no identifier of any kind.
     *
     * <p>A null body is rendered as an empty line rather than the string "null": the model would
     * otherwise be answering a question about a literal four-letter word.
     */
    public static String user(String title, String details,
                              java.util.List<AgentDraftGenerator.Passage> knowledge) {
        return user(title, details, knowledge, null);
    }

    /**
     * The user turn with the order-state line.
     *
     * @param orderState the ONE sentence {@code InquiryOrderFactReader} produced — either a
     *                   confirmed state with its observation date, or which of the five reasons says
     *                   there is none. <b>It names no order and carries no identifier</b>: the order
     *                   reference stays on the inquiry row where the join needs it and never reaches
     *                   a model, which is asserted on the serialized bytes by
     *                   {@code AgentDraftPayloadFloorTest}. Null renders the same "(확인된 값 없음)" as
     *                   an unavailable read, because a caller that forgot to look and a lookup that
     *                   found nothing must not differ in what the model is allowed to claim.
     */
    public static String user(String title, String details,
                              java.util.List<AgentDraftGenerator.Passage> knowledge, String orderState) {
        StringBuilder sb = new StringBuilder();
        sb.append("제목: ").append(title == null ? "" : title)
                .append("\n본문:\n").append(details == null ? "" : details);
        sb.append("\n\n판매자가 등록한 근거:\n");
        if (knowledge == null || knowledge.isEmpty()) {
            // Said out loud rather than omitted. An absent section reads to a model as "not relevant
            // here"; this section reads as "there is nothing, so do not pretend there is".
            sb.append("(없음)");
        } else {
            for (AgentDraftGenerator.Passage passage : knowledge) {
                sb.append("- ");
                if (passage.scopeLabel() != null && !passage.scopeLabel().isBlank()) {
                    sb.append('[').append(passage.scopeLabel()).append("] ");
                }
                sb.append('[').append(passage.heading() == null ? "" : passage.heading()).append("] ")
                        .append(passage.text() == null ? "" : passage.text()).append('\n');
            }
        }
        // The order line is always present, and by default says there is nothing. A model that is
        // never told about order state infers it may reason about it from the customer's message.
        sb.append("\n주문 상태:\n")
                .append(orderState == null || orderState.isBlank() ? "(확인된 값 없음)" : orderState);
        return sb.toString().strip();
    }

    /** The two-argument form, kept for callers with no product knowledge to offer. */
    public static String user(String title, String details) {
        return user(title, details, java.util.List.of());
    }
}
