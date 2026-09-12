package com.sellerops.reviewissue.dto;

import java.time.LocalDate;
import java.util.UUID;

/**
 * All-time evidence count for one product behind an issue — the "특정 상품 집중" roll-up as a
 * quote-free number. Carries only the product identifier + name, two counts, and this product's own
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
                                       /**
                                        * How many reviews this product has at all — the denominator
                                        * {@code evidenceCount} is a numerator OF.
                                        *
                                        * <p><b>It is here rather than fetched beside this row because a
                                        * denominator that travels separately from its numerator is a
                                        * denominator that can come to describe a different population.</b>
                                        * Both are org-scoped and both pass the {@code realDataOnly}
                                        * filter, so synthetic rows are absent from each.
                                        *
                                        * <p><b>The pair is not a rate, and a reader must not turn it into
                                        * one.</b> 「이 상품 리뷰 1,761건 중 16건」 is true as stated: 16
                                        * reviews said this. It does NOT say the other 1,745 did not — the
                                        * extractor reads a review only when it has a body, and a review it
                                        * never read is counted in this denominator while being unable to
                                        * appear in the numerator. So a percentage computed from these two
                                        * numbers would claim an examined population this read has not
                                        * measured. Surfaces render the pair and say what it counts.
                                        */
                                       long productReviews,
                                       LocalDate firstOccurredOn, LocalDate lastOccurredOn) {
}
