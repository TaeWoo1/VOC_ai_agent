package com.sellerops.connector.coupang;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * The Coupang answer contract — the connector's only WRITE.
 *
 * <p>What these pin, in order of how much damage getting them wrong would do: <b>an ambiguous write
 * is never reported as a failure</b> (a failure invites a retry, and a retry posts a second answer to
 * a real customer); a 200 that does not SAY success is not a success; a rejection carries the
 * platform's number and never its message; the request is the officially documented one and the
 * signature covers the method actually sent; and every refusal SellerOps makes itself happens before
 * anything leaves.
 */
class CoupangInquiryReplyClientTest {

    /** KST 2026-08-14 11:00 — the verification window is deterministic. */
    private final Clock clock = Clock.fixed(Instant.parse("2026-08-14T02:00:00Z"), ZoneOffset.UTC);
    private final FakeCoupangHttpClient http = new FakeCoupangHttpClient();
    private static final String TEST_APPROVAL_ID = "apr-test-approval";
    /** Records the pauses the client asks for instead of taking them — no test ever sleeps. */
    private final List<Long> pauses = new ArrayList<>();
    private final CoupangInquiryReplyClient client = new CoupangInquiryReplyClient(
            http, new CoupangSigner(clock), "https://api-gateway.coupang.com", TEST_APPROVAL_ID, clock,
            pauses::add);

    private static final String ACCESS_KEY = "AK-1";
    private static final String SECRET_KEY = "SK-1";
    private static final String VENDOR_ID = "A00012345";
    private static final String INQUIRY_ID = "158421449";
    private static final String REPLY_BY = "wing-operator";
    /** A reply a seller might actually write — distinctive, so a leak into a message would show. */
    private static final String CONTENT = "안녕하세요, 문의 주신 상품은 내일 발송 예정입니다.";

    private CoupangInquiryReplyClient.Outcome post() {
        return client.postReply(ACCESS_KEY, SECRET_KEY, VENDOR_ID, INQUIRY_ID, CONTENT, REPLY_BY);
    }

    private static CoupangHttpClient.Response response(int status, String body) {
        return new CoupangHttpClient.Response(status, body, Map.of());
    }

    /* ───────────────────────── the request that goes out ───────────────────────── */

    @Test
    void posts_to_the_official_v4_reply_endpoint_with_the_documented_body() {
        http.enqueue(response(200, "{\"code\":200,\"message\":\"OK\"}"));

        assertThat(post().kind()).isEqualTo(CoupangInquiryReplyClient.Kind.ACCEPTED);

        FakeCoupangHttpClient.Sent sent = http.sent.get(0);
        assertThat(sent.method()).isEqualTo("POST");
        assertThat(sent.uri().getPath())
                .isEqualTo("/v2/providers/openapi/apis/api/v4/vendors/A00012345/onlineInquiries/158421449/replies");
        // The collection path is v5 and this one is v4. That asymmetry is Coupang's, and "aligning"
        // them would be inventing an endpoint rather than calling a documented one.
        assertThat(sent.uri().getPath()).contains("/v4/");
        assertThat(sent.body()).contains("\"content\"").contains("\"vendorId\"").contains("\"replyBy\"");
        assertThat(sent.headers()).containsEntry("X-Requested-By", VENDOR_ID);
        assertThat(sent.headers()).containsEntry("X-MARKET", "KR");
    }

    @Test
    void the_signature_covers_the_POST_method_not_a_GET() {
        // A signature computed over the wrong method is rejected by the platform, and the failure
        // would look like a credential problem rather than a signing bug.
        http.enqueue(response(200, "{\"code\":200}"));
        post();

        String authorization = http.sent.get(0).headers().get("Authorization");
        String expected = new CoupangSigner(clock).authorization(ACCESS_KEY, SECRET_KEY, "POST",
                "/v2/providers/openapi/apis/api/v4/vendors/A00012345/onlineInquiries/158421449/replies", "");
        assertThat(authorization).isEqualTo(expected);
    }

