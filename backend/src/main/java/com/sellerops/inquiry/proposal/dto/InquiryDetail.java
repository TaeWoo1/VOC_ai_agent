package com.sellerops.inquiry.proposal.dto;

import com.sellerops.inquiry.draft.dto.DraftEvidenceView;
import com.sellerops.inquiry.reply.dto.ReplyDraftView;
import com.sellerops.inquiry.publish.dto.InquiryReplyCapabilityView;
import com.sellerops.order.fact.dto.OrderContextView;
import java.time.Instant;
import java.util.List;
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
 *
 * <p>{@code title}/{@code details} are the PLAIN TEXT of the stored body. A Cafe24 board post arrives
 * as whatever the customer's mail client or the shop editor emitted, and the seller was being shown
 * {@code <br /> [ Original Message ] <p>…}. The stored row is untouched; the reduction happens here,
 * on the way out, so the seller and the drafter both read the question a person asked.
 *
 * <p>{@code productBinding} says HOW {@code productId} was decided — {@code SOURCE_EXACT} (the
 * channel's own identifier matched a listing) or {@code USER_CONFIRMED} (a person picked it on
 * screen), null when nothing is bound. The screen shows the difference because the two are checkable
 * in different ways, and because a seller reading a grounded draft deserves to know whether the
 * product it was grounded in came from the channel or from a colleague.
 *
 * <p>{@code orderContext} is the operational state of the order this inquiry NAMES, read
 * deterministically from {@code channel_orders} at request time — no model, no planner, no
 * marketplace call. Its {@code present} flag is false for every inquiry whose source named no order,
 * which is the ordinary case; the screen renders nothing at all for those rather than an empty card.
 * It carries no order identifier, no amount, and no buyer field.
 *
 * <p>{@code answerStateProven} / {@code answerStateNote} say whether SellerOps can currently prove
 * this inquiry is still unanswered on the marketplace — see
 * {@link com.sellerops.inquiry.publish.PreSendCheck}. They are on the DETAIL, not only on the publish
 * result, because the point of knowing is to know BEFORE pressing send. {@code null} on a channel
 * with no send path at all, where the question does not arise.
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
        ReplyDraftView draft,
        UUID productId,
        String productName,
        String productBinding,
        String sourceSubtype,
        Boolean answerStateProven,
        String answerStateNote,
        List<DraftEvidenceView> draftEvidence,
        InquiryReplyCapabilityView replyCapability,
        OrderContextView orderContext) {
}
