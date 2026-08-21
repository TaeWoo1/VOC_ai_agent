package com.sellerops.agent.llm.operator;

import java.util.List;

/**
 * The prompt behind {@code POST /api/agent/plan} — goal interpretation and INVESTIGATION DESIGN.
 *
 * <p><b>What changed in Operator Graph v2, and why it had to.</b> v1 asked for a specialist list and a
 * tool list, which is an intent label wearing two arrays. Measured consequence: "폭이 몇 mm인가요?" and
 * "교환 가능한가요?" produced the same plan, so the same specialist read the same sources in the same
 * order and answered both from evidence that suited neither. v2 asks for {@code informationNeeds} — what
 * must be found out — and a {@code retrievalOrder} over them. Two goals that need different things now
 * differ structurally, which is what makes the divergence acceptance test possible at all.
 *
 * <p><b>The payload floor is unchanged and is still the mildest of the four capabilities.</b> What
 * leaves is the operator's OWN typed sentence, a STATIC catalogue of tool names and purposes, and — on
 * a re-plan — a closed-vocabulary summary of which needs are still open. No customer utterance, no
 * seller row, no id, no count, no org. {@code AgentOperatorPayloadFloorTest} asserts it on the
 * serialized bytes.
 *
 * <p><b>The model may not emit an id.</b> The schema offers only {@code mention} strings, and the
 * instructions say so outright. A planner that could name a {@code productId} would name a plausible
 * one; the tool would read it, find nothing, and the Operator would report calm about a product nobody
 * looked at. Resolution is a tool's job and the validator rejects any plan that arrives pre-resolved.
 *
 * <p><b>The tool catalogue is interpolated from the caller's own registry</b>, never restated in prose,
 * for the reason {@code AgentDraftPrompt} interpolates its categories: a prompt that names its options
 * by hand drifts from the code that executes them, and the first symptom is a plan naming a tool that
 * does not exist.
 */
public final class AgentPlanPrompt {

    /** Bump on every wording change. Stamped into the provenance a run records. */
    public static final String PROMPT_VERSION = "agent-plan-prompt/v2";

    /** The closed set of specialists a plan may name. */
    public static final String[] SPECIALISTS = {"PRODUCT_OPS", "REVIEW_OPS", "INQUIRY_OPS", "REPORT_OPS"};

    /**
     * The closed set of information-need kinds.
     *
     * <p>They name EVIDENCE, not tools. A need says what must be known; the retrieval order and the
     * specialist decide what to call. If these were tool names, two goals could "differ" only by call
     * order and the divergence test would be measuring nothing.
     */
    public static final String[] NEED_KINDS = {
        "PRODUCT_FACT", "PRODUCT_LISTING", "PRODUCT_VARIANT", "POLICY", "CUSTOMER_HISTORY",
        "REVIEW_SIGNAL", "INQUIRY_VOLUME", "REPEAT_PATTERN", "ORDER_HISTORY",
    };

    /** The closed set of entity kinds a mention may carry. */
    public static final String[] ENTITY_KINDS = {
        "PRODUCT", "CHANNEL", "ORDER", "INQUIRY", "ISSUE", "PERIOD",
    };

    private AgentPlanPrompt() {
    }

    public static String system() {
        return """
               당신은 한국 이커머스 판매자의 운영 보조 시스템의 조사 설계 담당입니다. 판매자가 말한 목표 \
               한 문장을 읽고, 그 목표에 답하려면 무엇을 알아내야 하는지 설계합니다.

               가장 중요한 규칙:
               - 당신은 데이터를 보지 않습니다. 조사 계획만 세웁니다. 사실을 지어내지 마세요.
               - **id 를 만들어내지 마세요.** 상품·주문·문의의 내부 id 는 당신이 알 수 없고, 알 필요도 \
               없습니다. 판매자가 말한 표현(mention)만 그대로 적으세요. 실제 해석은 도구가 합니다.
               - 서로 다른 질문은 서로 다른 informationNeeds 를 가져야 합니다. 규격 질문, 교환 정책 질문, \
               과거 구매와 다르다는 문의는 필요한 정보가 서로 다릅니다.
               - 목록에 없는 specialist / tool / kind 이름을 만들어내지 마세요. 목록 밖 이름은 거부됩니다.
               - 목표가 지원 범위 밖이면 supported 를 false 로 두세요. 무엇을 묻는지 알 수 없으면 \
               clarificationNeeded 를 true 로 두고 무엇이 불명확한지 적으세요. 억지 계획보다 되묻는 편이 낫습니다.
               - 도구는 꼭 필요한 것만 고르세요. 많이 고를수록 답이 느려지고 나빠집니다.

               specialist: %s
               informationNeeds[].kind: %s
               unresolvedEntities[].kind: %s
               riskClass: ROUTINE | SENSITIVE | REFUSE

               반드시 아래 형태의 JSON 객체 하나만 출력하세요. 다른 텍스트, 설명, 코드펜스는 금지입니다.
               {"supported":true,
                "userGoal":"<판매자 목표를 한 문장으로 다시 적기>",
                "unresolvedEntities":[{"kind":"PRODUCT","mention":"<판매자가 말한 표현 그대로>"}],
                "informationNeeds":[{"id":"n1","question":"<무엇을 알아내야 하는가>","kind":"<위 목록 중 하나>",
                                     "why":"<한 문장>","required":true}],
                "specialists":["..."],
                "tools":["..."],
                "retrievalOrder":["n1","n2"],
                "retrievalParallel":["n2"],
                "retrievalStopWhen":"<더 볼 필요가 없어지는 조건 또는 빈 문자열>",
                "evidenceRequirements":[{"needId":"n1","minEvidence":1,"acceptableKinds":["..."]}],
                "riskClass":"ROUTINE",
                "maxIterations":2,
                "maxToolCalls":8,
                "stopWhenEnough":"<한 문장>",
                "clarificationNeeded":false,
                "clarificationReason":"",
                "rationale":"<한 문장>"}
               """
                .formatted(String.join(", ", SPECIALISTS), String.join(", ", NEED_KINDS),
                        String.join(", ", ENTITY_KINDS));
    }

    /**
     * The user turn — <b>the payload floor</b>.
     *
     * <p>Exactly three things can leave: the operator's own goal sentence, the static tool catalogue the
     * caller passed in, and — only on a re-plan — a closed-vocabulary progress line the caller built
     * from need ids and statuses. {@code AgentPlanPayloadFloorTest} asserts this on the serialized
     * request bytes, because a check on what this method meant to send would keep passing after someone
     * added the org id "for correlation".
     */
    public static String user(String goalText, List<String> toolCatalogue, String priorContext) {
        StringBuilder out = new StringBuilder();
        out.append("목표: ").append(goalText == null ? "" : goalText);
        out.append("\n사용 가능한 도구:\n")
           .append(String.join("\n", toolCatalogue == null ? List.of() : toolCatalogue));
        if (priorContext != null && !priorContext.isBlank()) {
            // Need ids and statuses only. Never an evidence value, never a count, never a customer word.
            out.append("\n지금까지의 진행:\n").append(priorContext.strip());
        }
        return out.toString();
    }

    /** The single-turn form, for the first plan of a run. */
    public static String user(String goalText, List<String> toolCatalogue) {
        return user(goalText, toolCatalogue, null);
    }
}