    @Test
    void a_live_call_without_an_armed_approval_is_refused_before_anything_is_sent() {
        CoupangInquiryReplyClient unarmed = new CoupangInquiryReplyClient(
                http, new CoupangSigner(clock), "https://api-gateway.coupang.com", "", clock, pauses::add);

        assertThatThrownBy(() -> unarmed.postReply(ACCESS_KEY, SECRET_KEY, VENDOR_ID, INQUIRY_ID, CONTENT, REPLY_BY))
                .isInstanceOf(CoupangLiveApprovalRequiredException.class);
        assertThat(http.sent).isEmpty();
    }

    /* ───────────────────────── what an outcome means ───────────────────────── */

    @Test
    void a_transport_ambiguity_propagates_so_the_caller_can_verify_instead_of_resending() {
        // THE failure that matters most. If this surfaced as an ordinary error the core would treat
        // it as "nothing was sent" and retry — posting a second answer to a real customer.
        http.enqueueWriteAmbiguity();

        assertThatThrownBy(this::post).isInstanceOf(CoupangTransportAmbiguityException.class);
    }

    @Test
    void a_server_error_after_a_POST_is_UNKNOWN_not_retryable() {
        // The write may have landed before the fault. "Retryable" here would mean "send it again".
        http.enqueue(response(503, "{\"code\":503}"));

        assertThat(post().kind()).isEqualTo(CoupangInquiryReplyClient.Kind.UNKNOWN);
    }

    @Test
    void a_throttle_is_retryable_because_the_platform_says_it_refused_the_call() {
        http.enqueue(response(429, "{\"code\":429}"));

        assertThat(post().kind()).isEqualTo(CoupangInquiryReplyClient.Kind.RETRYABLE);
    }

    @Test
    void a_4xx_is_a_rejection_carrying_the_numeric_code_and_never_the_message() {
        http.enqueue(response(400, "{\"code\":400,\"message\":\"등록된 답변이 이미 있습니다\"}"));

        CoupangInquiryReplyClient.Outcome outcome = post();

        assertThat(outcome.kind()).isEqualTo(CoupangInquiryReplyClient.Kind.REJECTED);
        assertThat(outcome.resultCode()).isEqualTo(400);
        // The message is provider free text; it can quote the seller's own reply back at us.
        assertThat(outcome.toString()).doesNotContain("등록된");
    }

    @Test
    void a_200_that_does_not_say_success_is_NOT_a_success() {
        // Coupang answers business rejections with HTTP 200 and a non-OK envelope code. Reading only
        // the status would record a reply that was never posted — and the seller would believe a
        // customer had been answered.
        http.enqueue(response(200, "{\"code\":\"ERROR\",\"message\":\"권한이 없습니다\"}"));

        assertThat(post().kind()).isEqualTo(CoupangInquiryReplyClient.Kind.REJECTED);
    }

    @Test
    void a_200_whose_envelope_is_unrecognizable_is_not_read_as_success() {
        http.enqueue(response(200, "{\"somethingElse\":true}"));

        assertThat(post().kind()).isEqualTo(CoupangInquiryReplyClient.Kind.REJECTED);
    }

    @Test
    void an_explicit_success_flag_is_accepted_as_well_as_a_code() {
        http.enqueue(response(200, "{\"success\":true}"));

        assertThat(post().kind()).isEqualTo(CoupangInquiryReplyClient.Kind.ACCEPTED);
    }

    /* ───────────────────────── refusals SellerOps makes itself ───────────────────────── */

    @Test
    void a_blank_replyBy_refuses_before_the_request_rather_than_earning_a_rejection() {
        // The WING operator id is configuration SellerOps does not hold in the vault. An unconfigured
        // deployment must look like one — not like Coupang turning the seller's reply down.
        CoupangInquiryReplyClient.Outcome outcome =
                client.postReply(ACCESS_KEY, SECRET_KEY, VENDOR_ID, INQUIRY_ID, CONTENT, "  ");

        assertThat(outcome.kind()).isEqualTo(CoupangInquiryReplyClient.Kind.RETRYABLE);
        assertThat(http.sent).isEmpty();
    }

