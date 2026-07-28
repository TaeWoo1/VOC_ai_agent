package com.sellerops.reviewissue.dto;

import java.time.LocalDate;
import java.util.UUID;

/**
 * One evidence review of an issue, resolved to what the reply flow needs to act on it — the bridge
 * from the org-global issue surface to the account-scoped reply stack.
 *
 * <p><b>{@code actionRef}</b> is the attention address for this review ({@code review:<uuid>}, from
 * {@code VocItemRef.forReview}); the FE round-trips it into the existing reply panel and never parses
 * it. <b>{@code accountId}</b> is the seller account resolved from the review's org+channel — the
 * scope every reply endpoint requires. It is {@code null} with {@code accountAmbiguous = true} when
 * the org holds more than one account on that channel: {@code reviews} carries no seller account, so a
 * per-account attribution cannot be made and we fail closed rather than guess.
 *
 * <p><b>{@code selectable}</b> is the single honest "may the operator start a reply here" flag: false
 * when the channel already answered, when SellerOps has already recorded a reported submission for the
 * standing reply, or when the account is ambiguous. An already-answered review is excluded from
 * selection AND from execution — the same rule the guided-run 409 enforces server-side.
 *
 * <p><b>{@code quote}</b> is the masked opinion-unit clause this review contributed as evidence — the
 * "포함 이유", produced by the same {@code VocPreviewSanitizer} path as every other VOC surface; null
 * when the stored ordinal no longer resolves (never widened to the whole body). {@code rating},
 * {@code productName} and {@code reviewDate} are the same coarse locating facts the attention row and
 * the reply prep already carry — no new exposure, and no raw channel-side id or timestamp.
 */
public record ReviewIssueReplyCandidateView(
        UUID reviewId,
        String actionRef,
        Integer unitOrdinal,
        String quote,
        Integer rating,
        String productName,
        LocalDate reviewDate,
        String channelReplyState,
        boolean reportedSubmitted,
        boolean selectable,
        UUID accountId,
        boolean accountAmbiguous) {
}
