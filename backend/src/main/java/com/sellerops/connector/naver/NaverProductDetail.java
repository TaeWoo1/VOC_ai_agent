package com.sellerops.connector.naver;

import java.util.List;

/**
 * One NAVER listing's detail, reduced to the three things the LIST resource never sent.
 *
 * <p>{@code detailContent} is the seller's own 상세페이지 markup — their writing, delivered through
 * the channel's API. {@code optionNames} are the 규격 that make
 * {@code SpecApplicability.VARIANT_NAMED} reachable on NAVER at all; today it is unreachable, because
 * all 405 stored variants come from Coupang. {@code imageUrls} are recorded so that a page which
 * turns out to carry its answers in pictures can be DESCRIBED honestly without anything yet being
 * built to read them.
 *
 * <p>No price, status, stock, delivery, certification or customer-benefit field is projected. The
 * catalogue sweep already owns those and a second writer for the same values is how two sources of
 * truth start.
 */
public record NaverProductDetail(String name, String detailContent, List<Option> options,
                                 List<String> imageUrls) {

    /**
     * One 규격, with the identity that makes it upsertable.
     *
     * <p>{@code externalId} may be null — the reference elides the option sub-structure, so its
     * presence is doc-inferred rather than contracted. A null one is SKIPPED downstream, never
     * given a synthetic id: a variant that gets a new identity on every read is worse than a
     * variant that is missing, because the second is visible and the first is silent duplication.
     */
    public record Option(String externalId, String optionName) {
    }
}
