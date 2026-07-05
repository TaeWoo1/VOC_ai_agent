package com.sellerops.inquiry.proposal;

import java.util.UUID;

/**
 * The seller-side inquiry drafting seam (ported from the collector's {@code
 * InquiryProposalProvider}). Given the seller-visible inquiry context it returns a
 * coarse draft descriptor; the coordinator ({@link InquiryProposalService}) turns
 * that into a persisted {@link InquiryProposal} and moves the work item to PROPOSED.
 *
 * <p>The provider only DRAFTS. It never approves, never executes, and never sees
 * more than the permitted seller context. It may throw to signal it is temporarily
 * unavailable — the coordinator then leaves the work item OPEN and retryable,
 * writing nothing.
 *
 * <p>The default implementation is rule-based ({@link RuleBasedInquiryProposalProvider}),
 * deliberately isolated from the item-analysis subsystem; a future AI adapter would
 * implement this same interface and report its own provenance.
 */
public interface InquiryProposalProvider {

    /** Draft a proposal for one inquiry, or throw if the provider is unavailable. */
    Draft propose(SellerInquiryContext context);

    /**
     * The seller-visible operational view handed to the provider. Carries the raw,
     * seller-owned inquiry title/details (the seller owns them) plus the canonical
     * and raw source status — no buyer identity, no reply token, no internal ids
     * beyond the inquiry reference.
     */
    record SellerInquiryContext(
            UUID orgId,
            UUID inquiryId,
            String title,
            String details,
            String canonicalStatus,
            String rawInformStatus) {
    }

    /**
     * A coarse drafted-reply descriptor plus provider provenance. The raw reply body
     * is deliberately NOT part of this slice — only the coarse {@code summaryCategory}.
     */
    record Draft(
            String summaryCategory,
            String providerKind,
            String providerName,
            String providerVersion) {
    }
}
