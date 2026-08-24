package com.sellerops.inquiry.publish.naver;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.sellerops.connector.naver.NaverCustomerInquiriesClient;
import com.sellerops.connector.naver.NaverProductQnaClient;
import com.sellerops.connector.naver.NaverTokenClient;
import com.sellerops.credential.CredentialVault;
import com.sellerops.credential.DecryptedCredential;
import com.sellerops.inquiry.InquirySourceSubtype;
import com.sellerops.inquiry.publish.ReplyPublishCommand;
import com.sellerops.inquiry.publish.ReplyPublishResult;
import java.io.IOException;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The two NAVER answer contracts, and the ways they are not the same contract.
 *
 * <p>Every assertion here traces to the vendored official documents retrieved 2026-08-24
 * ({@code docs/vendor/naver-commerce-api/put-v1-contents-qnas-questionId.md} and
 * {@code post-v1-pay-merchant-inquiries-inquiryNo-answer.md}). Nothing is asserted that those
 * documents do not state — the previous package deliberately shipped no adapter precisely because
 * only the paths were known, and a body invented to fill the gap would have been a guess wearing an
 * implementation's clothes.
 */
class NaverAnswerContractTest {

    private static final String OFFLINE = "https://naver.test";
    private static final UUID ORG = UUID.randomUUID();
    private static final UUID SELLER = UUID.randomUUID();
    private static final UUID CHANNEL = UUID.randomUUID();
    private static final Instant RECEIVED = Instant.parse("2026-08-20T01:00:00Z");

    /** Records what was sent and answers with whatever the test staged. */
    private static final class FakeHttp implements NaverAnswerHttpClient {
        record Sent(String verb, URI uri, String token, String body) {
        }

        final List<Sent> sent = new ArrayList<>();
        int status = 200;
        String responseBody = "{}";
        RuntimeException failure;

        @Override
        public Response putJson(URI uri, String bearerToken, String jsonBody) {
            return record("PUT", uri, bearerToken, jsonBody);
        }

        @Override
        public Response postJson(URI uri, String bearerToken, String jsonBody) {
            return record("POST", uri, bearerToken, jsonBody);
        }

        private Response record(String verb, URI uri, String token, String body) {
            sent.add(new Sent(verb, uri, token, body));
            if (failure != null) {
                throw failure;
            }
            return new Response(status, responseBody, Map.of());
        }
    }

    private FakeHttp http;
    private CredentialVault vault;
    private NaverTokenClient tokens;

    @BeforeEach
    void setUp() {
        http = new FakeHttp();
        vault = mock(CredentialVault.class);
        when(vault.hasCredential(any(), any())).thenReturn(true);
        when(vault.open(any(), any())).thenReturn(new DecryptedCredential("naver", "OAUTH2",
                Map.of("client_id", "cid", "client_secret", "csec"), null, null));
        tokens = mock(NaverTokenClient.class);
        when(tokens.accessToken(any(), any())).thenReturn("TOKEN");
    }

    private NaverProductQnaReplyAdapter qnaAdapter() {
        return new NaverProductQnaReplyAdapter(
                new NaverProductQnaAnswerClient(http, OFFLINE, ""),
                mock(NaverProductQnaClient.class), tokens, vault,
                Clock.fixed(RECEIVED, ZoneOffset.UTC));
    }

    private NaverCustomerInquiryReplyAdapter customerAdapter() {
        return new NaverCustomerInquiryReplyAdapter(
                new NaverCustomerInquiryAnswerClient(http, OFFLINE, ""),
                mock(NaverCustomerInquiriesClient.class), tokens, vault,
                Clock.fixed(RECEIVED, ZoneOffset.UTC));
    }

    private static ReplyPublishCommand command(String externalId) {
        return new ReplyPublishCommand(ORG, SELLER, CHANNEL, externalId, RECEIVED, null,
                "안녕하세요, 문의 주신 내용 안내드립니다.");
    }

