package com.sellerops.attention.reply;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.attention.reply.ReviewReplyProposalProvider.ReviewReplyContext;
import com.sellerops.attention.reply.ReviewReplyProposalProvider.Suggestion;
import com.sellerops.attention.reply.dto.ReviewReplyTemplateView;
import com.sellerops.common.ApiException;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * Review Reply Template Settings v1 — the settings side, against a real (H2) DB.
 *
 * <p>What is pinned here is not "does a text column store text" but the four things a later edit
 * could plausibly break: that <b>no settings means the wording this product shipped with</b>, that one
 * company's templates cannot be reached from another's, that <b>restoring the default removes the
 * override rather than storing a copy of it</b>, and that saving a template changes only what the NEXT
 * suggestion starts from.
 *
 * <p>Hermetic: no network, no marketplace, no model. Every review body is synthetic.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class ReviewReplyTemplateServiceTest {

    @Autowired ReviewReplyTemplateRepository rows;

    private ReviewReplyTemplateService service;
    private RuleBasedReviewReplyProvider provider;

    private final UUID orgA = UUID.randomUUID();
    private final UUID orgB = UUID.randomUUID();
    private final UUID user = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        service = new ReviewReplyTemplateService(rows);
        provider = new RuleBasedReviewReplyProvider(new ObjectProvider<>() {
            @Override
            public ReviewReplyTemplateService getObject(Object... args) {
                return service;
            }

            @Override
            public ReviewReplyTemplateService getObject() {
                return service;
            }

            @Override
            public ReviewReplyTemplateService getIfAvailable() {
                return service;
            }

            @Override
            public ReviewReplyTemplateService getIfUnique() {
                return service;
            }
        });
    }

    private Suggestion suggest(UUID org, String body, Integer rating) {
        return provider.suggest(new ReviewReplyContext(org, UUID.randomUUID(), body, rating));
    }

    // ---------------------------------------------------------------- defaults

    @Test
    @DisplayName("no settings is a real state: every category answers with the shipped wording")
    void absenceIsTheShippedDefault() {
        for (ReviewReplyTemplateKey key : ReviewReplyTemplateKey.values()) {
            assertThat(service.bodyFor(orgA, key)).isEqualTo(key.defaultBody());
            assertThat(service.isCustomized(orgA, key)).isFalse();
        }
        assertThat(service.view(orgA).templates())
                .allSatisfy(t -> assertThat(t.customized()).isFalse())
                .allSatisfy(t -> assertThat(t.body()).isEqualTo(t.defaultBody()));
    }

    @Test
    @DisplayName("an org with no settings gets the same bytes the provider produced before the table existed")
    void aProviderWithNoStorageAndAnOrgWithNoRowAgree() {
        RuleBasedReviewReplyProvider storageless = new RuleBasedReviewReplyProvider();
        for (Integer rating : new Integer[] {5, 4, 3, 2, 1, null}) {
            String body = "합성-리뷰-본문: 배송이 늦고 포장이 아쉬웠습니다";
            Suggestion withStorage = suggest(orgA, body, rating);
            Suggestion without = storageless.suggest(
                    new ReviewReplyContext(orgA, UUID.randomUUID(), body, rating));
            assertThat(withStorage.body()).isEqualTo(without.body());
            assertThat(withStorage.category()).isEqualTo(without.category());
            assertThat(withStorage.providerVersion()).isEqualTo(RuleBasedReviewReplyProvider.VERSION);
        }
    }

    @Test
    @DisplayName("the list is in the provider's own decision order, so reading it top to bottom is reading the rule")
    void theListIsInDecisionOrder() {
        assertThat(service.view(orgA).templates()).extracting(ReviewReplyTemplateView::key)
                .containsExactly("positive_reply", "quality_reply", "delivery_reply",
                        "packaging_reply", "product_info_reply", "pricing_reply", "general_reply");
    }

    // ---------------------------------------------------------------- override

    @Test
    @DisplayName("a saved template is what the next suggestion starts from — selection is unchanged")
    void savingChangesTheWordingAndNotTheChoice() {
        service.save(orgA, "delivery_reply", "배송이 늦어 죄송합니다. 다음 주문은 더 빨리 보내드리겠습니다.", user);

        Suggestion s = suggest(orgA, "합성-리뷰-본문: 배송이 너무 늦어요", 2);
        assertThat(s.category()).isEqualTo("delivery_reply");
        assertThat(s.body()).isEqualTo("배송이 늦어 죄송합니다. 다음 주문은 더 빨리 보내드리겠습니다.");
        assertThat(s.providerKind()).isEqualTo("RULE_BASED");
        assertThat(s.providerVersion()).isEqualTo(RuleBasedReviewReplyProvider.ORG_VERSION);
        // Untouched categories still answer with the shipped wording.
        assertThat(suggest(orgA, "합성-리뷰-본문: 포장이 엉망이었어요", 2).body())
                .isEqualTo(ReviewReplyTemplateKey.PACKAGING.defaultBody());
    }

    @Test
    @DisplayName("rating still beats keywords after a company has written its own wording")
    void ratingStillDecidesFirst() {
        service.save(orgA, "delivery_reply", "배송이 늦어 죄송합니다.", user);

        assertThat(suggest(orgA, "배송 빨라요! 포장도 좋았습니다", 5).category()).isEqualTo("positive_reply");
    }

    @Test
    @DisplayName("org A's wording is not reachable from org B")
    void oneCompanysWordingIsNotAnothers() {
        service.save(orgA, "general_reply", "A사 전용 문구입니다.", user);

        assertThat(service.bodyFor(orgB, ReviewReplyTemplateKey.GENERAL))
                .isEqualTo(ReviewReplyTemplateKey.GENERAL.defaultBody());
        assertThat(suggest(orgB, "합성-리뷰-본문", 3).body())
                .isEqualTo(ReviewReplyTemplateKey.GENERAL.defaultBody());
        assertThat(service.view(orgB).templates()).allSatisfy(t -> assertThat(t.customized()).isFalse());
    }

    @Test
    @DisplayName("re-saving replaces the wording rather than adding a second row")
    void savingTwiceKeepsOneRow() {
        service.save(orgA, "quality_reply", "첫 번째 문구", user);
        service.save(orgA, "quality_reply", "두 번째 문구", user);

        assertThat(rows.findByOrgId(orgA)).hasSize(1);
        assertThat(service.bodyFor(orgA, ReviewReplyTemplateKey.QUALITY)).isEqualTo("두 번째 문구");
    }

    // ---------------------------------------------------------------- reset

    @Test
    @DisplayName("restoring the default removes the override — it does not store a copy of the shipped text")
    void resetDeletesTheRow() {
        service.save(orgA, "positive_reply", "감사합니다!", user);
        assertThat(rows.findByOrgId(orgA)).hasSize(1);

        ReviewReplyTemplateView restored = service.reset(orgA, "positive_reply");

        assertThat(rows.findByOrgId(orgA)).isEmpty();
        assertThat(restored.customized()).isFalse();
        assertThat(restored.body()).isEqualTo(ReviewReplyTemplateKey.POSITIVE.defaultBody());
        assertThat(service.bodyFor(orgA, ReviewReplyTemplateKey.POSITIVE))
                .isEqualTo(ReviewReplyTemplateKey.POSITIVE.defaultBody());
    }

    @Test
    @DisplayName("restoring an untouched template is a success, not an error")
    void resetOfNothingIsFine() {
        assertThat(service.reset(orgA, "general_reply").customized()).isFalse();
    }

    // ---------------------------------------------------------------- validation

    @Test
    @DisplayName("blank, over-long and unknown are all refused, and none of them writes a row")
    void validationFailsClosed() {
        assertThatThrownBy(() -> service.save(orgA, "delivery_reply", "   ", user))
                .isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> service.save(orgA, "delivery_reply", null, user))
                .isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> service.save(orgA, "delivery_reply",
                "가".repeat(ReviewReplyTemplateService.MAX_BODY_BYTES), user))
                .isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> service.save(orgA, "not_a_category", "문구", user))
                .isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> service.reset(orgA, "not_a_category"))
                .isInstanceOf(ApiException.class);

        assertThat(rows.findByOrgId(orgA)).isEmpty();
    }

    @Test
    @DisplayName("the stored wording is normalized the same way a saved draft is")
    void bodyIsNormalizedOnSave() {
        ReviewReplyTemplateView saved = service.save(orgA, "general_reply", "  문구입니다\r\n두 번째 줄  ", user);

        assertThat(saved.body()).isEqualTo("문구입니다\n두 번째 줄");
        assertThat(saved.customized()).isTrue();
    }
}
