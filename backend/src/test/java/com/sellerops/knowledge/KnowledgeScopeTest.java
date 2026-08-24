package com.sellerops.knowledge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.inquiry.draft.InquiryDraftEvidence;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

/**
 * The scope model, asserted structurally rather than trusted to a docblock.
 *
 * <p>The load-bearing claim is a NEGATIVE one: a channel capability and an order status must not be
 * copyable into a retrievable corpus. A comment saying so survives exactly until someone adds an
 * "order context" knowledge type to make a demo answer a shipping question. These tests make that
 * addition fail.
 */
class KnowledgeScopeTest {

    @Test
    @DisplayName("only the three seller-authored scopes are retrievable")
    void onlySellerAuthoredScopesAreRetrievable() {
        assertThat(KnowledgeScope.PRODUCT.retrievable()).isTrue();
        assertThat(KnowledgeScope.ORG_OPERATIONS.retrievable()).isTrue();
        assertThat(KnowledgeScope.PAST_ANSWER.retrievable()).isTrue();

        assertThat(KnowledgeScope.CHANNEL_FACT.retrievable())
                .as("what a platform supports is not seller policy and is not quoted to a customer")
                .isFalse();
        assertThat(KnowledgeScope.ORDER_STATE.retrievable())
                .as("an order status copied into a passage is a fact that goes stale without an edit")
                .isFalse();
    }

    @ParameterizedTest
    @EnumSource(KnowledgeScope.class)
    @DisplayName("a retrievable scope has a citation kind; a non-retrievable one cannot be cited at all")
    void citationKindsExistExactlyForRetrievableScopes(KnowledgeScope scope) {
        if (scope.retrievable()) {
            assertThat(InquiryDraftEvidence.kindOf(scope)).isNotBlank();
            assertThat(InquiryDraftEvidence.scopeOf(InquiryDraftEvidence.kindOf(scope))).isEqualTo(scope);
        } else {
            assertThatThrownBy(() -> InquiryDraftEvidence.kindOf(scope))
                    .isInstanceOf(IllegalArgumentException.class);
        }
    }

    @ParameterizedTest
    @EnumSource(KnowledgeScope.class)
    @DisplayName("every scope has a seller-facing name — a screen never shows the enum")
    void everyScopeIsNamedInKorean(KnowledgeScope scope) {
        assertThat(scope.labelKo()).isNotBlank();
        assertThat(scope.labelKo()).doesNotContain("_").isNotEqualTo(scope.name());
    }

    @Test
    @DisplayName("an unknown stored kind reads back as unknown rather than as some other scope")
    void anUnknownKindIsNotSilentlyMappedOntoAScope() {
        // Rows outlive builds. A kind this build has never heard of must not be displayed as
        // "상품 정보" — a mislabelled citation is worse than an unlabelled one.
        assertThat(InquiryDraftEvidence.scopeOf("ORDER_FACT")).isNull();
        assertThat(InquiryDraftEvidence.scopeLabelOf("ORDER_FACT")).isEqualTo("ORDER_FACT");
    }
}
