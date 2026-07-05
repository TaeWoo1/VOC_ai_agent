package com.sellerops.inquiry.proposal.dto;

import java.time.Instant;
import java.util.UUID;

/**
 * Seller-only inquiry detail, org-scoped. Unlike the sanitized queue row, this
 * exposes the seller's own operational content — the raw {@code title} and {@code
 * details} (body) — because the seller owns them. It still carries <b>no buyer
 * identity</b> (no author). {@code proposal} is present once the item is PROPOSED.
 */
public record InquiryDetail(
        UUID workItemId,
        UUID inquiryId,
        UUID sellerAccountId,
        UUID channelId,
        String phase,
        String status,
        String informStatus,
        String title,
        String details,
        Instant receivedAt,
        ProposalView proposal) {
}
