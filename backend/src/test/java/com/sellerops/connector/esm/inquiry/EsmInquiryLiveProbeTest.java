package com.sellerops.connector.esm.inquiry;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.connector.esm.EsmJwtSigner;
import com.sellerops.connector.esm.inquiry.EsmInquiryProbeReport.StatusClass;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.function.BooleanSupplier;
import org.junit.jupiter.api.Test;

/**
 * Offline coverage of the live-probe orchestration: signer → Bearer header →
 * guarded harness → sanitized report. The transport is the recording fake and the
 * credentials are synthetic (a {@code synthetic-secret-9999} sentinel guards
 * against any token/secret leak), so no live HTTP and no real credential are
 * exercised. INQUIRY remains NEEDS_VERIFICATION.
 */
class EsmInquiryLiveProbeTest {

    private static final String BASE_URL = "https://example.test";
    private static final EsmInquiryLiveProbe.Credentials SYNTHETIC_CREDS =
            new EsmInquiryLiveProbe.Credentials(
                    "synthetic-master", "synthetic-secret-9999", "probe.example.test",
                    null, "synthetic-gmarket-seller");
    private static final EsmInquiryLiveProbe.Params PARAMS =
            new EsmInquiryLiveProbe.Params(LocalDate.of(2026, 6, 1), "PRODUCT", "처리완료");
    private static final String OK_PAGE = """
            {"items":[{"status":"처리완료","regDate":"2026-06-03T09:00:00+09:00"}],
             "totalCount":1,"page":1,"pageSize":1}
            """;

    private final RecordingEsmHttpClient http = new RecordingEsmHttpClient();
    private final EsmInquiriesClient client = new EsmInquiriesClient(http, BASE_URL);
    private final EsmInquiryProbeReporter reporter = new EsmInquiryProbeReporter();
    private final EsmJwtSigner signer =
            new EsmJwtSigner(Clock.fixed(Instant.parse("2026-06-29T00:00:00Z"), ZoneOffset.UTC));

    private EsmInquiryLiveProbe probe(BooleanSupplier guard) {
        return new EsmInquiryLiveProbe(new EsmInquiryProbeHarness(client, reporter, guard), signer);
    }

    @Test
    void assemblesBearerAuthAndFiresExactlyOneProbeWhenGuardOnAndConfirmed() {
        http.enqueueOk(OK_PAGE);

        EsmInquiryProbeReport report = probe(() -> true).fireOnce(
                EsmInquiryProbeHarness.LIVE_PROBE_CONFIRMATION, SYNTHETIC_CREDS, PARAMS);

        assertThat(http.sent).hasSize(1);
        String auth = http.sent.get(0).headers().get("Authorization");
        assertThat(auth).startsWith("Bearer ");
        // The header is a signed token, never the raw secret key.
        assertThat(auth).doesNotContain("synthetic-secret-9999");
        // The single call is the bounded probe: page=1, pageSize=1.
        assertThat(http.sent.get(0).jsonBody()).contains("\"page\":1").contains("\"pageSize\":1");
        assertThat(report.statusClass()).isEqualTo(StatusClass.SUCCESS);
        assertThat(report.statusTokens()).containsExactly("처리완료");
        // No token/secret material reaches the sanitized report.
        assertThat(report.toString())
                .doesNotContain("synthetic-secret-9999")
                .doesNotContain("Bearer");
    }

    @Test
    void refusesAndSendsNothingWhenGuardOff() {
        assertThatThrownBy(() -> probe(() -> false).fireOnce(
                        EsmInquiryProbeHarness.LIVE_PROBE_CONFIRMATION, SYNTHETIC_CREDS, PARAMS))
                .isInstanceOf(IllegalStateException.class);

        assertThat(http.sent).isEmpty();
    }

    @Test
    void refusesAndSendsNothingWithoutTheExactConfirmation() {
        assertThatThrownBy(() -> probe(() -> true).fireOnce(
                        "not-the-phrase", SYNTHETIC_CREDS, PARAMS))
                .isInstanceOf(IllegalStateException.class);

        assertThat(http.sent).isEmpty();
    }
}