    // ── The bodies. These are the two field names, and they are not interchangeable.

    @Test
    @DisplayName("상품 문의는 commentContent를 PUT으로 보낸다")
    void productQnaSendsCommentContentByPut() {
        assertThat(qnaAdapter().publish(command("naver-qna:676568657")).kind())
                .isEqualTo(ReplyPublishResult.Kind.CONFIRMED);

        FakeHttp.Sent sent = http.sent.get(0);
        assertThat(sent.verb()).isEqualTo("PUT");
        assertThat(sent.uri().toString()).isEqualTo(OFFLINE + "/external/v1/contents/qnas/676568657");
        assertThat(sent.body()).contains("\"commentContent\"").doesNotContain("answerComment");
    }

    @Test
    @DisplayName("고객 문의는 answerComment를 POST로 보내고, 템플릿 ID는 절대 싣지 않는다")
    void customerInquirySendsAnswerCommentByPost() {
        assertThat(customerAdapter().publish(command("naver-payinq:322684048")).kind())
                .isEqualTo(ReplyPublishResult.Kind.CONFIRMED);

        FakeHttp.Sent sent = http.sent.get(0);
        assertThat(sent.verb()).isEqualTo("POST");
        assertThat(sent.uri().toString())
                .isEqualTo(OFFLINE + "/external/v1/pay-merchant/inquiries/322684048/answer");
        assertThat(sent.body()).contains("\"answerComment\"").doesNotContain("commentContent");
        // answerTemplateId is optional in the contract and deliberately never sent: it would make
        // NAVER substitute text the seller never read.
        assertThat(sent.body()).doesNotContain("answerTemplateId");
    }

    // ── The subtypes. An approval for one can never be spent by the other.

    @Test
    @DisplayName("각 adapter는 자기 subtype만 받는다 — 서로의 승인을 쓸 수 없다")
    void eachAdapterServesOnlyItsOwnSubtype() {
        assertThat(qnaAdapter().servesSubtype(InquirySourceSubtype.NAVER_PRODUCT_QNA)).isTrue();
        assertThat(qnaAdapter().servesSubtype(InquirySourceSubtype.NAVER_CUSTOMER_INQUIRY)).isFalse();
        assertThat(customerAdapter().servesSubtype(InquirySourceSubtype.NAVER_CUSTOMER_INQUIRY)).isTrue();
        assertThat(customerAdapter().servesSubtype(InquirySourceSubtype.NAVER_PRODUCT_QNA)).isFalse();
        // Neither answers the channel-wide null: a NAVER inquiry with no recorded subtype has no
        // proven resource, and guessing one picks a stranger's inquiry number.
        assertThat(qnaAdapter().servesSubtype(null)).isFalse();
        assertThat(customerAdapter().servesSubtype(null)).isFalse();
    }

    @Test
    @DisplayName("다른 lane의 external id는 대상이 되지 못한다 — 두 번호 공간은 겹치지 않는다")
    void anExternalIdFromTheOtherLaneIsNotATarget() {
        // Both are bare int64s from different sequences, so accepting one here would answer a
        // different customer's question rather than fail.
        assertThat(qnaAdapter().publish(command("naver-payinq:322684048")).kind())
                .isEqualTo(ReplyPublishResult.Kind.RETRYABLE_FAILURE);
        assertThat(customerAdapter().publish(command("naver-qna:676568657")).kind())
                .isEqualTo(ReplyPublishResult.Kind.RETRYABLE_FAILURE);
        assertThat(http.sent).isEmpty();
    }

    // ── Already answered: the one place the two contracts disagree about safety.

    @Test
    @DisplayName("고객 문의 중복 답변(ERR-NC-101010)은 실패가 아니라 확인 대상이다")
    void aDuplicateCustomerAnswerIsVerifiedRatherThanReportedAsAFailure() {
        http.status = 400;
        http.responseBody = "{\"code\":\"ERR-NC-101010\",\"message\":\"이미 답변이 존재합니다\"}";

        // The customer HAS an answer. Calling this a failure would invite the seller to send again.
        assertThat(customerAdapter().publish(command("naver-payinq:322684048")).kind())
                .isEqualTo(ReplyPublishResult.Kind.DELIVERY_UNKNOWN);
    }

