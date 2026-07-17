package com.sellerops.attention.reply;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.attention.reply.ReviewReplyProposalProvider.ReviewReplyContext;
import com.sellerops.attention.reply.ReviewReplyProposalProvider.Suggestion;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

/**
 * The rule baseline: deterministic, local, no external call. Every input is SYNTHETIC.
 *
 * <p>What is worth pinning here is not "does the keyword table work" — that is a restatement of
 * the table — but the two rules a future edit could plausibly get wrong: that rating beats
 * keywords, and that no template promises anything.
 */
class RuleBasedReviewReplyProviderTest {

    private final RuleBasedReviewReplyProvider provider = new RuleBasedReviewReplyProvider();

    private Suggestion suggest(String body, Integer rating) {
        return provider.suggest(new ReviewReplyContext(UUID.randomUUID(), UUID.randomUUID(), body,
                rating));
    }

    /**
     * The provider flag is REAL, not decorative — and this pins the claim
     * {@code application.yml} makes about it.
     *
     * <p>Selecting an unimplemented provider must leave no {@link ReviewReplyProposalProvider}
     * bean, which makes {@link ReviewReplyService}'s required constructor argument
     * unsatisfiable and stops the application from starting. That is the intended behaviour:
     * {@code ai} is reserved and unimplemented, and it is the first place a live LLM would
     * enter the product (roadmap §9.2, separately authorized). A silent fall back to rules
     * would be worse than a failed boot — the operator would be shown 규칙 기반 while believing
     * they had configured something else.
     *
     * <p>Asserted on the bean rather than by booting the whole app: an absent bean IS the boot
     * failure, and a context-failure test would drag the entire application in to observe one
     * conditional.
     */
    @Test
    void anUnimplementedProviderLeavesNoBeanSoTheApplicationCannotSilentlyFallBackToRules() {
        new ApplicationContextRunner()
                .withUserConfiguration(RuleBasedReviewReplyProvider.class)
                .withPropertyValues("sellerops.reply.review.provider=ai")
                .run(ctx -> assertThat(ctx).doesNotHaveBean(ReviewReplyProposalProvider.class));
    }

    @Test
    void theRuleProviderIsTheDefaultAndIsSelectableExplicitly() {
        new ApplicationContextRunner()
                .withUserConfiguration(RuleBasedReviewReplyProvider.class)
                .run(ctx -> assertThat(ctx).hasSingleBean(ReviewReplyProposalProvider.class));
        new ApplicationContextRunner()
                .withUserConfiguration(RuleBasedReviewReplyProvider.class)
                .withPropertyValues("sellerops.reply.review.provider=rule_based")
                .run(ctx -> assertThat(ctx).hasSingleBean(ReviewReplyProposalProvider.class));
    }

    @Test
    void reportsRuleBasedProvenanceHonestly() {
        Suggestion s = suggest("합성-리뷰-본문", 3);
        assertThat(s.providerKind()).isEqualTo("RULE_BASED");
        assertThat(s.providerName()).isEqualTo("review-reply-template");
        assertThat(s.providerVersion()).isEqualTo("templates-v1");
    }

    @Test
    void isDeterministic() {
        assertThat(suggest("배송이 너무 늦어요", 2).body()).isEqualTo(suggest("배송이 너무 늦어요", 2).body());
    }

    /**
     * The case the rating-first rule exists for. "배송 빨라요" on a 5★ review contains a delivery
     * keyword; a keyword-first provider would apologise for late delivery to a happy customer,
     * in public.
     */
    @Test
    void aPraisingReviewNeverGetsAnApologyJustBecauseItMentionsAKeyword() {
        Suggestion s = suggest("배송 빨라요! 포장도 좋았고 가격도 만족합니다", 5);
        assertThat(s.category()).isEqualTo("positive_reply");
        assertThat(s.body()).doesNotContain("죄송").doesNotContain("사과");
        assertThat(s.body()).contains("감사");
    }

    @Test
    void ratingAtTheThresholdIsAlreadyPraise() {
        assertThat(suggest("불량이 있었지만 교환은 빨랐어요", RuleBasedReviewReplyProvider.POSITIVE_MIN_RATING)
                .category()).isEqualTo("positive_reply");
    }

    @Test
    void aLowRatedReviewTakesTheKeywordPath() {
        assertThat(suggest("상품이 불량입니다", 1).category()).isEqualTo("quality_reply");
        assertThat(suggest("배송이 너무 늦어요", 2).category()).isEqualTo("delivery_reply");
        assertThat(suggest("포장이 엉망이었어요", 2).category()).isEqualTo("packaging_reply");
        assertThat(suggest("설명이랑 너무 달라요", 2).category()).isEqualTo("product_info_reply");
        assertThat(suggest("가격이 너무 비싸요", 3).category()).isEqualTo("pricing_reply");
    }

    /** No rating means no evidence of praise, so the keywords are the only signal there is. */
    @Test
    void anUnratedReviewTakesTheKeywordPath() {
        assertThat(suggest("배송이 너무 늦어요", null).category()).isEqualTo("delivery_reply");
        assertThat(suggest("그냥 그래요", null).category()).isEqualTo("general_reply");
    }

    @Test
    void fallsBackToTheGeneralTemplateWhenNothingMatches() {
        assertThat(suggest("무난합니다", 3).category()).isEqualTo("general_reply");
    }

    @Test
    void handlesAnEmptyOrNullBodyWithoutThrowing() {
        assertThat(suggest(null, null).category()).isEqualTo("general_reply");
        assertThat(suggest("", 2).body()).isNotBlank();
    }

    /**
     * The one output here that could do real damage once public. A rule engine cannot know
     * whether the seller intends a refund, an exchange, a discount, or a delivery date, so no
     * template may imply one — the operator supplies every specific.
     */
    @Test
    void noTemplatePromisesARemedyOrBlamesTheCustomer() {
        String[] bodies = {
                suggest("상품이 불량입니다", 1).body(),
                suggest("배송이 너무 늦어요", 2).body(),
                suggest("포장이 엉망이었어요", 2).body(),
                suggest("설명이랑 너무 달라요", 2).body(),
                suggest("가격이 너무 비싸요", 3).body(),
                suggest("무난합니다", 3).body(),
                suggest("최고예요", 5).body(),
        };
        for (String body : bodies) {
            assertThat(body)
                    .as("template must promise no remedy: %s", body)
                    .doesNotContain("환불").doesNotContain("교환").doesNotContain("반품")
                    .doesNotContain("보상").doesNotContain("쿠폰").doesNotContain("적립")
                    .doesNotContain("드리겠습니다만");
            assertThat(body)
                    .as("template must not blame the customer: %s", body)
                    .doesNotContain("고객님의 실수").doesNotContain("확인하지 않으")
                    .doesNotContain("잘못");
            assertThat(body).startsWith("안녕하세요, 고객님.");
        }
    }
}
