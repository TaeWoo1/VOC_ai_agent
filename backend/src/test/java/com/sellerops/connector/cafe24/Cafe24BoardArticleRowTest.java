package com.sellerops.connector.cafe24;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/**
 * The fail-closed {@code secret}(비밀글) policy on {@link Cafe24BoardArticleRow}: the
 * review path stores a post only when {@link Cafe24BoardArticleRow#isPublicPost()}
 * positively reads public. A private ({@code "T"}) or unknown/missing value must read
 * not-public so a possibly-private post is never stored.
 */
class Cafe24BoardArticleRowTest {

    private static Cafe24BoardArticleRow withSecret(String secret) {
        return new Cafe24BoardArticleRow(1L, "t", "c", null, null, null, null, "N", secret);
    }

    @Test
    void publicTokenReadsPublic() {
        assertThat(withSecret("F").isPublicPost()).isTrue();
        assertThat(withSecret("f").isPublicPost()).isTrue();
        assertThat(withSecret("  F  ").isPublicPost()).isTrue();
        // Boolean coercion of a false flag is still positively public.
        assertThat(withSecret("false").isPublicPost()).isTrue();
        assertThat(withSecret("FALSE").isPublicPost()).isTrue();
    }

    @Test
    void secretTokenReadsNotPublic() {
        assertThat(withSecret("T").isPublicPost()).isFalse();
        assertThat(withSecret("t").isPublicPost()).isFalse();
        assertThat(withSecret("true").isPublicPost()).isFalse();
        assertThat(withSecret("TRUE").isPublicPost()).isFalse();
    }

    @Test
    void unknownOrMissingReadsNotPublicFailClosed() {
        assertThat(withSecret(null).isPublicPost()).isFalse();
        assertThat(withSecret("").isPublicPost()).isFalse();
        assertThat(withSecret("   ").isPublicPost()).isFalse();
        assertThat(withSecret("X").isPublicPost()).isFalse();
        assertThat(withSecret("Y").isPublicPost()).isFalse();
        assertThat(withSecret("1").isPublicPost()).isFalse();
        assertThat(withSecret("public").isPublicPost()).isFalse();
    }

    @Test
    void backCompatConstructorDefaultsToNotPublic() {
        // The 8-arg (no-secret) constructor leaves secret null → fail-closed not-public.
        Cafe24BoardArticleRow row = new Cafe24BoardArticleRow(1L, "t", "c", null, null, null, null, "N");
        assertThat(row.secret()).isNull();
        assertThat(row.isPublicPost()).isFalse();
    }
}
