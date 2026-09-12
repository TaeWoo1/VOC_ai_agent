package com.sellerops.agent.llm.operator;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.agent.llm.operator.AgentOperatorResponseParser.ParsedPlan;
import java.util.Optional;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The plan parser after schema v3.
 *
 * <p>The v3 sections ({@code requestedAction}, {@code tone}, {@code filters}, {@code target}) are
 * REFINEMENTS of a plan, not its substance. So the contract under test is asymmetric on purpose: the
 * reading part of a plan is still refused when off-schema (no repair, no second call), while a v3
 * section that is absent, wrong-typed or carries a token the prompt never offered collapses to its
 * default and the plan stands. A conversation must not fail on the field that matters least to
 * whether the right rows are read.
 */
class AgentOperatorResponseParserTest {

    private static final String V2_MINIMUM = """
            {"supported":true,"userGoal":"오늘 새 리뷰 확인",
             "informationNeeds":[{"id":"n1","question":"오늘 들어온 리뷰","kind":"REVIEW_SIGNAL","why":"목록","required":true}],
             "specialists":["REVIEW_OPS"],"tools":["list_recent_reviews"],
             "retrievalOrder":["n1"],"retrievalParallel":[],
             "evidenceRequirements":[{"needId":"n1","minEvidence":1,"acceptableKinds":["REVIEW_LIST"]}],
             "riskClass":"ROUTINE","maxIterations":1,"maxToolCalls":2,"stopWhenEnough":"행이 있으면",
             "clarificationNeeded":false,"clarificationReason":"","rationale":"목록 요청"}
            """;

    private static final String V3_FULL = """
            {"supported":true,"userGoal":"첫 번째 문의의 답변을 더 부드럽게",
             "informationNeeds":[{"id":"n1","question":"직전 문의 집합","kind":"INQUIRY_VOLUME","why":"대상","required":true}],
             "specialists":["INQUIRY_OPS"],"tools":["list_inquiry_workload"],
             "retrievalOrder":["n1"],"retrievalParallel":[],
             "evidenceRequirements":[],
             "riskClass":"ROUTINE","maxIterations":1,"maxToolCalls":2,"stopWhenEnough":"대상을 찾으면",
             "clarificationNeeded":false,"clarificationReason":"","rationale":"초안 요청",
             "requestedAction":"PREPARE_INQUIRY_DRAFT",
             "tone":"SOFTER",
             "filters":{"period":"LAST_WEEK","rating":"LOW","channel":"CAFE24","scope":"WORKING_SET","topic":"SHIPPING","reviewIntent":"ROWS",
                        "inquiryIntent":"ROWS","limit":3,"order":"OLDEST","status":"UNANSWERED"},
             "target":{"selector":"NTH","index":2}}
            """;

    private static ParsedPlan parse(String text) {
        Optional<ParsedPlan> plan = AgentOperatorResponseParser.parsePlan(text);
        assertThat(plan).as("the reading part is on schema, so the plan parses").isPresent();
        return plan.get();
    }

