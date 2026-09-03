package com.sellerops.knowledge.candidate;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Knowledge Sources &amp; Acquisition v1 §D — what counts as a repeatable sentence, and what makes two
 * of them the same one.
 *
 * <p>Both bounds exist to keep the inbox worth reading: a greeting repeats in every answer and is not a
 * standard, and a whole answer is not a rule inside one.
 */
class KnowledgeCandidateSentenceTest {

    @Test
    @DisplayName("greetings and sign-offs are too short to be standards")
    void greetingsAreNotStandards() {
        assertThat(KnowledgeCandidateService.sentencesOf("안녕하세요. 감사합니다."))
                .isEmpty();
    }

    @Test
    @DisplayName("a sentence long enough to say something is kept, verbatim")
    void aRealSentenceIsKept() {
        assertThat(KnowledgeCandidateService.sentencesOf(
                "안녕하세요. 부착 전 표면의 먼지와 기름기를 제거해 주세요. 감사합니다."))
                .containsExactly("부착 전 표면의 먼지와 기름기를 제거해 주세요.");
    }

    @Test
    @DisplayName("newlines split as sentence ends do — a seller's answer is not one paragraph")
    void newlinesSplit() {
        assertThat(KnowledgeCandidateService.sentencesOf(
                "부착 전 표면의 먼지를 제거해 주세요\n30초 이상 눌러 고정해 주시기 바랍니다"))
                .hasSize(2);
    }

    @Test
    @DisplayName("the same sentence written two ways is ONE candidate — spacing and punctuation aside")
    void spacingDoesNotMakeASecondCandidate() {
        String a = KnowledgeCandidateService.dedupeKey("ORG", null, "먼지를 제거해 주세요.");
        String b = KnowledgeCandidateService.dedupeKey("ORG", null, "먼지를  제거해주세요");
        assertThat(a).isEqualTo(b);
    }

    @Test
    @DisplayName("the same sentence about two products is two candidates — scope is part of identity")
    void scopeIsPartOfIdentity() {
        java.util.UUID one = java.util.UUID.randomUUID();
        java.util.UUID two = java.util.UUID.randomUUID();
        assertThat(KnowledgeCandidateService.dedupeKey("PRODUCT", one, "먼지를 제거해 주세요."))
                .isNotEqualTo(KnowledgeCandidateService.dedupeKey("PRODUCT", two, "먼지를 제거해 주세요."));
        assertThat(KnowledgeCandidateService.dedupeKey("PRODUCT", one, "먼지를 제거해 주세요."))
                .isNotEqualTo(KnowledgeCandidateService.dedupeKey("ORG", null, "먼지를 제거해 주세요."));
    }

    @Test
    @DisplayName("three is the threshold — a sentence written twice is not yet a standard")
    void theThresholdIsStated() {
        assertThat(KnowledgeCandidateService.MIN_REPEATS).isEqualTo(3);
    }
}
