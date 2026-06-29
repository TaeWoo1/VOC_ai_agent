package com.sellerops.connector.esm.inquiry;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.connector.esm.inquiry.EsmInquiryProbeReport.StatusClass;
import java.time.LocalDate;
import org.junit.jupiter.api.Test;

/**
 * Tests the two-lock guard on the read-only probe driver. The transport is the
 * recording fake, so no live HTTP is reachable; {@code AUTH} is synthetic (no real
 * credential). A refused run must perform <b>no</b> HTTP call. INQUIRY remains
 * NEEDS_VERIFICATION.
 */
class EsmInquiryProbeHarnessTest {

    private static final String BASE_URL = "https://example.test";
    private static final String AUTH = "Bearer test-token"; // synthetic, not a real credential
    private static final String OK_PAGE = """
            {"items":[{"status":"처리완료","regDate":"2026-06-03T09:00:00+09:00"}],
             "totalCount":1,"page":1,"pageSize":1}
            """;

    private final RecordingEsmHttpClient http = new RecordingEsmHttpClient();
    private final EsmInquiriesClient client = new EsmInquiriesClient(http, BASE_URL);
    private final EsmInquiryProbeReporter reporter = new EsmInquiryProbeReporter();

    @Test
    void refusesToRunWhenGuardFlagIsOff() {
        EsmInquiryProbeHarness harness = new EsmInquiryProbeHarness(client, reporter, () -> false);

        assertThatThrownBy(() -> harness.runOnce(
                        EsmInquiryProbeHarness.LIVE_PROBE_CONFIRMATION,
                        LocalDate.of(2026, 6, 1), null, "처리완료", AUTH))
                .isInstanceOf(IllegalStateException.class);

        // The guard is the first lock: no HTTP call may have been attempted.
        assertThat(http.sent).isEmpty();
    }

    @Test
    void refusesToRunWithoutTheExactConfirmationEvenWhenGuardIsOn() {
        EsmInquiryProbeHarness harness = new EsmInquiryProbeHarness(client, reporter, () -> true);

        assertThatThrownBy(() -> harness.runOnce(
                        "not-the-phrase", LocalDate.of(2026, 6, 1), null, "처리완료", AUTH))
                .isInstanceOf(IllegalStateException.class);

        assertThat(http.sent).isEmpty();
    }

    @Test
    void defaultConstructorIsOffByDefaultSoItRefuses() {
        // No system property set => default guard is false => cannot run accidentally.
        EsmInquiryProbeHarness harness = new EsmInquiryProbeHarness(client, reporter);

        assertThatThrownBy(() -> harness.runOnce(
                        EsmInquiryProbeHarness.LIVE_PROBE_CONFIRMATION,
                        LocalDate.of(2026, 6, 1), null, "처리완료", AUTH))
                .isInstanceOf(IllegalStateException.class);

        assertThat(http.sent).isEmpty();
    }

    @Test
    void firesExactlyOneRequestAndReturnsASanitizedReportWhenFlaggedAndConfirmed() {
        http.enqueueOk(OK_PAGE);
        EsmInquiryProbeHarness harness = new EsmInquiryProbeHarness(client, reporter, () -> true);

        EsmInquiryProbeReport report = harness.runOnce(
                EsmInquiryProbeHarness.LIVE_PROBE_CONFIRMATION,
                LocalDate.of(2026, 6, 1), "PRODUCT", "처리완료", AUTH);

        assertThat(http.sent).hasSize(1);
        assertThat(report.statusClass()).isEqualTo(StatusClass.SUCCESS);
        assertThat(report.statusTokens()).containsExactly("처리완료");
        // The single call was the bounded probe: page=1, pageSize=1.
        assertThat(http.sent.get(0).jsonBody()).contains("\"page\":1").contains("\"pageSize\":1");
    }
}
