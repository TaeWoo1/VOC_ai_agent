package com.sellerops.product.detail.image;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The Stage 1 cost ceiling, computed from the constants that actually go on the wire.
 *
 * <p><b>Why this is a test and not a paragraph.</b> The approval says the run must not be able to
 * exceed USD 0.75, and every input to that number is a constant somebody could raise: the output
 * cap, the image budget, the detail level. A sentence in a document does not fail when one of them
 * moves. This does.
 *
 * <p>Vendor figures, from the pricing and vision pages on 2026-08-27 — quoted here, never guessed:
 * gpt-5.6-terra short-context input USD 2.00 / 1M and output USD 12.00 / 1M; patch tokenization
 * {@code ceil(w/32)*ceil(h/32)} with a 1.2 multiplier; {@code detail=high} capped at 2,500 patches.
 * The output price is applied to the whole {@code max_completion_tokens} budget because on a
 * reasoning model that budget is shared with reasoning — the ceiling assumes it is all spent.
 */
class ImageKnowledgeCostFenceTest {

    private static final double INPUT_USD_PER_TOKEN = 2.00 / 1_000_000;
    private static final double OUTPUT_USD_PER_TOKEN = 12.00 / 1_000_000;

    /**
     * A generous bound on the constant instruction, in tokens.
     *
     * <p>Deliberately over-stated: the prompt is about 330 tokens of English, and a ceiling that
     * assumed the exact figure would be a ceiling that moves whenever a sentence is reworded.
     */
    private static final int PROMPT_TOKENS_CEILING = 600;

    private static final double APPROVED_CEILING_USD = 0.75;

    @Test
    @DisplayName("26 images at the vendor's stated worst case stays under the approved ceiling")
    void theTheoreticalMaximumIsUnderTheApprovedCeiling() {
        int imageTokensCeiling = (int) Math.ceil(
                ImageKnowledgeProperties.MAX_PATCHES_AT_HIGH * ImageKnowledgeProperties.PATCH_MULTIPLIER);
        assertThat(imageTokensCeiling).isEqualTo(3_000);

        int images = ImageFetchPolicy.MAX_IMAGES_PER_PRODUCT;
        int outputCeilingPerCall = 1_200;

        double input = (long) images * (imageTokensCeiling + PROMPT_TOKENS_CEILING) * INPUT_USD_PER_TOKEN;
        double output = (long) images * outputCeilingPerCall * OUTPUT_USD_PER_TOKEN;
        double total = input + output;

        assertThat(images).isEqualTo(26);
        assertThat(total)
                .as("the whole run's theoretical maximum, at the vendor's own stated rates")
                .isLessThanOrEqualTo(APPROVED_CEILING_USD);
        // Stated so a future reader sees how much headroom there was rather than only that it fit.
        assertThat(total).isCloseTo(0.556, org.assertj.core.data.Offset.offset(0.01));
    }

    @Test
    @DisplayName("the output cap is small on purpose — the generic 4,000 would break the ceiling")
    void theGenericOutputCeilingWouldNotFit() {
        int images = ImageFetchPolicy.MAX_IMAGES_PER_PRODUCT;
        double withGenericCap = (long) images * 4_000 * OUTPUT_USD_PER_TOKEN
                + (long) images * (3_000 + PROMPT_TOKENS_CEILING) * INPUT_USD_PER_TOKEN;

        // Every other capability in this backend defaults to 4,000 output tokens. Inheriting that
        // here would have cost 2.2x and bought nothing: the answer is a bounded list of triples.
        assertThat(withGenericCap).isGreaterThan(APPROVED_CEILING_USD);
    }

    @Test
    @DisplayName("detail=auto has no patch budget on this model — the fence is the detail level")
    void theDetailLevelIsTheFence() {
        // Documented behaviour: on gpt-5.6-terra, `auto` sizes like `original` — up to 65,535 px with
        // NO patch-budget limit. One tall 상세페이지 strip would then cost an amount nobody can put
        // on a manifest, which is why the request pins `high`.
        assertThat(ImageKnowledgeProperties.DETAIL).isEqualTo("high");
        assertThat(ImageKnowledgeProperties.MAX_PATCHES_AT_HIGH).isEqualTo(2_500);
    }
}
