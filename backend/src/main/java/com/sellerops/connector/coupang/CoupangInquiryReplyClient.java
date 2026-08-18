package com.sellerops.connector.coupang;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * <b>The official Coupang answer path for 상품별 고객문의</b> — the only place SellerOps writes to the
 * Coupang marketplace.
 *
 * <pre>POST /v2/providers/openapi/apis/api/v4/vendors/{vendorId}/onlineInquiries/{inquiryId}/replies</pre>
 *
 * <p><b>Why this replaced a browser flow.</b> The earlier design drove the seller to the WING 고객문의
 * screen and had them type the reply there, because no answer API was believed to exist. It does. An
 * official endpoint is better on every axis that matters here: it targets by the channel's own
 * {@code inquiryId} instead of by a locator measured off a rendered page, it returns a result instead
 * of an appearance, and it never has to read a screen full of other customers' questions to find one
 * row. The WING work is kept only as a diagnostic.
 *
 * <p><b>Version asymmetry, deliberately preserved.</b> Collection runs on {@code v5}
 * ({@link CoupangInquiriesClient}); this answer endpoint is {@code v4}. That is how Coupang publishes
 * them, and quietly "aligning" one to the other would be inventing an endpoint rather than calling a
 * documented one. If a v5 reply path exists, adopting it is a change with its own evidence.
 *
 * <p><b>What is NOT verified from the repository.</b> The request field names below
 * ({@code content} / {@code vendorId} / {@code replyBy}) come from Coupang's public API reference, not
 * from anything this repository can check, and no live call has yet exercised them. The client is
 * written so the first live attempt either succeeds or fails LOUDLY and idempotently: a rejected body
 * is a PERMANENT failure with the platform's numeric code, never a silent retry against a guess.
 *
 * <p><b>{@code replyBy} is required and is not a credential.</b> It is the WING operator id Coupang
 * stamps the answer with, and SellerOps does not hold it: the credential handoff stores 업체코드 /
 * Access Key / Secret Key and nothing else. So it is configured explicitly, and a blank one fails
 * closed <i>before</i> the request rather than producing a rejected write.
 *
 * <p><b>Safety.</b> Same interlock as every other Coupang call — {@link CoupangLiveCallGuard} at the
 * signing choke point, the shared 4-calls-per-second pace, per-request CEA HMAC. Nothing here decides
 * to send: the caller reaches this class only after the channel-neutral publish core has bound an
 * approved draft to a seller confirmation. A transport ambiguity throws
 * {@link CoupangTransportAmbiguityException} so the caller can record DELIVERY_UNKNOWN and verify,
 * because a resend would post a second answer to a real customer.
 */
public class CoupangInquiryReplyClient {

    private static final Logger log = LoggerFactory.getLogger(CoupangInquiryReplyClient.class);

    static final String REPLY_PATH_FMT =
            "/v2/providers/openapi/apis/api/v4/vendors/%s/onlineInquiries/%s/replies";

    private static final String MARKET = "KR";

    /**
     * How far around the inquiry's own date the verification re-query looks.
     *
     * <p>The list endpoint filters by inquiry date, and the stored timestamp is normalized to UTC
     * while Coupang windows in KST — so a query for exactly one day can miss an inquiry that sits on
     * the other side of the boundary. One day either side is cheap and removes the whole class of
     * off-by-a-timezone verification failures, which would otherwise read as "the reply did not land".
     */
    static final int VERIFY_WINDOW_DAYS = 1;

    private final CoupangHttpClient http;
    private final CoupangSigner signer;
    private final String baseUrl;
    private final String liveApprovalId;
    private final Clock clock;
    private final CoupangInquiriesClient.Pacer pacer;
    private final ObjectMapper mapper = new ObjectMapper();

    /**
     * The last call's instant, guarded by {@link #pace()}.
     *
     * <p>Shared mutable state on a Spring singleton, so the pause is {@code synchronized} for the
     * same reason the collection client's is: two concurrent verifications would otherwise each read
     * the same "last call" and both decide no pause was needed, which is how the rate limit was hit
     * in the first place.
     */
    private long lastCallAtMillis;

    public CoupangInquiryReplyClient(CoupangHttpClient http, CoupangSigner signer, String baseUrl,
                                     String liveApprovalId, Clock clock) {
        this(http, signer, baseUrl, liveApprovalId, clock, CoupangInquiriesClient.SLEEPING_PACER);
    }

    CoupangInquiryReplyClient(CoupangHttpClient http, CoupangSigner signer, String baseUrl,
                              String liveApprovalId, Clock clock, CoupangInquiriesClient.Pacer pacer) {
        this.http = http;
        this.signer = signer;
        this.baseUrl = baseUrl;
        this.liveApprovalId = liveApprovalId == null ? "" : liveApprovalId;
        this.clock = clock;
        this.pacer = pacer;
    }

