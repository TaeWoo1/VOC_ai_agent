package com.sellerops.inquiry.publish.cafe24;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.connector.cafe24.Cafe24Authorizer;
import com.sellerops.connector.cafe24.Cafe24BoardArticleRow;
import com.sellerops.connector.cafe24.Cafe24BoardArticlesClient;
import com.sellerops.connector.cafe24.Cafe24HttpClient;
import com.sellerops.connector.cafe24.Cafe24ReplyArticleClient;
import com.sellerops.connector.cafe24.Cafe24WriteApprovalRequired;
import com.sellerops.inquiry.publish.ReplyPublishCommand;
import com.sellerops.inquiry.publish.ReplyPublishResult;
import com.sellerops.inquiry.publish.ReplyVerificationResult;
import java.net.URI;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * What the Cafe24 answer path does and refuses to do, proven without a network.
 *
 * <p>The transport is a stub whose {@code postJson} records every call, so "exactly one POST" and
 * "no POST at all" are both assertable facts rather than intentions.
 */
class Cafe24ReplyAdapterOfflineTest {

    private static final UUID ORG = UUID.randomUUID();
    private static final UUID ACCOUNT = UUID.randomUUID();
    private static final UUID CHANNEL = UUID.randomUUID();
    private static final String MALL = "demoshop";
    private static final String DRAFT = "안녕하세요, 세금계산서는 발행 가능합니다.";
    private static final java.time.LocalDate DAY = java.time.LocalDate.of(2026, 8, 25);

    /** Records writes and reads; answers reads from a canned board. */
    private static final class StubHttp implements Cafe24HttpClient {
        final List<String> writes = new ArrayList<>();
        final List<URI> writeUris = new ArrayList<>();
        final List<URI> reads = new ArrayList<>();
        int writeStatus = 201;
        String writeBody = "{\"articles\":[{\"article_no\":901}]}";
        String readBody = "{\"articles\":[]}";
        final List<String> readBodies = new ArrayList<>();
        int readCursor;
        RuntimeException writeThrows;

        @Override
        public Response postForm(URI uri, Map<String, String> h, Map<String, String> form) {
            throw new AssertionError("이 경로는 form POST를 쓰지 않는다.");
        }

        @Override
        public Response postJson(URI uri, Map<String, String> h, String body) {
            writes.add(body);
            writeUris.add(uri);
            if (writeThrows != null) {
                throw writeThrows;
            }
            return new Response(writeStatus, writeBody, Map.of());
        }

        @Override
        public Response get(URI uri, Map<String, String> h) {
            reads.add(uri);
            if (!readBodies.isEmpty()) {
                return new Response(200,
                        readBodies.get(Math.min(readCursor++, readBodies.size() - 1)), Map.of());
            }
            return new Response(200, readBody, Map.of());
        }
    }

    private static Cafe24Authorizer authorizer() {
        return new Cafe24Authorizer(null, null, "", "") {
            @Override
            public Authorized authorize(UUID orgId, UUID sellerAccountId) {
                return new Authorized(MALL, "tok");
            }
        };
    }

    private static Cafe24AnswerExecutionGrant grant(boolean granted) {
        return new Cafe24AnswerExecutionGrant(null) {
            @Override
            public boolean hasWriteGrant(UUID orgId, UUID sellerAccountId) {
                return granted;
            }
        };
    }

    /**
     * An ARMED adapter — the live-run approval id is present, so these tests exercise the adapter's
     * own rules rather than the approval interlock. The interlock has its own test below, and it is
     * the reason a blank id is the default everywhere else.
     */
    private static Cafe24ChannelReplyAdapter adapter(StubHttp http, boolean granted, String clientIp) {
        return new Cafe24ChannelReplyAdapter(
                new Cafe24ReplyArticleClient(http, "approval-for-this-test"),
                new Cafe24BoardArticlesClient(http), authorizer(), grant(granted), clientIp,
                OBSERVED_SHOP_NO);
    }

    /** The value an approved bounded READ observed on the target article itself — never a default. */
    private static final int OBSERVED_SHOP_NO = 1;

