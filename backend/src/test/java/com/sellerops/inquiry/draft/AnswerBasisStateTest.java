package com.sellerops.inquiry.draft;

import com.sellerops.knowledge.RetrievalOutcome;

import com.sellerops.knowledge.KnowledgeTopic;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.inquiry.draft.SpecApplicability.Applicability;
import com.sellerops.product.library.KnowledgeAuthorship;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

class AnswerBasisStateTest {

    @Nested
    @DisplayName("the projection")
    class Projection {

        @Test
        @DisplayName("no current evidence is NO_ANSWER_BASIS, whatever the question is about")
        void absenceBeatsEverything() {
            for (DraftKnowledgeState ungrounded : List.of(DraftKnowledgeState.NO_PRODUCT,
                    DraftKnowledgeState.NO_LIBRARY, DraftKnowledgeState.NO_MATCH)) {
                for (Applicability applicability : Applicability.values()) {
                    assertThat(AnswerBasisState.of(ungrounded, applicability))
                            .as("%s + %s", ungrounded, applicability)
                            .isEqualTo(AnswerBasisState.NO_ANSWER_BASIS);
                }
            }
        }

        @Test
        @DisplayName("evidence plus an unresolved 규격 is NEEDS_CLARIFICATION")
        void unresolvedVariantAsks() {
            assertThat(AnswerBasisState.of(DraftKnowledgeState.GROUNDED, Applicability.VARIANT_UNRESOLVED))
                    .isEqualTo(AnswerBasisState.NEEDS_CLARIFICATION);
        }

        @Test
        @DisplayName("evidence that applies as asked is GROUNDED")
        void applicableEvidenceGrounds() {
            assertThat(AnswerBasisState.of(DraftKnowledgeState.GROUNDED, Applicability.NOT_VARIANT_SENSITIVE))
                    .isEqualTo(AnswerBasisState.GROUNDED);
            assertThat(AnswerBasisState.of(DraftKnowledgeState.GROUNDED, Applicability.VARIANT_NAMED))
                    .isEqualTo(AnswerBasisState.GROUNDED);
        }

        @Test
        @DisplayName("only NO_ANSWER_BASIS stops a model call")
        void onlyOneStateRefusesToGenerate() {
            assertThat(AnswerBasisState.GROUNDED.mayGenerate()).isTrue();
            assertThat(AnswerBasisState.NEEDS_CLARIFICATION.mayGenerate())
                    .as("asking for the missing fact IS a reply, and it invents nothing").isTrue();
            assertThat(AnswerBasisState.NO_ANSWER_BASIS.mayGenerate()).isFalse();
        }

        @Test
        @DisplayName("the seller is told what is missing, and it differs per library state")
        void theActionNamesTheGap() {
            assertThat(AnswerBasisState.NO_ANSWER_BASIS.messageKo()).isEqualTo("답변 기준이 필요합니다.");
            assertThat(AnswerBasisState.NO_ANSWER_BASIS.actionKo(DraftKnowledgeState.NO_PRODUCT))
                    .isNotEqualTo(AnswerBasisState.NO_ANSWER_BASIS.actionKo(DraftKnowledgeState.NO_LIBRARY));
            assertThat(AnswerBasisState.GROUNDED.actionKo(DraftKnowledgeState.GROUNDED)).isNull();
        }

        @Test
        @DisplayName("the action matches what retrieval established — a rule that exists and does not apply is not re-registered")
        void theActionMatchesTheRetrievalOutcome() {
            AnswerBasisState none = AnswerBasisState.NO_ANSWER_BASIS;
            SpecApplicability.Applicability flat = SpecApplicability.Applicability.NOT_VARIANT_SENSITIVE;
            // Policy exists, does not apply: not 「기준 없음」, not 「상품을 연결하면」.
            String notApplicable = none.actionKo(DraftKnowledgeState.NO_PRODUCT, null, flat,
                    RetrievalOutcome.ABSENT, RetrievalOutcome.NOT_APPLICABLE, KnowledgeTopic.SHIPPING);
            assertThat(notApplicable).isEqualTo("배송 기준은 등록되어 있지만, 이 문의에 적용할 근거로 확인되지는 않았습니다.");
            // No policy at all for a policy question: register one.
            String absent = none.actionKo(DraftKnowledgeState.NO_PRODUCT, null, flat,
                    RetrievalOutcome.ABSENT, RetrievalOutcome.ABSENT, KnowledgeTopic.CASH_RECEIPT);
            assertThat(absent).isEqualTo("등록된 현금영수증 기준이 아직 없습니다. 기준을 등록하면 근거가 생깁니다.");
            // Rules exist, one of them IS about tax invoices, none covers the question: a miss, not a
            // link-the-product instruction and not 「기준 없음」.
            String miss = none.actionKo(DraftKnowledgeState.NO_PRODUCT, null, flat,
                    RetrievalOutcome.ABSENT, RetrievalOutcome.NO_RELEVANT_EVIDENCE, KnowledgeTopic.TAX_INVOICE, true);
            assertThat(miss).isEqualTo("등록된 운영 기준에서 이 질문에 해당하는 근거를 찾지 못했습니다.");
            // Rules exist but none declares itself about tax invoices: for THAT topic this is absence.
            String absentForTopic = none.actionKo(DraftKnowledgeState.NO_PRODUCT, null, flat,
                    RetrievalOutcome.ABSENT, RetrievalOutcome.NO_RELEVANT_EVIDENCE, KnowledgeTopic.TAX_INVOICE, false);
            assertThat(absentForTopic).isEqualTo("등록된 세금계산서 기준이 아직 없습니다. 기준을 등록하면 근거가 생깁니다.");
            // Product knowledge exists and missed: said as a miss over the product information.
            String productMiss = none.actionKo(DraftKnowledgeState.NO_MATCH, "가닥", flat,
                    RetrievalOutcome.NO_RELEVANT_EVIDENCE, RetrievalOutcome.ABSENT, null);
            assertThat(productMiss).isEqualTo("등록된 상품 정보에서 「가닥」 관련 근거를 찾지 못했습니다.");
            // A product question with no product and no policy topic keeps the original instruction.
            assertThat(none.actionKo(DraftKnowledgeState.NO_PRODUCT, null, flat,
                    RetrievalOutcome.ABSENT, RetrievalOutcome.ABSENT, null))
                    .isEqualTo("이 문의가 어떤 상품에 대한 것인지 연결하면 근거를 찾을 수 있습니다.");
        }

