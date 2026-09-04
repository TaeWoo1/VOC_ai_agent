package com.sellerops.agent.llm.report;

/**
 * The prompt behind the report narrative.
 *
 * <p><b>What leaves.</b> The facts snapshot, serialized — every value the report screen also prints.
 * No review body, no inquiry body, no quote, no buyer field, no org id. {@code AgentReportPayloadFloorTest}
 * asserts it on the serialized bytes.
 *
 * <p><b>What is asked.</b> Restate, do not explain. Every sentence must name the fact ids it rests on;
 * a cause or an outcome is forbidden outright, and the model is told to say the cause is unknown
 * rather than guess one. The instruction is not the safeguard — {@link com.sellerops.report.NarrativeClaimGuard}
 * is — but a model told the rule breaks it less, and every refused line is a line the seller does not get.
 */
public final class AgentReportPrompt {

    /** Bump on every wording change. Stamped into the provenance a report records. */
    public static final String PROMPT_VERSION = "agent-report-prompt/v1";

    private AgentReportPrompt() {
    }

    public static String system() {
        return """
               당신은 한국 이커머스 판매자의 운영 담당자입니다. 한 기간의 운영 사실(JSON)을 받아, 판매자 대표가 \
               30초 안에 읽을 짧은 운영 요약을 씁니다.

               규칙:
               1. 사실만 다시 말합니다. JSON 에 없는 숫자·상품·문제를 만들지 않습니다.
               2. 모든 문장은 근거가 된 fact id 를 facts 배열에 적습니다 (counters·issues·opportunities·nextSteps 의 id). \
               id 를 댈 수 없는 문장은 쓰지 않습니다.
               3. 원인을 말하지 않습니다. "…때문", "원인은", "품질이 나빠졌다", "매출", "만족도" 같은 원인·성과 표현은 금지입니다. \
               원인을 모르면 "원인은 자료가 말해주지 않습니다"라고 씁니다.
               4. 해석은 "확인할 필요가 있습니다" 수준까지만 합니다. 늘었다는 사실과 확인하라는 제안은 되고, 왜 늘었는지는 안 됩니다.
               5. 순서: 무엇이 달라졌는지 → 어떤 문제가 반복됐는지 → 어떤 개선 기회가 있는지 → 다음에 무엇을 하면 되는지.
               6. 최대 6문장, 한 문장은 짧게. 존댓말.
               7. 달라진 것이 없으면 그렇다고 한 문장으로 씁니다.

               반드시 아래 형태의 JSON 객체 하나만 출력하세요. 다른 텍스트, 설명, 코드펜스는 금지입니다.
               {"headline":"한 줄 요약","lines":[{"text":"문장","facts":["c-reviews"]}]}
               """;
    }

    /** The facts, and nothing else. */
    public static String user(String factsJson) {
        return "이번 기간의 운영 사실:\n" + factsJson;
    }
}