    private static ReplyPublishCommand command(String externalId) {
        return new ReplyPublishCommand(ORG, ACCOUNT, CHANNEL, externalId, Instant.now(),
                "초안 라벨", DRAFT, "세금계산서 발행 문의드립니다");
    }

    // ────────────────────────────────────────────────────────────── target binding

    @Test
    @DisplayName("답글(REPLY) 행의 external id는 대상이 될 수 없다 — 답변에 답하지 않는다")
    void aThreadReplyIsNotATarget() {
        // A reply row's external id is a board article id like any other, so the fence that keeps it
        // out is the caller's ACTIVE/ROOT gate — but a target this adapter cannot even parse never
        // reaches a POST either. Both are asserted: an unparseable id sends nothing.
        StubHttp http = new StubHttp();
        assertThat(adapter(http, true, "203.0.113.10").publish(command("naver:q:12345")).kind())
                .isEqualTo(ReplyPublishResult.Kind.RETRYABLE_FAILURE);
        assertThat(adapter(http, true, "203.0.113.10").publish(command(null)).kind())
                .isEqualTo(ReplyPublishResult.Kind.RETRYABLE_FAILURE);
        assertThat(http.writes).isEmpty();
    }

    @Test
    @DisplayName("대상은 external id가 지목한 바로 그 글이다 — 본문에 부모 번호가 그대로 실린다")
    void theRequestNamesTheApprovedParent() {
        StubHttp http = new StubHttp();
        adapter(http, true, "203.0.113.10").publish(command("cafe24:b6:a246"));

        assertThat(http.writes).hasSize(1);
        assertThat(http.writes.get(0)).contains("\"reply_article_no\":246");
        assertThat(http.writeUris.get(0).getPath())
                .as("board_no는 경로가 나르는 값이다 — 본문이 아니라")
                .isEqualTo("/api/v2/admin/boards/6/articles");
        assertThat(http.writes.get(0)).doesNotContain("\"board_no\"");
    }

    // ────────────────────────────────────────────────────────────── refusals

    @Test
    @DisplayName("쓰기 권한이 없으면 POST가 없다")
    void noWriteGrantNoPost() {
        StubHttp http = new StubHttp();
        ReplyPublishResult result = adapter(http, false, "203.0.113.10").publish(command("cafe24:b6:a246"));

        assertThat(result.kind()).isEqualTo(ReplyPublishResult.Kind.RETRYABLE_FAILURE);
        assertThat(http.writes).as("동의하지 않은 몰에는 요청 자체가 가지 않는다").isEmpty();
    }

    @Test
    @DisplayName("client_ip가 설정되지 않으면 POST가 없다 — 지어내지 않는다")
    void noConfiguredClientIpNoPost() {
        StubHttp http = new StubHttp();
        ReplyPublishResult result = adapter(http, true, "  ").publish(command("cafe24:b6:a246"));

        assertThat(result.kind()).isEqualTo(ReplyPublishResult.Kind.RETRYABLE_FAILURE);
        assertThat(http.writes).isEmpty();
    }

    @Test
    @DisplayName("제목이 계약 상한을 넘으면 자르지 않고 영구 실패로 거절한다")
    void anOverlongTitleIsRefusedNotTruncated() {
        StubHttp http = new StubHttp();
        String tooLong = "가".repeat(Cafe24ReplyArticleClient.TITLE_MAX + 1);
        ReplyPublishResult result = adapter(http, true, "203.0.113.10").publish(
                new ReplyPublishCommand(ORG, ACCOUNT, CHANNEL, "cafe24:b6:a246", Instant.now(),
                        "초안", DRAFT, tooLong));

        assertThat(result.kind()).isEqualTo(ReplyPublishResult.Kind.PERMANENT_FAILURE);
        assertThat(http.writes).isEmpty();
    }

    @Test
    @DisplayName("승인된 라이브 실행 ID가 없으면 실제 호스트에는 한 바이트도 나가지 않는다")
    void aRealHostNeedsAnArmedApproval() {
        StubHttp http = new StubHttp();
        Cafe24ReplyArticleClient unarmed = new Cafe24ReplyArticleClient(http, "");
        assertThatThrownBy(() -> unarmed.post("tok", MALL,
                new Cafe24ReplyArticleClient.ReplyArticle(1, 6, 246L, "제목", DRAFT, MALL, MALL,
                        "203.0.113.10")))
                .isInstanceOf(Cafe24WriteApprovalRequired.class);
        assertThat(http.writes).isEmpty();
    }

