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
 *
 * <p><b>v10 asks for less, because the answer's LENGTH is the turn's latency.</b> Agent Responsiveness
 * v1 measured one plan call as 98–99% of every free-sentence turn, and the call's duration tracks the
 * number of tokens it emits. So the schema was audited against the code that reads it: {@code why} on
 * every need, {@code retrievalStopWhen}, {@code retrievalParallel} and {@code stopWhenEnough} had
 * <b>no consumer anywhere in agent-runtime</b> — the validator copied them into a plan object and
 * nothing ever read them again. They were prose the model wrote, the network carried and the seller
 * waited for, and removing them removes exactly that. {@code rationale} and {@code clarificationReason}
 * are read on one branch each, so they are now asked for on those branches only. Nothing that decides
 * WHAT the run does was touched: needs, kinds, specialists, tools, evidence requirements, filters,
 * target, action and tone are all unchanged, which is why the accuracy suite is comparable across
 * versions.
 *
 * <p><b>v16 is v15's rules, regrouped — and that claim was measured, not asserted.</b> v15 was one
 * flat run of about thirty dashes in which the routing rules, the token-reading rules, the follow-up
 * rules and the refusal rules were interleaved. v16 puts each rule under the decision it belongs to
 * ([1] absolute rules · [2] which need kind · [3] which token to copy out of the sentence · [4] what
 * the seller asked for · [5] the continuing conversation · [6] when a plan cannot be made). Compared
 * character by character with whitespace removed, v16 is v15's text plus 178 heading characters, four
 * bullet markers and three fewer line-continuations — <b>no rule was added, removed or reworded</b>,
 * and no keyword exception or seller-specific phrase was introduced.
 *
 * <p>Both were run as arms of {@code agent-runtime/bench} over the scenario eval, three passes each,
 * with the model, effort, schema, tool catalogue and validator identical: selection 94.4% → 95.8%,
 * holdout 92.9% → 92.9%, plan p50 2,677ms → 2,129ms, and the turns v16 fails are a strict subset of
 * the turns v15 fails. The reason it was adopted is not the 1.4 points — the blind holdout did not
 * reproduce those — but that v15 intermittently lost the first-morning question (two flakes in three
 * passes) and v16 lost nothing in six. It costs 120 more input tokens per call and, because it emits
 * slightly fewer, the same money. See {@code docs/planner_model_prompt_benchmark_v1.md}.
 */
public final class AgentPlanPrompt {

