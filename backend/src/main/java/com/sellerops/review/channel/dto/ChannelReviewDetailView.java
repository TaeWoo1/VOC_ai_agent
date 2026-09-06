package com.sellerops.review.channel.dto;

import com.sellerops.review.triage.ReviewTriageNote;
import java.time.LocalDate;
import java.util.UUID;

/**
 * One channel review, read in full — and the target that finds it again on the seller's own screen.
 *
 * <p>{@code body} is the redacted full text ({@code VocPreviewSanitizer.redactFullBody}): line structure
 * kept, nothing truncated, volatile PII-shaped spans tokenized. {@code bodyRedacted} says whether anything
 * was replaced, so the operator knows they are reading a redaction rather than wondering.
 *
 * <p><b>{@code locateTarget} is what the seller is shown about how the review is identified</b> — the
 * 노출상품ID and 옵션ID the 상세 panel prints, beside the date and rating it already shows.
 *
 * <p>It is deliberately NOT the target a locate run matches on. Coupang publishes no review id, so
 * `[쿠팡에서 보기]` re-finds the review by product, option, date, rating and the body's
 * {@code review-body-fingerprint/v1} — and that fingerprint reaches the Local Agent by resolving an opaque
 * {@code locateRef} against {@link com.sellerops.review.channel.ChannelReviewLocateService}, never through
 * the browser. It used to ride here as well; nothing in the frontend read it, and a fingerprint of a
 * buyer's review sitting in a page nobody uses it in is a copy that exists for no reason.
 *
 * <p><b>{@code replyWork} is the one place this record touches the reply flow</b> (product assembly A6). It is
 * the server-minted address of the review's reply work plus the two facts the panel mounts on — the operator's
 * current decision and whether a draft or approval already exists — and it is {@code null} for every channel
 * whose capability says {@code replySupported = false}. Coupang gives sellers no way to answer a 상품평 and
 * Cafe24 has no reply flow built, so on those channels there is still no reply field, no draft, and no submit
 * affordance: the surface renders no control the server would refuse. There is never a body here — the draft's
 * text and the approval's state come from the reply read, addressed by {@code actionRef}.
 */
public record ChannelReviewDetailView(
        UUID id,
        LocalDate writtenOn,
        Integer rating,
        boolean negative,
        String body,
        boolean bodyRedacted,
        String productName,
        int mediaCount,
        /** The buyer rated and wrote nothing — see {@code ChannelReviewItemView.textless}. */
        boolean textless,
        boolean isNew,
        /** The same suggestion the list row carries, so opening a review cannot change what it said. */
        ReviewTriageNote triage,
        /** The same pilot mark the list row carried, or null — see {@link ChannelReviewItemView#aiMark()}. */
        AiTriageMarkView aiMark,
        LocateTarget locateTarget,
        /** The reply work this review can carry, or null when the channel has no reply flow (capability §1). */
        ReplyWork replyWork,
        /** {@code MARKETPLACE} | {@code NONE} — see {@code RecentReviewItemView.executableIdentity}. */
        String executableIdentity) {

    /** The address (client-opaque, round-tripped to the reply endpoints) and state of one review's reply work. */
    public record ReplyWork(
            String actionRef,
            /** The operator's current decision ({@code TriageDisposition} name), or null when none was recorded. */
            String triageDisposition,
            /** A draft or an approval already exists — the panel must stay reachable whatever the decision. */
            boolean hasReplyPreparation,
            /**
             * What the CHANNEL last said about a reply already posted ({@code ReviewReplyState}:
             * {@code PENDING} | {@code ANSWERED} | {@code UNKNOWN}).
             *
             * <p>Carried here, on the read that opens the screen, because the panel that already knew
             * it ({@code ReviewReplyPrepView.channelReplyState}) does not mount until the operator has
             * already made the response decision. Measured in pilot QA on 2026-09-06: a review the
             * channel reports as answered opened on 「판단 전」 and three triage buttons and said nothing
             * — the operator decided whether to answer without being told an answer already exists.
             *
             * <p>It is the channel's statement and NOTHING else. It is not the operator's decision, it
             * does not stand in for one, and no surface may read it as triage having been done: a
             * review answered on the channel may still be one this operator has not looked at.
             */
            String channelReplyState) {
    }

    /** The channel-side identifiers this review carries — nothing that names a person. */
    public record LocateTarget(
            String productId,
            String vendorItemId,
            LocalDate writtenOn,
            Integer rating) {
    }
}