    /**
     * Hold to the same 4-calls-per-second the collection client holds to — the limit is per vendorId,
     * and a verification can easily be running while a sync sweeps the same vendor.
     *
     * <p>The pause is taken BEFORE signing, because the CEA signature is stamped with a timestamp the
     * platform checks: signing first and then sleeping would age the signature by the pause.
     */
    private synchronized void pace() {
        long now = clock.millis();
        long waited = now - lastCallAtMillis;
        if (lastCallAtMillis != 0 && waited < CoupangInquiriesClient.MIN_CALL_INTERVAL_MS) {
            pacer.pauseMillis(CoupangInquiriesClient.MIN_CALL_INTERVAL_MS - waited);
        }
        lastCallAtMillis = clock.millis();
    }

    /** What one answer attempt did, in the connector's own terms. */
    public enum Kind {
        /** The platform accepted the answer. */
        ACCEPTED,
        /** The platform rejected it. Re-sending the same body would be rejected again. */
        REJECTED,
        /** Nothing was sent — a throttle or a transient server fault. Safe to try again. */
        RETRYABLE,
        /** It may or may not have been posted. NEVER re-send; verify. */
        UNKNOWN
    }

    /**
     * One attempt's outcome. {@code resultCode} is the platform's numeric code on a rejection —
     * never its message, which is free text that can quote the seller's own reply back.
     */
    public record Outcome(Kind kind, Integer resultCode) {

        public static Outcome accepted() {
            return new Outcome(Kind.ACCEPTED, null);
        }

        public static Outcome rejected(Integer resultCode) {
            return new Outcome(Kind.REJECTED, resultCode);
        }

        public static Outcome retryable() {
            return new Outcome(Kind.RETRYABLE, null);
        }

        public static Outcome unknown() {
            return new Outcome(Kind.UNKNOWN, null);
        }
    }

    /**
     * Post one answer to one inquiry.
     *
     * <p>Every argument is validated before anything leaves: a blank credential, a non-numeric
     * inquiry id, a blank body or a blank {@code replyBy} is a RETRYABLE refusal made here, with no
     * request issued. Refusing early is the difference between "SellerOps declined to send" and "the
     * marketplace rejected the seller's reply", and the seller sees a different thing in each case.
     */
    public Outcome postReply(String accessKey, String secretKey, String vendorId,
                             String inquiryId, String content, String replyBy) {
        if (isBlank(accessKey) || isBlank(secretKey) || isBlank(vendorId)) {
            return Outcome.retryable();
        }
        // Digits only. The id is interpolated into a request PATH, so anything else has no business
        // being there — and a malformed id could otherwise address a different resource entirely.
        if (inquiryId == null || !inquiryId.matches("[0-9]{1,24}")) {
            return Outcome.retryable();
        }
        if (isBlank(content) || isBlank(replyBy)) {
            return Outcome.retryable();
        }

        String path = String.format(REPLY_PATH_FMT, vendorId, inquiryId);
        String body;
        try {
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("content", content);
            payload.put("vendorId", vendorId);
            payload.put("replyBy", replyBy);
            body = mapper.writeValueAsString(payload);
        } catch (JsonProcessingException e) {
            return Outcome.retryable(); // nothing was sent
        }

        CoupangHttpClient.Response response = signedPost(path, body, accessKey, secretKey, vendorId);
        int status = response.statusCode();
        if (status == 429) {
            // Throttled BEFORE the answer was accepted — the platform says so by refusing it.
            return Outcome.retryable();
        }
        if (status >= 500) {
            // A 5xx after a POST is genuinely ambiguous: the write may have landed before the fault.
            log.warn("Coupang inquiry reply returned a server error: status={}", status);
            return Outcome.unknown();
        }
        if (status != 200) {
            Integer code = numericCode(response.body());
            log.warn("Coupang inquiry reply was rejected: status={} code={}", status, code);
            return Outcome.rejected(code);
        }
        // A 200 whose envelope does not say success is NOT a success. Coupang returns 200 with a
        // non-OK code for business rejections, and reading only the HTTP status would record a reply
        // that was never posted — the seller would believe a customer had been answered.
        return acceptedByEnvelope(response.body()) ? Outcome.accepted() : Outcome.rejected(numericCode(response.body()));
    }