    @Test
    @DisplayName("상품 문의에는 중복 방어가 없다 — 그래서 재시도가 아니라 확인으로 간다")
    void anAmbiguousProductQnaSendIsNeverRetried() {
        http.failure = new NaverAnswerTransportAmbiguity();

        // On this endpoint a blind retry is not a duplicate answer: PUT is an upsert, so it would
        // overwrite whatever is there — including an answer a person typed in the NAVER console.
        assertThat(qnaAdapter().publish(command("naver-qna:676568657")).kind())
                .isEqualTo(ReplyPublishResult.Kind.DELIVERY_UNKNOWN);
    }

    @Test
    @DisplayName("계약에 있는 400/403/404는 같은 요청이 다시 거절될 자리다")
    void documentedRefusalsArePermanent() {
        http.status = 403;
        assertThat(qnaAdapter().publish(command("naver-qna:676568657")).kind())
                .isEqualTo(ReplyPublishResult.Kind.PERMANENT_FAILURE);
    }

    @Test
    @DisplayName("만료된 토큰은 다음 발급이 고치는 일시적 실패다")
    void anExpiredTokenIsRetryable() {
        http.status = 401;
        assertThat(qnaAdapter().publish(command("naver-qna:676568657")).kind())
                .isEqualTo(ReplyPublishResult.Kind.RETRYABLE_FAILURE);
    }

    // ── The live interlock.

    @Test
    @DisplayName("승인 ID 없이 실제 호스트로는 한 바이트도 나가지 않는다")
    void aRealHostWithoutAnArmedApprovalSendsNothing() {
        FakeHttp live = new FakeHttp();
        NaverProductQnaAnswerClient armed =
                new NaverProductQnaAnswerClient(live, "https://api.commerce.naver.com", "");

        assertThatThrownBy(() -> armed.postAnswer("TOKEN", "676568657", "답변"))
                .isInstanceOf(NaverAnswerLiveApprovalRequired.class);
        assertThat(live.sent).isEmpty();
    }

    @Test
    @DisplayName("빈 base URL은 네이버의 거절이 아니라 배포 상태다 — 아무것도 보내지 않는다")
    void aBlankBaseUrlIsADeploymentFactNotARefusal() {
        FakeHttp unconfigured = new FakeHttp();
        assertThat(new NaverCustomerInquiryAnswerClient(unconfigured, "", "")
                .postAnswer("TOKEN", "1", "답변").kind())
                .isEqualTo(NaverAnswerOutcome.Kind.RETRYABLE);
        assertThat(unconfigured.sent).isEmpty();
    }

    // ── The fence that did not move.

    @Test
    @DisplayName("답변 경로는 connector 패키지 밖에 있다 — 수집 lane은 여전히 읽기 전용이다")
    void theAnswerPathLivesOutsideTheReadOnlyConnector() throws IOException {
        Path connector = Paths.get("src/main/java/com/sellerops/connector/naver");
        List<String> offenders = new ArrayList<>();
        try (Stream<Path> walk = Files.walk(connector)) {
            for (Path source : walk.filter(p -> p.toString().endsWith(".java")).toList()) {
                String code = Files.readString(source);
                for (String marker : List.of("commentContent", "answerComment", "pay-merchant",
                        "putJson", "NaverAnswerHttpClient")) {
                    if (code.contains(marker)) {
                        offenders.add(source.getFileName() + " → " + marker);
                    }
                }
            }
        }
        // Routine collection runs on a SCHEDULE — a standing grant to call NAVER with no human in the
        // turn. The guarantee that such a lane cannot write is the fact that the writing code is not
        // in it.
        assertThat(offenders).isEmpty();
    }
}
