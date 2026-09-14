package com.sellerops.channel;

import java.util.List;

/**
 * Flag-aware, honest support facts for one channel — computed server-side so the
 * frontend renders truth instead of seed-derived over-claims. These are FACTS
 * (booleans + collectable-data-type lists); the operator-facing Korean wording is
 * the frontend's job.
 *
 * <p>Honesty rules baked into how {@link ChannelService} populates this:
 * <ul>
 *   <li>{@code autoCollectSupported} is true only when the channel resolves to a
 *       <b>dedicated</b> connector (a real, feature-flagged connector) that
 *       advertises a non-empty capability set — never the generic mock fallback,
 *       which over-advertises.</li>
 *   <li>{@code fileUploadSupported} is structural (every channel except the
 *       file-upload meta-channel) and says nothing about whether a given channel's
 *       export FORMAT is verified — the frontend keeps that wording conservative.</li>
 *   <li>Data-type lists carry only operator-collectable types (리뷰/문의/주문);
 *       SALES/PRODUCT are never emitted as collectable (no ingestion path).</li>
 *   <li>{@code screenReadReviews} is NOT about a connector at all — it says the channel's reviews are
 *       read off the seller's own open 판매자센터 screen. It is the same one condition
 *       {@code ChannelReviewAcquisitionService.readinessOf} opens with, asked of a channel rather than
 *       of an account, because a seller who has not connected anything yet has no account to ask about
 *       and still needs to be told this lane exists.</li>
 * </ul>
 */
public record ChannelSupport(
        boolean fileUploadSupported,
        List<String> fileUploadDataTypes,
        boolean autoCollectSupported,
        List<String> autoCollectDataTypes,
        boolean connectionCheckSupported,
        boolean credentialSetupSupported,
        boolean screenReadReviews) {
}