    // ────────────────────────────────────────────────────────────── one write, never two

    @Test
    @DisplayName("하나의 승인은 최대 한 번의 POST다 — 타임아웃에도 재전송하지 않는다")
    void oneApprovalIsAtMostOnePost() {
        StubHttp http = new StubHttp();
        http.writeThrows = new IllegalStateException("timeout");
        ReplyPublishResult result = adapter(http, true, "203.0.113.10").publish(command("cafe24:b6:a246"));

        assertThat(result.kind())
                .as("이미 답변 글이 생성됐을 수 있다 — 확인하되 다시 보내지 않는다")
                .isEqualTo(ReplyPublishResult.Kind.DELIVERY_UNKNOWN);
        assertThat(http.writes).hasSize(1);
    }

    @Test
    @DisplayName("5xx는 성공도 실패도 아니다 — 배송 불명으로만 읽는다")
    void aServerErrorIsAmbiguousNotFailed() {
        StubHttp http = new StubHttp();
        http.writeStatus = 502;
        assertThat(adapter(http, true, "203.0.113.10").publish(command("cafe24:b6:a246")).kind())
                .isEqualTo(ReplyPublishResult.Kind.DELIVERY_UNKNOWN);
    }

    @Test
    @DisplayName("권한 만료(401/403)는 아무것도 보내지 못한 것이므로 승인이 소진되지 않는다")
    void anExpiredGrantDoesNotBurnTheApproval() {
        StubHttp http = new StubHttp();
        http.writeStatus = 401;
        assertThat(adapter(http, true, "203.0.113.10").publish(command("cafe24:b6:a246")).kind())
                .isEqualTo(ReplyPublishResult.Kind.RETRYABLE_FAILURE);
    }

    // ────────────────────────────────────────────────────────────── request body

    @Test
    @DisplayName("요청에는 결정된 칸만 실린다 — 담당자ID·비밀글·비밀번호는 없다")
    void theBodyCarriesOnlyTheDecidedFields() {
        StubHttp http = new StubHttp();
        adapter(http, true, "203.0.113.10").publish(command("cafe24:b6:a246"));
        String body = http.writes.get(0);

        assertThat(body)
                .contains("\"title\":\"세금계산서 발행 문의드립니다\"")
                .contains("\"reply_status\":\"C\"")
                .contains("\"member_id\":\"" + MALL + "\"")
                .contains("\"writer\":\"" + MALL + "\"")
                .contains("\"client_ip\":\"203.0.113.10\"");
        assertThat(body)
                .as("의미가 증명되지 않은 칸과 고객 노출을 결정해 버리는 칸은 보내지 않는다")
                .doesNotContain("reply_user_id")
                .doesNotContain("\"secret\"")
                .doesNotContain("password")
                .doesNotContain("order_id");
    }

