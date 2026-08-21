package com.sellerops.product.dto;

import com.sellerops.reviewissue.dto.ReviewIssueView;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * Everything SellerOps can honestly say about one product right now — and, just as load-bearing,
 * what it cannot say.
 *
 * <p><b>Nothing here is a new judgement.</b> {@code issues} are {@link ReviewIssueView}s straight from
 * {@code ReviewIssueQueryService} (severity, trend and concentration decided by {@code IssueChangeRules}
 * as always); {@code recommendedActions} are tallies of stored {@code item_analyses.recommended_action}
 * values; the counts are repository counts. The product specialist composes existing truth and derives
 * none of its own — the rule the Operator Graph contract states as R1.
 *
 * <p><b>{@code coverage} is not decoration.</b> It is the difference between "이 상품은 문제 없음" and
 * "이 상품에 연결된 데이터가 없어 판단할 수 없음", and a reader that ignores it will report the second as
 * the first. Every list in this shape must be read together with the coverage row for its source: an
 * empty {@code issues} list under {@link com.sellerops.attention.AttentionCoverage#UNCERTAIN_PRODUCT_UNLINKED}
 * says nothing about the product at all.
 *
 * @param linkedChannels channel codes that actually have product-linked rows for this product — the
 *     positive half of coverage, so a reader can name which channel a finding does and does not cover
 */
public record ProductSignalsView(UUID productId, String productName, String sku,
                                 LocalDate referenceDate,
                                 List<ReviewIssueView> issues,
                                 List<RecommendedActionCountView> recommendedActions,
                                 ProductVolumeView volume,
                                 List<String> linkedChannels,
                                 List<SignalCoverageView> coverage) {

    /** True when at least one signal source cannot answer for this product. */
    public boolean hasUncertainSignal() {
        return coverage.stream().anyMatch(SignalCoverageView::isUncertain);
    }
}
