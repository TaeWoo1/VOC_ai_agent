package com.sellerops.review.channel;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The digest is half of a comparison whose other half is in TypeScript
 * ({@code collector/src/action-window/coupang-review/wing-store-identity.ts}), and the two halves never run in
 * the same process. Nothing but a pinned vector can notice them drifting apart — a changed domain string on
 * one side would simply make every real store read as {@code MISMATCH}, which looks exactly like a seller
 * signed into the wrong account.
 */
class WingStoreIdentityTest {

    /** Also pinned by `coupang-wing-identity.test.ts`. Change this and you have changed the contract. */
    private static final String VECTOR = "869a00c798a22cf32b6997a87256a365dd3455c94efd1210789857268ef2cb00";

    @Test
    @DisplayName("the digest matches the collector's, byte for byte")
    void pinnedVector() {
        assertThat(WingStoreIdentity.fingerprint("A00123456")).isEqualTo(VECTOR);
    }

    @Test
    @DisplayName("surrounding whitespace is not identity")
    void stripped() {
        assertThat(WingStoreIdentity.fingerprint("  A00123456  ")).isEqualTo(VECTOR);
    }

    @Test
    @DisplayName("no vendor code yields no expectation — never a digest of nothing")
    void absent() {
        assertThat(WingStoreIdentity.fingerprint(null)).isNull();
        assertThat(WingStoreIdentity.fingerprint("   ")).isNull();
    }

    @Test
    @DisplayName("the domain separates it: this is not a bare SHA-256 of the code")
    void domainSeparated() {
        assertThat(WingStoreIdentity.fingerprint("A00123456"))
                .isNotEqualTo("1c8b0a1b8b1e3f9a9f6b3b4b9a0e2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d");
        assertThat(WingStoreIdentity.DOMAIN).isEqualTo("coupang-wing-store-identity/v1\n");
    }
}