    @Test
    @DisplayName("a full v3 object parses every new section")
    void fullV3Parses() {
        ParsedPlan plan = parse(V3_FULL);

        assertThat(plan.requestedAction()).isEqualTo("PREPARE_INQUIRY_DRAFT");
        assertThat(plan.tone()).isEqualTo("SOFTER");
        assertThat(plan.filters().period()).isEqualTo("LAST_WEEK");
        assertThat(plan.filters().rating()).isEqualTo("LOW");
        assertThat(plan.filters().channel()).isEqualTo("CAFE24");
        assertThat(plan.filters().scope()).isEqualTo("WORKING_SET");
        assertThat(plan.filters().topic()).isEqualTo("SHIPPING");
        assertThat(plan.filters().reviewIntent()).isEqualTo("ROWS");
        assertThat(AgentPlanPrompt.REVIEW_INTENTS).containsExactly("ROWS", "ISSUES");
        assertThat(AgentPlanPrompt.system()).contains("filters.reviewIntent");
        // Query Accuracy v1: the QuerySpec axes the runtime executes — every one a closed token.
        assertThat(plan.filters().inquiryIntent()).isEqualTo("ROWS");
        assertThat(plan.filters().limit()).isEqualTo(3);
        assertThat(plan.filters().order()).isEqualTo("OLDEST");
        assertThat(plan.filters().status()).isEqualTo("UNANSWERED");
        // PRIORITY (Conversation UX v2): 「가장 시급한 건」 is a question about ORDER, and a list was the
        // only shape it could take before this token existed.
        assertThat(AgentPlanPrompt.INQUIRY_INTENTS).containsExactly("ROWS", "WORKLOAD", "COUNT", "PRIORITY");
        assertThat(AgentPlanPrompt.ORDERS).containsExactly("NEWEST", "OLDEST");
        assertThat(AgentPlanPrompt.STATUSES).containsExactly("UNANSWERED", "ANSWERED", "ALL");
        assertThat(AgentPlanPrompt.system()).contains("filters.inquiryIntent", "filters.limit", "filters.order", "filters.status");
        assertThat(plan.target().selector()).isEqualTo("NTH");
        assertThat(plan.target().index()).isEqualTo(2);
        // And the v2 part is untouched by the additions.
        assertThat(plan.specialists()).containsExactly("INQUIRY_OPS");
        assertThat(plan.informationNeeds()).hasSize(1);
    }

    @Test
    @DisplayName("a v2 answer with no v3 sections is a v3 plan with defaults — never a failure")
    void missingSectionsDefault() {
        ParsedPlan plan = parse(V2_MINIMUM);

        assertThat(plan.requestedAction()).isEqualTo("NONE");
        assertThat(plan.tone()).isNull();
        assertThat(plan.filters()).isEqualTo(AgentOperatorResponseParser.PlanFilters.none());
        assertThat(plan.target()).isEqualTo(AgentOperatorResponseParser.PlanTarget.none());
        assertThat(plan.target().selector()).isEqualTo("NONE");
        assertThat(plan.target().index()).isNull();
    }

    @Test
    @DisplayName("a token the prompt never offered collapses to null / NONE and the plan stands")
    void unknownTokensCollapse() {
        String text = V2_MINIMUM.trim();
        text = text.substring(0, text.length() - 1) + """
                ,"requestedAction":"SEND_NOW","tone":"ANGRY",
                 "filters":{"period":"LAST_YEAR","rating":"HIGH","channel":"ESM","scope":"EVERYTHING","topic":"PRICE"},
                 "target":{"selector":"SECOND","index":"two"}}
                """;
        ParsedPlan plan = parse(text);

        assertThat(plan.requestedAction()).as("no invented action, and certainly not a send").isEqualTo("NONE");
        assertThat(plan.tone()).isNull();
        assertThat(plan.filters()).isEqualTo(AgentOperatorResponseParser.PlanFilters.none());
        assertThat(plan.target().selector()).isEqualTo("NONE");
        assertThat(plan.target().index()).isNull();
    }

    @Test
    @DisplayName("LIST_ACTIONS is a closed value — a request for a to-do list, not for an execution")
    void listActionsIsAccepted() {
        String text = V2_MINIMUM.trim();
        text = text.substring(0, text.length() - 1) + ",\"requestedAction\":\"LIST_ACTIONS\"}";
        assertThat(parse(text).requestedAction()).isEqualTo("LIST_ACTIONS");
        assertThat(AgentPlanPrompt.REQUESTED_ACTIONS).containsExactly(
                "NONE", "PREPARE_INQUIRY_DRAFT", "REQUEST_SEND_APPROVAL", "OPEN_WORKSPACE", "LIST_ACTIONS", "EXPLAIN_CAPABILITY");
    }

