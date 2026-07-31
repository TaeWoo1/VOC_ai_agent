package com.sellerops.inquiry.guidedhandoff.dto;

import java.util.List;

/**
 * The full Guided Handoff descriptor for one inquiry work item.
 *
 * <p><b>Honest level: a Guided Handoff, not an Action Window.</b> Cafe24 has no browser
 * surface / DOM finder in this product, so SellerOps cannot open/verify the reply screen
 * for the operator. This descriptor therefore guides — it verifies the bound store and
 * board, states the target, and gives an exact manual checklist — and the operator does
 * the actual navigation and submission on the Cafe24 admin. {@code mode} is always
 * {@code "GUIDED_HANDOFF"} to keep the client honest about that level.
 *
 * <p>{@code eligible} is fail-closed: false unless the item is an OPEN, bound, Cafe24
 * board-6 inquiry with no reply adapter (a read-only, operator-answered channel). When
 * false, {@code reason} is a coarse, non-secret code and every other field is empty/null.
 *
 * <p>{@code deepLink} is null in this version: the Cafe24 admin board-article screen URL
 * is not derivable from stored data, so V1 ships checklist-only. A best-effort link may be
 * added later once the URL shape is confirmed — but a link is never a completion.
 */
public record InquiryGuidedHandoffView(
        boolean eligible,
        String reason,
        String mode,
        String handoffRef,
        boolean boundStoreVerified,
        boolean boardVerified,
        InquiryGuidedHandoffTargetHint targetHint,
        List<InquiryGuidedHandoffStep> checklist,
        String deepLink) {

    public static final String MODE_GUIDED_HANDOFF = "GUIDED_HANDOFF";

    /** A fail-closed, not-eligible descriptor carrying only the coarse reason code. */
    public static InquiryGuidedHandoffView notEligible(String reason) {
        return new InquiryGuidedHandoffView(
                false, reason, MODE_GUIDED_HANDOFF, null, false, false, null, List.of(), null);
    }
}
