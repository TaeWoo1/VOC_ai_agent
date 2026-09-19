package com.sellerops.inquiry.decision;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.inquiry.draft.AnswerBasisState;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/**
 * Inquiry Decision v2 — the engine and the case policy, with the model replaced by a script.
 *
 * <p>The shapes are the real regression cases of Inquiry Need Eval v1 (docs/inquiry_need_eval_v1.md §9): the needs and
 * the verdicts are what a correct judge says about them. What is under test is what CODE does with those verdicts —
 * the model's accuracy is measured by the eval, not asserted here.
 */
class InquiryDecisionEngineTest {

    static final UUID ORG = UUID.randomUUID();

    /** A model that answers from a script and counts its calls. */
    static final class ScriptedModel implements InquiryDecisionModel {
        final List<InquiryNeed> needs;
        final Map<String, NeedVerdict> verdicts;
        int plans;
        int judges;
        List<EvidenceCandidate> sawEvidence = List.of();
        List<InquiryNeed> sawNeeds = List.of();

        ScriptedModel(List<InquiryNeed> needs, Map<String, NeedVerdict> verdicts) {
            this.needs = needs;
            this.verdicts = verdicts;
        }

        @Override
        public boolean enabledFor(UUID orgId) {
            return true;
        }

        @Override
        public Answer<List<InquiryNeed>> plan(UUID orgId, String question) {
            plans++;
            return new Answer<>(needs, new CallCost(1, 900, 600, 150));
        }

        @Override
        public Answer<Map<String, NeedVerdict>> judge(UUID orgId, String question, List<InquiryNeed> needs,
                                                      List<EvidenceCandidate> evidence,
                                                      List<PrecedentCandidate> precedents) {
            judges++;
            sawNeeds = needs;
            sawEvidence = evidence;
            return new Answer<>(verdicts, new CallCost(1, 1400, 2400, 300));
        }
    }

    static InquiryNeed need(String id, String ask, NeedType type) {
        return new InquiryNeed(id, ask, type, ask);
    }

    static NeedVerdict verdict(String need, NeedStatus status, String... evidence) {
        return NeedVerdict.of(need, status, List.of(evidence), status == NeedStatus.FULL ? null : "부족한 내용",
                status == NeedStatus.CONDITIONAL_ON_CUSTOMER ? "어떤 규격을 쓰시는지 알려주세요." : null, List.of());
    }

    static EvidenceCandidate knowledge(String title, String text) {
        return new EvidenceCandidate(null, EvidenceCandidate.Kind.PRODUCT_KNOWLEDGE, title, text, UUID.randomUUID(),
                null, null);
    }

    static EvidenceCandidate policy(String title, String text) {
        return new EvidenceCandidate(null, EvidenceCandidate.Kind.ORG_KNOWLEDGE, title, text, UUID.randomUUID(), null,
                null);
    }

    static NeedDecision decide(ScriptedModel model, List<EvidenceCandidate> evidence,
                               List<PrecedentCandidate> precedents, DetailCapability detail) {
        return InquiryDecisionEngine.decide(ORG, "문의", model,
                needs -> new InquiryDecisionEngine.Pool(evidence, precedents), detail);
    }

    static Map<String, NeedVerdict> verdicts(NeedVerdict... vs) {
        Map<String, NeedVerdict> m = new LinkedHashMap<>();
        for (NeedVerdict v : vs) {
            m.put(v.needId(), v);
        }
        return m;
    }

    static final EvidenceCandidate WIDTH_TABLE = knowledge("선바로 전선몰딩 내경",
            "내경 너비는 1호 13mm(내경 높이 9mm), 2호 20mm(내경 높이 10mm), 3호 23mm, 4호 26mm, 5호 30mm입니다.");
    static final EvidenceCandidate SHIPPING = policy("배송교환정책",
            "Orders paid before 2 PM on a business day are dispatched the same day.");

    @Nested
    @DisplayName("the real regression cases")
    class Regressions {

        @Test
        @DisplayName("R 77a91fab — three questions, evidence for one: never GROUNDED")
        void threeNeedsOneCovered() {
            ScriptedModel model = new ScriptedModel(
                    List.of(need("N1", "마감캡 끝이 뚫려 있는지", NeedType.PRODUCT_SPEC),
                            need("N2", "8.5mm 케이블에 맞는 호수", NeedType.PRODUCT_COMPATIBILITY),
                            need("N3", "엘보 구간에 쓸 사이즈", NeedType.PRODUCT_COMPATIBILITY)),
                    verdicts(verdict("N1", NeedStatus.NONE), verdict("N2", NeedStatus.FULL, "E1"),
                            verdict("N3", NeedStatus.PARTIAL, "E1")));
            NeedDecision d = decide(model, List.of(WIDTH_TABLE), List.of(), DetailCapability.IMAGE_ONLY);

            assertThat(d.basis()).isEqualTo(AnswerBasisState.NO_ANSWER_BASIS);
            assertThat(d.covered()).extracting(n -> n.need().id()).containsExactly("N2");
            assertThat(d.needs()).extracting(NeedResult::status)
                    .containsExactly(NeedStatus.UNKNOWN, NeedStatus.FULL, NeedStatus.UNKNOWN);
        }