    /** Bump on every wording change. Stamped into the provenance a run records. */
    public static final String PROMPT_VERSION = "agent-plan-prompt/v21";

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
        "TODAY", "YESTERDAY", "THIS_WEEK", "LAST_WEEK", "THIS_MONTH", "LAST_MONTH",
        "LAST_7_DAYS", "LAST_14_DAYS", "LAST_30_DAYS", "LAST_N_DAYS",
    };
    /**
     * The largest trailing window {@code LAST_N_DAYS} may name (Conversation Contract Correctness v2).
     *
     * <p>v10 held seven period tokens and a seller may name any number of days: 「최근 3일 안에 들어온
     * 문의만 보여줘」 matched none of them, the axis arrived empty, and the read answered about every
     * inquiry the org has ever received. Adding {@code LAST_3_DAYS} would have left the same hole at
     * 「최근 5일」, so the axis gained a SHAPE — a token plus the count the seller said — rather than one
     * more value. Every other filter stays a closed token.
     */
    public static final int MAX_PERIOD_DAYS = 365;
    public static final String[] RATINGS = {"ALL", "LOW"};
    public static final String[] CHANNELS = {"NAVER", "COUPANG", "CAFE24"};
    public static final String[] SCOPES = {"WORKING_SET"};
    public static final String[] TOPICS = {"SHIPPING", "EXCHANGE_RETURN", "PRODUCT_SPEC", "USAGE", "OTHER"};
    /**
     * Acceptance Closure §9: what a REVIEW_SIGNAL need is FOR — the review rows themselves (ROWS) or the
     * repeated problems across them (ISSUES). A closed plan token, so the runtime never infers it from the
     * sentence and a request for recent reviews can never fall through to the repeated-problems reader.
     */
    public static final String[] REVIEW_INTENTS = {"ROWS", "ISSUES"};
    /**
     * Query Accuracy v1 (2026-08-28): what an INQUIRY_VOLUME need is FOR. {@code ROWS} = the customer's
     * inquiries themselves (any status, ordered, limited); {@code WORKLOAD} = what the seller still has to
     * answer, classified by draft state (the work queue); {@code COUNT} = one org-wide number;
     * {@code PRIORITY} = the same queue RANKED, for 「가장 시급한 건」 — a superlative question whose only
     * expressible shape used to be a list, so twenty rows were printed and nothing was answered. A closed
     * plan token, so 「최근 문의 3개」 and 「내가 답해야 할 문의」 never share a path by accident.
     */
    public static final String[] INQUIRY_INTENTS = {"ROWS", "WORKLOAD", "COUNT", "PRIORITY"};
    /**
     * v17 (2026-09-07): what an {@code EXPLAIN_CAPABILITY} request is FOR — the third member of the
     * family {@link #REVIEW_INTENTS} and {@link #INQUIRY_INTENTS} belong to.
     *
     * <p>Measured live on a clean seller: six different questions about the product all planned as
     * EXPLAIN_CAPABILITY (correctly), and four of them arrived with no needs, because there was no axis
     * on which 「어떤 채널을 지원해?」 and 「연동하고 나면 뭐가 되냐고」 differ. The runtime's only way to
     * tell product questions apart was «did this plan declare any needs», so they collapsed onto one
     * fixed answer and the follow-up repeated it. The repair is an axis, not a longer instruction and
     * not a phrase list: the runtime answers each aspect from what the tool catalogue, the coverage
     * table and the channel capability reads actually say.
     */
    /**
     * <b>v18 (2026-09-08) adds the two the measurement found missing.</b>
     *
     * <p>「판매자센터랑 뭐가 달라?」 and 「앞으로 뭐 할 거야?」 are ordinary product questions and neither is
     * any of the first five, so both arrived with a null aspect — and null WIDENS by design, which
     * handed the runtime every layer of the reviewed ledger at once: 84 fact lines, past the
     * conversation floor's own bound, refused outright, answered by the deterministic fallback. The fix
     * is a token each rather than a wider bound, because these are genuinely different questions. One
     * asks what this product does that another way of working does not; the other asks what does not
     * exist yet. Answering either from the whole ledger is not thorough — it is unanswered.
     */
    /**
     * <b>v19 (2026-09-08) adds the two that manual QA watched go somewhere else.</b>
     *
     * <p>「지금 자동으로 가져오고 있어?」 planned as AFTER_CONNECT and 「내가 매일 들어와야 해?」 planned as
     * an investigation — so a question about whether collection is running came back with a product
     * catalogue and repeated-issue evidence beside it, and a question about how often to log in came
     * back as the day's inquiry count. Neither answer is wrong about the store; both answer a question
     * the seller did not ask. These are STATE and OPERATION questions about the product, and each now
     * has a token so the runtime can answer from collection posture and connection state rather than
     * from a specialist's read.
     */
    /**
     * <b>v21 (2026-09-08): the two the ledger grew an answer for.</b>
     *
     * 「직원이랑 같이 써도 돼?」 and 「우리 회사 자료는 안전하게 관리돼?」 planned as PRODUCT_OVERVIEW,
     * which is correct as far as it goes and sends the whole product — every narrative, every feature
     * and the channel grid — for a question answered by four reviewed items. Measured live at 79 fact
     * lines against a floor of 80: the next few ledger additions would have dropped both questions back
     * onto the composed answer, silently. A token each is what makes the selection able to be small.
     */
    public static final String[] CAPABILITY_ASPECTS = {
        "PRODUCT_OVERVIEW", "SUPPORTED_CHANNELS", "AFTER_CONNECT", "CHANNEL_ACTION", "HOW_TO_CONNECT",
        "PRODUCT_DIFFERENCE", "FUTURE_DIRECTION", "COLLECTION_STATE", "DAILY_OPERATION",
        "TEAM_ACCESS", "SECURITY_AND_DATA",
    };
    /** Row order — the newest first, or the oldest first. Absent ⇒ NEWEST. */
    public static final String[] ORDERS = {"NEWEST", "OLDEST"};
    /** Which inquiries: still unanswered, already answered, or all. Absent ⇒ ROWS reads ALL, WORKLOAD is by nature UNANSWERED. */
    public static final String[] STATUSES = {"UNANSWERED", "ANSWERED", "ALL"};
    /** The most rows a plan may ask for. A limit above this is clamped, not refused. */
    public static final int MAX_LIMIT = 50;
    public static final String[] TARGET_SELECTORS = {"FIRST", "NTH", "ALL", "THIS", "NONE"};

    /**
     * The closed set of information-need kinds.
     *
     * <p>They name EVIDENCE, not tools. A need says what must be known; the retrieval order and the
     * specialist decide what to call. If these were tool names, two goals could "differ" only by call
     * order and the divergence test would be measuring nothing.
     */
    public static final String[] NEED_KINDS = {
        "PRODUCT_FACT", "PRODUCT_CATALOG", "PRODUCT_LISTING", "PRODUCT_VARIANT", "PRODUCT_KNOWLEDGE_DOC", "POLICY",
        "CUSTOMER_HISTORY", "REVIEW_SIGNAL", "INQUIRY_VOLUME", "REPEAT_PATTERN", "ORDER_HISTORY",
        "COMPANY_PROFILE", "PAST_ANSWER", "IMPROVEMENT_OPPORTUNITY",
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


               [1] 절대 규칙
               - 당신은 데이터를 보지 않습니다. 조사 계획만 세웁니다. 사실을 지어내지 마세요.
               - **id 를 만들어내지 마세요.** 상품·주문·문의의 내부 id 는 당신이 알 수 없고, 알 필요도 \
               없습니다. 판매자가 말한 표현(mention)만 그대로 적으세요. 실제 해석은 도구가 합니다.
               - 목록에 없는 specialist / tool / kind 이름을 만들어내지 마세요. 목록 밖 이름은 거부됩니다.
               - 서로 다른 질문은 서로 다른 informationNeeds 를 가져야 합니다. 규격 질문, 교환 정책 질문, \
               과거 구매와 다르다는 문의는 필요한 정보가 서로 다릅니다.
               - 도구는 꼭 필요한 것만 고르세요. 많이 고를수록 답이 느려지고 나빠집니다.

               [2] 무엇을 알아내야 하는가 — informationNeeds[].kind 고르기


               (2-1) 회사 자신에 대한 것
               - **회사 운영 기준은 POLICY 입니다.** 배송·주문 취소·교환·반품·환불·결제·세금계산서·현금영수증처럼 \
               상품과 무관하게 회사가 정해 둔 기준("우리 배송 정책 뭐였지", "환불 기준으로 답해줘")은 POLICY 이며 \
               상품을 특정할 필요가 없습니다 — 회사 기준만 묻는 문장에는 PRODUCT entity 를 만들지 마세요. POLICY need 는 \
               specialists 에 INQUIRY_OPS, tools 에 search_org_knowledge 를 넣으세요. 특정 상품의 설명·FAQ 에 적힌 \
               내용은 PRODUCT_KNOWLEDGE_DOC 입니다. **다만 그 주제의 "문의"를 보여 달라는 요청은 POLICY 가 아니라 \
               INQUIRY_VOLUME 입니다** — "현금영수증 관련 문의 보여줘"는 고객이 보낸 문의 목록을 달라는 뜻이고, \
               "현금영수증 기준이 뭐였지"만 POLICY 입니다.
               - **회사가 어떤 곳인지(등록된 회사 소개)는 COMPANY_PROFILE 입니다** — "우리 회사는 어떤 곳으로 등록돼 \
               있어", "우리 업체 특성을 고려해서" 처럼 회사 자체를 묻거나 참고하라고 할 때만 세우고(specialists 에 \
               INQUIRY_OPS, tools 에 get_seller_profile), 목록·개수·최근 문의·리뷰처럼 회사 소개가 필요 없는 질문에는 \
               세우지 마세요. 배송·환불·규격의 근거는 아닙니다.
               - **회사가 예전에 실제로 보내거나 승인한 답변("예전에 비슷한 문의에 뭐라고 답했어", "과거 승인 답변 \
               참고해서")은 PAST_ANSWER 입니다** — specialists 에 INQUIRY_OPS, tools 에 search_answer_memory. \
               CUSTOMER_HISTORY 는 고객·문의·리뷰의 과거 **사례 기록**(같은 문제를 본 적이 있는지)이지 답변 본문이 \
               아니므로, 답변 문장을 찾는 질문에 CUSTOMER_HISTORY 를 세우지 마세요.

               (2-2) 상품에 대한 것
               - **PRODUCT_FACT 와 PRODUCT_KNOWLEDGE_DOC 는 출처가 다른 두 가지입니다.** 앞의 것은                채널이 명시한 값(규격·가격·원산지)이고, 뒤의 것은 판매자가 직접 써 둔 글(상품 설명·FAQ·               사용법·교환반품 정책)입니다. "이 상품 어떻게 쓰나요", "고객에게 어떻게 설명하지",                "이 상품 반품 규정이 뭐였지" 처럼 **판매자가 쓴 문장이 있어야 답할 수 있는 질문**은                PRODUCT_KNOWLEDGE_DOC 입니다. 치수·용량 같은 값 하나를 묻는 질문은 PRODUCT_FACT 입니다.                두 가지가 다 필요하면 need 를 둘 세우세요.
               - **어떤 상품인지 지목하지 않고 상품 목록 자체를 묻는 질문**("우리 상품 목록 보여줘", "무슨 상품 \
               팔고 있지", "등록된 상품 뭐뭐 있어")은 PRODUCT_CATALOG 입니다 — specialists 에 PRODUCT_OPS, tools 에 \
               list_products. 상품 하나를 이름으로 지목한 질문에는 PRODUCT_CATALOG 를 쓰지 마세요(그때는 \
               PRODUCT_FACT / PRODUCT_KNOWLEDGE_DOC 이고 resolve_product 가 그 상품을 찾습니다).

               (2-3) 리뷰 · 문의 · 주문
               - **REVIEW_SIGNAL 은 반복되는 문제만이 아니라 리뷰 행 목록도 뜻합니다** — "새 리뷰", "오늘 들어온 \
               리뷰", "낮은 평점 리뷰 목록". "오늘 새 리뷰 보여줘" 는 REVIEW_SIGNAL 에 filters.period=TODAY 입니다. \
               **REVIEW_SIGNAL 을 세울 때는 filters.reviewIntent 를 반드시 정하세요**: 리뷰를 보여·확인·정리해 달라는 \
               요청("새 리뷰", "최근 리뷰", "상품평 보여줘", "안 좋은 리뷰")은 ROWS 입니다. **filters.period 는 판매자가 \
               기간을 말했을 때만 채우세요** — "오늘"·"어제"·"이번 주"·"최근 7일"처럼 문장에 있는 말만 옮기고, \
               "별점 낮은 리뷰 보여줘"처럼 기간이 없으면 null 로 두세요(기본 창은 실행이 정하고 답에 밝힙니다; 판매자가 \
               묻지 않은 "오늘"을 만들어 넣으면 답이 오늘에 대한 주장이 되어 버립니다); 반복되는 문제·이슈·경향을 묻는 \
               요청("반복되는 문제 있어?", "리뷰 문제 정리")만 ISSUES 입니다. 둘 중 무엇인지 정하지 못하겠으면 ROWS 입니다 \
               — 행은 보고 나서 문제를 물을 수 있지만, "반복 문제 없음"은 리뷰를 보여 달라는 요청에 대한 답이 아닙니다.
               - **반복되는 문제에서 무엇을 개선·보완할 수 있는지 묻는 질문은 IMPROVEMENT_OPPORTUNITY 입니다** \
               ("최근 반복 문제에서 개선할 만한 것 있어?", "FAQ나 상세페이지에 보완할 거 있나", "이 상품에서 손볼 데") \
               — specialists 에 REVIEW_OPS, tools 에 list_improvement_opportunities. 개선 기회는 리뷰 문제와 판매자 \
               지식에서 도구가 도출하므로 당신이 원인이나 대책을 적지 마세요. "반복되는 문제가 뭐야"처럼 문제 자체를 \
               묻는 질문은 여전히 REVIEW_SIGNAL(ISSUES) 이고, 상품 하나를 지목했으면 resolve_product 를 함께 넣으세요.
               - **문의 목록 질문에는 filters.inquiryIntent 를 반드시 정하세요.** 문의를 보여·확인해 달라는 요청 \
               ("최근 문의 3개", "오늘 들어온 문의", "네이버 문의 보여줘", "답변 안 한 것만", "가장 오래된 문의")은 \
               ROWS 이고, **판매자가 처리해야 할 일**을 묻는 요청("내가 답해야 할 문의", "오늘 처리할 문의 정리", \
               "초안 준비된 것")은 WORKLOAD 이며, **무엇을 먼저 처리해야 하는지 순위를 묻는 요청**("가장 시급한 건", \
               "급한 것부터", "먼저 볼 것", "어떤 것부터 처리할까")은 PRIORITY 이고, 숫자 하나만 묻는 요청("미답변 문의 \
               몇 건이야")은 COUNT 입니다. **특정 주제의 문의가 있는지 묻는 질문("현금영수증 관련 문의 있어?", \
               "파손 얘기 나온 적 있어?", "세금계산서 문의 받은 적 있나")도 ROWS 입니다** — 그런 질문의 답은 숫자가 \
               아니라 그 주제의 문의 행이고, COUNT 는 판매자가 숫자 하나만 물었을 때에만 씁니다. \
               답변을 준비·전송해 달라는 요청(requestedAction 이 NONE 이 아닐 때)과 「첫 번째 거」류 target 은 \
               WORKLOAD 위에서만 동작합니다. 정하지 못하겠으면 ROWS 입니다. **filters.period 는 문의가 접수된 \
               기간이고 ROWS 에만 적용됩니다** — 작업 큐(WORKLOAD)는 언제 들어왔든 지금 밀린 것 전부입니다. "오늘 \
               들어온 문의" 는 ROWS + period=TODAY, "어제 온 문의 중 답해야 할 것" 은 ROWS + period=YESTERDAY + \
               status=UNANSWERED, "오늘 내가 답해야 할 문의" 는 WORKLOAD 이고 period 는 null 입니다.
               - **ORDER_OPS 는 주문·매출 흐름을 답합니다** — 기간 합계, 직전 기간 대비 변화, 채널별 매출·주문, \
               일별 추이. need kind 는 ORDER_HISTORY 입니다. "매출이 왜 떨어졌어" 류는 ORDER_HISTORY(필수)를 \
               세우고, 리뷰나 문의의 변화를 함께 물었을 때만 REVIEW_SIGNAL / INQUIRY_VOLUME 을 추가하세요.

               [3] 문장에 있는 말을 그대로 옮겨 적을 값 — filters
               - **기간은 판매자가 말한 그 기간입니다.** 문장에 기간이 있으면 목록의 토큰 중 맞는 것을 고르고, \
               「최근 3일」·「지난 10일」처럼 목록에 없는 길이의 기간이면 period 를 LAST_N_DAYS 로 두고 \
               periodDays 에 그 날짜 수를 적으세요 — 가까운 토큰(LAST_7_DAYS)으로 바꾸지 마세요. \
               「이번 달」은 THIS_MONTH, 「지난달」·「저번 달」은 LAST_MONTH 이고, 달을 말한 문장을 주 단위 \
               토큰으로 바꾸지 마세요. 판매자가 말하지 않은 기간은 만들지 마세요(period 도 periodDays 도 null).
               - **개수·순서·상태는 문장에 있으면 반드시 토큰으로 적으세요.** "1개만", "3개", "두 개" → filters.limit 에 \
               정수; **하나를 묻는 최상급 표현("가장 최근 문의", "제일 오래된 건", "가장 시급한 건")은 filters.limit=1** \
               입니다 — 개수를 말하지 않았어도 하나를 물은 것입니다; "가장 최근", "최신" → filters.order=NEWEST; "가장 오래된", "먼저 들어온" → OLDEST; "답변 안 한", \
               "미답변" → filters.status=UNANSWERED, "답변한", "답변 완료" → ANSWERED, 둘 다 아니면 null. 이 값들은 \
               question 문장에만 적으면 실행되지 않습니다 — 런타임은 filters 만 읽습니다. 리뷰(REVIEW_SIGNAL) 에도 \
               limit·order 는 그대로 적용됩니다.
               - **filters.topic** 은 문의 주제: "배송 관련부터" → SHIPPING. 없으면 null. **다섯 값 중 어느 것에도 \
               맞지 않는 주제(현금영수증·세금계산서·파손·색상·A/S…)를 판매자가 말했으면 topic 은 null 로 두세요** — \
               억지로 OTHER 나 가까운 값을 고르지 마세요. 그 낱말은 런타임이 판매자가 쓴 그대로 문의 본문에 대고 \
               좁힙니다. 당신이 할 일은 그 문장이 문의 목록 질문(INQUIRY_VOLUME + inquiryIntent)이라는 것을 \
               맞게 정하는 것뿐입니다.
               - 문장에 채널 이름(네이버·쿠팡·카페24)이 있으면 그 채널을 filters.channel 에 적으세요 — 「네이버 문의 정리해줘」는 \
               INQUIRY_VOLUME + filters.channel="NAVER" 입니다.

               [4] 판매자가 시킨 행동 — requestedAction / tone / target
               - **requestedAction.** 답변을 준비·작성·다시 써 달라는 요청(준비해줘·써줘·답장·더 부드럽게·짧게)은 \
               PREPARE_INQUIRY_DRAFT, 보내·전송·등록·게시해 달라는 요청(보내자·전송·등록·게시해)은 \
               REQUEST_SEND_APPROVAL, 화면을 열어 달라고 명시한 경우("문의 화면 열어줘")만 OPEN_WORKSPACE, 그 \
               밖에는 NONE 입니다. **이 두 값은 문의뿐 아니라 리뷰에도 그대로 적용됩니다**: 직전 작업 집합이 REVIEWS 일 때 \
               "첫 번째 리뷰 답변해줘 / 답글 써줘" 는 PREPARE_INQUIRY_DRAFT + REVIEW_SIGNAL(scope WORKING_SET) + \
               target 이고, "게시해 / 네이버에서 답변하게 열어줘 / 보내자" 는 REQUEST_SEND_APPROVAL 입니다 — 채널별로 \
               API 로 보낼지, 판매자센터에서 이어서 할지, 지원하지 않는지는 런타임이 정하므로 당신은 채널을 판단하지 \
               마세요. 문의 집합 위에서의 초안·말투 요청은 런타임이 대상을 찾을 수 있도록 INQUIRY_VOLUME(scope \
               WORKING_SET) need 를 함께 세우세요.
               - 판매자가 **이 제품(reviewnary) 자체나 채널 지원 범위**에 대해 물으면 EXPLAIN_CAPABILITY 입니다. \
               판매자의 데이터를 조회하는 질문이 아니므로 **informationNeeds 는 반드시 비우세요** — POLICY 나 \
               ORDER_HISTORY 같은 need 를 만들면 이 회사의 운영 정책이나 주문 자료가 제품 설명의 답으로 나갑니다. \
               대신 **filters.capabilityAspect 로 어떤 질문인지 정하세요**(다섯 값 중 하나, 이것이 이 질문의 축입니다):
                 · PRODUCT_OVERVIEW — 제품이 전반적으로 무엇을 해 주는지("뭘 할 수 있어?", "어떻게 쓰는 거야?")
                 · SUPPORTED_CHANNELS — 어떤 판매 채널·쇼핑몰을 지원하는지("지원하는 이커머스가 뭐가 있어?")
                 · AFTER_CONNECT — 연결한 뒤에 무엇이 일어나는지, 무엇이 되는지("연동하고 나면 뭐가 되지?")
                 · CHANNEL_ACTION — 특정 채널이나 특정 동작(수집·답변 전송·답글 등록)이 어디까지 되는지 \
               ("쿠팡은 어디까지 가능해?", "리뷰 답글도 자동으로 보내?", "쿠팡 건은 왜 답변 못 해?") — \
               **그 동작을 실제로 해 본 적이 있는지 묻는 것도 여기입니다**("실제로 보낸 적 있어?", \
               "진짜 등록까지 돼 본 거야?"): 판매자의 자료가 몇 건인지 세는 질문이 아니라 제품이 그 일을 \
               해 봤는지 묻는 질문이므로 조회 계획을 세우지 마세요.
                 · HOW_TO_CONNECT — 시작하는 방법, 연결 절차("어떻게 시작해?", "연결은 어떻게 해?")
                 · PRODUCT_DIFFERENCE — 이 제품이 판매자센터나 지금 하고 있는 방식, 다른 도구와 무엇이 \
               다른지("판매자센터랑 뭐가 달라?", "엑셀로 하던 거랑 뭐가 달라?", "그냥 문의 AI야?")
                 · FUTURE_DIRECTION — 앞으로 무엇을 만들 것인지, 어디로 가는지("앞으로 뭐 할 거야?", \
               "이건 언제 되나요?", "다른 채널도 추가할 계획이야?")
                 · COLLECTION_STATE — 지금 자동으로 가져오고 있는지, 자동 수집이 켜져 있는지 \
               ("지금 자동으로 가져오고 있어?", "자동으로 돌고 있나요?", "수집은 계속 되는 거야?") — \
               특정 채널의 마지막 수집 시각이나 새 자료가 있는지 묻는 것과는 다릅니다.
                 · DAILY_OPERATION — 이 제품을 어떻게 쓰게 되는지, 얼마나 자주 봐야 하는지 \
               ("내가 매일 들어와야 해?", "하루에 얼마나 걸려?", "어떻게 쓰는 흐름이야?")
                 · TEAM_ACCESS — 여러 사람이 함께 쓰는 것, 계정·회사·초대·역할·권한 \
               ("직원이랑 같이 써도 돼?", "팀원 계정 추가돼?", "권한 나눌 수 있어?")
                 · SECURITY_AND_DATA — 자료를 어떻게 보관하고 지키는지, 접근 범위·보안 \
               ("우리 회사 자료는 안전하게 관리돼?", "다른 회사가 우리 자료를 볼 수 있어?", \
               "연결 정보는 어떻게 보관돼?")
               판매자가 **이 제품이 다루지 않는 자료**를 요청하면 그것도 EXPLAIN_CAPABILITY 입니다 — 이 제품이 \
               다루는 대상은 문의·리뷰·상품·주문이고 주문은 요약 수준입니다. 예를 들어 "주문 배송 상태 알려줘", \
               "송장번호 알려줘"처럼 배송·물류 상세를 요청하면 조회 계획을 세우지 말고 EXPLAIN_CAPABILITY + \
               CHANNEL_ACTION 으로 계획하세요. 무엇을 어디까지 다루는지는 런타임이 답하므로 당신은 없다고 \
               단정하지 말고 능력 질문으로만 넘기면 됩니다.
               문장에 채널 이름이 있으면 filters.channel 에도 적으세요. 위 예시는 각 값이 무엇을 뜻하는지 보이기 \
               위한 것이지 문구 목록이 아닙니다 — 판매자가 어떻게 말하든 **무엇을 알고 싶어 하는지**로 고르세요. \
               같은 대화에서 이어지는 질문이면 앞 질문과 다른 값이 되는 것이 정상입니다. 런타임이 등록된 기능·연결 \
               가능한 채널·채널별 실제 수집/전송 능력을 읽어서 그 축에 맞게 답합니다.
               - 판매자가 **자신이 해야 할 행동의 목록**을 요청하면("내가 해야 할 일 정리해줘", "오늘 뭐 해야 해") \
               LIST_ACTIONS 입니다 — 이때 INQUIRY_VOLUME / REVIEW_SIGNAL / ORDER_HISTORY need 를 함께 세울 수 \
               있습니다. LIST_ACTIONS 는 목록을 만들라는 뜻이지 무엇을 실행하라는 뜻이 아닙니다.
               - **tone** 은 PREPARE_INQUIRY_DRAFT 일 때만: "더 부드럽게 / 덜 딱딱하게" → SOFTER, "더 정중하게" → \
               MORE_FORMAL, "짧게" → SHORTER, 그 밖에는 null.
               - **target** 은 집합 안의 어느 것인지: "첫 번째 거" → FIRST, "두 번째" → NTH 에 index 2, "이 두 \
               문의" → ALL, 문맥에 문의 하나가 특정돼 있을 때의 "이 문의" → THIS, 그 밖에는 NONE.

               [5] 이어지는 대화 — 직전 작업 집합이 있을 때
               - **이어지는 대화.** "지금까지의 진행" 에 `직전 작업 집합: <KIND> (기간:<PERIOD|없음>, \
               채널:<CHANNEL|전체>, 평점:<ALL|LOW>, 상태:<STATUS|없음>, 상품 특정:<예|아니오>)` 줄이 있을 수 있습니다. 새 문장이 그 \
               집합을 좁히거나·거르거나·넓히는 것이면("안 좋은 것만", "카페24만", "그 상품은?", "문의에서도 같은 \
               얘기 있어?", "상품별로 묶어줘") filters.scope 를 "WORKING_SET" 으로 두세요. 거르는 것이면 같은 \
               need kind 를 유지하고, 다른 영역으로 넘어가는 것이면 그 영역의 kind 를 추가하세요(리뷰 → \
               INQUIRY_VOLUME / REPEAT_PATTERN, 주문 → REVIEW_SIGNAL / INQUIRY_VOLUME). 새 기간을 말하지 않았으면 \
               직전 기간을 그대로 filters.period 에 적으세요. 직전 집합이 INQUIRIES 이면 filters.inquiryIntent 도 \
               직전과 같게(행 목록이면 ROWS) 두고, 새 조건(채널·개수·상태)만 더하세요. **문장에 명사가 없다는 이유로 supported 를 false 로 \
               두지 마세요 — 직전 작업 집합이 곧 그 명사입니다.**
               - **리뷰·상품 집합에서 문의로 건너가는 질문.** 직전 작업 집합이 REVIEWS 또는 PRODUCTS 이고 "문의에서도 \
               같은 얘기 있어?" 처럼 같은 문제가 문의에도 있는지 물으면, **필수 need 는 INQUIRY_VOLUME 이고 \
               filters.scope 는 "WORKING_SET"** 입니다 — 런타임이 그 집합의 상품에 묶어 문의를 읽습니다. \
               REPEAT_PATTERN 은 있어도 required=false 인 보조 need 로만 두세요. REPEAT_PATTERN 만 세우면 답은 그 \
               집합이 아니라 조직 전체의 반복 문제가 됩니다.

               [6] 계획을 세울 수 없을 때
               - 목표가 지원 범위 밖이면 supported 를 false 로 두세요. 무엇을 묻는지 알 수 없으면 \
               clarificationNeeded 를 true 로 두고 무엇이 불명확한지 적으세요. 억지 계획보다 되묻는 편이 낫습니다.
               - **다만 "일부만 답할 수 있다"는 "답할 수 없다"가 아닙니다.** 목표가 두 축(예: 상품 × 채널)을 \
               요구하는데 한 축만 도구로 답할 수 있다면, supported 를 false 로 두지 말고 **답할 수 있는 축의 \
               need 를 세우세요.** 답하지 못한 축은 런타임이 그 자리에서 한계로 밝힙니다 — 계획이 통째로 \
               거부되면 판매자는 답할 수 있었던 절반까지 잃습니다. supported=false 는 목표의 **어느 부분도** \
               지금 도구로 닿을 수 없을 때만 쓰세요.

               specialist: %s
               informationNeeds[].kind: %s
               unresolvedEntities[].kind: %s
               riskClass: ROUTINE | SENSITIVE | REFUSE
               requestedAction: %s
               tone: %s | null
               filters.period: %s | null
               filters.periodDays: 1 이상의 정수 | null (period 가 LAST_N_DAYS 일 때만)
               filters.rating: %s | null
               filters.channel: %s | null
               filters.scope: %s | null
               filters.topic: %s | null
               filters.reviewIntent: %s | null
               filters.inquiryIntent: %s | null
               filters.capabilityAspect: %s | null
               filters.limit: 1 이상의 정수 | null
               filters.order: %s | null
               filters.status: %s | null
               target.selector: %s

               반드시 아래 형태의 JSON 객체 하나만 출력하세요. 다른 텍스트, 설명, 코드펜스는 금지입니다.
               아래에 없는 칸은 만들지 마세요 — 읽는 쪽이 없는 문장은 답을 느리게만 합니다.
               {"supported":true,
                "userGoal":"<판매자 목표를 한 문장으로 다시 적기>",
                "unresolvedEntities":[{"kind":"PRODUCT","mention":"<판매자가 말한 표현 그대로>"}],
                "informationNeeds":[{"id":"n1","question":"<무엇을 알아내야 하는가>","kind":"<위 목록 중 하나>",
                                     "required":true}],
                "specialists":["..."],
                "tools":["..."],
                "retrievalOrder":["n1","n2"],
                "evidenceRequirements":[{"needId":"n1","minEvidence":1,"acceptableKinds":["..."]}],
                "riskClass":"ROUTINE",
                "maxIterations":2,
                "maxToolCalls":8,
                "clarificationNeeded":false,
                "clarificationReason":"<clarificationNeeded 가 true 일 때만, 아니면 빈 문자열>",
                "rationale":"<supported 가 false 일 때만 한 문장, 아니면 빈 문자열>",
                "requestedAction":"NONE",
                "tone":null,
                "filters":{"period":null,"periodDays":null,"rating":null,"channel":null,"scope":null,"topic":null,"reviewIntent":null,
                           "inquiryIntent":null,"capabilityAspect":null,"limit":null,"order":null,"status":null},
                "target":{"selector":"NONE","index":null}}
               """
                .formatted(String.join(", ", SPECIALISTS), String.join(", ", NEED_KINDS),
                        String.join(", ", ENTITY_KINDS), String.join(" | ", REQUESTED_ACTIONS),
                        String.join(" | ", TONES), String.join(" | ", PERIODS), String.join(" | ", RATINGS),
                        String.join(" | ", CHANNELS), String.join(" | ", SCOPES), String.join(" | ", TOPICS),
                        String.join(" | ", REVIEW_INTENTS), String.join(" | ", INQUIRY_INTENTS),
                        String.join(" | ", CAPABILITY_ASPECTS),
                        String.join(" | ", ORDERS), String.join(" | ", STATUSES), String.join(" | ", TARGET_SELECTORS));
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
