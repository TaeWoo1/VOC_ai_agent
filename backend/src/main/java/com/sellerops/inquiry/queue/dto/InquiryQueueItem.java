package com.sellerops.inquiry.queue.dto;

import java.time.Instant;
import java.util.UUID;

/**
 * One sanitized row of the seller inquiry work queue. It carries the work-item and
 * connection identity ({@code sellerAccountId} — the exact seller connection), the
 * lifecycle {@code phase}, the canonical {@code status}, the seller-visible {@code
 * title}, and the receipt time. It deliberately carries <b>no</b> buyer identity
 * (no {@code author}) and <b>no</b> raw inquiry body — the list stays sanitized;
 * full details belong to a later detail endpoint.
 *
 * <p>{@code channelCode}/{@code channelNameKo} and {@code productName} are here because a queue row
 * without them is unworkable: an operator triaging 69 inquiries needs to know which shop and which
 * product each is about before opening it. {@code productName} is null when the inquiry is genuinely
 * unattributed — which on a Cafe24 board article is the ordinary case — and a null must render as
 * "상품 미지정" rather than as a blank that reads like a loading state.
 */
public record InquiryQueueItem(
        UUID workItemId,
        UUID inquiryId,
        UUID sellerAccountId,
        UUID channelId,
        String channelCode,
        String channelNameKo,
        UUID productId,
        String productName,
        String phase,
        String status,
        String title,
        /**
         * The SAME bounded, PII-masked opening of the customer's message the 문의 feed shows
         * ({@code InboxService.snippet}) — not the raw body. A queue row the operator cannot read is a
         * row they must open to triage; this is the one line that makes the list itself workable.
         */
        String snippet,
        Instant receivedAt,
        /**
         * Whether a reply draft has actually been written for this work item.
         *
         * <p><b>Not derivable from {@code phase}.</b> {@code PROPOSED} is written when a proposal is
         * recorded, and a proposal stores no reply text at all ({@code InquiryProposal}); a client that
         * read the phase and said 「초안 준비됨」 was telling the seller a sentence exists that nobody
         * wrote. This field is the fact, read from {@code inquiry_reply_draft} in one query per page.
         */
        boolean hasDraft,
        /** Which resource of the channel produced the row ({@code InquirySourceSubtype} name), or null. */
        String sourceSubtype,
        /** {@code MARKETPLACE} | {@code NONE} — see {@code InquiryDetail.executableIdentity}. */
        String executableIdentity) {
}
