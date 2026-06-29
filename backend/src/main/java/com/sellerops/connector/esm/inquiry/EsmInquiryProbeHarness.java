package com.sellerops.connector.esm.inquiry;

import com.sellerops.connector.esm.EsmHttpClient;
import java.time.LocalDate;
import java.util.function.BooleanSupplier;

/**
 * Guarded driver for the <b>one-time, read-only</b> ESM+ INQUIRY live probe. It
 * fires <b>exactly one</b> request via {@link EsmInquiriesClient#probeSinglePage}
 * and returns only the sanitized {@link EsmInquiryProbeReport} from
 * {@link EsmInquiryProbeReporter}; it performs <b>no</b> DB write, no status /
 * {@code LAST_SUCCESS} update, no upload, no scheduler/manual-sync, and persists no
 * {@link com.sellerops.ingest.canonical.CanonicalInquiry} — it has no such
 * collaborators by construction.
 *
 * <p><b>Impossible to run accidentally.</b> {@link #runOnce} fires only when
 * <i>both</i> locks are satisfied: (1) the live-probe guard flag is on (the default
 * guard reads system property {@link #LIVE_PROBE_GUARD_PROPERTY}, which is
 * <b>off</b> unless explicitly set to {@code true}); and (2) the caller passes the
 * exact {@link #LIVE_PROBE_CONFIRMATION} phrase. Either lock missing throws and no
 * HTTP call is attempted. This mirrors the collector's NAVER {@code --diagnose-*}
 * observe-and-discard precedent.
 *
 * <p>No credentials live here: {@code authorization} is the caller-assembled header
 * value (the vault/JWT assembly is intentionally out of scope and supplied only by
 * a separately-approved runner). INQUIRY remains NEEDS_VERIFICATION; capabilities
 * are unchanged.
 */
public final class EsmInquiryProbeHarness {

    /** System property that must equal {@code "true"} to arm the live probe (default off). */
    public static final String LIVE_PROBE_GUARD_PROPERTY = "sellerops.connector.esm.inquiry.probe.live";

    /** Exact confirmation phrase a caller must pass to {@link #runOnce}. */
    public static final String LIVE_PROBE_CONFIRMATION =
            "I-UNDERSTAND-THIS-FIRES-ONE-LIVE-ESM-INQUIRY-REQUEST";

    private final EsmInquiriesClient client;
    private final EsmInquiryProbeReporter reporter;
    private final BooleanSupplier liveProbeGuard;

    /** Production constructor: the guard reads {@link #LIVE_PROBE_GUARD_PROPERTY} (off by default). */
    public EsmInquiryProbeHarness(EsmInquiriesClient client, EsmInquiryProbeReporter reporter) {
        this(client, reporter,
                () -> "true".equalsIgnoreCase(System.getProperty(LIVE_PROBE_GUARD_PROPERTY, "false")));
    }

    /** Test/explicit constructor with an injected guard. */
    EsmInquiryProbeHarness(EsmInquiriesClient client, EsmInquiryProbeReporter reporter,
                           BooleanSupplier liveProbeGuard) {
        this.client = client;
        this.reporter = reporter;
        this.liveProbeGuard = liveProbeGuard;
    }

    /**
     * Fire exactly one probe request and return its sanitized report — only when
     * both the guard flag is on and {@code confirmation} equals
     * {@link #LIVE_PROBE_CONFIRMATION}. Otherwise throws before any HTTP call.
     */
    public EsmInquiryProbeReport runOnce(String confirmation, LocalDate day, String qnaType,
                                         String statusFilter, String authorization) {
        if (!liveProbeGuard.getAsBoolean()) {
            throw new IllegalStateException(
                    "ESM INQUIRY 라이브 프로브가 차단되었습니다: 가드 플래그("
                            + LIVE_PROBE_GUARD_PROPERTY + ")가 설정되지 않았습니다.");
        }
        if (!LIVE_PROBE_CONFIRMATION.equals(confirmation)) {
            throw new IllegalStateException(
                    "ESM INQUIRY 라이브 프로브가 차단되었습니다: 명시적 확인 문구가 필요합니다.");
        }
        // One call; the raw response is consumed by the reporter and discarded here.
        EsmHttpClient.Response response =
                client.probeSinglePage(day, qnaType, statusFilter, authorization);
        return reporter.report(response);
    }
}
