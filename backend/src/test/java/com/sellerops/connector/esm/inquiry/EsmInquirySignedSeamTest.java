package com.sellerops.connector.esm.inquiry;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.connector.ConnectorCapabilities;
import com.sellerops.connector.DataType;
import com.sellerops.connector.esm.EsmApiConnector;
import com.sellerops.connector.esm.EsmJwtSigner;
import com.sellerops.ingest.canonical.CanonicalInquiry;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * Offline seam test for the ESM+/GMARKET INQUIRY read path: it exercises
 * <b>auth → request → parser → {@link CanonicalInquiry}</b> as one piece, with the
 * real {@link EsmJwtSigner} producing the {@code Authorization} header and the
 * {@link RecordingEsmHttpClient} fake standing in for the network. No live HTTP,
 * no real credentials, no production wiring — the signer and client both already
 * exist, so the seam is a wiring test only (no new production surface). INQUIRY
 * stays official-doc confirmed but live-response unverified and connector
 * capabilities are asserted unchanged.
 *
 * <p>All credentials below are obviously synthetic, non-secret placeholders.
 */
class EsmInquirySignedSeamTest {

    // Synthetic, non-secret credential material (never a real Master ID / key).
    private static final String MASTER_ID = "synthetic-master";
    private static final String SECRET_KEY = "synthetic-secret-key";
    private static final String ISSUER = "www.sellerops.example";
    private static final String AUCTION_SELLER_ID = "auction-syn";
    private static final String GMARKET_SELLER_ID = "gmarket-syn";
    private static final Instant FIXED_INSTANT = Instant.parse("2026-06-12T00:00:00Z");

    private static final String BASE_URL = "https://example.test";

    private final EsmJwtSigner signer = new EsmJwtSigner(Clock.fixed(FIXED_INSTANT, ZoneOffset.UTC));
    private final RecordingEsmHttpClient http = new RecordingEsmHttpClient();
    private final EsmInquiriesClient client = new EsmInquiriesClient(http, BASE_URL);

    private String synthesizedAuthorization() {
        String token = signer.token(MASTER_ID, SECRET_KEY, ISSUER, AUCTION_SELLER_ID, GMARKET_SELLER_ID);
        return "Bearer " + token;
    }

    private static String oneItemArray(String messageNo) {
        return """
                [
                  {
                    "messageNo": "%s",
                    "qnaType": 1,
                    "goodsNo": "SKU-1",
                    "details": "문의 내용",
                    "informStatus": "미처리",
                    "receiveDate": "2026-06-03T09:00:00+09:00",
                    "reAsking": false
                  }
                ]
                """.formatted(messageNo);
    }

    @Test
    void signedRequestAttachesAuthorizationCarriesFiltersAndParsesToCanonical() {
        http.enqueueOk(oneItemArray("INQ-1"));
        String authorization = synthesizedAuthorization();

        List<CanonicalInquiry> result = client.fetchRange(
                LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 7), 1, 2, 3, authorization);

        // auth → the signed JWT rides on the request as a well-formed Bearer token.
        RecordingEsmHttpClient.Sent sent = http.sent.get(0);
        assertThat(sent.headers()).containsEntry("Authorization", authorization);
        String bearerToken = authorization.substring("Bearer ".length());
        assertThat(bearerToken.split("\\.")).hasSize(3); // header.payload.signature
        assertThat(sent.uri().toString()).isEqualTo(BASE_URL + EsmInquiriesClient.INQUIRY_PATH);

        // request → date window and the numeric filters are in the body (no pagination).
        assertThat(sent.jsonBody())
                .contains("\"fromDate\":\"2026-06-01\"")
                .contains("\"toDate\":\"2026-06-07\"")
                .contains("\"qnaType\":1")
                .contains("\"status\":2")
                .contains("\"type\":3")
                .doesNotContain("page");

        // parser → CanonicalInquiry with the canonical (binary) status mapping.
        assertThat(result).hasSize(1);
        CanonicalInquiry inquiry = result.get(0);
        assertThat(inquiry.externalId()).isEqualTo("INQ-1");
        assertThat(inquiry.body()).isEqualTo("문의 내용");
        assertThat(inquiry.status()).isEqualTo("UNANSWERED");
    }

    @Test
    void omittedFiltersAreAbsentFromBodyButWindowStillPresent() {
        http.enqueueOk(oneItemArray("INQ-2"));

        client.fetchRange(LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 7), null, null, null,
                synthesizedAuthorization());

        String body = http.sent.get(0).jsonBody();
        assertThat(body).contains("\"fromDate\":\"2026-06-01\"").contains("\"toDate\":\"2026-06-07\"");
        assertThat(body).doesNotContain("qnaType").doesNotContain("\"status\"");
    }

    @Test
    void malformedResponseOnSignedPathThrowsWithoutLeakingBody() {
        http.enqueueOk("<<garbage secret-marker-9999>>");

        assertThatThrownBy(() -> client.fetchRange(
                        LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 7), null, null, null,
                        synthesizedAuthorization()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("문의 응답")
                .hasMessageNotContaining("secret-marker-9999");
    }

    @Test
    void connectorCapabilitiesRemainUnchangedAndDoNotExposeInquiry() {
        // capabilities() reads neither http nor vault — safe to probe directly.
        EsmApiConnector connector = new EsmApiConnector(new RecordingEsmHttpClient(), null);
        ConnectorCapabilities caps = connector.capabilities(EsmApiConnector.CHANNEL_CODE);

        assertThat(caps.supportedDataTypes()).isEmpty();
        assertThat(caps.supports(DataType.INQUIRY)).isFalse();
        assertThat(caps.verificationStatus()).isEmpty();
    }
}
