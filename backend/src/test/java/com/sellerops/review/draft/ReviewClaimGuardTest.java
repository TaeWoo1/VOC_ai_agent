package com.sellerops.review.draft;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * Grounded Review Drafting v1 — the check behind the prompt.
 *
 * <p>The sentence that does real damage in a public reply is not a wrong specification; it is a
 * remedy the seller never agreed to. These tests pin the two halves of the rule: a promise the
 * evidence supports is fine, and a promise nothing supports is a refusal.
 */
class ReviewClaimGuardTest {

    @Test
    void a_plain_thank_you_promises_nothing() {
        assertThat(ReviewClaimGuard.unsupportedClaims(
                "소중한 후기 감사합니다. 남겨주신 의견 잘 읽었습니다.", List.of())).isEmpty();
    }

    @Test
    void an_exchange_offered_with_no_evidence_at_all_is_refused() {
        assertThat(ReviewClaimGuard.unsupportedClaims(
                "불편을 드려 죄송합니다. 교환 도와드리겠습니다.", List.of())).containsExactly("교환");
    }

    @Test
    void the_same_offer_is_allowed_when_the_seller_own_policy_is_the_ground() {
        assertThat(ReviewClaimGuard.unsupportedClaims(
                "불편을 드려 죄송합니다. 교환 도와드리겠습니다.",
                List.of("수령 후 7일 이내 교환 및 반품이 가능합니다."))).isEmpty();
    }

    @Test
    void a_particle_or_a_space_cannot_hide_the_promise() {
        assertThat(ReviewClaimGuard.unsupportedClaims("환불 을 도와드리겠습니다.", List.of()))
                .containsExactly("환불");
        assertThat(ReviewClaimGuard.unsupportedClaims("전액 환불해 드리겠습니다.", List.of()))
                .containsExactly("환불");
    }

    @Test
    void every_unsupported_remedy_is_reported_in_declaration_order() {
        assertThat(ReviewClaimGuard.unsupportedClaims(
                "환불 또는 교환, 재발송까지 모두 도와드리겠습니다.", List.of()))
                .containsExactly("환불", "교환", "재발송");
    }

    @Test
    void evidence_about_a_different_remedy_does_not_authorize_this_one() {
        // The company's shipping note mentions 재발송; it says nothing about money coming back.
        assertThat(ReviewClaimGuard.unsupportedClaims(
                "환불 도와드리겠습니다.", List.of("파손 시 재발송해 드립니다.")))
                .containsExactly("환불");
    }

    @Test
    void a_blank_draft_is_not_a_violation() {
        assertThat(ReviewClaimGuard.unsupportedClaims(null, List.of())).isEmpty();
        assertThat(ReviewClaimGuard.unsupportedClaims("   ", List.of())).isEmpty();
    }
}
