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
 * <p><b>v3 adds what the seller asked the runtime to DO and how the sentence relates to the last
 * turn</b> — {@code requestedAction}, {@code tone}, {@code filters} and {@code target}, every one a
 * closed token. They exist because a conversation's second sentence ("안 좋은 것만") has no noun of
 * its own: the noun is the working set the previous turn produced, and the runtime tells the planner
 * about it in the same closed vocabulary (kind · period · channel · rating · product fixed?) so the
 * planner can refine instead of refusing. None of this is interpreted by keyword anywhere else —
 * the planner is still the only thing that reads the sentence.
 *
 * <p><b>The tool catalogue is interpolated from the caller's own registry</b>, never restated in prose,
 * for the reason {@code AgentDraftPrompt} interpolates its categories: a prompt that names its options
 * by hand drifts from the code that executes them, and the first symptom is a plan naming a tool that
 * does not exist.
 */
public final class AgentPlanPrompt {

    /** Bump on every wording change. Stamped into the provenance a run records. */
    public static final String PROMPT_VERSION = "agent-plan-prompt/v3";

    /** The closed set of specialists a plan may name. */
    public static final String[] SPECIALISTS = {
        "PRODUCT_OPS", "REVIEW_OPS", "INQUIRY_OPS", "REPORT_OPS", "ORDER_OPS",
    };

    /**
     * What the seller asked the runtime to DO after the reading, beyond answering. Closed, and the
     * only values with any effect downstream: a prepare step that saves a draft version on the
     * existing draft path, a request to hand a prepared draft to the existing approval boundary, or
     * a request to open a screen. There is no value that sends anything.
     */
    public static final String[] REQUESTED_ACTIONS = {
        "NONE", "PREPARE_INQUIRY_DRAFT", "REQUEST_SEND_APPROVAL", "OPEN_WORKSPACE", "LIST_ACTIONS", "EXPLAIN_CAPABILITY",
    };

    /** Draft wording hints — MANNER only; a hint can never carry a fact. */
    public static final String[] TONES = {"SOFTER", "MORE_FORMAL", "SHORTER"};

    /** Closed filter vocabularies. Every value is a token; none can be a customer word or an id. */
    public static final String[] PERIODS = {
        "TODAY", "YESTERDAY", "THIS_WEEK", "LAST_WEEK", "LAST_7_DAYS", "LAST_14_DAYS", "LAST_30_DAYS",
    };
    public static final String[] RATINGS = {"ALL", "LOW"};
    public static final String[] CHANNELS = {"NAVER", "COUPANG", "CAFE24"};
    public static final String[] SCOPES = {"WORKING_SET"};
    public static final String[] TOPICS = {"SHIPPING", "EXCHANGE_RETURN", "PRODUCT_SPEC", "USAGE", "OTHER"};
    public static final String[] TARGET_SELECTORS = {"FIRST", "NTH", "ALL", "THIS", "NONE"};

