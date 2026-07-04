package com.sellerops.connector.esm.inquiry;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.connector.esm.EsmJwtSigner;
import com.sellerops.connector.esm.JdkEsmHttpClient;
import java.time.Clock;
import java.time.LocalDate;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

/**
 * The <b>one-time, read-only ESM+ INQUIRY live probe driver</b>. It is the only
 * piece that touches the live transport, and it is <b>off by default</b>: it runs
 * only when env {@code RUN_ESM_INQUIRY_PROBE=true} is set, so a normal
 * {@code ./gradlew test} discovers it and skips it (no live call, no credential).
 *
 * <p>Two further locks still apply inside {@link EsmInquiryProbeHarness}: this
 * driver arms the guard system property for the single call (and clears it after)
 * and passes the exact {@link EsmInquiryProbeHarness#LIVE_PROBE_CONFIRMATION}
 * phrase. It fires <b>exactly one</b> request (a single historical day, no
 * pagination) and prints <b>only</b> the sanitized {@link EsmInquiryProbeReport} — never
 * the raw body, the {@code Authorization}/JWT/token, credentials, seller/Master
 * ids, buyer identifiers, inquiry text, exact counts, or exact timestamps.
 *
 * <p>Credentials and parameters come from the environment (supplied out-of-band,
 * never committed): {@code ESM_MASTER_ID}, {@code ESM_SECRET_KEY},
 * {@code ESM_ISSUER}, {@code ESM_GMARKET_SELLER_ID} (required);
 * {@code ESM_AUCTION_SELLER_ID} (optional); {@code ESM_BASE_URL}
 * (default {@code https://sa2.esmplus.com}); {@code ESM_INQUIRY_PROBE_DAY}
 * (required, ISO date — one historical day); {@code ESM_INQUIRY_PROBE_STATUS}
 * (numeric reply-status filter, default {@code 2} — the resolved/answered code,
 * official-doc confirmed but live-response unverified); {@code
 * ESM_INQUIRY_PROBE_QNA_TYPE} and {@code ESM_INQUIRY_PROBE_TYPE} (optional numeric).
 * No DB, no vault, no scheduler/manual-sync, no capability change, no live
 * ingestion. To see the report, run with {@code --info} (Gradle captures stdout).
 */
@EnabledIfEnvironmentVariable(named = "RUN_ESM_INQUIRY_PROBE", matches = "true")
class EsmInquiryLiveProbeIT {

    private static final String DEFAULT_BASE_URL = "https://sa2.esmplus.com";
    private static final int DEFAULT_STATUS_CODE = 2; // resolved/answered (provisional numeric code)

    @Test
    void fireOneReadOnlyProbeAndPrintSanitizedReport() {
        EsmInquiryLiveProbe.Credentials credentials = new EsmInquiryLiveProbe.Credentials(
                requireEnv("ESM_MASTER_ID"),
                requireEnv("ESM_SECRET_KEY"),
                requireEnv("ESM_ISSUER"),
                blankToNull(System.getenv("ESM_AUCTION_SELLER_ID")),
                requireEnv("ESM_GMARKET_SELLER_ID"));

        EsmInquiryLiveProbe.Params params = new EsmInquiryLiveProbe.Params(
                LocalDate.parse(requireEnv("ESM_INQUIRY_PROBE_DAY")),
                envInt(System.getenv("ESM_INQUIRY_PROBE_QNA_TYPE"), null),
                envInt(System.getenv("ESM_INQUIRY_PROBE_STATUS"), DEFAULT_STATUS_CODE),
                envInt(System.getenv("ESM_INQUIRY_PROBE_TYPE"), null));

        String baseUrl = envOrDefault("ESM_BASE_URL", DEFAULT_BASE_URL);

        // Arm the harness guard for this single run only; always release it.
        System.setProperty(EsmInquiryProbeHarness.LIVE_PROBE_GUARD_PROPERTY, "true");
        try {
            EsmInquiriesClient client = new EsmInquiriesClient(new JdkEsmHttpClient(), baseUrl);
            EsmInquiryProbeHarness harness =
                    new EsmInquiryProbeHarness(client, new EsmInquiryProbeReporter());
            EsmInquiryLiveProbe probe = new EsmInquiryLiveProbe(harness, new EsmJwtSigner(Clock.systemUTC()));

            EsmInquiryProbeReport report = probe.fireOnce(
                    EsmInquiryProbeHarness.LIVE_PROBE_CONFIRMATION, credentials, params);

            // Sanitized report ONLY — safe to print (no body/token/credential/PII).
            System.out.println("=== ESM+ INQUIRY one-time read-only probe — sanitized report ===");
            System.out.println(report);

            assertThat(report).isNotNull();
        } finally {
            System.clearProperty(EsmInquiryProbeHarness.LIVE_PROBE_GUARD_PROPERTY);
        }
    }

    private static String requireEnv(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("필수 환경변수가 비어 있습니다: " + name);
        }
        return value;
    }

    private static String envOrDefault(String name, String fallback) {
        String value = System.getenv(name);
        return (value == null || value.isBlank()) ? fallback : value;
    }

    private static String blankToNull(String value) {
        return (value == null || value.isBlank()) ? null : value;
    }

    /** Parse a numeric env value; blank/unset yields {@code fallback} (may be null). */
    private static Integer envInt(String value, Integer fallback) {
        return (value == null || value.isBlank()) ? fallback : Integer.valueOf(value.strip());
    }
}
