package com.sellerops.review.naver;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.List;

/**
 * <b>What an unattended NAVER review read may hand back: the rows it read, and nothing about who wrote them.</b>
 *
 * <p>The Seller Center row model carries the buyer's masked id, member number and order number beside every
 * review. None of them has a field here, and unknown properties are refused rather than ignored, so a helper that
 * sent one would be told so instead of quietly succeeding — the same posture as the Coupang handoff.
 *
 * <p>{@code windowDays} is the screen's own period as the helper measured it. It is recorded as the bound this
 * read covered, and it is why a run of this recipe is {@code BOUNDED}: a read of a period is never a read of a
 * store's history.
 */
@JsonIgnoreProperties(ignoreUnknown = false)
public record NaverReviewObservationRequest(List<Review> reviews, Integer windowDays) {

    /**
     * One review as the list's row model held it.
     *
     * @param reviewId    the review's own id — the value its detail link opens and the export's 리뷰글번호
     * @param createdAt   리뷰등록일 as the page carries it (ISO-8601 with offset)
     * @param answered    the page's own «has a seller comment» flag; never inferred
     * @param attachCount how many photos/videos the row model listed — a reading, so 0 means «none», not «unknown»
     */
    @JsonIgnoreProperties(ignoreUnknown = false)
    public record Review(String reviewId, String createdAt, Integer rating, String body, String productNo,
                         String productName, Boolean answered, Integer attachCount) {
    }
}