    /**
     * The closed set of information-need kinds.
     *
     * <p>They name EVIDENCE, not tools. A need says what must be known; the retrieval order and the
     * specialist decide what to call. If these were tool names, two goals could "differ" only by call
     * order and the divergence test would be measuring nothing.
     */
    public static final String[] NEED_KINDS = {
        "PRODUCT_FACT", "PRODUCT_LISTING", "PRODUCT_VARIANT", "PRODUCT_KNOWLEDGE_DOC", "POLICY",
        "CUSTOMER_HISTORY", "REVIEW_SIGNAL", "INQUIRY_VOLUME", "REPEAT_PATTERN", "ORDER_HISTORY",
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
               - **다만 "일부만 답할 수 있다"는 "답할 수 없다"가 아닙니다.** 목표가 두 축(예: 상품 × 채널)을 \
               요구하는데 한 축만 도구로 답할 수 있다면, supported 를 false 로 두지 말고 **답할 수 있는 축의 \
               need 를 세우세요.** 답하지 못한 축은 런타임이 그 자리에서 한계로 밝힙니다 — 계획이 통째로 \
               거부되면 판매자는 답할 수 있었던 절반까지 잃습니다. supported=false 는 목표의 **어느 부분도** \
               지금 도구로 닿을 수 없을 때만 쓰세요.
               - 도구는 꼭 필요한 것만 고르세요. 많이 고를수록 답이 느려지고 나빠집니다.
               - **PRODUCT_FACT 와 PRODUCT_KNOWLEDGE_DOC 는 출처가 다른 두 가지입니다.** 앞의 것은                채널이 명시한 값(규격·가격·원산지)이고, 뒤의 것은 판매자가 직접 써 둔 글(상품 설명·FAQ·               사용법·교환반품 정책)입니다. "이 상품 어떻게 쓰나요", "고객에게 어떻게 설명하지",                "반품 규정이 뭐였지" 처럼 **판매자가 쓴 문장이 있어야 답할 수 있는 질문**은                PRODUCT_KNOWLEDGE_DOC 입니다. 치수·용량 같은 값 하나를 묻는 질문은 PRODUCT_FACT 입니다.                두 가지가 다 필요하면 need 를 둘 세우세요.
               - **ORDER_OPS 는 주문·매출 흐름을 답합니다** — 기간 합계, 직전 기간 대비 변화, 채널별 매출·주문, \
               일별 추이. need kind 는 ORDER_HISTORY 입니다. "매출이 왜 떨어졌어" 류는 ORDER_HISTORY(필수)를 \
               세우고, 리뷰나 문의의 변화를 함께 물었을 때만 REVIEW_SIGNAL / INQUIRY_VOLUME 을 추가하세요.
               - **REVIEW_SIGNAL 은 반복되는 문제만이 아니라 리뷰 행 목록도 뜻합니다** — "새 리뷰", "오늘 들어온 \
               리뷰", "낮은 평점 리뷰 목록". "오늘 새 리뷰 보여줘" 는 REVIEW_SIGNAL 에 filters.period=TODAY 입니다.
               - **이어지는 대화.** "지금까지의 진행" 에 `직전 작업 집합: <KIND> (기간:<PERIOD|없음>, \
               채널:<CHANNEL|전체>, 평점:<ALL|LOW>, 상품 특정:<예|아니오>)` 줄이 있을 수 있습니다. 새 문장이 그 \
               집합을 좁히거나·거르거나·넓히는 것이면("안 좋은 것만", "카페24만", "그 상품은?", "문의에서도 같은 \
               얘기 있어?", "상품별로 묶어줘") filters.scope 를 "WORKING_SET" 으로 두세요. 거르는 것이면 같은 \
               need kind 를 유지하고, 다른 영역으로 넘어가는 것이면 그 영역의 kind 를 추가하세요(리뷰 → \
               INQUIRY_VOLUME / REPEAT_PATTERN, 주문 → REVIEW_SIGNAL / INQUIRY_VOLUME). 새 기간을 말하지 않았으면 \
               직전 기간을 그대로 filters.period 에 적으세요. **문장에 명사가 없다는 이유로 supported 를 false 로 \
               두지 마세요 — 직전 작업 집합이 곧 그 명사입니다.**
               - **리뷰·상품 집합에서 문의로 건너가는 질문.** 직전 작업 집합이 REVIEWS 또는 PRODUCTS 이고 "문의에서도 \
               같은 얘기 있어?" 처럼 같은 문제가 문의에도 있는지 물으면, **필수 need 는 INQUIRY_VOLUME 이고 \
               filters.scope 는 "WORKING_SET"** 입니다 — 런타임이 그 집합의 상품에 묶어 문의를 읽습니다. \
               REPEAT_PATTERN 은 있어도 required=false 인 보조 need 로만 두세요. REPEAT_PATTERN 만 세우면 답은 그 \
               집합이 아니라 조직 전체의 반복 문제가 됩니다.
               - **requestedAction.** 답변을 준비·작성·다시 써 달라는 요청(준비해줘·써줘·답장·더 부드럽게·짧게)은 \
               PREPARE_INQUIRY_DRAFT, 보내·전송·등록·게시해 달라는 요청(보내자·전송·등록·게시해)은 \
               REQUEST_SEND_APPROVAL, 화면을 열어 달라고 명시한 경우("문의 화면 열어줘")만 OPEN_WORKSPACE, 그 \
               밖에는 NONE 입니다. **이 두 값은 문의뿐 아니라 리뷰에도 그대로 적용됩니다**: 직전 작업 집합이 REVIEWS 일 때 \
               "첫 번째 리뷰 답변해줘 / 답글 써줘" 는 PREPARE_INQUIRY_DRAFT + REVIEW_SIGNAL(scope WORKING_SET) + \
               target 이고, "게시해 / 네이버에서 답변하게 열어줘 / 보내자" 는 REQUEST_SEND_APPROVAL 입니다 — 채널별로 \
               API 로 보낼지, 판매자센터에서 이어서 할지, 지원하지 않는지는 런타임이 정하므로 당신은 채널을 판단하지 \
               마세요. 문의 집합 위에서의 초안·말투 요청은 런타임이 대상을 찾을 수 있도록 INQUIRY_VOLUME(scope \
               WORKING_SET) need 를 함께 세우세요.
               문장에 채널 이름(네이버·쿠팡·카페24)이 있으면 그 채널을 filters.channel 에 적으세요 — 「네이버 문의 정리해줘」는 \
               INQUIRY_VOLUME + filters.channel="NAVER" 입니다. \
               판매자가 **왜 어떤 채널에서는 답변/전송/수집이 안 되는지, 되는지**를 물으면("쿠팡 건은 왜 답변 못 해?", \
               "네이버 리뷰는 왜 자동으로 안 가져와?") EXPLAIN_CAPABILITY 입니다 — 조사가 아니라 설명이므로 need 는 \
               비워도 되고, 채널을 말했으면 filters.channel 에 적으세요. \
               판매자가 **자신이 해야 할 행동의 목록**을 요청하면("내가 해야 할 일 정리해줘", "오늘 뭐 해야 해") \
               LIST_ACTIONS 입니다 — 이때 INQUIRY_VOLUME / REVIEW_SIGNAL / ORDER_HISTORY need 를 함께 세울 수 \
               있습니다. LIST_ACTIONS 는 목록을 만들라는 뜻이지 무엇을 실행하라는 뜻이 아닙니다.
               - **tone** 은 PREPARE_INQUIRY_DRAFT 일 때만: "더 부드럽게 / 덜 딱딱하게" → SOFTER, "더 정중하게" → \
               MORE_FORMAL, "짧게" → SHORTER, 그 밖에는 null.
               - **target** 은 집합 안의 어느 것인지: "첫 번째 거" → FIRST, "두 번째" → NTH 에 index 2, "이 두 \
               문의" → ALL, 문맥에 문의 하나가 특정돼 있을 때의 "이 문의" → THIS, 그 밖에는 NONE.
               - **filters.topic** 은 문의 주제: "배송 관련부터" → SHIPPING. 없으면 null.

               specialist: %s
               informationNeeds[].kind: %s
               unresolvedEntities[].kind: %s
               riskClass: ROUTINE | SENSITIVE | REFUSE
               requestedAction: %s
               tone: %s | null
               filters.period: %s | null
               filters.rating: %s | null
               filters.channel: %s | null
               filters.scope: %s | null
               filters.topic: %s | null
               target.selector: %s

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
                "rationale":"<한 문장>",
                "requestedAction":"NONE",
                "tone":null,
                "filters":{"period":null,"rating":null,"channel":null,"scope":null,"topic":null},
                "target":{"selector":"NONE","index":null}}
               """
                .formatted(String.join(", ", SPECIALISTS), String.join(", ", NEED_KINDS),
                        String.join(", ", ENTITY_KINDS), String.join(" | ", REQUESTED_ACTIONS),
                        String.join(" | ", TONES), String.join(" | ", PERIODS), String.join(" | ", RATINGS),
                        String.join(" | ", CHANNELS), String.join(" | ", SCOPES), String.join(" | ", TOPICS),
                        String.join(" | ", TARGET_SELECTORS));
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
