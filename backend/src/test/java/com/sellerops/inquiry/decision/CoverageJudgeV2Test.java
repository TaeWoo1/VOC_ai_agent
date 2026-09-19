package com.sellerops.inquiry.decision;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.inquiry.draft.AnswerBasisState;
import com.sellerops.knowledge.memory.AnswerMemoryReuseScope;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Inquiry Decision v2.1 — CoverageJudge v2 and the memory provenance invariant, with the model replaced by a script.
 *
 * <p>What is under test is what CODE does: how a v2 verdict is read, how it is held to its own words, which listing's
 * evidence may support which need, and which past answers may reach a Case. Whether the model's words are right is the
 * calibration harness's question (docs/inquiry_decision_v2_1.md), never a unit test's.
 */
class CoverageJudgeV2Test {

    static final UUID PRODUCT = UUID.randomUUID();
    static final UUID OTHER_PRODUCT = UUID.randomUUID();

    static InquiryNeed need(String id, NeedType type) {
        return new InquiryNeed(id, "질문 " + id, type, "검색 " + id);
    }

    static Map<String, EvidenceCandidate> pool(EvidenceCandidate... cs) {
        Map<String, EvidenceCandidate> m = new LinkedHashMap<>();
        for (EvidenceCandidate c : cs) {
            m.put(c.id(), c);
        }
        return m;
    }

    static EvidenceCandidate own(String id) {
        return new EvidenceCandidate(id, EvidenceCandidate.Kind.OPTIONS, "옵션 목록", "색상: A / 사이즈: 1", null, PRODUCT,
                null);
    }

    static EvidenceCandidate foreign(String id) {
        return new EvidenceCandidate(id, EvidenceCandidate.Kind.OPTIONS, "옵션 목록", "색상: A / 사이즈: 1", null,
                OTHER_PRODUCT, null);
    }

    static NeedVerdict v2(String need, NeedStatus status, List<String> evidence, List<String> missing,
                          List<String> customerInput, List<String> assumptions) {
        return new NeedVerdict(need, status, evidence, missing, customerInput, assumptions, null, List.of());
    }

    static NeedResult enforceOne(InquiryNeed need, NeedVerdict v, Map<String, EvidenceCandidate> evidence) {
        return NeedAggregation.enforce(List.of(need), Map.of(need.id(), v), evidence, Map.of(),
                DetailCapability.READABLE, PRODUCT).get(0);
    }

    // ── parsing ─────────────────────────────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("a v2 verdict is read with its structured reasons; a v1 verdict reads exactly as before")
    void parsesBothShapes() {
        Map<String, NeedVerdict> v2 = InquiryDecisionGenerator.parseJudge("""
                {"verdicts":[{"need":"N1","status":"CONDITIONAL_ON_CUSTOMER","evidence":["E1"],"missing":[],
                  "customer_input":["사용할 규격"],"assumptions":[],"ask_customer":"어떤 규격인가요?","precedents":[]},
                 {"need":"N2","status":"PARTIAL","evidence":["E2"],"missing":["두께","무게"],"customer_input":[],
                  "assumptions":["일반적인 경우"],"precedents":["P1"]}]}""");
        assertThat(v2.get("N1").customerInput()).containsExactly("사용할 규격");
        assertThat(v2.get("N2").missingInfo()).containsExactly("두께", "무게");
        assertThat(v2.get("N2").missing()).isEqualTo("두께 · 무게");
        assertThat(v2.get("N2").assumptions()).containsExactly("일반적인 경우");

        Map<String, NeedVerdict> v1 = InquiryDecisionGenerator.parseJudge("""
                {"verdicts":[{"need":"N1","status":"PARTIAL","evidence":["E1"],"missing":"두께가 없습니다.",
                  "ask_customer":null,"precedents":[]}]}""");
        assertThat(v1.get("N1").missingInfo()).containsExactly("두께가 없습니다.");
        assertThat(v1.get("N1").assumptions()).isEmpty();
        assertThat(v1.get("N1").customerInput()).isEmpty();
    }

    // ── the verdict held to its own words ───────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("FULL that names an assumption is PARTIAL — the judge said it filled a gap")
    void fullWithAnAssumptionIsPartial() {
        NeedResult r = enforceOne(need("N1", NeedType.PRODUCT_SPEC),
                v2("N1", NeedStatus.FULL, List.of("E1"), List.of(), List.of(), List.of("일반적으로 그렇다")),
                pool(own("E1")));
        assertThat(r.status()).isEqualTo(NeedStatus.PARTIAL);
        assertThat(r.judged()).isEqualTo(NeedStatus.FULL);
        assertThat(r.enforcement()).isEqualTo(NeedResult.Enforcement.DECLARED_ASSUMPTION);
    }