        @Test
        @DisplayName("R 7a8136b2 — a shipping rule and a PAID order do not say when THIS order ships")
        void policyButNotThisOrder() {
            EvidenceCandidate order = new EvidenceCandidate(null, EvidenceCandidate.Kind.ORDER_FACT, "주문 상태",
                    "결제 완료가 확인되었습니다. 발송 상태는 확인되지 않았습니다.", null, null, null);
            ScriptedModel model = new ScriptedModel(List.of(need("N1", "이 주문이 언제 발송되는지", NeedType.ORDER_STATE)),
                    verdicts(verdict("N1", NeedStatus.PARTIAL, "E1", "E2")));
            NeedDecision d = decide(model, List.of(SHIPPING, order), List.of(), DetailCapability.NOT_ACQUIRED);

            assertThat(d.basis()).isEqualTo(AnswerBasisState.NO_ANSWER_BASIS);
            assertThat(d.needs().get(0).status()).as("an order need is not the listing's — no detail gap applies")
                    .isEqualTo(NeedStatus.PARTIAL);
            assertThat(d.acquisitionPlanned()).isFalse();
        }

        @Test
        @DisplayName("R ffc2cc44 — the width table without the wire's outer diameter is partial: no automatic answer")
        void partialEvidence() {
            ScriptedModel model = new ScriptedModel(
                    List.of(need("N1", "1.5sq 전선 두 가닥에 맞는 호수", NeedType.PRODUCT_COMPATIBILITY)),
                    verdicts(verdict("N1", NeedStatus.PARTIAL, "E1")));
            NeedDecision d = decide(model, List.of(WIDTH_TABLE), List.of(), DetailCapability.NOT_ACQUIRED);

            assertThat(d.basis()).isEqualTo(AnswerBasisState.NO_ANSWER_BASIS);
            assertThat(d.needs().get(0).acquirable()).as("the listing's detail was never read — a system step")
                    .isTrue();
            assertThat(d.acquisitionPlanned()).isTrue();
        }

        @Test
        @DisplayName("S X6a — fully answered: GROUNDED, not a clarification")
        void fullIsNotAClarification() {
            ScriptedModel model = new ScriptedModel(
                    List.of(need("N1", "지름 10mm 두 줄에 맞는 호수", NeedType.PRODUCT_COMPATIBILITY)),
                    verdicts(verdict("N1", NeedStatus.FULL, "E1")));
            NeedDecision d = decide(model, List.of(WIDTH_TABLE), List.of(), DetailCapability.IMAGE_ONLY);

            assertThat(d.basis()).isEqualTo(AnswerBasisState.GROUNDED);
            assertThat(d.passages()).extracting(p -> p.heading()).containsExactly("선바로 전선몰딩 내경");
        }

        @Test
        @DisplayName("S T6b / T9a — the answer depends on what the customer uses: ask the customer, not the seller")
        void conditionalGoesToTheCustomer() {
            ScriptedModel model = new ScriptedModel(
                    List.of(need("N1", "멀티탭 선 한 가닥에 맞는 호수", NeedType.PRODUCT_COMPATIBILITY)),
                    verdicts(verdict("N1", NeedStatus.CONDITIONAL_ON_CUSTOMER, "E1")));
            NeedDecision d = decide(model, List.of(WIDTH_TABLE), List.of(), DetailCapability.IMAGE_ONLY);

            assertThat(d.basis()).isEqualTo(AnswerBasisState.NEEDS_CLARIFICATION);
            assertThat(d.answerScope()).contains("고객에게 확인").contains("멀티탭 선 한 가닥에 맞는 호수");
        }

        @Test
        @DisplayName("R 9b8cc5a5 / S N3 — a shipping policy is not an answer to a lost parcel or overseas shipping")
        void relevantIsNotSufficient() {
            ScriptedModel model = new ScriptedModel(List.of(need("N1", "배송 완료 후 분실 처리", NeedType.SELLER_DECISION)),
                    verdicts(verdict("N1", NeedStatus.NONE)));
            NeedDecision d = decide(model, List.of(SHIPPING), List.of(), DetailCapability.NOT_ACQUIRED);

            assertThat(d.basis()).isEqualTo(AnswerBasisState.NO_ANSWER_BASIS);
            assertThat(d.passages()).as("nothing uncovered reaches a drafter").isEmpty();
        }
    }

