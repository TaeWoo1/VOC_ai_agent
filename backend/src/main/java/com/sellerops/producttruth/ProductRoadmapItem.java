package com.sellerops.producttruth;

import java.time.LocalDate;
import java.util.List;

/**
 * ROADMAP — a direction, never a capability.
 *
 * <p>The separation is structural, not a convention: this record has no
 * {@link ProductCapabilityStatus}, no {@link ProductCapabilityMode} and no
 * {@link ProductEvidence}, and it shares no supertype with {@link ProductCapability}. A caller
 * cannot iterate the two together by accident, and there is no field on this type that could be
 * mistaken for "the product does this".
 *
 * <p>{@code qualifier} is mandatory for the same reason: any answer that mentions a roadmap item has
 * to carry the sentence that says it is not available today.
 */
public record ProductRoadmapItem(
        String id,
        String title,
        ProductRoadmapStatus status,
        String summary,
        /** The Korean hedge an answer must carry when this item is mentioned. Never blank. */
        String qualifier,
        List<String> sourceRefs,
        ProductReviewState review,
        LocalDate lastReviewed) {
}
