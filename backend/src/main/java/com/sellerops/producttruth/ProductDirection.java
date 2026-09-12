package com.sellerops.producttruth;

import java.time.LocalDate;
import java.util.List;

/**
 * PRODUCT_DIRECTION — a product or UX decision that has already been made, but is not a capability.
 *
 * <p>It sits between the two things the ledger already had. "홈은 command center다" is not something
 * a seller can be told the product does today in the way a capability row is, and it is not a roadmap
 * hypothesis either — it is a decision that constrains what gets built next. Keeping it in the
 * narrative made the narrative make quiet capability claims; keeping it in the roadmap made a settled
 * decision read as an open question.
 *
 * <p>Like {@link ProductNarrative}, it carries no status, no mode and no evidence, so it cannot be
 * read as something the product provides.
 */
public record ProductDirection(
        String id,
        String title,
        String statement,
        List<String> sourceRefs,
        ProductReviewState review,
        LocalDate lastReviewed) {
}