    @Test
    @DisplayName("본문은 request 봉투 안에 있고, 밖으로 새는 칸은 없다")
    void theRequestIsWrapped() throws Exception {
        // Two live refusals came from this one method. Attempt 1 sent the fields FLAT (400).
        // Attempt 2 wrapped them in a SINGULAR `request` object with `board_no` inside it (422) —
        // but the singular object is PUT's envelope, and `board_no` is a PATH parameter. The
        // reference's own request sample, now transcribed into
        // docs/vendor/cafe24-admin-api/get-boards-articles.md, is `{shop_no, requests:[…]}`.
        StubHttp http = new StubHttp();
        adapter(http, true, "203.0.113.10").publish(command("cafe24:b6:a246"));
        com.fasterxml.jackson.databind.JsonNode root =
                new com.fasterxml.jackson.databind.ObjectMapper().readTree(http.writes.get(0));

        List<String> topLevel = new ArrayList<>();
        root.fieldNames().forEachRemaining(topLevel::add);
        assertThat(topLevel)
                .as("top level is the envelope and nothing else")
                .containsExactlyInAnyOrder("shop_no", "requests");
        assertThat(root.path("shop_no").asInt())
                .as("관측된 값이며 계약 기본값 1을 그대로 채택한 것이 아니다")
                .isEqualTo(OBSERVED_SHOP_NO);

        assertThat(root.path("requests").isArray()).as("복수형 배열 — PUT의 단수 request가 아니다").isTrue();
        assertThat(root.path("requests")).hasSize(1);
        assertThat(root.has("request")).as("singular `request` belongs to PUT").isFalse();

        List<String> inside = new ArrayList<>();
        root.path("requests").get(0).fieldNames().forEachRemaining(inside::add);
        assertThat(inside).containsExactlyInAnyOrder(
                "reply_article_no", "title", "content",
                "writer", "member_id", "client_ip", "reply_status");
        assertThat(inside).as("board_no는 경로에만 있다 — 본문 필드가 아니다").doesNotContain("board_no");
        for (String leaked : List.of("writer", "title", "content", "client_ip",
                "reply_article_no", "member_id", "reply_status", "board_no")) {
            assertThat(root.has(leaked)).as(leaked + " must not sit at the top level").isFalse();
        }
    }

    @Test
    @DisplayName("두 번 거절당한 두 요청 모양은 회귀로 금지된다 — 평평한 본문도, 단수 request도")
    void theTwoRefusedShapesCannotComeBack() throws Exception {
        StubHttp http = new StubHttp();
        adapter(http, true, "203.0.113.10").publish(command("cafe24:b6:a246"));
        String sent = http.writes.get(0);

        com.fasterxml.jackson.databind.JsonNode root =
                new com.fasterxml.jackson.databind.ObjectMapper().readTree(sent);
        assertThat(root.path("writer").isMissingNode())
                .as("attempt 1 (HTTP 400): 필드가 최상위에 평평하게 놓였다")
                .isTrue();
        assertThat(root.path("content").isMissingNode()).isTrue();
        assertThat(root.path("request").isMissingNode())
                .as("attempt 2 (HTTP 422): 단수 request 객체")
                .isTrue();
        assertThat(root.path("requests").get(0).path("board_no").isMissingNode())
                .as("attempt 2 (HTTP 422): 본문 안의 board_no")
                .isTrue();
    }

    @Test
    @DisplayName("전송 직전 구조 검증은 거절당한 두 모양을 이름으로 막는다")
    void thePreSendGuardNamesBothRefusedShapes() {
        Cafe24ReplyArticleClient client = new Cafe24ReplyArticleClient(new StubHttp(), "");

        // attempt 1 (HTTP 400): flat
        assertThatThrownBy(() -> client.assertContractShape(
                "{\"reply_article_no\":3672,\"title\":\"t\",\"content\":\"c\",\"writer\":\"w\","
                        + "\"member_id\":\"m\",\"client_ip\":\"1.2.3.4\",\"reply_status\":\"C\"}"))
                .isInstanceOf(IllegalStateException.class);

        // attempt 2 (HTTP 422): singular `request`, board_no inside
        assertThatThrownBy(() -> client.assertContractShape(
                "{\"request\":{\"board_no\":6,\"reply_article_no\":3672,\"title\":\"t\","
                        + "\"content\":\"c\",\"writer\":\"w\",\"member_id\":\"m\","
                        + "\"client_ip\":\"1.2.3.4\",\"reply_status\":\"C\"}}"))
                .isInstanceOf(IllegalStateException.class);

        // board_no smuggled back into the corrected envelope
        assertThatThrownBy(() -> client.assertContractShape(
                "{\"shop_no\":1,\"requests\":[{\"board_no\":6,\"reply_article_no\":3672,"
                        + "\"title\":\"t\",\"content\":\"c\",\"writer\":\"w\","
                        + "\"member_id\":\"m\",\"client_ip\":\"1.2.3.4\",\"reply_status\":\"C\"}]}"))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    @DisplayName("관측되지 않은 상점 번호는 기본값 1로 채워지지 않고 전송을 막는다")
    void anUnobservedShopStopsTheSend() {
        StubHttp http = new StubHttp();
        Cafe24ChannelReplyAdapter unstated = new Cafe24ChannelReplyAdapter(
                new Cafe24ReplyArticleClient(http, "approval-for-this-test"),
                new Cafe24BoardArticlesClient(http), authorizer(), grant(true), "203.0.113.10", 0);

        ReplyPublishResult result = unstated.publish(command("cafe24:b6:a246"));

        assertThat(result.kind()).isEqualTo(ReplyPublishResult.Kind.RETRYABLE_FAILURE);
        assertThat(http.writes).as("한 바이트도 나가지 않는다").isEmpty();
    }

    @Test
    @DisplayName("제목은 초안의 라벨이 아니라 질문의 제목이다")
    void theTitleIsTheQuestionsNotTheDrafts() {
        StubHttp http = new StubHttp();
        adapter(http, true, "203.0.113.10").publish(command("cafe24:b6:a246"));
        assertThat(http.writes.get(0)).contains("세금계산서 발행 문의드립니다").doesNotContain("초안 라벨");
    }

    @Test
    @DisplayName("보낼 값이 비어 있으면 빈 문자열로 보내지 않고 거절한다")
    void aMissingActorValueIsRefusedNotBlanked() {
        Cafe24ReplyArticleClient client = new Cafe24ReplyArticleClient(new StubHttp(), "");
        assertThatThrownBy(() -> client.body(new Cafe24ReplyArticleClient.ReplyArticle(
                1, 6, 246L, "제목", DRAFT, "", MALL, "203.0.113.10")))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> client.body(new Cafe24ReplyArticleClient.ReplyArticle(
                1, 6, 0L, "제목", DRAFT, MALL, MALL, "203.0.113.10")))
                .isInstanceOf(IllegalStateException.class);
    }

