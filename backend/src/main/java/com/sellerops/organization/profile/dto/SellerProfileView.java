package com.sellerops.organization.profile.dto;

import java.time.Instant;

/**
 * The company as the seller registered it.
 *
 * @param name            {@code Organization.name} — reused, not duplicated; the profile has no name of its own
 * @param businessSummary the seller's own description, or null when none is registered
 * @param configured      whether a summary is registered — the honest half, so a screen can say
 *                        「아직 등록하지 않으셨습니다」 rather than render an empty box as a choice
 * @param updatedAt       when the summary was last saved, or null
 */
public record SellerProfileView(String name, String businessSummary, boolean configured,
                                Instant updatedAt) {
}
