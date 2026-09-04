package com.sellerops.opportunity;

import static com.sellerops.opportunity.OpportunityFixtures.PRODUCT;
import static com.sellerops.opportunity.OpportunityFixtures.issue;
import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.reviewissue.IssueVocabulary;
import com.sellerops.reviewissue.ReviewIssueThresholds;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The derivation table, pinned on the extractor's own vocabulary. Every case is a sentence a seller
 * could be shown, so every case is a product decision — change one here and the doc must say why.
 */
class OpportunityRulesTest {

    private static List<OpportunityKind> kinds(List<OpportunityRules.Candidate> c) {
        return c.stream().map(OpportunityRules.Candidate::kind).toList();
    }

    @Test
    @DisplayName("접착 × 탈락 with nothing written yields an FAQ opportunity AND a product review")
    void adhesionYieldsBothLanes() {
        assertThat(kinds(OpportunityRules.derive(issue("접착", "탈락", 5, PRODUCT), false)))
                .containsExactly(OpportunityKind.FAQ_SUPPLEMENT, OpportunityKind.PRODUCT_IMPROVEMENT_REVIEW);
    }

    @Test
    @DisplayName("…and when the seller has already written about the aspect, the guidance becomes 상세 보완")
    void mentionedAspectMovesGuidanceToDetailPage() {
        assertThat(kinds(OpportunityRules.derive(issue("접착", "탈락", 5, PRODUCT), true)))
                .containsExactly(OpportunityKind.PRODUCT_GUIDE_SUPPLEMENT, OpportunityKind.PRODUCT_IMPROVEMENT_REVIEW);
    }

    @Test
    @DisplayName("포장 × 파손 has no customer-facing sentence — product lane only")
    void packagingDamageIsProductLaneOnly() {
        assertThat(kinds(OpportunityRules.derive(issue("포장", "파손", 4, PRODUCT), false)))
                .containsExactly(OpportunityKind.PRODUCT_IMPROVEMENT_REVIEW);
    }

    @Test
    @DisplayName("배송 × 지연 is the company's rule, and needs no product")
    void shippingIsOrgPolicyWithoutProduct() {
        assertThat(kinds(OpportunityRules.derive(issue("배송", "지연", 3, null), false)))
                .containsExactly(OpportunityKind.OPERATING_POLICY_SUPPLEMENT);
    }

    @Test
    @DisplayName("배송 × a broken product is the exchange/refund rule, not the shipping one")
    void shippingDamageIsExchangePolicy() {
        assertThat(OpportunityRules.guidanceTargetOf(issue("배송", "파손", 15, null)).orgType())
                .isEqualTo(com.sellerops.knowledge.org.OrgKnowledgeType.EXCHANGE_REFUND_POLICY);
        assertThat(OpportunityRules.guidanceTargetOf(issue("배송", "지연", 6, null)).orgType())
                .isEqualTo(com.sellerops.knowledge.org.OrgKnowledgeType.SHIPPING_POLICY);
        assertThat(kinds(OpportunityRules.derive(issue("배송", "파손", 15, null), true)))
                .containsExactly(OpportunityKind.OPERATING_POLICY_SUPPLEMENT);
    }

    @Test
    @DisplayName("불일치 is always the detail page, whatever the library says")
    void mismatchIsAlwaysDetailPage() {
        assertThat(kinds(OpportunityRules.derive(issue("색상", "불일치", 3, PRODUCT), false)))
                .containsExactly(OpportunityKind.PRODUCT_GUIDE_SUPPLEMENT);
        assertThat(kinds(OpportunityRules.derive(issue("색상", "불일치", 3, PRODUCT), true)))
                .containsExactly(OpportunityKind.PRODUCT_GUIDE_SUPPLEMENT);
    }

    @Test
    @DisplayName("난이도 is a usage note wherever it lands")
    void difficultyIsUsageGuidance() {
        assertThat(OpportunityRules.guidanceTargetOf(issue("설치", "난이도", 3, PRODUCT)).productType().name())
                .isEqualTo("USAGE");
        assertThat(kinds(OpportunityRules.derive(issue("설치", "난이도", 3, PRODUCT), false)))
                .containsExactly(OpportunityKind.FAQ_SUPPLEMENT);
    }

    @Test
    @DisplayName("a product-scoped guidance with no product yields nothing — there is nowhere to file it")
    void productGuidanceNeedsAProduct() {
        assertThat(OpportunityRules.derive(issue("접착", "탈락", 5, null), false)).isEmpty();
    }

    @Test
    @DisplayName("aspects no sentence helps with (가격) yield no guidance")
    void priceHasNoGuidanceLane() {
        assertThat(OpportunityRules.derive(issue("가격", "부족", 5, PRODUCT), false))
                .extracting(OpportunityRules.Candidate::kind)
                .containsExactly(OpportunityKind.PRODUCT_IMPROVEMENT_REVIEW);
    }

    @Test
    @DisplayName("the repeat gate is the extractor's own threshold; dismissed and resolved issues never qualify")
    void gate() {
        assertThat(OpportunityRules.qualifies(issue("접착", "탈락", ReviewIssueThresholds.NEW_MIN_EVIDENCE - 1, PRODUCT)))
                .isFalse();
        assertThat(OpportunityRules.qualifies(issue("접착", "탈락", ReviewIssueThresholds.NEW_MIN_EVIDENCE, PRODUCT)))
                .isTrue();
        assertThat(OpportunityRules.qualifies(issue(UUID.randomUUID(), "접착", "탈락", 9, PRODUCT, "NEEDS_REVIEW", true)))
                .isFalse();
        assertThat(OpportunityRules.qualifies(issue(UUID.randomUUID(), "접착", "탈락", 9, PRODUCT, "RESOLVED", false)))
                .isFalse();
        assertThat(OpportunityRules.derive(issue("접착", "탈락", 1, PRODUCT), false)).isEmpty();
    }

    @Test
    @DisplayName("every aspect the extractor knows is either mapped to a guidance place or deliberately not")
    void everyAspectIsDecided() {
        // Aspects with a guidance lane, and the two without one. A new aspect in the vocabulary must
        // be placed here on purpose rather than silently getting no opportunity.
        List<String> withGuidance = List.of("배송", "접착", "설치", "설명", "표면", "색상", "크기");
        List<String> without = List.of("포장", "가격");
        assertThat(IssueVocabulary.aspects()).containsExactlyInAnyOrderElementsOf(
                java.util.stream.Stream.concat(withGuidance.stream(), without.stream()).toList());
        for (String aspect : withGuidance) {
            assertThat(OpportunityRules.guidanceTargetOf(issue(aspect, "부족", 3, PRODUCT))).as(aspect).isNotNull();
        }
        for (String aspect : without) {
            assertThat(OpportunityRules.guidanceTargetOf(issue(aspect, "부족", 3, PRODUCT))).as(aspect).isNull();
        }
    }
}