    // ────────────────────────────────────────────────────────────── verification

    private static String board(String... articles) {
        return "{\"articles\":[" + String.join(",", articles) + "]}";
    }

    private static String article(long no, Long parent, Integer depth, String status, String content) {
        return ("{\"article_no\":%d,\"parent_article_no\":%s,\"reply_depth\":%s,"
                + "\"reply_status\":%s,\"content\":%s,\"title\":\"제목\"}")
                .formatted(no, parent == null ? "null" : parent, depth == null ? "null" : depth,
                        status == null ? "null" : "\"" + status + "\"",
                        content == null ? "null" : "\"" + content + "\"");
    }

    private Cafe24ChannelReplyAdapter verifying(StubHttp http) {
        return adapter(http, true, "203.0.113.10");
    }

    @Test
    @DisplayName("Case A — 자식이 맞고 부모가 C면 검증 완료")
    void caseAChildVerifiedAndParentAnswered() {
        StubHttp http = new StubHttp();
        http.readBody = board(article(246L, null, null, "C", "질문"),
                article(901L, 246L, 1, null, DRAFT));
        ReplyVerificationResult r = verifying(http).verifyCreated("tok", MALL,
                new Cafe24ChannelReplyAdapter.Target(6, 246L), 901L, DRAFT, DAY);

        assertThat(r.kind()).isEqualTo(ReplyVerificationResult.Kind.COMPLETED);
        assertThat(r.observedSignal()).isEqualTo("ANSWERED");
    }

    @Test
    @DisplayName("Case B — 답변은 올라갔는데 부모가 여전히 N이면 완료가 아니고, 재전송도 아니다")
    void caseBAnswerPostedButStatusUnresolved() {
        StubHttp http = new StubHttp();
        http.readBody = board(article(246L, null, null, "N", "질문"),
                article(901L, 246L, 1, null, DRAFT));
        ReplyVerificationResult r = verifying(http).verifyCreated("tok", MALL,
                new Cafe24ChannelReplyAdapter.Target(6, 246L), 901L, DRAFT, DAY);

        assertThat(r.kind()).isEqualTo(ReplyVerificationResult.Kind.NOT_COMPLETED);
        assertThat(r.observedSignal()).isEqualTo(Cafe24ChannelReplyAdapter.STATUS_UNRESOLVED);
        assertThat(http.writes).as("상태를 맞추려고 추가 쓰기를 하지 않는다").isEmpty();
    }

