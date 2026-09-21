package com.sellerops.inquiry.draft;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.agent.llm.AgentDraftGenerator;
import com.sellerops.agent.llm.AgentDraftPrompt;
import com.sellerops.inquiry.draft.SpecApplicability.Applicability;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/**
 * The four cases of the 2026-08-26 answer-applicability contract.
 *
 * <p><b>What these tests can and cannot assert.</b> They assert the classification, and they assert
 * what the drafter is TOLD. They do not assert the sentence a model writes, because that is not a
 * deterministic function of anything in this repository — every other prompt in the backend is under
 * the same limit, and pretending otherwise would turn a vendor's sampling into a red build. The
 * behaviour those two halves buy is recorded in {@code docs/answer_applicability_v1.md}.
 */
class SpecApplicabilityTest {

    /** The listing behind the live case: several 규격 on one product. */
    private static final List<String> WIRE_MOLD_OPTIONS =
            List.of("규격: 소형 15mm", "규격: 중형 25mm", "규격: 대형 35mm");

    @Nested
    @DisplayName("A · a question whose answer cannot move with the option")
    class VariantIndependent {

        @Test
        @DisplayName("부착 방법은 규격과 무관하므로 근거를 그대로 쓸 수 있다")
        void adhesionQuestionIsNotVariantSensitive() {
            assertThat(SpecApplicability.of("벽지에도 붙나요?",
                    "실크벽지에 붙이려고 하는데 가능한지 궁금합니다.", WIRE_MOLD_OPTIONS))
                    // Note this text contains 「가능한지」 — near, but not, the sensitive 「가능한가요」.
                    .isEqualTo(Applicability.NOT_VARIANT_SENSITIVE);
        }

        @Test
        @DisplayName("적용 범위가 「해당 없음」이면 초안에 추가 제약이 걸리지 않는다")
        void invariantQuestionsCarryNoCaution() {
            assertThat(Applicability.NOT_VARIANT_SENSITIVE.messageKo()).isEqualTo("(해당 없음)");
        }

        @Test
        @DisplayName("「가능한가요」는 행위의 가부를 묻는 말이라 그것만으로는 규격 질문이 되지 않는다")
        void aBarePossibilityQuestionIsNotAboutTheItem() {
            // Observed 2026-09-21: this exact question drafted a reply asking which 규격 the customer
            // had bought. 교환 기간은 색상에 따라 달라지지 않는다 — the word matched five syllables, not a
            // property. Options present or absent: the verdict is the same, because the question is.
            assertThat(SpecApplicability.of("교환 신청은 언제까지 가능한가요?", null, WIRE_MOLD_OPTIONS))
                    .isEqualTo(Applicability.NOT_VARIANT_SENSITIVE);
            assertThat(SpecApplicability.of("교환 신청은 언제까지 가능한가요?", null, List.of()))
                    .isEqualTo(Applicability.NOT_VARIANT_SENSITIVE);
            assertThat(SpecApplicability.of("문의", "당일 발송 가능한가요?", WIRE_MOLD_OPTIONS))
                    .isEqualTo(Applicability.NOT_VARIANT_SENSITIVE);
        }

        @Test
        @DisplayName("운영 주제를 말하지 않는 「가능한가요」도 규격 질문이 아니다 — 행위의 가부이지 물건의 성질이 아니다")
        void aPossibilityQuestionNamingNoOperationIsStillNotAboutTheItem() {
            // These name no 배송·교환·취소·결제·증빙, so the operating-topic gate says nothing about them. They are
            // NOT_VARIANT_SENSITIVE for the other reason — 「가능한가요」 asks whether an ACTION is permitted, and
            // permission does not move with the 규격. Without the word's removal this pair would hedge.
            assertThat(SpecApplicability.of("문의", "설치도 가능한가요?", WIRE_MOLD_OPTIONS))
                    .isEqualTo(Applicability.NOT_VARIANT_SENSITIVE);
            assertThat(SpecApplicability.of("문의", "대량 구매 가능한가요?", List.of()))
                    .isEqualTo(Applicability.NOT_VARIANT_SENSITIVE);
        }

        @Test
        @DisplayName("남은 「맞나요」류도 운영 주제를 말한 질문에서는 규격을 되묻지 않는다")
        void aFitPhrasingAboutAnOperationIsNotAboutTheItem() {
            assertThat(SpecApplicability.of("문의", "반품 배송비가 3000원 맞나요?", WIRE_MOLD_OPTIONS))
                    .isEqualTo(Applicability.NOT_VARIANT_SENSITIVE);
        }

        @Test
        @DisplayName("운영 주제를 함께 말해도, 속성을 이름으로 부른 질문은 여전히 규격 질문이다")
        void namingAPropertyOutranksTheOperationGate() {
            // The gate withholds the benefit of the doubt from a bare phrasing; it cannot overturn a
            // named property. 「교환하려는데 25mm 규격이 맞나요」 is about the 규격 and says so.
            assertThat(SpecApplicability.of("문의", "교환하려는데 이 치수가 맞나요?", WIRE_MOLD_OPTIONS))
                    .isEqualTo(Applicability.VARIANT_UNRESOLVED);
        }
    }

    @Nested
    @DisplayName("B · a variant-dependent question with no determined 규격 — the live defect")
    class VariantDependentUnresolved {

