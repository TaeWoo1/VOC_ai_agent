package com.sellerops.review.channel;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

/**
 * The expected-store digest a deterministic acquisition run compares the screen against
 * ({@code docs/review_acquisition_aside_v2.md} §6, PD-4).
 *
 * <p>A Coupang seller's channel-native identity is their <b>업체코드</b> — the {@code vendor_id} this product
 * already seals with their API credentials, and the same code WING prints in its own shell chrome. So the
 * expectation is not a new fact to collect: it is one this org already gave us, and the run's only question
 * is whether the authenticated browser is showing it.
 *
 * <p><b>The digest is a comparison device, not a privacy device — and this says so.</b> A vendor code is one
 * letter and eight digits; SHA-256 over a space that small is enumerable, exactly as
 * {@code connection/seller-account-fingerprint.ts} warns. It is used because it lets the raw credential value
 * stay inside the vault boundary while still making the comparison possible on the seller's own machine, and
 * because a digest cannot be mistaken for a credential by a later reader. It is not claimed to conceal the
 * code from whoever holds the digest.
 *
 * <p>Domain-separated so a value here can never collide with, or be mistaken for, a digest from another
 * contract. The string is byte-identical to the collector's {@code wing-store-identity.ts}; the two are the
 * two halves of one comparison and a test on each side pins the same vector.
 */
public final class WingStoreIdentity {

    static final String DOMAIN = "coupang-wing-store-identity/v1\n";

    private WingStoreIdentity() {
    }

    /**
     * Lowercase-hex SHA-256 of a vendor code, or {@code null} for a blank/absent one — never a digest of
     * nothing, which would be an expectation every screen fails identically and for the wrong reason.
     */
    public static String fingerprint(String vendorCode) {
        String value = vendorCode == null ? "" : vendorCode.strip();
        if (value.isEmpty()) {
            return null;
        }
        try {
            MessageDigest sha = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(sha.digest((DOMAIN + value).getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }
}