    @Test
    @DisplayName("the prompt states the cross-domain rule: reviews → inquiries is INQUIRY_VOLUME over the working set")
    void crossDomainRuleIsInThePrompt() {
        String system = AgentPlanPrompt.system();
        assertThat(system).contains("LIST_ACTIONS");
        assertThat(system).contains("필수 need 는 INQUIRY_VOLUME");
        assertThat(system).contains("REPEAT_PATTERN 은 있어도 required=false");
    }

    @Test
    @DisplayName("wrong-typed v3 sections are defaults too — a string where an object was expected refuses nothing")
    void wrongTypedSectionsDefault() {
        String text = V2_MINIMUM.trim();
        text = text.substring(0, text.length() - 1)
                + ",\"filters\":\"오늘\",\"target\":[1],\"tone\":3,\"requestedAction\":null}";
        ParsedPlan plan = parse(text);

        assertThat(plan.filters()).isEqualTo(AgentOperatorResponseParser.PlanFilters.none());
        assertThat(plan.target()).isEqualTo(AgentOperatorResponseParser.PlanTarget.none());
        assertThat(plan.tone()).isNull();
        assertThat(plan.requestedAction()).isEqualTo("NONE");
    }

    @Test
    @DisplayName("an index is kept only for NTH and only as a positive ordinal")
    void indexOnlyMeansSomethingForNth() {
        String base = V2_MINIMUM.trim();
        base = base.substring(0, base.length() - 1);

        assertThat(parse(base + ",\"target\":{\"selector\":\"FIRST\",\"index\":3}}").target().index())
                .as("FIRST carries no ordinal").isNull();
        assertThat(parse(base + ",\"target\":{\"selector\":\"NTH\",\"index\":0}}").target().index())
                .as("0 is not an ordinal").isNull();
        assertThat(parse(base + ",\"target\":{\"selector\":\"NTH\",\"index\":3}}").target().index())
                .isEqualTo(3);
    }

    @Test
    @DisplayName("the reading part is still refused off-schema — v3 did not soften the plan contract")
    void readingPartStillRefused() {
        assertThat(AgentOperatorResponseParser.parsePlan("{\"supported\":\"yes\"}")).isEmpty();
        assertThat(AgentOperatorResponseParser.parsePlan("{\"supported\":true,\"specialists\":\"REVIEW_OPS\"}"))
                .isEmpty();
    }