    /**
     * Has this inquiry been answered, according to Coupang?
     *
     * <p>The verification is a re-query of the ANSWERED bucket for the inquiry's own date window,
     * asking only whether this {@code inquiryId} is now in it. Deliberately NOT a check that our
     * text is present: the answer of record is the platform's, and comparing bodies would both read
     * customer-visible content back and turn a normalization difference into a failed verification.
     *
     * @return true only when the platform lists it as answered; false when it does not, or when the
     *         re-query could not be read — an unreadable verification is "not yet", never "yes"
     */
    public boolean isAnswered(String accessKey, String secretKey, String vendorId,
                              String inquiryId, Instant inquiredAt) {
        if (isBlank(accessKey) || isBlank(secretKey) || isBlank(vendorId) || isBlank(inquiryId)) {
            return false;
        }
        Instant at = inquiredAt == null ? clock.instant() : inquiredAt;
        LocalDate day = LocalDate.ofInstant(at, CoupangInquiriesClient.KST);
        String from = day.minusDays(VERIFY_WINDOW_DAYS).toString();
        String to = day.plusDays(VERIFY_WINDOW_DAYS).toString();

        String path = String.format(CoupangInquiriesClient.ONLINE_INQUIRIES_PATH_FMT, vendorId);
        int pageNum = 1;
        while (pageNum <= CoupangInquiriesClient.MAX_PAGES_PER_TYPE) {
            String query = CoupangInquiriesClient.inquiriesQuery(
                    "ANSWERED", from, to, pageNum, CoupangInquiriesClient.MAX_PAGE_SIZE);
            CoupangHttpClient.Response response = signedGet(path, query, accessKey, secretKey, vendorId);
            if (response.statusCode() != 200) {
                return false; // could not read it ⇒ not yet, and the caller retries verification
            }
            JsonNode root;
            try {
                root = mapper.readTree(response.body() == null ? "" : response.body());
            } catch (JsonProcessingException e) {
                return false;
            }
            JsonNode content = root.path("data").path("content");
            if (!content.isArray() || content.isEmpty()) {
                return false;
            }
            for (JsonNode item : content) {
                if (inquiryId.equals(item.path("inquiryId").asText(null))) {
                    return true;
                }
            }
            if (content.size() < CoupangInquiriesClient.MAX_PAGE_SIZE) {
                return false;
            }
            pageNum++;
        }
        return false;
    }

    /**
     * Whether a 200 body actually says the write succeeded.
     *
     * <p>Accepts the two shapes Coupang uses — a {@code code} of {@code 200}/{@code SUCCESS}, or an
     * explicit {@code success: true}. An envelope carrying neither is NOT read as success: a body we
     * cannot interpret has not told us the reply was posted, and defaulting to yes is precisely how a
     * seller comes to believe a customer was answered when they were not.
     */
    private boolean acceptedByEnvelope(String body) {
        if (body == null || body.isBlank()) {
            return false;
        }
        JsonNode root;
        try {
            root = mapper.readTree(body);
        } catch (JsonProcessingException e) {
            log.warn("Coupang inquiry reply 200-body did not parse: length={}", body.length());
            return false;
        }
        JsonNode success = root.path("success");
        if (success.isBoolean()) {
            return success.asBoolean();
        }
        JsonNode code = root.path("code");
        if (code.isNumber()) {
            return code.asInt() == 200;
        }
        if (code.isTextual()) {
            String text = code.asText();
            return "200".equals(text) || "SUCCESS".equalsIgnoreCase(text);
        }
        log.warn("Coupang inquiry reply 200-body carried no recognizable result field: length={}", body.length());
        return false;
    }

    /** The platform's numeric result code, when it gives one. Never its message. */
    private Integer numericCode(String body) {
        if (body == null || body.isBlank()) {
            return null;
        }
        try {
            JsonNode code = mapper.readTree(body).path("code");
            if (code.isNumber()) {
                return code.asInt();
            }
            if (code.isTextual() && code.asText().matches("[0-9]{1,9}")) {
                return Integer.valueOf(code.asText());
            }
        } catch (JsonProcessingException e) {
            return null;
        }
        return null;
    }

    private CoupangHttpClient.Response signedPost(String path, String body,
                                                  String accessKey, String secretKey, String vendorId) {
        // WRITE gate, explicitly: a marketplace-mutating POST opens ONLY on the per-run live approval id.
        // The Self-Pilot standing READ grant is not even reachable from here (Self-Pilot Runtime v1).
        CoupangLiveCallGuard.ensureLiveWriteAllowed(baseUrl, liveApprovalId);
        pace();
        String authorization = signer.authorization(accessKey, secretKey, "POST", path, "");
        URI uri = URI.create(baseUrl + path);
        return http.post(uri, headers(authorization, vendorId), body);
    }

    private CoupangHttpClient.Response signedGet(String path, String query,
                                                 String accessKey, String secretKey, String vendorId) {
        CoupangLiveCallGuard.ensureLiveCallAllowed(baseUrl, liveApprovalId);
        pace();
        String authorization = signer.authorization(accessKey, secretKey, "GET", path, query);
        URI uri = URI.create(baseUrl + path + (query.isEmpty() ? "" : "?" + query));
        return http.get(uri, headers(authorization, vendorId));
    }

    private static Map<String, String> headers(String authorization, String vendorId) {
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Authorization", authorization);
        headers.put("X-Requested-By", vendorId);
        headers.put("X-MARKET", MARKET);
        return headers;
    }

    /** The reply body's size in bytes as Coupang counts it, for callers that bound it. */
    public static int utf8Bytes(String value) {
        return value == null ? 0 : value.getBytes(StandardCharsets.UTF_8).length;
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
