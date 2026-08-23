package com.sellerops.reviewissue.dto;

import java.time.LocalDate;
import java.util.UUID;

/**
 * All-time evidence count for one product behind an issue — the "특정 상품 집중" roll-up as a
 * quote-free number. Carries only the product identifier + name, a count, and this product's own
 * span; never a review id, a quote, or a buyer identity.
 *
 * <p><b>The span is this product's, not the issue's.</b> {@code firstOccurredOn}/{@code
 * lastOccurredOn} are the min/max {@code occurred_on} of the evidence rows belonging to THIS
 * {@code (issue, product)} pair. {@link IssueEvidenceSummaryView#firstEvidenceOn()} is the issue's,
 * over every product, and the two are different facts: an issue whose latest review is another
 * product's must not let this product's rows be called recent. Handing the issue's dates down to a
 * product row is exactly the count-scope defect (C4) on the temporal axis, so the fields are
 * separate rather than derived.
 */
public record IssueProductEvidenceView(UUID productId, String productName, long evidenceCount,
                                       LocalDate firstOccurredOn, LocalDate lastOccurredOn) {
}
