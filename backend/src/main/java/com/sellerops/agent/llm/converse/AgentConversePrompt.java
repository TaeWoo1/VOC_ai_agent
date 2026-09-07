package com.sellerops.agent.llm.converse;

import java.util.List;

/**
 * The prompt behind {@code POST /api/agent/converse} — the Grounded Conversation lane.
 *
 * <p><b>What leaves, and why it is the class of content this repository already sends.</b> Three
 * things: the seller's own sentence (the planner seam has always sent it), the last few sentences of
 * this thread — the seller's and the ones <i>we</i> composed (the judge seam sends a SellerOps-authored
 * sentence for the same reason) — and a FACT SHEET this deployment assembled about itself from its own
 * tool catalogue, its own coverage table and its own capability resolver. No review body, no inquiry
 * body, no customer utterance, no buyer field, no identifier that means anything outside this turn.
 *
 * <p><b>The model is given facts and asked to answer, not given an answer and asked to say it.</b> That
 * is the whole point of the package: the deterministic composer could only answer the five questions
 * someone had already thought of, and every new question needed a new token. Here the fact sheet is the
 * ground and the question is whatever the seller typed.
 *
 * <p><b>Three instructions carry the safety, and each of them is a defect this repository already
 * had.</b> Say nothing that is not on the sheet (the product must not describe a competitor, or a
 * capability, it cannot check). Do not promise a send (every write in this product goes through an
 * approval the chat lane cannot reach). Do not print our internal words (an enum in a seller's answer
 * is how 「NOT_SUPPORTED」 once reached a screen).
 */
public final class AgentConversePrompt {

    /** Bump on every wording change. Stamped into the provenance a turn records. */
    public static final String PROMPT_VERSION = "agent-converse-prompt/v1";

    private AgentConversePrompt() {
    }

    public static String system() {
        return """
               당신은 한국 이커머스 판매자를 돕는 AI 운영 담당자 'reviewnary'(리뷰너리)입니다. \
               판매자가 이 제품에 대해 묻는 질문에, 아래에 주어지는 「제품 사실」만을 근거로 직접 답합니다.

               지켜야 할 것:
               1. 제품 사실에 없는 것은 사실로 말하지 마세요. 모르면 모른다고 말하고, 대신 확인할 수 있는 것을 말하세요.
               2. 다른 회사·다른 서비스·가격·시장 점유율처럼 제품 사실에 없는 외부 정보는 단정하지 마세요. \
               비교를 요청받으면 "그 서비스에 대해서는 제가 정확히 알지 못합니다"라고 말한 뒤, \
               우리가 실제로 하는 일을 사실 목록에서 골라 설명하세요.
               3. 질문에 직접 답하세요. 묻지 않은 소개나 목록을 덧붙이지 마세요. \
               앞선 대화에서 이미 말한 문장을 그대로 반복하지 마세요 — 다만 새 질문에 필요하면 같은 사실을 근거로 다시 써도 됩니다.
               4. 짧게 쓰세요. 3~6문장, 필요하면 항목 3개 이하. 문서처럼 길게 쓰지 마세요.
               5. 할 수 없는 것을 묻거든 사실 목록에 적힌 한계를 그대로 말하세요. 없는 기능을 약속하지 마세요.
               6. 채널에 답변이나 답글을 '대신 보낸다'고 말할 수 있는 것은 사실 목록이 그렇게 적은 채널·동작뿐입니다. \
               그 밖에는 초안까지 준비하고 보내는 것은 판매자가 확인한 뒤라고 말하세요.
               7. 내부 용어를 쓰지 마세요: 영문 대문자 코드값, 도구 이름, 파일명, 설정 키, 내부 상태 이름.
               8. 한국어 존댓말로, 판매자에게 말하듯 씁니다. 이모지·마크다운 표·제목 기호는 쓰지 마세요.

               반드시 아래 형태의 JSON 객체 하나만 출력하세요. 다른 텍스트, 설명, 코드펜스는 금지입니다.
               {"answered":true,"answer":"..."}

               제품 사실만으로 그 질문에 아무것도 답할 수 없으면 {"answered":false,"answer":""} 로 답하세요.
               """;
    }

    /**
     * The user turn — <b>the payload floor</b>.
     *
     * <p>Four sections and nothing else: what this deployment can prove about itself, the closed-token
     * description of where the conversation is standing, the last few sentences of the thread, and the
     * question. {@code AgentConversePayloadFloorTest} asserts on the serialized bytes that a caller
     * passing a customer body cannot get it here.
     */
    public static String user(List<String> facts, List<String> context, List<String> recentTurns,
                              String question) {
        StringBuilder out = new StringBuilder();
        out.append("제품 사실:\n");
        for (String fact : facts) {
            out.append("- ").append(fact).append('\n');
        }
        if (!context.isEmpty()) {
            out.append("\n현재 상태:\n");
            for (String line : context) {
                out.append("- ").append(line).append('\n');
            }
        }
        if (!recentTurns.isEmpty()) {
            out.append("\n최근 대화:\n");
            for (String turn : recentTurns) {
                out.append(turn).append('\n');
            }
        }
        out.append("\n판매자 질문: ").append(question == null ? "" : question);
        return out.toString();
    }
}
