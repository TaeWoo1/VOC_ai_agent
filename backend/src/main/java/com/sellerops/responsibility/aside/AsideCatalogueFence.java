package com.sellerops.responsibility.aside;

import com.sellerops.product.ChannelProductRepository;
import com.sellerops.responsibility.IdentityVerdict;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.UUID;

/**
 * <b>Whose store a marketplace page was, judged by the one identifier both sides hold: the channel's listing id.</b>
 *
 * <p>NAVER publishes no store identifier this backend stores, so a scheduled Seller Center read cannot be fenced on a
 * store id. What it CAN be fenced on is 채널상품번호: unique per channel across every organisation, and this
 * organisation's listings were collected by the official API with its own credential. Every product number on the
 * page is ours ⇒ {@code MATCH}. Any number that belongs to another organisation ⇒ {@code MISMATCH}. Any number nobody
 * holds (a listing newer than the last catalogue read), or a page with no product numbers at all ⇒ {@code UNRESOLVED}
 * — a catalogue lag, or an empty page, is not proof of a store.
 *
 * <p>One rule, used by both NAVER Seller Center recipes (리뷰 and 상품 문의), so the two cannot come to disagree about
 * what «this store» means.
 */
public final class AsideCatalogueFence {

    private AsideCatalogueFence() {
    }

    public static IdentityVerdict verdict(ChannelProductRepository listings, UUID orgId, UUID channelId,
                                          Collection<String> pageProductNos) {
        Set<String> productNos = new LinkedHashSet<>(pageProductNos);
        if (productNos.isEmpty()) {
            return IdentityVerdict.UNRESOLVED;
        }
        long owned = listings.countOwnedListings(orgId, channelId, productNos);
        if (owned == productNos.size()) {
            return IdentityVerdict.MATCH;
        }
        for (String productNo : productNos) {
            boolean elsewhere = listings.findByChannelIdAndExternalProductId(channelId, productNo)
                    .map(listing -> !orgId.equals(listing.getOrgId()))
                    .orElse(false);
            if (elsewhere) {
                return IdentityVerdict.MISMATCH;
            }
        }
        return IdentityVerdict.UNRESOLVED;
    }
}
