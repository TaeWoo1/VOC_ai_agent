package com.sellerops.review.recent;

import com.sellerops.channel.Channel;
import com.sellerops.common.MarkupText;
import com.sellerops.common.VocPreviewSanitizer;
import com.sellerops.identity.ExecutableIdentity;
import com.sellerops.review.Review;
import com.sellerops.review.recent.dto.RecentReviewItemView;
import com.sellerops.review.triage.ReviewTriageRules;
import com.sellerops.selleraccount.SellerAccount;
import java.time.ZoneOffset;

/**
 * How a stored review becomes one sanitized row.
 *
 * <p>It exists so that there is exactly ONE of these. Two reads now answer 「이 리뷰가 무엇인가」 — the
 * window read the Agent uses ({@link RecentReviewService}) and the product-scoped record the 상품 screen's
 * 리뷰 figure opens ({@code ProductReviewsService}) — and a second copy of this mapping is how the same
 * review comes to read differently in the conversation and on the screen.
 *
 * <p>The redaction rules are the caller's inheritance, not this class's decision: a rating-only review has
 * no sentence to preview, and everything else goes through {@link VocPreviewSanitizer}. No buyer name, no
 * raw body, no channel-side identifier.
 */
public final class ReviewRows {

    private ReviewRows() {
    }

    public static RecentReviewItemView row(Review r, Channel channel, SellerAccount account,
                                           String productName, ExecutableIdentity executableIdentity) {
        // A rating-only review has no sentence to preview; the sanitizer's text would be blank.
        String preview = ReviewTriageRules.isTextless(r.getBody())
                ? null : VocPreviewSanitizer.sanitize(MarkupText.toPlainText(r.getBody())).text();
        return new RecentReviewItemView(
                r.getId(),
                account == null ? null : account.getId(),
                channel == null ? null : channel.getCode(),
                channel == null ? null : channel.getNameKo(),
                r.getReceivedAt() == null ? null : r.getReceivedAt().atZone(ZoneOffset.UTC).toLocalDate(),
                r.getRating(),
                r.isNegative(),
                preview,
                r.getProductId(),
                productName,
                r.getReplyState() == null ? null : r.getReplyState().name(),
                executableIdentity.name());
    }
}
