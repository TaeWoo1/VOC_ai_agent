package com.sellerops.agent.llm.operator;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.agent.llm.AgentLlmTransport;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Agent Responsiveness v1 §3 — deep reasoning where the repository has EVIDENCE it is needed.
 *
 * <p>The measured shape of the problem: one plan call is 98–99% of a free-sentence turn, and its
 * duration tracks the tokens the model emits, most of which were internal reasoning. Spending that on
 * every sentence made the ordinary ones slow; spending it on none would make the hard ones worse. The
 * only signal this repository has for "this goal is hard" that is not a guess about the seller's words
 * is that a first attempt did not settle it — the validator refused the plan, or the run came back to
 * re-plan. Both arrive as a request carrying {@code priorContext}.
 *
 * <p>So these assertions are about WHICH REQUEST gets the stronger setting, not about how good a plan
 * is. A test that measured plan quality here would be asserting the vendor's mood.
 */
class AgentPlanEffortEscalationTest {

    private static final UUID ORG = UUID.fromString("7f3a1c9e-0000-4000-8000-000000000001");
    private static final List<String> CATALOGUE = List.of("list_inquiries: 문의를 읽는다");

    /** Records every body that leaves, so the assertion is on the wire and not on an intention. */
    private static final class Recorder implements AgentLlmTransport {
        private final List<String> bodies = new ArrayList<>();

        @Override
        public Response post(java.net.URI uri, java.util.Map<String, String> headers, String jsonBody) {
            bodies.add(jsonBody);
            return new Response(200, "{}");
        }
    }

    private static AgentPlanProperties properties(String first, String retry) {
        return new AgentPlanProperties(true, ORG.toString(), "OPENAI", "test-model", "sk-test", 6000, first, retry);
    }

    @Test
    @DisplayName("the first attempt is the fast setting; a second attempt at the same goal is the strong one")
    void escalatesOnlyOnTheSecondAttempt() {
        Recorder http = new Recorder();
        AgentPlanService service = new AgentPlanService(properties("minimal", "low"), http);

        service.plan(ORG, "최근 문의 3개 보여줘", CATALOGUE);
        service.plan(ORG, "최근 문의 3개 보여줘", CATALOGUE, "plan-invalid: PRODUCT_UNRESOLVABLE.", true);

        assertThat(http.bodies).hasSize(2);
        assertThat(http.bodies.get(0)).contains("\"reasoning_effort\":\"minimal\"");
        assertThat(http.bodies.get(1)).contains("\"reasoning_effort\":\"low\"");
    }

    /**
     * The measured mistake this flag exists to prevent.
     *
     * <p>The first version of the escalation read "is there a progress line" as "was this hard", and
     * {@code priorContext} carries the conversation's working-set line on ordinary follow-up sentences.
     * Every second sentence in a conversation therefore paid for deep reasoning: measured live at
     * 5.6–9.6s against 3.4s for the same shape of question asked first. A follow-up is not a retry.
     */
    @Test
    @DisplayName("a follow-up sentence carries a progress line and is still the fast pass")
    void aFollowUpIsNotARetry() {
        Recorder http = new Recorder();
        AgentPlanService service = new AgentPlanService(properties("minimal", "low"), http);

        service.plan(ORG, "그중 네이버만", CATALOGUE, "직전 작업 집합: INQUIRIES (기간:없음, 채널:전체)", false);
        service.plan(ORG, "그중 네이버만", CATALOGUE, "직전 작업 집합: INQUIRIES (기간:없음, 채널:전체)");

        assertThat(http.bodies).hasSize(2);
        assertThat(http.bodies).allSatisfy(body -> assertThat(body).contains("\"reasoning_effort\":\"minimal\""));
    }

    @Test
    @DisplayName("a deployment turns the escalation off with a blank value, not with an invented one")
    void blankRetryEffortFallsBackToTheFirstPass() {
        Recorder http = new Recorder();
        AgentPlanService service = new AgentPlanService(properties("minimal", ""), http);

        service.plan(ORG, "최근 문의 3개 보여줘", CATALOGUE, "plan-invalid: PRODUCT_UNRESOLVABLE.", true);

        assertThat(http.bodies).singleElement().asString().contains("\"reasoning_effort\":\"minimal\"");
    }

    @Test
    @DisplayName("the escalation is a setting, never a change to what is sent")
    void payloadFloorIsUnchangedByTheRetryEffort() {
        Recorder http = new Recorder();
        AgentPlanService service = new AgentPlanService(properties("minimal", "low"), http);

        service.plan(ORG, "최근 문의 3개 보여줘", CATALOGUE, "plan-invalid: PRODUCT_UNRESOLVABLE.", true);

        // The org whose plan this is never travels, on either attempt — the retry path is not a hole in
        // the floor the payload test guards.
        assertThat(http.bodies).singleElement().asString().doesNotContain(ORG.toString());
    }
}
