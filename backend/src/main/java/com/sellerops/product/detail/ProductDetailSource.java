package com.sellerops.product.detail;

import com.sellerops.connector.naver.NaverProductDetail;
import java.util.UUID;

/**
 * One channel's ability to read a SINGLE listing's 상세페이지.
 *
 * <p><b>Deliberately not a collector.</b> The method takes one external product id and returns one
 * listing; there is no page, no cursor and no "read the catalogue" shape to reach for. That is the
 * property {@code ProductDetailEnrichment} exists to protect, expressed as a type.
 *
 * <p><b>Why the return type names NAVER.</b> Exactly one channel publishes a 상세페이지 through an
 * official API today, so a neutral projection would be a second vocabulary invented for one
 * implementation — and {@code ProductDetailEnrichment.apply} already speaks
 * {@link NaverProductDetail}. When a second channel arrives, the projection is the change to make;
 * inventing it before there is anything to project would be guessing at the other channel's shape.
 */
public interface ProductDetailSource {

    /** {@code NAVER}. Matched against {@code channels.code}, never against a display name. */
    String channelCode();

    /** {@code NAVER:PRODUCT_API:v1} — the provenance stamped on anything this read produces. */
    String sourceKind();

    /**
     * The provenance of the FACTS a detail read states (notice fields, attributes, 추가상품, the page's shape) —
     * distinct from {@link #sourceKind()} so the detail read can own its facts as a set: what a re-read no longer
     * states is removed, and the catalogue sweep's facts are never touched.
     */
    default String detailSourceKind() {
        return sourceKind() + "/detail";
    }

    /**
     * Read one listing.
     *
     * @return the detail, or {@code null} when the channel does not have this listing — absence is a
     *     result and is never turned into a deletion
     * @throws RuntimeException on any transport, auth or permission failure; the caller catches and
     *     reports, so that a failed enrichment cannot fail the seller's actual request
     */
    NaverProductDetail read(UUID orgId, UUID sellerAccountId, String externalProductId);
}