        @Test
        @DisplayName("「몇 가닥까지 들어가나요」는 규격에 따라 달라지고, 이 문의는 규격을 말하지 않았다")
        void theLiveQuestionIsUnresolved() {
            assertThat(SpecApplicability.of("문의", "안녕하세요. 전선이 몇 가닥까지 들어가나요?",
                    WIRE_MOLD_OPTIONS))
                    .isEqualTo(Applicability.VARIANT_UNRESOLVED);
        }

        @Test
        @DisplayName("옵션 정보를 하나도 갖고 있지 않은 상품도 「확정되지 않음」이지 「해당 없음」이 아니다")
        void aProductWithNoRecordedOptionsIsStillUnresolved() {
            // NAVER contributes no variant rows at all, so this is the live case's actual state.
            assertThat(SpecApplicability.of("문의", "전선이 몇 가닥까지 들어가나요?", List.of()))
                    .isEqualTo(Applicability.VARIANT_UNRESOLVED);
        }

        @Test
        @DisplayName("속성을 이름으로 부르지 않아도, 물건이 들어가는지 묻는 질문은 규격 질문이다")
        void aBareFitQuestionAboutAnObjectIsStillUnresolved() {
            // The narrowing of 2026-09-21 removed 「가능한가요」 and gated the rest on operating topics.
            // It did not touch this: no property noun, no options recorded — the NAVER shape — and the
            // honest reply is still to ask which 규격, because the answer does move with it.
            assertThat(SpecApplicability.of("문의", "3구 멀티탭도 들어가나요?", List.of()))
                    .isEqualTo(Applicability.VARIANT_UNRESOLVED);
        }

        @Test
        @DisplayName("드래프터는 수치를 확정 사실로 쓰지 말고 규격을 되물으라는 지시를 받는다")
        void theDrafterIsToldNotToCloseOnASingleSpec() {
            String user = AgentDraftPrompt.user("문의", "전선이 몇 가닥까지 들어가나요?",
                    List.of(new AgentDraftGenerator.Passage("상품 정보", "자주 묻는 질문",
                            "Q. 몇 가닥까지 들어가나요? A. 일반 가전 전선 기준으로 3~4가닥이 여유 있게 들어갑니다.")),
                    null, Applicability.VARIANT_UNRESOLVED.messageKo());

            assertThat(user).as("the question's applicability is stated, always in its own section")
                    .contains("규격 적용 범위:")
                    .contains("어떤 규격인지 확정되지 않았습니다");
            assertThat(AgentDraftPrompt.system())
                    .as("and the rule that reads it forbids asserting the figure as settled")
                    .contains("규격 적용 범위")
                    .contains("확정된 사실로 단정하지 마세요")
                    .contains("되물으세요");
        }
    }

    @Nested
    @DisplayName("C · a variant-dependent question that names a 규격 this product sells")
    class VariantDependentNamed {

        @Test
        @DisplayName("고객이 규격을 밝히면 그 근거를 쓸 수 있는 상태가 된다")
        void namingAKnownOptionResolvesIt() {
            assertThat(SpecApplicability.of("문의",
                    "중형 25mm 규격으로 샀는데 전선이 몇 가닥까지 들어가나요?", WIRE_MOLD_OPTIONS))
                    .isEqualTo(Applicability.VARIANT_NAMED);
        }

        @Test
        @DisplayName("옵션 조합의 일부만 겹치는 것은 규격을 밝힌 것이 아니다")
        void aPartialOverlapIsNotANamedOption() {
            // 「규격」 alone appears in every option string; matching on it would resolve everything.
            assertThat(SpecApplicability.of("문의", "규격이 어떻게 되나요?", WIRE_MOLD_OPTIONS))
                    .isEqualTo(Applicability.VARIANT_UNRESOLVED);
        }

        @Test
        @DisplayName("확정된 규격을 알려 줄 때도 옵션 이름 자체는 모델에 나가지 않는다")
        void theNoteNamesNoOption() {
            assertThat(Applicability.VARIANT_NAMED.messageKo())
                    .contains("고객이 문의에서 규격을 밝혔습니다")
                    .doesNotContain("25mm")
                    .doesNotContain("중형");
        }
    }

    @Nested
    @DisplayName("D · no evidence at all")
    class NoEvidence {

        @Test
        @DisplayName("근거가 비어 있으면 그 사실이 명시되고, 지어내지 말라는 규칙이 함께 걸린다")
        void anEmptyLibraryStillForbidsInvention() {
            String user = AgentDraftPrompt.user("문의", "전선이 몇 가닥까지 들어가나요?", List.of(), null,
                    Applicability.VARIANT_UNRESOLVED.messageKo());

            assertThat(user).contains("판매자가 등록한 근거:").contains("(없음)")
                    .contains("규격 적용 범위:");
            assertThat(AgentDraftPrompt.system())
                    .contains("근거가 비어 있으면 그것만으로 답을 만들지 말고")
                    .contains("거기 없는 사양·수치·기간·");
        }
    }

    @Test
    @DisplayName("적용 범위 줄은 분류하지 않은 호출에서도 「해당 없음」으로 항상 존재한다")
    void theSectionIsAlwaysPresent() {
        // An absent section reads to a model as "not relevant here"; that is the same reason the
        // order-state line is unconditional.
        assertThat(AgentDraftPrompt.user("문의", "본문", List.of())).contains("규격 적용 범위:").contains("(해당 없음)");
    }
}
