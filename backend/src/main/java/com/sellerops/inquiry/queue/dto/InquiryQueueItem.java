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
        Instant receivedAt,
        /** Which resource of the channel produced the row ({@code InquirySourceSubtype} name), or null. */
        String sourceSubtype,
        /** {@code MARKETPLACE} | {@code NONE} — see {@code InquiryDetail.executableIdentity}. */
        String executableIdentity) {
}
