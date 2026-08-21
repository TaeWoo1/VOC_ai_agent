package com.sellerops.agent.llm.operator;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.agent.llm.AgentLlmTransport;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

/**
 * <b>The plan and judge payload floors, asserted on the serialized bytes.</b>
 *
 * <p>The twin of {@code AgentDraftPayloadFloorTest}, and it rests on the same argument: a test that
 * read {@code requestBody}'s intent would keep passing the day someone adds the org id "for
 * correlation". So every assertion is against the string that goes on the wire.
 *
 * <p>The two floors are different and are asserted separately, because they are what makes these two
 * separate capabilities rather than one:
 *
 * <ul>
 *   <li><b>plan</b> — the operator's own sentence and a static tool catalogue. No seller row at all.</li>
 *   <li><b>judge</b> — a SellerOps-composed sentence and closed-vocabulary metadata. No customer body,
 *       even if a caller hands one over: {@link EvidenceDigestFloor} refuses the request first.</li>
 * </ul>
 */
class AgentOperatorPayloadFloorTest {

    /**
     * Values a caller plausibly has in hand while building either request — which is exactly why the
     * list is explicit rather than "no PII".
     */
    private static final List<String> FORBIDDEN = List.of(
            "7f3a1c9e-0000-4000-8000-000000000001", // orgId
            "9b2d4f60-0000-4000-8000-000000000002", // workItemId
            "김구매",                                  // buyer name
            "010-1234-5678",                         // buyer phone
            "buyer@example.com",                     // buyer email
            "서울시 강남구",                            // shipping address
            "sk-should-never-appear");               // the API key itself

    /** A customer's actual words. Neither capability may ever carry one. */
    private static final String CUSTOMER_UTTERANCE = "붙였는데 이틀 만에 다 떨어졌어요 환불해주세요";

    private static AgentPlanGenerator planner(AgentLlmWireFormat.Vendor vendor) {
        return new AgentPlanGenerator((uri, headers, body) -> new AgentLlmTransport.Response(200, "{}"),
                vendor, "test-model", "sk-should-never-appear", 2000, "low");
    }

    private static AgentJudgeGenerator judge(AgentLlmWireFormat.Vendor vendor) {
        return new AgentJudgeGenerator((uri, headers, body) -> new AgentLlmTransport.Response(200, "{}"),
                vendor, "test-model", "sk-should-never-appear", 2000, "low");
    }

    @ParameterizedTest
    @EnumSource(AgentLlmWireFormat.Vendor.class)
    @DisplayName("a plan request carries the operator's goal and the tool catalogue — nothing of the seller's")
    void planCarriesOnlyGoalAndCatalogue(AgentLlmWireFormat.Vendor vendor) {
        String body = planner(vendor).requestBody(new AgentPlanGenerator.Input(
                "오늘 뭐부터 봐야 해?",
                List.of("get_today_inbox: 오늘 확인할 일", "search_review_issues: 반복 이슈")));

        assertThat(body).as("the two things that MAY leave are there")
                .contains("오늘 뭐부터 봐야 해")
                .contains("get_today_inbox");
        for (String forbidden : FORBIDDEN) {
            assertThat(body).as("%s must never reach the vendor", forbidden).doesNotContain(forbidden);
        }
        assertThat(body).as("no customer utterance is anywhere near this capability")
                .doesNotContain(CUSTOMER_UTTERANCE);
    }

    @ParameterizedTest
    @EnumSource(AgentLlmWireFormat.Vendor.class)
    @DisplayName("a judge request carries the finding and a metadata digest — and no customer text")
    void judgeCarriesOnlyFindingAndDigest(AgentLlmWireFormat.Vendor vendor) {
        String digest = """
                e1 kind=REVIEW_ISSUE signature=접착:탈락 severity=HIGH count=12 coverage=COVERED observedOn=2026-08-14
                e2 kind=INQUIRY topic=교환 count=3 coverage=UNCERTAIN_PRODUCT_UNLINKED observedOn=2026-08-18
                """;
        String body = judge(vendor).requestBody(new AgentJudgeGenerator.Input(
                "접착 관련 문제가 반복해서 보고되고 있습니다.", digest));

        assertThat(body).as("the finding and the digest are there")
                .contains("접착 관련 문제가 반복해서 보고되고 있습니다")
                .contains("e1")
                .contains("coverage=COVERED");
        for (String forbidden : FORBIDDEN) {
            assertThat(body).as("%s must never reach the vendor", forbidden).doesNotContain(forbidden);
        }
        assertThat(body).as("a customer's own words are never part of a judgement request")
                .doesNotContain(CUSTOMER_UTTERANCE);
    }

