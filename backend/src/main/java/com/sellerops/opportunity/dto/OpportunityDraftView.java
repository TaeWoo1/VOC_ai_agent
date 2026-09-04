package com.sellerops.opportunity.dto;

import java.time.Instant;

/** The prepared draft — a scaffold of facts and the seller's own passages, seller-editable. */
public record OpportunityDraftView(String title, String body, Instant updatedAt) {
}