        @Test
        @DisplayName("no promise template survives anywhere in this vocabulary")
        void noPromiseTemplates() {
            // Organization Answer Style v1 does not exist, so SellerOps has no seller-approved
            // sentence to fall back to — and inventing one is the defect this package closed.
            for (AnswerBasisState state : AnswerBasisState.values()) {
                for (DraftKnowledgeState knowledge : DraftKnowledgeState.values()) {
                    String text = state.messageKo() + " " + String.valueOf(state.actionKo(knowledge));
                    assertThat(text).as("%s/%s", state, knowledge)
                            .doesNotContain("안내드리겠습니다").doesNotContain("연락드리겠습니다")
                            .doesNotContain("담당자");
                }
            }
        }
    }

    @Nested
    @DisplayName("it is a projection, not a classifier")
    class NoNewClassifier {

        @Test
        @DisplayName("the only inputs are the two enums that already existed")
        void twoInputsAndNoOthers() throws Exception {
            var of = AnswerBasisState.class.getMethod("of", DraftKnowledgeState.class,
                    Applicability.class);
            assertThat(of.getParameterTypes()).containsExactly(DraftKnowledgeState.class,
                    Applicability.class);
        }

        @Test
        @DisplayName("it reads no text, calls no model and holds no word list")
        void nothingIsClassifiedHere() throws IOException {
            String code = Files.readString(
                            Path.of("src/main/java/com/sellerops/inquiry/draft/AnswerBasisState.java"))
                    .replaceAll("(?s)/\\*.*?\\*/", "").replaceAll("(?m)//.*$", "");
            assertThat(code).doesNotContain("contains(").doesNotContain("matches(")
                    .doesNotContain("Pattern").doesNotContain("Repository").doesNotContain("Service");
        }
    }

    @Nested
    @DisplayName("the image lane's authority rule has an enforcer")
    class ExtractedFigureAuthority {

        /**
         * {@code carriesExactFiguresUnaided()} was a declared rule with zero callers — an enum
         * stating a consequence that nothing applied. It is enforced through the spec-applicability
         * line, which is the seam its own docblock names ("the same treatment a variant-unresolved
         * spec already gets"), and it is live before any producer of the image authorship exists.
         */
        @Test
        @DisplayName("an image-derived figure changes the line the drafter reads")
        void imageDerivedEvidenceEscalatesTheCaution() {
            String typed = Applicability.NOT_VARIANT_SENSITIVE.messageKo(true);
            String fromImage = Applicability.NOT_VARIANT_SENSITIVE.messageKo(false);

            assertThat(typed).isEqualTo(Applicability.NOT_VARIANT_SENSITIVE.messageKo());
            assertThat(fromImage).isNotEqualTo(typed)
                    .contains("이미지에서 읽은").contains("확정된 사실");
        }

        @Test
        @DisplayName("the escalated line still names no option — the payload floor is unchanged")
        void theLineCarriesNoCatalogue() {
            for (Applicability applicability : Applicability.values()) {
                assertThat(applicability.messageKo(false))
                        .as("%s", applicability)
                        .doesNotContain("mm").doesNotContain("호").doesNotContain("가닥");
            }
        }

        @Test
        @DisplayName("the authorship rule is applied in main, not only declared")
        void theRuleHasACaller() throws IOException {
            Path main = Path.of("src", "main", "java", "com", "sellerops");
            List<String> callers = new ArrayList<>();
            try (Stream<Path> walk = Files.walk(main)) {
                for (Path source : walk.filter(f -> f.toString().endsWith(".java")).toList()) {
                    if (source.getFileName().toString().equals("KnowledgeAuthorship.java")) {
                        continue;
                    }
                    String code = Files.readString(source)
                            .replaceAll("(?s)/\\*.*?\\*/", "").replaceAll("(?m)//.*$", "");
                    if (code.contains("carriesExactFiguresUnaided()")) {
                        callers.add(source.getFileName().toString());
                    }
                }
            }
            assertThat(callers).as("an enum that declares a rule nobody applies is a comment")
                    .contains("InquiryEvidenceRetriever.java");
            assertThat(KnowledgeAuthorship.AI_EXTRACTED_FROM_SELLER_IMAGE.carriesExactFiguresUnaided())
                    .isFalse();
        }
    }
}
