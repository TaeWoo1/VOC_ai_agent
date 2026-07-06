package com.sellerops.inquiry.esmimport;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.common.ApiException;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** Signing + expiry contract for the preview token; every tamper path fails closed. */
class PreviewTokenServiceTest {

    private final PreviewTokenService service =
            new PreviewTokenService("unit-test-secret-please-be-long-enough-abcdef");
    private final Instant issued = Instant.parse("2026-07-06T00:00:00Z");

    private PreviewToken claims() {
        return new PreviewToken(
                UUID.fromString("11111111-1111-1111-1111-111111111111"),
                UUID.fromString("22222222-2222-2222-2222-222222222222"),
                EsmMarketplace.GMARKET, "filehash", "headersig", 3, "canonhash", "statehash",
                issued.toEpochMilli(), issued.plusSeconds(1800).toEpochMilli());
    }

    @Test
    void failsClosedOnBlankOrShortSecret() {
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> new PreviewTokenService(""))
                .isInstanceOf(IllegalStateException.class);
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> new PreviewTokenService("   "))
                .isInstanceOf(IllegalStateException.class);
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> new PreviewTokenService("short"))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void roundTripsWithinExpiry() {
        String token = service.issue(claims());
        PreviewToken back = service.verify(token, issued.plusSeconds(60));
        assertThat(back).isEqualTo(claims());
    }

    @Test
    void rejectsExpiredToken() {
        String token = service.issue(claims());
        assertThatThrownBy(() -> service.verify(token, issued.plusSeconds(1801)))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void rejectsAlteredPayload() {
        String token = service.issue(claims());
        // Flip a character in the payload segment.
        String payload = token.substring(0, token.indexOf('.'));
        String sig = token.substring(token.indexOf('.'));
        char[] p = payload.toCharArray();
        p[0] = p[0] == 'A' ? 'B' : 'A';
        assertThatThrownBy(() -> service.verify(new String(p) + sig, issued.plusSeconds(60)))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void rejectsAlteredSignature() {
        String token = service.issue(claims());
        String tampered = token.substring(0, token.length() - 1)
                + (token.charAt(token.length() - 1) == 'A' ? 'B' : 'A');
        assertThatThrownBy(() -> service.verify(tampered, issued.plusSeconds(60)))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void rejectsUnsignedOrMalformedToken() {
        // No signature segment at all — a plain payload is never accepted.
        String payloadOnly = service.issue(claims());
        String noSig = payloadOnly.substring(0, payloadOnly.indexOf('.'));
        assertThatThrownBy(() -> service.verify(noSig, issued))
                .isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> service.verify("garbage", issued)).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> service.verify("", issued)).isInstanceOf(ApiException.class);
    }

    @Test
    void rejectsTokenSignedWithADifferentSecret() {
        String foreign = new PreviewTokenService("a-totally-different-secret-value").issue(claims());
        assertThatThrownBy(() -> service.verify(foreign, issued.plusSeconds(60)))
                .isInstanceOf(ApiException.class);
    }
}
