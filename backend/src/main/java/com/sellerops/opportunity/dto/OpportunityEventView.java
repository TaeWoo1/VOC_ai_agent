package com.sellerops.opportunity.dto;

import java.time.Instant;

/**
 * One thing the seller did about this opportunity, as they see it.
 *
 * <p>{@code evidenceCount} is what the suggestion rested on when they did it, and is null for
 * decisions taken before the trail existed — the screen then says when, not on what.
 */
public record OpportunityEventView(String event, String eventLabelKo,
                                   String statusFrom, String statusTo,
                                   Long evidenceCount, Instant decidedAt) {
}
