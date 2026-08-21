package com.sellerops.common;

/**
 * Where a row came from — real seller data, or something the product manufactured about itself.
 *
 * <p>The canonical demo org accumulated all three kinds in one table and had no way to tell them
 * apart, which made its own numbers unusable: on 2026-08-22 the 홈 screen's "미답변 9" was 8 synthetic
 * rows and one real one, and "부정 리뷰 25" was 11 seeded strings about a product nobody sold. Both
 * numbers were arithmetically correct and told the seller nothing true.
 *
 * <p>Deleting the residue was the tempting fix and the wrong one. A demo org is also a test corpus,
 * and the fixtures that proved Coupang's inquiry ingestion are evidence — they should stop being
 * counted, not stop existing. So this is a projection axis, exactly like
 * {@code InquiryOperationalState}: every row stays, and the operational surfaces read one corpus.
 */
public enum DataOrigin {

    /** Acquired from the seller's actual channel — API, export, Action Window, or manual import. */
    REAL,

    /** Manufactured by {@code MockDataSeeder} so a fresh checkout has something on screen. */
    DEMO_SEED,

    /**
     * Written by a live-verification run to prove a code path end to end. Real in shape and
     * synthetic in origin — the Coupang {@code VERIFY-11618-*} inquiries are the type case.
     */
    VERIFY_FIXTURE;

    /** Everything that is not the seller's own data — what the default operational read excludes. */
    public boolean synthetic() {
        return this != REAL;
    }
}
