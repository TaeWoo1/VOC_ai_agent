package com.sellerops.connector.coupang;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.Test;

/**
 * Phase 3D-2: the CEA signature against the officially documented recipe
 * (developers.coupangcorp.com "Creating HMAC Signature", verified 2026-06-12)
 * — message concatenation, GMT signed-date format, lowercase-hex HMAC-SHA256,
 * and the exact Authorization header form. All offline; the expected values
 * are recomputed independently inside the test, not copied from the
 * implementation.
 */
class CoupangSignerTest {

    private static final String ACCESS_KEY = "test-access-key";
    private static final String SECRET_KEY = "test-secret-key";
    // The signed-date example string the official article itself uses.
    private static final Instant OFFICIAL_EXAMPLE_INSTANT = Instant.parse("2019-08-05T04:40:45Z");
    private static final String OFFICIAL_EXAMPLE_SIGNED_DATE = "190805T044045Z";

    private static final String METHOD = "GET";
    private static final String PATH = "/v2/providers/openapi/apis/api/v5/vendors/A00012345/ordersheets";
    private static final String QUERY = "createdAtFrom=2026-06-11&createdAtTo=2026-06-12&status=ACCEPT";

    /** Independent recomputation — Mac used directly, not through the signer. */
    private static String expectedHex(String secretKey, String message) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secretKey.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        return HexFormat.of().formatHex(mac.doFinal(message.getBytes(StandardCharsets.UTF_8)));
    }

    @Test
    void signedDateUsesTheOfficialGmtFormat() {
        CoupangSigner signer = new CoupangSigner(
                Clock.fixed(OFFICIAL_EXAMPLE_INSTANT, ZoneOffset.UTC));
        assertThat(signer.signedDate()).isEqualTo(OFFICIAL_EXAMPLE_SIGNED_DATE);
    }

    @Test
    void signedDateIsGmtRegardlessOfClockZone() {
        // A KST-zoned clock must not shift the signed-date — the format is GMT.
        CoupangSigner signer = new CoupangSigner(
                Clock.fixed(OFFICIAL_EXAMPLE_INSTANT, java.time.ZoneId.of("Asia/Seoul")));
        assertThat(signer.signedDate()).isEqualTo(OFFICIAL_EXAMPLE_SIGNED_DATE);
    }

    @Test
    void signatureIsHmacSha256OverTheOfficialMessageConcatenation() throws Exception {
        // Official message: signedDate + method + path + query, no separators,
        // no '?'. Recomputed independently here.
        String expected = expectedHex(SECRET_KEY,
                OFFICIAL_EXAMPLE_SIGNED_DATE + METHOD + PATH + QUERY);

        String actual = CoupangSigner.signature(
                SECRET_KEY, OFFICIAL_EXAMPLE_SIGNED_DATE, METHOD, PATH, QUERY);

        assertThat(actual).isEqualTo(expected);
    }

    @Test
    void signatureIsLowercaseHex() {
        String signature = CoupangSigner.signature(
                SECRET_KEY, OFFICIAL_EXAMPLE_SIGNED_DATE, METHOD, PATH, QUERY);
        // 32 HMAC-SHA256 bytes → 64 lowercase hex chars (official hexdigest()).
        assertThat(signature).matches("[0-9a-f]{64}");
    }

    @Test
    void signatureIsDeterministicForFixedInputs() {
        String first = CoupangSigner.signature(
                SECRET_KEY, OFFICIAL_EXAMPLE_SIGNED_DATE, METHOD, PATH, QUERY);
        String second = CoupangSigner.signature(
                SECRET_KEY, OFFICIAL_EXAMPLE_SIGNED_DATE, METHOD, PATH, QUERY);
        assertThat(first).isEqualTo(second);
    }

    @Test
    void nullQuerySignsThePathOnlyMessage() throws Exception {
        String expected = expectedHex(SECRET_KEY, OFFICIAL_EXAMPLE_SIGNED_DATE + METHOD + PATH);
        assertThat(CoupangSigner.signature(SECRET_KEY, OFFICIAL_EXAMPLE_SIGNED_DATE, METHOD, PATH, null))
                .isEqualTo(expected);
        // Empty query is the same message as null — '?' never enters the message.
        assertThat(CoupangSigner.signature(SECRET_KEY, OFFICIAL_EXAMPLE_SIGNED_DATE, METHOD, PATH, ""))
                .isEqualTo(expected);
    }

    @Test
    void authorizationHeaderHasTheExactOfficialForm() throws Exception {
        String expectedSignature = expectedHex(SECRET_KEY,
                OFFICIAL_EXAMPLE_SIGNED_DATE + METHOD + PATH + QUERY);

        String header = CoupangSigner.authorization(
                ACCESS_KEY, SECRET_KEY, OFFICIAL_EXAMPLE_SIGNED_DATE, METHOD, PATH, QUERY);

        assertThat(header).isEqualTo(
                "CEA algorithm=HmacSHA256, access-key=" + ACCESS_KEY
                        + ", signed-date=" + OFFICIAL_EXAMPLE_SIGNED_DATE
                        + ", signature=" + expectedSignature);
    }

    @Test
    void clockStampedAuthorizationMatchesTheExplicitSignedDateForm() {
        CoupangSigner signer = new CoupangSigner(
                Clock.fixed(OFFICIAL_EXAMPLE_INSTANT, ZoneOffset.UTC));

        String stamped = signer.authorization(ACCESS_KEY, SECRET_KEY, METHOD, PATH, QUERY);
        String explicit = CoupangSigner.authorization(
                ACCESS_KEY, SECRET_KEY, OFFICIAL_EXAMPLE_SIGNED_DATE, METHOD, PATH, QUERY);

        assertThat(stamped).isEqualTo(explicit);
    }

    @Test
    void unusableSecretKeyFailsWithoutEchoingSecretMaterial() {
        // An empty key is rejected by the JCE; the replacement message must not
        // contain the key or any JCE detail that could carry it.
        assertThatThrownBy(() -> CoupangSigner.signature(
                "", OFFICIAL_EXAMPLE_SIGNED_DATE, METHOD, PATH, QUERY))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("쿠팡 secret_key로 전자서명을 생성할 수 없습니다.");
    }
}
