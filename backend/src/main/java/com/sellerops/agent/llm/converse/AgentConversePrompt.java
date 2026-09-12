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
 *
 * <p><b>v2 — the generalisation rules (Product Self-Knowledge Truth Closure v1).</b> Manual QA on a
 * clean seller produced seven sentences that were each grounded in a line of the sheet and wrong as
 * stated. Every one of them failed the same way: a fact the sheet gave PER CHANNEL, PER OBJECT or as a
 * CAPABILITY came back as a claim about the whole product, in the present tense. 「자동으로 문의·리뷰·
 * 주문을 가져와 읽고」 was said with 「네이버·쿠팡 리뷰 가져오기 — 판매자님이 …확인해 주시면」 sitting two
 * lines below it, and 「다루는 영역은 …뿐」 turned a derived list into an exclusion. So v2 adds the
 * rules the sheet's own shape needs: do not widen a channel's fact to every channel, do not read
 * 「할 수 있다」 as 「하고 있다」, do not strengthen an UNKNOWN or PARTIAL, and use an exclusive or global
 * word only where a fact says it. The rules are about SHAPE — they add no fact and remove none.
 *
 * <p><b>v3 — the Canonical Product Source arrives (Grounded Conversation wiring).</b> The sheet now
 * carries lines a human reviewed and approved, and three of its shapes did not exist before: a line
 * marked as a DIRECTION (a decision about how the product should work), a line marked as a future
 * item and carrying its own hedge, and a channel row that is split by SUBTYPE because one object is
 * several contracts. Each needs a rule, and each rule is about shape rather than content: a direction
 * is not something the product does today, a future item may only be spoken with the hedge it arrived
 * with, and a subtype's answer may not be read as the whole object's. The fourth rule is the one that
 * keeps evidence honest without ever naming it — a limitation travels with the fact it limits, so
 * dropping 「다만 …한 적이 없습니다」 is how an implemented capability becomes a proven one.
 */
public final class AgentConversePrompt {

    /** Bump on every wording change. Stamped into the provenance a turn records. */
    public static final String PROMPT_VERSION = "agent-converse-prompt/v4";

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
               9. 특정 채널이나 특정 대상(상품·주문·문의·리뷰)에 대한 사실을 제품 전체의 사실로 넓히지 마세요. \
               사실 목록이 「네이버 리뷰」에 대해 말한 것은 네이버 리뷰에 대한 것입니다. \
               일부 채널에만 해당하는 것을 모든 채널에 해당하는 것처럼 쓰지 말고, \
               채널마다 다르면 다르다고 말한 뒤 묻는 채널만 구체적으로 답하세요.
               10. 「할 수 있다」와 「지금 하고 있다」를 구분하세요. \
               사실 목록이 가능성만 말했으면 가능성으로 쓰고, 지금 실제로 그렇게 하고 있다고 쓰지 마세요.
               11. 사실 목록이 「확인되지 않았다」·「일부만 가능하다」로 적은 것을 \
               「된다」·「안 된다」로 바꾸지 마세요. 확인되지 않은 것은 확인되지 않았다고 말하세요.
               12. 「뿐」·「밖에」·「항상」·「모든」·「절대」·「전혀」 같은 배타적·전역 표현은 \
               사실 목록이 그렇게 명시한 경우에만 쓰세요. \
               특히 우리가 다루는 범위를 말할 때 그 목록이 전부라고 단정하지 마세요.
               13. 「제품 방향」으로 표시된 사실은 이미 정한 방식에 대한 설명이고, \
               「앞으로의 방향」으로 표시된 사실은 아직 만들지 않은 것입니다. \
               둘 다 지금 되는 기능처럼 말하지 마세요. \
               「앞으로의 방향」을 언급할 때는 그 사실에 함께 적힌 한정어를 반드시 같이 말하세요.
               14. 사실 뒤에 「다만 …」으로 붙은 한계는 그 사실과 한 몸입니다. \
               앞부분만 말하고 한계를 빼지 마세요 — 특히 「실행된 적이 없습니다」·「관측된 적이 없습니다」처럼 \
               아직 실제로 해 보지 않았다고 적힌 것을 이미 해 본 것처럼 말하지 마세요.
               15. 한 채널의 한 대상이 종류별로 나뉘어 적혀 있으면(예: 문의의 종류), \
               그중 하나에 해당하는 사실로 전체를 말하지 마세요. 종류마다 다르면 다르다고 말하세요.

               16. 지금 어떻게 돌아가고 있는지를 묻는 질문에는 **상태를 먼저 답하세요** — 채널과 대상을 \
               훑어 나열하지 마세요. 「제품에는 자동으로 가져오는 경로가 있다」와 「지금 이 환경에서 \
               자동으로 갱신되고 있는가」 두 가지면 충분하고, 어떤 채널의 무엇이 자동인지는 판매자가 \
               범위를 다시 물었을 때 답하세요. 목록이 답인 질문은 판매자가 목록을 물은 질문뿐입니다.

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
