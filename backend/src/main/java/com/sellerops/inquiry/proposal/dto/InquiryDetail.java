package com.sellerops.inquiry.proposal.dto;

import com.sellerops.inquiry.reply.dto.ReplyDraftView;
import java.time.Instant;
import java.util.UUID;

/**
 * Seller-only inquiry detail, org-scoped. Unlike the sanitized queue row, this
 * exposes the seller's own operational content — the raw {@code title} and {@code
 * details} (body) — because the seller owns them. It still carries <b>no buyer
 * identity</b> (no author). {@code proposal} is present once the item is PROPOSED;
 * {@code draft} is the current (latest) reply draft, present once the seller has
 * saved one.
 *
 * <p>{@code channelCode}/{@code channelNameKo} are the resolved catalog labels for
 * {@code channelId} (null if the channel row is absent), so a reader can name the
 * target channel (e.g. Cafe24) without dereferencing the raw id. {@code isSecret}
 * mirrors {@link com.sellerops.inquiry.Inquiry#getSecret()} — {@code true} for a
 * Cafe24 비밀글 (fail-closed), {@code false} for a positively-public post, and
 * {@code null} when the source did not classify it (legacy / non-Cafe24). It lets a
 * reader flag a secret inquiry <b>without</b> ever exposing more of its content; it
 * does not change what this detail returns and never widens the dashboard/analysis
 * exposure boundary (that exclusion lives in the repository/service layer).
 */
public record InquiryDetail(
        UUID workItemId,
        UUID inquiryId,
        UUID sellerAccountId,
        UUID channelId,
        String channelCode,
        String channelNameKo,
        Boolean isSecret,
        String phase,
        String status,
        String informStatus,
        String title,
        String details,
        Instant receivedAt,
        ProposalView proposal,
        ReplyDraftView draft) {
}
