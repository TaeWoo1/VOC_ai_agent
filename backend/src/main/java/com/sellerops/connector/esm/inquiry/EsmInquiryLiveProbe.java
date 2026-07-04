package com.sellerops.connector.esm.inquiry;

import com.sellerops.connector.esm.EsmJwtSigner;
import java.time.LocalDate;

/**
 * Orchestration for the one-time, read-only ESM+ INQUIRY live probe: assemble a
 * signed {@code Authorization} header from a credential and drive the guarded
 * {@link EsmInquiryProbeHarness} for <b>exactly one</b> request, returning only
 * the sanitized {@link EsmInquiryProbeReport}.
 *
 * <p>This class is transport-agnostic and fully offline-testable: the
 * {@link EsmInquiryProbeHarness} (hence the {@link EsmInquiriesClient} and its
 * {@link com.sellerops.connector.esm.EsmHttpClient}) and the {@link EsmJwtSigner}
 * are injected, so unit tests drive it with the recording fake and synthetic
 * credentials. The actual live wiring (real {@code JdkEsmHttpClient}, real
 * credentials from the environment) lives only in the env-gated live driver.
 *
 * <p><b>Safety.</b> The token is built here and handed straight to the harness;
 * it is never logged, stored, or returned. The harness's two locks (guard flag +
 * exact confirmation phrase) still gate every call — a refused run sends no
 * request. No DB write, no scheduler/manual-sync, no capability change, no live
 * inquiry ingestion; INQUIRY is official-doc confirmed but live-response unverified.
 */
public final class EsmInquiryLiveProbe {

    /** ESM Sell-API credential for signing one JWT (carried in memory only). */
    public record Credentials(String masterId, String secretKey, String issuer,
                              String auctionSellerId, String gmarketSellerId) {
    }

    /**
     * The single probe query: one historical day plus the optional numeric filters
     * {@code qnaType}, {@code status}, and {@code type} (any may be null).
     */
    public record Params(LocalDate day, Integer qnaType, Integer status, Integer type) {
    }

    private final EsmInquiryProbeHarness harness;
    private final EsmJwtSigner signer;

    public EsmInquiryLiveProbe(EsmInquiryProbeHarness harness, EsmJwtSigner signer) {
        this.harness = harness;
        this.signer = signer;
    }

    /**
     * Sign one JWT from {@code credentials}, assemble {@code Authorization: Bearer
     * <token>}, and run the guarded single probe for {@code params}. Returns only
     * the sanitized report; throws (sending nothing) when the harness's guard flag
     * is off or {@code confirmation} is not the exact phrase.
     */
    public EsmInquiryProbeReport fireOnce(String confirmation, Credentials credentials, Params params) {
        String token = signer.token(credentials.masterId(), credentials.secretKey(),
                credentials.issuer(), credentials.auctionSellerId(), credentials.gmarketSellerId());
        String authorization = "Bearer " + token;
        return harness.runOnce(confirmation, params.day(), params.qnaType(),
                params.status(), params.type(), authorization);
    }
}
