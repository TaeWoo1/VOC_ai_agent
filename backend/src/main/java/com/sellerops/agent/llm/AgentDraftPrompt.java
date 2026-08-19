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
    public static final String PROMPT_VERSION = "agent-draft-prompt/v1";

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
     * <p>Exactly two values of the seller's content leave: the inquiry's own {@code title} and
     * {@code details}. Not the buyer's name, not an order id, not a work-item or inquiry UUID, not
     * the org, not the channel, not the phase, not a timestamp. {@code AgentDraftPayloadFloorTest}
     * asserts this on the serialized request bytes rather than on this method's intent, which is the
     * only way the floor stays true after the next edit.
     *
     * <p>A null body is rendered as an empty line rather than the string "null": the model would
     * otherwise be answering a question about a literal four-letter word.
     */
    public static String user(String title, String details) {
        return "제목: " + (title == null ? "" : title) + "\n본문:\n" + (details == null ? "" : details);
    }
}