    /**
     * The judge's runtime floor, not just its byte floor.
     *
     * <p>The judge's input is ASSEMBLED by a caller holding a whole run's state, so unlike the draft
     * capability it has no structural guarantee that a third value cannot appear. {@link
     * EvidenceDigestFloor} is the substitute: metadata passes, prose does not. Asserted here because it
     * is the difference between a floor that is checked and a floor that is described.
     */
    @Test
    @DisplayName("the digest floor admits metadata and refuses anything that reads like a sentence")
    void theDigestFloorRefusesProse() {
        assertThat(EvidenceDigestFloor.isSafe(
                "e1 kind=REVIEW_ISSUE signature=접착:탈락 severity=HIGH count=12 coverage=COVERED"))
                .as("closed-vocabulary metadata passes").isTrue();
        assertThat(EvidenceDigestFloor.isSafe("e1 topic=배송 count=3\ne2 topic=교환 count=2"))
                .as("Hangul vocabulary values pass — topic is 배송/교환/…").isTrue();
        assertThat(EvidenceDigestFloor.isSafe(null)).as("no evidence is a true and safe input").isTrue();
        assertThat(EvidenceDigestFloor.isSafe(""))
                .as("an empty digest says 'no evidence', which the judge needs to hear").isTrue();

        assertThat(EvidenceDigestFloor.isSafe("e1 quote=" + CUSTOMER_UTTERANCE))
                .as("a customer sentence smuggled into a value is refused").isFalse();
        assertThat(EvidenceDigestFloor.isSafe(CUSTOMER_UTTERANCE))
                .as("a bare customer sentence is refused").isFalse();
        assertThat(EvidenceDigestFloor.isSafe("e1 body=\"고객이 이렇게 말했습니다\""))
                .as("a quoted phrase is refused").isFalse();
        assertThat(EvidenceDigestFloor.isSafe("e1 count=1\n".repeat(EvidenceDigestFloor.MAX_LINES + 1)))
                .as("an unbounded digest is refused rather than truncated").isFalse();
    }

    /**
     * A refused digest never reaches a vendor.
     *
     * <p>The floor would be decorative if the service checked it and posted anyway, so this asserts the
     * transport is never called — the property, not the code path.
     */
    @Test
    @DisplayName("a service whose digest fails the floor makes no vendor call at all")
    void aRefusedDigestNeverPosts() {
        java.util.concurrent.atomic.AtomicInteger posts = new java.util.concurrent.atomic.AtomicInteger();
        AgentLlmTransport counting = (uri, headers, body) -> {
            posts.incrementAndGet();
            return new AgentLlmTransport.Response(200, "{}");
        };
        java.util.UUID org = java.util.UUID.randomUUID();
        AgentJudgeService service = new AgentJudgeService(
                new AgentJudgeProperties(true, org.toString(), "OPENAI", "m", "sk-key", 2000, "low"),
                counting);

        assertThat(service.judge(org, "무언가 반복되고 있습니다.", "e1 quote=" + CUSTOMER_UTTERANCE))
                .as("a refused digest yields no verdict").isEmpty();
        assertThat(posts.get()).as("and no request left the building").isZero();
    }

    /** Off by default in three independent ways, for both new capabilities. */
    @Test
    @DisplayName("plan and judge are each off by default in three independent ways")
    void offByDefaultThreeWays() {
        java.util.UUID org = java.util.UUID.randomUUID();
        assertThat(new AgentPlanProperties(false, org.toString(), "OPENAI", "m", "sk", 2000, "low")
                .isEnabledFor(org)).as("plan: flag off").isFalse();
        assertThat(new AgentPlanProperties(true, org.toString(), "OPENAI", "m", "", 2000, "low")
                .isEnabledFor(org)).as("plan: no key").isFalse();
        assertThat(new AgentPlanProperties(true, "", "OPENAI", "m", "sk", 2000, "low")
                .isEnabledFor(org)).as("plan: org not listed").isFalse();
        assertThat(new AgentPlanProperties(true, org.toString(), "OPENAI", "m", "sk", 2000, "low")
                .isEnabledFor(org)).as("plan: all three").isTrue();
        assertThat(new AgentJudgeProperties(true, "*", "OPENAI", "m", "sk", 2000, "low")
                .isEnabledFor(org)).as("judge: the local single-user wildcard").isTrue();
        assertThat(new AgentJudgeProperties(true, "*", "OPENAI", "m", "sk", 2000, "low")
                .isEnabledFor(null)).as("judge: but never for no org at all").isFalse();
    }
}