    @Test
    @DisplayName("자식의 부모가 승인된 대상이 아니면 검증 실패다")
    void aChildHangingOffSomethingElseFailsVerification() {
        StubHttp http = new StubHttp();
        http.readBody = board(article(246L, null, null, "C", "질문"),
                article(901L, 999L, 1, null, DRAFT));
        assertThat(verifying(http).verifyCreated("tok", MALL,
                new Cafe24ChannelReplyAdapter.Target(6, 246L), 901L, DRAFT, DAY).observedSignal())
                .isEqualTo("DELIVERY_UNKNOWN");
    }

    @Test
    @DisplayName("본문 해시가 승인된 초안과 다르면 검증 실패다")
    void aDifferentBodyFailsVerification() {
        StubHttp http = new StubHttp();
        http.readBody = board(article(246L, null, null, "C", "질문"),
                article(901L, 246L, 1, null, "다른 답변입니다"));
        assertThat(verifying(http).verifyCreated("tok", MALL,
                new Cafe24ChannelReplyAdapter.Target(6, 246L), 901L, DRAFT, DAY).observedSignal())
                .isEqualTo("DELIVERY_UNKNOWN");
    }

    @Test
    @DisplayName("자식을 찾지 못하면 배송 불명 — 성공으로 읽지 않는다")
    void aMissingChildIsDeliveryUnknown() {
        StubHttp http = new StubHttp();
        http.readBody = board(article(246L, null, null, "C", "질문"));
        assertThat(verifying(http).verifyCreated("tok", MALL,
                new Cafe24ChannelReplyAdapter.Target(6, 246L), 901L, DRAFT, DAY).observedSignal())
                .isEqualTo("DELIVERY_UNKNOWN");
    }

    @Test
    @DisplayName("검증은 정확한 두 번호만 묻는다 — 날짜 훑기가 없다")
    void verificationAsksForExactlyTwoNumbers() {
        StubHttp http = new StubHttp();
        http.readBody = board(article(246L, null, null, "C", "질문"),
                article(901L, 246L, 1, null, DRAFT));
        verifying(http).verifyCreated("tok", MALL,
                new Cafe24ChannelReplyAdapter.Target(6, 246L), 901L, DRAFT, DAY);

        assertThat(http.reads).hasSize(1);
        String uri = http.reads.get(0).toString();
        assertThat(uri).contains("246%2C901").doesNotContain("start_date").doesNotContain("end_date");
    }

    @Test
    @DisplayName("생성 번호를 못 받으면 그날 하루만 한 번 더 읽는다 — 훑지 않고, 못 찾으면 배송 불명")
    void withoutACreatedNumberOneBoundedDayIsRead() {
        StubHttp http = new StubHttp();
        // First read (the parent, by number), then the same-day page.
        http.readBodies.add(board(article(246L, null, null, "C", "질문")));
        http.readBodies.add(board(article(902L, 246L, 1, null, DRAFT)));
        ReplyVerificationResult r = verifying(http).verifyCreated("tok", MALL,
                new Cafe24ChannelReplyAdapter.Target(6, 246L), null, DRAFT, DAY);

        assertThat(r.kind()).isEqualTo(ReplyVerificationResult.Kind.COMPLETED);
        assertThat(http.reads).hasSize(2);
        assertThat(http.reads.get(1).toString())
                .contains("start_date=2026-08-25").contains("end_date=2026-08-25")
                .as("하루, 한 페이지 — 기간 훑기가 아니다").contains("offset=0");
    }

    @Test
    @DisplayName("그날 페이지에 남의 답글만 있으면 우리 것으로 착각하지 않는다")
    void aStrangersReplyOnTheSameQuestionIsNotOurs() {
        StubHttp http = new StubHttp();
        http.readBodies.add(board(article(246L, null, null, "C", "질문")));
        http.readBodies.add(board(article(902L, 246L, 1, null, "다른 사람이 쓴 답글")));
        assertThat(verifying(http).verifyCreated("tok", MALL,
                new Cafe24ChannelReplyAdapter.Target(6, 246L), null, DRAFT, DAY).observedSignal())
                .isEqualTo("DELIVERY_UNKNOWN");
    }