    @Test
    @DisplayName("the closed sets the parser accepts are the ones the prompt offers")
    void promptAndParserShareOneVocabulary() {
        String system = AgentPlanPrompt.system();
        for (String token : AgentPlanPrompt.REQUESTED_ACTIONS) {
            assertThat(system).contains(token);
        }
        for (String token : AgentPlanPrompt.TOPICS) {
            assertThat(system).contains(token);
        }
        assertThat(system).contains("ORDER_OPS");
        // Agentic Experience v2: the catalogue need and the read that serves it are BOTH named, so a
        // planner that hears 「우리 상품 목록 보여줘」 has a kind to put it in and a tool to reach it.
        assertThat(system).contains("PRODUCT_CATALOG");
        assertThat(system).contains("list_products");
        // Planner Model & Prompt Benchmark v1: v16 is v15's rules grouped under the decision each one
        // belongs to. The headings ARE the change, so they are pinned — a later edit that dissolves
        // them back into one flat run is the thing this assertion is here to catch.
        for (String heading : new String[] {
                "[1] 절대 규칙", "[2] 무엇을 알아내야 하는가", "(2-1)", "(2-2)", "(2-3)",
                "[3] 문장에 있는 말을 그대로 옮겨 적을 값", "[4] 판매자가 시킨 행동",
                "[5] 이어지는 대화", "[6] 계획을 세울 수 없을 때" }) {
            assertThat(system).contains(heading);
        }
        // v17 (2026-09-07): the aspect axis for EXPLAIN_CAPABILITY. Every value is offered by the
        // prompt and accepted by the parser, so a plan cannot name one the runtime would drop — which
        // is why v18's two new values needed no edit here: the loop reads the vocabulary itself.
        for (String token : AgentPlanPrompt.CAPABILITY_ASPECTS) {
            assertThat(system).contains(token);
        }
        assertThat(system).contains("filters.capabilityAspect");
        // v18 (2026-09-08): PRODUCT_DIFFERENCE and FUTURE_DIRECTION. 「판매자센터랑 뭐가 달라?」 and
        // 「앞으로 뭐 할 거야?」 had no value of their own, arrived with a null aspect, and null widens —
        // so the runtime sent every layer of the reviewed ledger and the conversation floor refused the
        // request. v19 (same day) adds COLLECTION_STATE and DAILY_OPERATION, which manual QA watched go
        // elsewhere: 「지금 자동으로 가져오고 있어?」 planned as AFTER_CONNECT and 「내가 매일 들어와야
        // 해?」 as an investigation, so both answered with the seller's rows instead of the product's
        // state. The version moves because the vocabulary moved, and a plan recorded against an older
        // one does not carry these values.
        // v21 (same day): TEAM_ACCESS and SECURITY_AND_DATA. Both questions planned as
        // PRODUCT_OVERVIEW, which sends the whole product for an answer made of four reviewed items —
        // measured at 79 lines against a floor of 80, one addition from breaking silently.
        // v20 (same day): 「카페24 리뷰에 답글 실제로 보낸 적 있어?」 planned twice, once with an aspect
        // and once with none at all, and the run without one answered with the store's review count —
        // a question about whether the PRODUCT has ever done it, answered by counting the SELLER's rows.
        assertThat(AgentPlanPrompt.PROMPT_VERSION).isEqualTo("agent-plan-prompt/v21");
    }

    /**
     * Agent Responsiveness v1 §2 — the answer's LENGTH is the turn's latency.
     *
     * <p>These four fields were asked for on every plan and read by nothing anywhere in agent-runtime:
     * a {@code why} sentence per information need, and three prose sentences about when to stop. They
     * cost output tokens, output tokens cost seconds, and the seconds were the seller's. Re-adding one
     * is a decision with a price, so it fails here first — and if a consumer for one is ever written,
     * this assertion is the right place to argue with.
     *
     * <p>The fields that DO decide what a run does are asserted above and are untouched.
     */
    @Test
    @DisplayName("the schema asks for no field that nothing reads")
    void promptAsksOnlyForFieldsWithAConsumer() {
        String system = AgentPlanPrompt.system();
        assertThat(system).doesNotContain("\"why\"", "retrievalStopWhen", "stopWhenEnough", "retrievalParallel");
        // …while everything the runtime actually executes is still requested.
        assertThat(system).contains("informationNeeds", "evidenceRequirements", "retrievalOrder",
                "specialists", "tools", "filters", "target", "requestedAction");
    }

    @Test
    @DisplayName("QuerySpec tokens outside the closed sets are null, and a limit is clamped, never trusted")
    void querySpecTokensAreClosed() {
        String text = V3_FULL
                .replace("\"inquiryIntent\":\"ROWS\"", "\"inquiryIntent\":\"SQL\"")
                .replace("\"limit\":3", "\"limit\":999")
                .replace("\"order\":\"OLDEST\"", "\"order\":\"RANDOM\"")
                .replace("\"status\":\"UNANSWERED\"", "\"status\":\"MAYBE\"");
        ParsedPlan plan = parse(text);
        assertThat(plan.filters().inquiryIntent()).isNull();
        assertThat(plan.filters().limit()).isEqualTo(AgentPlanPrompt.MAX_LIMIT);
        assertThat(plan.filters().order()).isNull();
        assertThat(plan.filters().status()).isNull();
        ParsedPlan zero = parse(V3_FULL.replace("\"limit\":3", "\"limit\":0"));
        assertThat(zero.filters().limit()).isNull();
    }
}