    @Nested
    @DisplayName("invariants code enforces on the judge")
    class Invariants {

        @Test
        @DisplayName("support that cites nothing is not support; a precedent cited as evidence is dropped")
        void supportNeedsEvidence() {
            PrecedentCandidate past = new PrecedentCandidate(null, UUID.randomUUID(), "예전에 이렇게 답했습니다.");
            ScriptedModel model = new ScriptedModel(
                    List.of(need("N1", "a", NeedType.PRODUCT_SPEC), need("N2", "b", NeedType.POLICY),
                            need("N3", "c", NeedType.POLICY)),
                    verdicts(NeedVerdict.of("N1", NeedStatus.FULL, List.of(), null, null, List.of()),
                            NeedVerdict.of("N2", NeedStatus.FULL, List.of("P1"), null, null, List.of()),
                            NeedVerdict.of("N3", NeedStatus.FULL, List.of("E9"), null, null, List.of())));
            NeedDecision d = decide(model, List.of(WIDTH_TABLE), List.of(past), DetailCapability.READABLE);

            assertThat(d.needs()).extracting(NeedResult::status).containsOnly(NeedStatus.NONE);
            assertThat(d.basis()).isEqualTo(AnswerBasisState.NO_ANSWER_BASIS);
        }

        @Test
        @DisplayName("a need the judge did not answer is NONE — one silent need keeps the case with the seller")
        void silenceIsNone() {
            ScriptedModel model = new ScriptedModel(
                    List.of(need("N1", "a", NeedType.PRODUCT_SPEC), need("N2", "b", NeedType.PRODUCT_SPEC)),
                    verdicts(verdict("N1", NeedStatus.FULL, "E1")));
            NeedDecision d = decide(model, List.of(WIDTH_TABLE), List.of(), DetailCapability.READABLE);

            assertThat(d.needs().get(1).status()).isEqualTo(NeedStatus.NONE);
            assertThat(d.basis()).isEqualTo(AnswerBasisState.NO_ANSWER_BASIS);
        }

        @Test
        @DisplayName("precedents are kept only for an uncovered need, only when they are candidates, never as evidence")
        void precedentsArePrefillOnly() {
            PrecedentCandidate past = new PrecedentCandidate(null, UUID.randomUUID(), "같은 호수로 사시면 됩니다.");
            ScriptedModel model = new ScriptedModel(
                    List.of(need("N1", "엘보 호수", NeedType.PRODUCT_COMPATIBILITY),
                            need("N2", "8.5mm 호수", NeedType.PRODUCT_COMPATIBILITY)),
                    verdicts(NeedVerdict.of("N1", NeedStatus.NONE, List.of(), "없음", null, List.of("P1", "P7")),
                            NeedVerdict.of("N2", NeedStatus.FULL, List.of("E1"), null, null, List.of("P1"))));
            NeedDecision d = decide(model, List.of(WIDTH_TABLE), List.of(past), DetailCapability.READABLE);

            assertThat(d.needs().get(0).precedents()).extracting(PrecedentCandidate::memoryId)
                    .containsExactly(past.memoryId());
            assertThat(d.needs().get(1).precedents()).as("a covered need needs no prefill").isEmpty();
            assertThat(d.passages()).extracting(p -> p.text()).doesNotContain(past.text());
        }

        @Test
        @DisplayName("an unreadable 상세페이지 makes a short listing need UNKNOWN; a policy need stays what the judge said")
        void unknownIsCodes() {
            ScriptedModel model = new ScriptedModel(
                    List.of(need("N1", "길이", NeedType.PRODUCT_SPEC), need("N2", "현금영수증", NeedType.POLICY)),
                    verdicts(verdict("N1", NeedStatus.NONE), verdict("N2", NeedStatus.NONE)));
            NeedDecision d = decide(model, List.of(), List.of(), DetailCapability.NOT_COLLECTED);

            assertThat(d.needs()).extracting(NeedResult::status).containsExactly(NeedStatus.UNKNOWN, NeedStatus.NONE);
        }
    }

    @Nested
    @DisplayName("topology and failure")
    class Topology {

        @Test
        @DisplayName("two model calls however many needs: one plan, one judge over one candidate list")
        void twoCalls() {
            List<InquiryNeed> needs = new ArrayList<>();
            Map<String, NeedVerdict> vs = new LinkedHashMap<>();
            for (int i = 1; i <= 5; i++) {
                needs.add(need("N" + i, "need " + i, NeedType.PRODUCT_SPEC));
                vs.put("N" + i, verdict("N" + i, NeedStatus.FULL, "E1"));
            }
            ScriptedModel model = new ScriptedModel(needs, vs);
            NeedDecision d = decide(model, List.of(WIDTH_TABLE, SHIPPING), List.of(), DetailCapability.READABLE);

            assertThat(model.plans).isEqualTo(1);
            assertThat(model.judges).isEqualTo(1);
            assertThat(model.sawNeeds).hasSize(5);
            assertThat(model.sawEvidence).extracting(EvidenceCandidate::id).containsExactly("E1", "E2");
            assertThat(d.cost().calls()).isEqualTo(2);
            assertThat(d.cost().promptTokens()).isEqualTo(3000);
        }

