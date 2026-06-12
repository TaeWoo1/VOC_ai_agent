package com.sellerops.connector.esm;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Base64;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.Test;

/**
 * Phase 3D-4: the ESM Sell-API JWT against the officially documented shape
 * (etapi.gmarket.com API 가이드, verified 2026-06-12) — HS256 header with the
 * Master-ID {@code kid}, the fixed {@code sub}/{@code aud} claims, the
 * site-prefixed {@code ssi} claim, base64url-without-padding segments, and an
 * independently recomputed signature. All offline.
 */
class EsmJwtSignerTest {

    private static final String MASTER_ID = "test-master-id";
    private static final String SECRET_KEY = "test-esm-secret-key";
    private static final String ISSUER = "www.sellerops.example";
    private static final Instant FIXED_INSTANT = Instant.parse("2026-06-12T00:00:00Z");

    private final EsmJwtSigner signer =
            new EsmJwtSigner(Clock.fixed(FIXED_INSTANT, ZoneOffset.UTC));
    private final ObjectMapper mapper = new ObjectMapper();

    private static String decodeSegment(String segment) {
        return new String(Base64.getUrlDecoder().decode(segment), StandardCharsets.UTF_8);
    }

    @Test
    void tokenHasTheOfficialHeaderShape() throws Exception {
        String token = signer.token(MASTER_ID, SECRET_KEY, ISSUER, "auction-1", "gmarket-1");

        String[] segments = token.split("\\.");
        assertThat(segments).hasSize(3);
        // Byte-literal assertion: the HMAC signs these exact bytes, so field
        // ORDER matters — JSON-object equality alone would miss a reordering.
        assertThat(decodeSegment(segments[0])).isEqualTo(
                "{\"alg\":\"HS256\",\"typ\":\"JWT\",\"kid\":\"" + MASTER_ID + "\"}");
        JsonNode header = mapper.readTree(decodeSegment(segments[0]));
        assertThat(header.size()).isEqualTo(3); // nothing beyond the official fields
    }

    @Test
    void tokenHasTheOfficialPayloadClaims() throws Exception {
        String token = signer.token(MASTER_ID, SECRET_KEY, ISSUER, "auction-1", "gmarket-1");

        // Byte-literal assertion locks claim order and the iat epoch-seconds
        // value (officially optional claim, RFC 7519 NumericDate).
        assertThat(decodeSegment(token.split("\\.")[1])).isEqualTo(
                "{\"iss\":\"" + ISSUER + "\",\"sub\":\"sell\",\"aud\":\"sa.esmplus.com\","
                        + "\"iat\":" + FIXED_INSTANT.getEpochSecond() + ","
                        + "\"ssi\":\"A:auction-1,G:gmarket-1\"}");
        JsonNode payload = mapper.readTree(decodeSegment(token.split("\\.")[1]));
        assertThat(payload.size()).isEqualTo(5); // nothing beyond the official claims
    }

    @Test
    void blankSignerInputsFailClosedBeforeSigning() {
        for (String[] inputs : new String[][] {
                {null, SECRET_KEY, ISSUER},
                {"", SECRET_KEY, ISSUER},
                {MASTER_ID, null, ISSUER},
                {MASTER_ID, " ", ISSUER},
                {MASTER_ID, SECRET_KEY, null},
                {MASTER_ID, SECRET_KEY, ""}}) {
            assertThatThrownBy(() -> signer.token(inputs[0], inputs[1], inputs[2], null, "gmarket-1"))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining("비어 있습니다");
        }
    }

    @Test
    void ssiIncludesOnlyThePresentSites() {
        assertThat(EsmJwtSigner.ssiClaim(null, "gmarket-1")).isEqualTo("G:gmarket-1");
        assertThat(EsmJwtSigner.ssiClaim("auction-1", null)).isEqualTo("A:auction-1");
        assertThat(EsmJwtSigner.ssiClaim("auction-1", "gmarket-1"))
                .isEqualTo("A:auction-1,G:gmarket-1");
        assertThat(EsmJwtSigner.ssiClaim("", "gmarket-1")).isEqualTo("G:gmarket-1");
    }

    @Test
    void missingBothSellerIdsFailsBeforeSigning() {
        assertThatThrownBy(() -> signer.token(MASTER_ID, SECRET_KEY, ISSUER, null, null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("판매자 ID");
        assertThatThrownBy(() -> EsmJwtSigner.ssiClaim("", " "))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void signatureIsHs256OverTheOfficialSigningInput() throws Exception {
        String token = signer.token(MASTER_ID, SECRET_KEY, ISSUER, "auction-1", "gmarket-1");
        String[] segments = token.split("\\.");

        // Independent recomputation: HS256(header.payload, secret), base64url
        // without padding — Mac used directly, not through the signer.
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(SECRET_KEY.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        String expected = Base64.getUrlEncoder().withoutPadding().encodeToString(
                mac.doFinal((segments[0] + "." + segments[1]).getBytes(StandardCharsets.UTF_8)));

        assertThat(segments[2]).isEqualTo(expected);
    }

    @Test
    void tokenIsDeterministicForFixedClockAndInputs() {
        String first = signer.token(MASTER_ID, SECRET_KEY, ISSUER, "auction-1", "gmarket-1");
        String second = signer.token(MASTER_ID, SECRET_KEY, ISSUER, "auction-1", "gmarket-1");
        assertThat(first).isEqualTo(second);
    }

    @Test
    void segmentsAreBase64UrlWithoutPadding() {
        String token = signer.token(MASTER_ID, SECRET_KEY, ISSUER, "auction-1", "gmarket-1");
        assertThat(token).matches("[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+");
    }

    @Test
    void signerFailuresNeverEchoSecretMaterial() {
        // The blank guard fires before the JCE ever sees the key; either
        // failure path emits a fixed Korean message with no input echo.
        assertThatThrownBy(() -> signer.token(MASTER_ID, "", ISSUER, null, "gmarket-1"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("ESM 전자서명 입력값(master_id, secret_key, issuer)이 비어 있습니다.")
                .hasMessageNotContaining(MASTER_ID)
                .hasMessageNotContaining(ISSUER);
    }
}