    @Test
    @DisplayName("FULL that names missing information is PARTIAL; FULL that names a customer value is CONDITIONAL")
    void fullIsHeldToItsOwnLists() {
        assertThat(enforceOne(need("N1", NeedType.PRODUCT_SPEC),
                v2("N1", NeedStatus.FULL, List.of("E1"), List.of("무게"), List.of(), List.of()), pool(own("E1")))
                .enforcement()).isEqualTo(NeedResult.Enforcement.DECLARED_MISSING);
        NeedResult conditional = enforceOne(need("N1", NeedType.PRODUCT_COMPATIBILITY),
                v2("N1", NeedStatus.FULL, List.of("E1"), List.of(), List.of("사용할 규격"), List.of()), pool(own("E1")));
        assertThat(conditional.status()).isEqualTo(NeedStatus.CONDITIONAL_ON_CUSTOMER);
        assertThat(conditional.askCustomer()).as("what to ask comes from the value the judge named").isEqualTo("사용할 규격");
        assertThat(conditional.enforcement()).isEqualTo(NeedResult.Enforcement.DECLARED_CUSTOMER_INPUT);
    }

    @Test
    @DisplayName("v2.2: a CONDITIONAL is not downgraded for naming an assumption; a clean CONDITIONAL and FULL stand")
    void cleanVerdictsStand() {
        // v2.1 turned this into PARTIAL. The A/B run (apr-8ef649ab) measured that rule: 0 unsafe verdicts caught, 1
        // correct CONDITIONAL lost. A judge describing what it cannot know about the customer is doing its job.
        NeedResult described = enforceOne(need("N1", NeedType.PRODUCT_COMPATIBILITY),
                v2("N1", NeedStatus.CONDITIONAL_ON_CUSTOMER, List.of("E1"), List.of(), List.of("규격"),
                        List.of("고객 선반의 폭을 모른다")), pool(own("E1")));
        assertThat(described.status()).isEqualTo(NeedStatus.CONDITIONAL_ON_CUSTOMER);
        assertThat(described.enforcement()).isNull();
        NeedResult cond = enforceOne(need("N1", NeedType.PRODUCT_COMPATIBILITY),
                v2("N1", NeedStatus.CONDITIONAL_ON_CUSTOMER, List.of("E1"), List.of(), List.of("규격"), List.of()),
                pool(own("E1")));
        assertThat(cond.status()).isEqualTo(NeedStatus.CONDITIONAL_ON_CUSTOMER);
        assertThat(cond.enforcement()).isNull();
        NeedResult full = enforceOne(need("N1", NeedType.PRODUCT_SPEC),
                v2("N1", NeedStatus.FULL, List.of("E1"), List.of(), List.of(), List.of()), pool(own("E1")));
        assertThat(full.status()).isEqualTo(NeedStatus.FULL);
        assertThat(full.enforcement()).isNull();
    }

    @Test
    @DisplayName("one enforced need is enough to keep the Case away from the customer")
    void anEnforcedNeedKeepsTheCaseWithTheSeller() {
        List<NeedResult> results = NeedAggregation.enforce(
                List.of(need("N1", NeedType.PRODUCT_SPEC), need("N2", NeedType.POLICY)),
                Map.of("N1", v2("N1", NeedStatus.FULL, List.of("E1"), List.of(), List.of(), List.of()),
                        "N2", v2("N2", NeedStatus.FULL, List.of("E1"), List.of(), List.of(), List.of("짐작"))),
                pool(own("E1")), Map.of(), DetailCapability.READABLE, PRODUCT);
        assertThat(NeedAggregation.basis(results)).isEqualTo(AnswerBasisState.NO_ANSWER_BASIS);
    }

    // ── another listing's evidence ──────────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("another listing's facts never support this listing's spec, usage or compatibility need")
    void otherListingOnlyIsNone() {
        for (NeedType type : List.of(NeedType.PRODUCT_SPEC, NeedType.PRODUCT_USAGE, NeedType.PRODUCT_COMPATIBILITY)) {
            NeedResult r = enforceOne(need("N1", type),
                    v2("N1", NeedStatus.FULL, List.of("E1"), List.of(), List.of(), List.of()), pool(foreign("E1")));
            assertThat(r.status()).as(type.name()).isEqualTo(NeedStatus.NONE);
            assertThat(r.enforcement()).isEqualTo(NeedResult.Enforcement.OTHER_INSTANCE_ONLY);
        }
        NeedResult mixed = enforceOne(need("N1", NeedType.PRODUCT_SPEC),
                v2("N1", NeedStatus.FULL, List.of("E1", "E2"), List.of(), List.of(), List.of()),
                pool(foreign("E1"), own("E2")));
        assertThat(mixed.status()).isEqualTo(NeedStatus.FULL);
        assertThat(mixed.evidence()).extracting(EvidenceCandidate::id).containsExactly("E2");
    }

    @Test
    @DisplayName("an availability need may be answered by another listing existing; unknown Case product fences nothing")
    void availabilityKeepsOtherListings() {
        assertThat(enforceOne(need("N1", NeedType.CATALOGUE_AVAILABILITY),
                v2("N1", NeedStatus.FULL, List.of("E1"), List.of(), List.of(), List.of()), pool(foreign("E1")))
                .status()).isEqualTo(NeedStatus.FULL);
        assertThat(NeedAggregation.enforce(List.of(need("N1", NeedType.PRODUCT_SPEC)),
                Map.of("N1", v2("N1", NeedStatus.FULL, List.of("E1"), List.of(), List.of(), List.of())),
                pool(foreign("E1")), Map.of(), DetailCapability.READABLE, (UUID) null).get(0).status())
                .isEqualTo(NeedStatus.FULL);
    }

