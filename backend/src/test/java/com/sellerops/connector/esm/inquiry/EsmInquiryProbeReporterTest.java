package com.sellerops.connector.esm.inquiry;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.connector.esm.EsmHttpClient;
import com.sellerops.connector.esm.inquiry.EsmInquiryProbeReport.CountBucket;
import com.sellerops.connector.esm.inquiry.EsmInquiryProbeReport.ReceiveDateShape;
import com.sellerops.connector.esm.inquiry.EsmInquiryProbeReport.RetryAfterForm;
import com.sellerops.connector.esm.inquiry.EsmInquiryProbeReport.StatusClass;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * Tests the redaction boundary: a raw probe response goes in, only sanitized
 * signals come out. The success body is a top-level JSON array (no envelope). All
 * fixtures are synthetic (no live call, no real credential); PII/secret-bearing
 * fields are seeded with {@code secret-marker-*} sentinels so any leak is caught —
 * including the reply {@code token}. INQUIRY is official-doc confirmed but
 * live-response unverified.
 */
class EsmInquiryProbeReporterTest {

    private final EsmInquiryProbeReporter reporter = new EsmInquiryProbeReporter();

    private static EsmHttpClient.Response ok(String body) {
        return new EsmHttpClient.Response(200, body, Map.of());
    }

    /** A one-row array whose every content/secret-bearing field carries a unique sentinel. */
    private static final String ONE_ITEM = """
            [
              {
                "messageNo": "secret-marker-MSGNO",
                "qnaType": 1,
                "goodsNo": "secret-marker-GOODSNO",
                "title": "secret-marker-TITLE",
                "details": "secret-marker-DETAILS",
                "token": "secret-marker-TOKEN",
                "informStatus": "처리완료",
                "receiveDate": "2026-06-03T09:00:00+09:00",
                "reAsking": true
              }
            ]
            """;

    @Test
    void recordsOnlySanitizedSignalsForASuccessfulArray() {
        EsmInquiryProbeReport r = reporter.report(ok(ONE_ITEM));

        assertThat(r.statusCode()).isEqualTo(200);
        assertThat(r.statusClass()).isEqualTo(StatusClass.SUCCESS);
        assertThat(r.parseOk()).isTrue();
        assertThat(r.bodyIsJsonArray()).isTrue();
        assertThat(r.itemFields().messageNo()).isTrue();
        assertThat(r.itemFields().qnaType()).isTrue();
        assertThat(r.itemFields().goodsNo()).isTrue();
        assertThat(r.itemFields().details()).isTrue();
        assertThat(r.itemFields().title()).isTrue();
        assertThat(r.itemFields().token()).isTrue();
        assertThat(r.itemFields().reAsking()).isTrue();
        assertThat(r.itemCountBucket()).isEqualTo(CountBucket.ONE);
        assertThat(r.statusTokens()).containsExactly("처리완료");
        assertThat(r.receiveDateShape()).isEqualTo(ReceiveDateShape.OFFSET_BEARING);
        assertThat(r.retryAfterForm()).isEqualTo(RetryAfterForm.NONE);
    }

    @Test
    void redactsEveryContentAndSecretValueFromTheReport() {
        EsmInquiryProbeReport r = reporter.report(ok(ONE_ITEM));

        String rendered = r.toString();
        assertThat(rendered)
                .doesNotContain("secret-marker-MSGNO")
                .doesNotContain("secret-marker-GOODSNO")
                .doesNotContain("secret-marker-TITLE")
                .doesNotContain("secret-marker-DETAILS")
                .doesNotContain("secret-marker-TOKEN");
        // Only the allowed reply-status token is carried.
        assertThat(r.statusTokens()).containsExactly("처리완료");
    }

    @Test
    void timezonelessReceiveDateIsRecordedAsShapeOnlyNeverTheValue() {
        String body = """
                [{"informStatus":"미처리","receiveDate":"2026-06-03 09:00:00"}]
                """;

        EsmInquiryProbeReport r = reporter.report(ok(body));

        assertThat(r.receiveDateShape()).isEqualTo(ReceiveDateShape.TIMEZONE_LESS);
        assertThat(r.toString()).doesNotContain("2026-06-03");
    }

    @Test
    void emptyArrayBucketsToZeroWithNoStatusTokens() {
        EsmInquiryProbeReport r = reporter.report(ok("[]"));

        assertThat(r.bodyIsJsonArray()).isTrue();
        assertThat(r.itemCountBucket()).isEqualTo(CountBucket.ZERO);
        assertThat(r.statusTokens()).isEmpty();
        assertThat(r.receiveDateShape()).isEqualTo(ReceiveDateShape.NONE);
    }

    @Test
    void nonArrayJsonObjectIsParseableRowsButNotAnArray() {
        // A JSON object (e.g. a stray failure body sent with 200) is not the success
        // array shape: parse fails and bodyIsJsonArray is false — never inspected further.
        EsmInquiryProbeReport r = reporter.report(ok("{\"resultCode\":1,\"message\":\"x\"}"));

        assertThat(r.bodyIsJsonArray()).isFalse();
        assertThat(r.parseOk()).isFalse();
        assertThat(r.itemCountBucket()).isEqualTo(CountBucket.ZERO);
    }

    @Test
    void malformedBodyRecordsParseFailedWithoutLeakingBody() {
        EsmInquiryProbeReport r = reporter.report(ok("<<garbage secret-marker-9999>>"));

        assertThat(r.parseOk()).isFalse();
        assertThat(r.bodyIsJsonArray()).isFalse();
        assertThat(r.itemCountBucket()).isEqualTo(CountBucket.ZERO);
        assertThat(r.toString()).doesNotContain("secret-marker-9999");
    }

    @Test
    void nonSuccessStatusRecordsClassOnlyAndNeverInspectsBody() {
        EsmInquiryProbeReport r = reporter.report(
                new EsmHttpClient.Response(401, "{\"error\":\"secret-marker-9999\"}", Map.of()));

        assertThat(r.statusClass()).isEqualTo(StatusClass.UNAUTHORIZED);
        assertThat(r.parseOk()).isFalse();
        assertThat(r.bodyIsJsonArray()).isFalse();
        assertThat(r.itemCountBucket()).isEqualTo(CountBucket.ZERO);
        assertThat(r.toString()).doesNotContain("secret-marker-9999");
    }

    @Test
    void rateLimitedRecordsRetryAfterFormOnlyNotTheLiteralValue() {
        EsmInquiryProbeReport numeric = reporter.report(new EsmHttpClient.Response(
                429, "{\"trace\":\"secret-marker-9999\"}", Map.of("Retry-After", "30")));
        assertThat(numeric.statusClass()).isEqualTo(StatusClass.RATE_LIMITED);
        assertThat(numeric.retryAfterForm()).isEqualTo(RetryAfterForm.SECONDS);
        assertThat(numeric.parseOk()).isFalse();
        assertThat(numeric.toString()).doesNotContain("secret-marker-9999").doesNotContain("30");

        EsmInquiryProbeReport httpDate = reporter.report(new EsmHttpClient.Response(
                429, "[]", Map.of("Retry-After", "Wed, 21 Oct 2026 07:28:00 GMT")));
        assertThat(httpDate.retryAfterForm()).isEqualTo(RetryAfterForm.HTTP_DATE);

        EsmInquiryProbeReport none =
                reporter.report(new EsmHttpClient.Response(429, "[]", Map.of()));
        assertThat(none.retryAfterForm()).isEqualTo(RetryAfterForm.NONE);
    }
}