    @Test
    @DisplayName("공백 차이는 같은 답변으로, 낱말 차이는 다른 답변으로 읽는다")
    void hashingNormalizesWhitespaceAndNothingElse() {
        assertThat(Cafe24ChannelReplyAdapter.normalizedHash("가  나\n다"))
                .isEqualTo(Cafe24ChannelReplyAdapter.normalizedHash("가 나 다"));
        assertThat(Cafe24ChannelReplyAdapter.normalizedHash("가 나 다"))
                .isNotEqualTo(Cafe24ChannelReplyAdapter.normalizedHash("가 나 라"));
    }

    // ────────────────────────────────────────────────────────────── structural fences

    @Test
    @DisplayName("읽기 전용 전송 구현으로는 쓸 수 없다 — 기본값이 거부다")
    void aReadOnlyTransportCannotWrite() {
        Cafe24HttpClient readOnly = new Cafe24HttpClient() {
            @Override
            public Response postForm(URI uri, Map<String, String> h, Map<String, String> f) {
                throw new AssertionError();
            }

            @Override
            public Response get(URI uri, Map<String, String> h) {
                return new Response(200, "{}", Map.of());
            }
        };
        assertThatThrownBy(() -> readOnly.postJson(URI.create("https://x.test/a"), Map.of(), "{}"))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    @DisplayName("external id 파싱은 카페24 게시판 글만 인정한다")
    void onlyABoardArticleParses() {
        assertThat(Cafe24ChannelReplyAdapter.Target.parse("cafe24:b6:a246"))
                .isEqualTo(new Cafe24ChannelReplyAdapter.Target(6, 246L));
        assertThat(Cafe24ChannelReplyAdapter.Target.parse("cafe24:b6:a0")).isNull();
        assertThat(Cafe24ChannelReplyAdapter.Target.parse("onlineInquiry:246")).isNull();
        assertThat(Cafe24ChannelReplyAdapter.Target.parse("cafe24:b6:a246 ")).isNull();
    }

    @Test
    @DisplayName("Case B는 Answer Memory를 쓰지 않는다 — 기억은 COMPLETED에만 매여 있다")
    void caseBWritesNoMemory() throws Exception {
        // Audited rather than asserted at runtime, because the only writer is a private call the
        // publish core makes at exactly one place. The audit: rememberVerified is reached inside the
        // `if (verified)` branch, and Case B is NOT_COMPLETED, so it cannot reach it.
        //
        // It is a conservative reading and a revisitable one. In Case B the child article IS on the
        // customer's thread with a matching hash, so "the customer can see it" is satisfied; what is
        // not satisfied is the contract EXECUTOR_SENT_VERIFIED actually carries, which is a send this
        // product verified as COMPLETE. Adding a second memory writer for a state that has never once
        // occurred live would be designing a precedent path from a hypothesis.
        String core = java.nio.file.Files.readString(java.nio.file.Path.of(
                "src/main/java/com/sellerops/inquiry/publish/InquiryPublishService.java"));
        int verifiedBranch = core.indexOf("if (verified) {");
        assertThat(verifiedBranch).isPositive();
        int endOfBranch = core.indexOf("executions.save(execution);", verifiedBranch);
        assertThat(core.substring(verifiedBranch, endOfBranch)).contains("rememberVerified(workItem)");
        assertThat(core.indexOf("rememberVerified(workItem)"))
                .as("한 곳에서만 호출된다 — 그리고 그곳은 COMPLETED 분기 안이다")
                .isEqualTo(core.lastIndexOf("rememberVerified(workItem)"));
        assertThat(Cafe24ChannelReplyAdapter.STATUS_UNRESOLVED).isEqualTo("ANSWER_POSTED_STATUS_UNRESOLVED");
    }

    @Test
    @DisplayName("Cafe24BoardArticleRow는 여전히 사람 필드를 투영하지 않는다")
    void theReadRowStillProjectsNoPerson() {
        for (var component : Cafe24BoardArticleRow.class.getRecordComponents()) {
            assertThat(component.getName().toLowerCase())
                    .doesNotContain("writer").doesNotContain("member").doesNotContain("ip")
                    .doesNotContain("email");
        }
    }
}