    // ── the prompt and the switch ───────────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("the judge instruction is selectable, v2 by default, and an unknown name refuses to boot")
    void judgePromptSelection() {
        InquiryDecisionProperties defaults = new InquiryDecisionProperties(true, "", "m", "k", 1, 1, "minimal");
        assertThat(defaults.judgePrompt()).isEqualTo(InquiryDecisionPrompt.JUDGE_V2);
        assertThat(defaults.judgeReasoningEffort()).as("the judge follows the plan's effort unless told").isEqualTo("minimal");
        InquiryDecisionProperties armC = new InquiryDecisionProperties(true, "", "m", "k", 1, 1, "minimal",
                InquiryDecisionPrompt.JUDGE_V2, "low");
        assertThat(armC.reasoningEffort()).isEqualTo("minimal");
        assertThat(armC.judgeReasoningEffort()).isEqualTo("low");
        assertThatThrownBy(() -> new InquiryDecisionProperties(true, "", "m", "k", 1, 1, "minimal", "coverage-judge/v9",
                "")).isInstanceOf(IllegalArgumentException.class);

        InquiryDecisionService v1 = new InquiryDecisionService(new InquiryDecisionProperties(true, "", "m", "k", 1, 1,
                "minimal", InquiryDecisionPrompt.JUDGE_V1, ""), null, null);
        String v1Body = v1.generator().judgeBody("q", List.of(need("N1", NeedType.POLICY)), List.of(), List.of());
        assertThat(v1Body).doesNotContain("assumptions").contains("\"reasoning_effort\":\"minimal\"");
        InquiryDecisionService c = new InquiryDecisionService(armC, null, null);
        String cBody = c.generator().judgeBody("q", List.of(need("N1", NeedType.POLICY)), List.of(), List.of());
        assertThat(cBody).contains("assumptions").contains("\"reasoning_effort\":\"low\"");
        assertThat(c.generator().planBody("q")).as("the planner is not moved by the judge's knob")
                .contains("\"reasoning_effort\":\"minimal\"");
    }

    @Test
    @DisplayName("the v2 instruction separates relevant from sufficient and carries no product vocabulary")
    void v2Instruction() {
        String p = InquiryDecisionPrompt.judgeSystemV2();
        assertThat(p).contains("추가 가정 없이").contains("확신이 없으면").contains("assumptions").contains("customer_input")
                .contains("목록의 일부 항목에서 전체를");
        for (String word : List.of("몰딩", "디스펜서", "전선", "종이컵", "호수", "선바로", "mm", "가닥")) {
            assertThat(p).as(word).doesNotContain(word);
        }
    }

    // ── past-answer provenance ──────────────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("REUSABLE crosses Cases; ORDER_ONLY only to the same order; CASE_ONLY and UNKNOWN only to their own")
    void precedentReuse() {
        UUID origin = UUID.randomUUID();
        UUID other = UUID.randomUUID();
        UUID channel = UUID.randomUUID();
        PrecedentReuse.OrderKey order = new PrecedentReuse.OrderKey(channel, "A-1");
        PrecedentReuse.OrderKey sameOrder = new PrecedentReuse.OrderKey(channel, "A-1");
        PrecedentReuse.OrderKey otherOrder = new PrecedentReuse.OrderKey(channel, "A-2");
        PrecedentReuse.OrderKey otherChannel = new PrecedentReuse.OrderKey(UUID.randomUUID(), "A-1");

        assertThat(PrecedentReuse.admits(AnswerMemoryReuseScope.REUSABLE, origin, null, other, null)).isTrue();
        assertThat(PrecedentReuse.admits(AnswerMemoryReuseScope.ORDER_ONLY, origin, order, other, sameOrder)).isTrue();
        assertThat(PrecedentReuse.admits(AnswerMemoryReuseScope.ORDER_ONLY, origin, order, other, otherOrder)).isFalse();
        assertThat(PrecedentReuse.admits(AnswerMemoryReuseScope.ORDER_ONLY, origin, order, other, otherChannel))
                .isFalse();
        assertThat(PrecedentReuse.admits(AnswerMemoryReuseScope.ORDER_ONLY, origin, null, other, null))
                .as("no order on either side is not the same order").isFalse();
        for (AnswerMemoryReuseScope s : new AnswerMemoryReuseScope[] {AnswerMemoryReuseScope.CASE_ONLY,
                AnswerMemoryReuseScope.UNKNOWN, null}) {
            assertThat(PrecedentReuse.admits(s, origin, order, other, sameOrder)).as(String.valueOf(s)).isFalse();
            assertThat(PrecedentReuse.admits(s, origin, null, origin, null)).as(String.valueOf(s)).isTrue();
        }
    }
}