        @Test
        @DisplayName("the candidate list is bounded and numbered by position")
        void bounded() {
            List<EvidenceCandidate> many = new ArrayList<>();
            for (int i = 0; i < 40; i++) {
                many.add(knowledge("t" + i, "text " + i));
            }
            ScriptedModel model = new ScriptedModel(List.of(need("N1", "a", NeedType.PRODUCT_SPEC)),
                    verdicts(verdict("N1", NeedStatus.FULL, "E30")));
            NeedDecision d = decide(model, many, List.of(), DetailCapability.READABLE);

            assertThat(model.sawEvidence).hasSize(InquiryDecisionEngine.MAX_EVIDENCE);
            assertThat(d.basis()).isEqualTo(AnswerBasisState.GROUNDED);
        }

        @Test
        @DisplayName("no plan, too many needs, no judgement, no needs — never a completed case")
        void failuresGoToTheSeller() {
            ScriptedModel noPlan = new ScriptedModel(null, Map.of());
            assertThat(decide(noPlan, List.of(WIDTH_TABLE), List.of(), DetailCapability.READABLE).outcome())
                    .isEqualTo(NeedDecision.Outcome.PLAN_FAILED);
            assertThat(noPlan.judges).as("no plan, no judge call").isZero();

            List<InquiryNeed> seven = new ArrayList<>();
            for (int i = 1; i <= 7; i++) {
                seven.add(need("N" + i, "n", NeedType.PRODUCT_SPEC));
            }
            assertThat(decide(new ScriptedModel(seven, Map.of()), List.of(), List.of(), DetailCapability.READABLE)
                    .basis()).isEqualTo(AnswerBasisState.NO_ANSWER_BASIS);

            ScriptedModel noJudge = new ScriptedModel(List.of(need("N1", "a", NeedType.PRODUCT_SPEC)), null);
            NeedDecision failed = decide(noJudge, List.of(WIDTH_TABLE), List.of(), DetailCapability.READABLE);
            assertThat(failed.outcome()).isEqualTo(NeedDecision.Outcome.JUDGE_FAILED);
            assertThat(failed.basis()).isEqualTo(AnswerBasisState.NO_ANSWER_BASIS);

            assertThat(decide(new ScriptedModel(List.of(), Map.of()), List.of(), List.of(), DetailCapability.READABLE)
                    .outcome()).isEqualTo(NeedDecision.Outcome.NO_NEEDS);
        }
    }

    @Nested
    @DisplayName("parsing what the model returned")
    class Parsing {

        @Test
        @DisplayName("a plan with an unknown type is no plan — a dropped need would be a need nobody judged")
        void unknownTypeFailsThePlan() {
            assertThat(InquiryDecisionGenerator.parsePlan("{\"needs\":[{\"ask\":\"a\",\"type\":\"PRODUCT_SPEC\"},"
                    + "{\"ask\":\"b\",\"type\":\"WEATHER\"}]}")).isNull();
            List<InquiryNeed> ok = InquiryDecisionGenerator.parsePlan("{\"needs\":[{\"id\":\"X9\",\"ask\":\"a\","
                    + "\"type\":\"POLICY\",\"search\":\"배송\"},{\"id\":\"X1\",\"ask\":\"b\",\"type\":\"ORDER_STATE\"}]}");
            assertThat(ok).extracting(InquiryNeed::id).containsExactly("N1", "N2");
            assertThat(ok.get(1).search()).as("no search phrase → the ask").isEqualTo("b");
        }

        @Test
        @DisplayName("the judge cannot say UNKNOWN; an unparseable verdict is no verdict")
        void judgeVocabulary() {
            Map<String, NeedVerdict> v = InquiryDecisionGenerator.parseJudge("{\"verdicts\":["
                    + "{\"need\":\"N1\",\"status\":\"UNKNOWN\",\"evidence\":[\"E1\"]},"
                    + "{\"need\":\"N2\",\"status\":\"CONDITIONAL_ON_CUSTOMER\",\"evidence\":[\"E1\",\"E1\"],"
                    + "\"ask_customer\":\"규격?\"}]}");
            assertThat(v).containsOnlyKeys("N2");
            assertThat(v.get("N2").evidence()).containsExactly("E1");
            assertThat(InquiryDecisionGenerator.parseJudge("not json")).isNull();
        }
    }
}
