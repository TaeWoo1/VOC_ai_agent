package com.sellerops.channel;

import java.util.List;
import java.util.Set;

/**
 * The channels the product shows to a seller.
 *
 * <p>Product-owner decision (2026-08-17, product assembly): channel expansion is paused and the
 * user-visible channel set is exactly NAVER / Coupang / Cafe24 — "a channel on screen is a channel
 * that is actually usable." Every other catalog row (ESM/Gmarket, 11번가, SSG, 오늘의집, 카카오,
 * 자사몰/기타, the FILE_UPLOAD meta-channel, …) stays in the catalog table and in the connector
 * layer, but is not returned to product surfaces. Adding a channel here is a product decision made
 * after a connector/capability proof, not a side effect of a connector landing.
 *
 * <p>Canonical: {@code docs/product_assembly_ia_v1.md} §2. This is the one place the set is
 * declared on the backend; the frontend mirrors it in {@code lib/productChannels.ts} for its
 * demo-mode catalog only, and otherwise trusts what this returns.
 */
public final class ProductChannels {

    /** Ordered as the product lists them. */
    public static final List<String> VISIBLE_CODES = List.of("NAVER", "COUPANG", "CAFE24");

    private static final Set<String> VISIBLE = Set.copyOf(VISIBLE_CODES);

    private ProductChannels() {
    }

    /** Whether the product shows this channel to a seller. Null / unknown codes are never visible. */
    public static boolean isVisible(String channelCode) {
        return channelCode != null && VISIBLE.contains(channelCode);
    }
}
