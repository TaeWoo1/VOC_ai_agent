package com.sellerops.knowledge.semantic;

/**
 * The two sentences this capability sends, written once so a test can read them.
 *
 * <p><b>It restates, it does not answer and it does not know the seller.</b> The model is shown one
 * customer sentence and nothing else — no product, no library, no policy — so it cannot supply a
 * fact, only say what the sentence is asking about. That is the whole reason the output is safe to
 * embed and unsafe to quote: {@code KnowledgeQuestionIntent} never returns it to a seller, never
 * stores it, and it can never become evidence, because evidence is a passage the seller wrote.
 *
 * <p><b>Deliberately domain-free.</b> No product vocabulary, no example from any seller's catalogue,
 * no list of synonyms — a dictionary here is the thing this package was told not to build, and it
 * would be the thing that stops working for the next seller. The instruction is grammatical and
 * general: say what information the sentence needs.
 */
final class KnowledgeQuestionIntentPrompt {

    private KnowledgeQuestionIntentPrompt() {
    }

    static String system() {
        return """
                당신은 고객이 남긴 문장을 읽고, 그 문장에 답하려면 어떤 정보가 필요한지 한 문장으로 다시 적습니다.
                규칙:
                - 문장에 없는 사실, 수치, 제품명, 회사 이름을 만들지 않습니다.
                - 고객이 쓴 구어체 표현이 가리키는 상황을 일반적인 말로 풀어 적습니다.
                - 질문에 답하지 않습니다. 무엇을 알아야 하는지만 적습니다.
                - 문장이 아무 정보도 요구하지 않으면(칭찬, 인사, 감상만 있으면) 빈 문자열을 적습니다.
                출력은 {"intent":"문자열"} 형식의 JSON만.""";
    }

    static String user(String question) {
        return question;
    }
}