    @Test
    void a_non_numeric_inquiry_id_never_reaches_the_request_path() {
        // The id is interpolated into a PATH; anything but digits could address a different resource.
        for (String bad : new String[] {"158421449/../orders", "onlineInquiry:158421449", "", "abc"}) {
            assertThat(client.postReply(ACCESS_KEY, SECRET_KEY, VENDOR_ID, bad, CONTENT, REPLY_BY).kind())
                    .isEqualTo(CoupangInquiryReplyClient.Kind.RETRYABLE);
        }
        assertThat(http.sent).isEmpty();
    }

    @Test
    void a_missing_credential_or_an_empty_body_sends_nothing() {
        assertThat(client.postReply("", SECRET_KEY, VENDOR_ID, INQUIRY_ID, CONTENT, REPLY_BY).kind())
                .isEqualTo(CoupangInquiryReplyClient.Kind.RETRYABLE);
        assertThat(client.postReply(ACCESS_KEY, SECRET_KEY, VENDOR_ID, INQUIRY_ID, "  ", REPLY_BY).kind())
                .isEqualTo(CoupangInquiryReplyClient.Kind.RETRYABLE);
        assertThat(http.sent).isEmpty();
    }

    /* ───────────────────────── verification by re-query ───────────────────────── */

    @Test
    void verification_is_COMPLETE_only_when_the_platform_lists_the_inquiry_as_answered() {
        http.enqueue(response(200, "{\"data\":{\"content\":[{\"inquiryId\":158421449}]}}"));

        assertThat(client.isAnswered(ACCESS_KEY, SECRET_KEY, VENDOR_ID, INQUIRY_ID,
                Instant.parse("2026-08-13T05:00:00Z"))).isTrue();

        // The ANSWERED bucket, over a window that brackets the inquiry's own KST day — a one-day
        // query would miss an inquiry sitting on the far side of the timezone boundary and read as
        // "the reply did not land".
        String query = http.sent.get(0).uri().getQuery();
        assertThat(query).contains("answeredType=ANSWERED");
        assertThat(query).contains("inquiryStartAt=2026-08-12").contains("inquiryEndAt=2026-08-14");
    }

    @Test
    void an_inquiry_absent_from_the_answered_bucket_is_not_verified() {
        http.enqueue(response(200, "{\"data\":{\"content\":[{\"inquiryId\":999999999}]}}"));

        assertThat(client.isAnswered(ACCESS_KEY, SECRET_KEY, VENDOR_ID, INQUIRY_ID, clock.instant())).isFalse();
    }

    @Test
    void an_unreadable_re_query_is_NOT_YET_rather_than_confirmed() {
        // "We could not check" must never round up to "it landed" — that would close a work item on
        // an answer no customer ever received.
        http.enqueue(response(500, "{}"));
        assertThat(client.isAnswered(ACCESS_KEY, SECRET_KEY, VENDOR_ID, INQUIRY_ID, clock.instant())).isFalse();

        http.enqueue(response(200, "not json"));
        assertThat(client.isAnswered(ACCESS_KEY, SECRET_KEY, VENDOR_ID, INQUIRY_ID, clock.instant())).isFalse();
    }

    @Test
    void the_write_and_its_verification_hold_to_the_per_vendor_pace() {
        // The limit is per vendorId, and a verification can run while a sync sweeps the same vendor.
        http.enqueue(response(200, "{\"code\":200}"));
        http.enqueue(response(200, "{\"data\":{\"content\":[]}}"));

        post();
        client.isAnswered(ACCESS_KEY, SECRET_KEY, VENDOR_ID, INQUIRY_ID, clock.instant());

        // A fixed clock means no time passes between the two calls, so the second must be paced.
        assertThat(pauses).containsExactly(CoupangInquiriesClient.MIN_CALL_INTERVAL_MS);
    }
}
