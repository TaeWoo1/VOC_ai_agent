package com.sellerops.connector.cafe24;

import static org.assertj.core.api.Assertions.assertThat;

import java.lang.reflect.RecordComponent;
import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The reply-actor observation, proven offline. No test here reaches a network: the HTTP client is a
 * stub that answers from a canned body, which is also how the sanitization is provable — a body
 * stuffed with names, member ids and addresses goes in, and only counts come out.
 */
class Cafe24ReplyActorProbeTest {

    private static final String MALL = "demoshop";

    /** Records every URI it is asked for and answers from a queue of bodies. */
    private static final class StubHttp implements Cafe24HttpClient {
        private final List<URI> calls = new ArrayList<>();
        private final List<Response> bodies = new ArrayList<>();
        private int cursor;

        StubHttp answering(String... jsonBodies) {
            for (String body : jsonBodies) {
                bodies.add(new Response(200, body, Map.of()));
            }
            return this;
        }

        @Override
        public Response postForm(URI uri, Map<String, String> headers, Map<String, String> form) {
            throw new AssertionError("이 관측은 쓰기를 하지 않는다.");
        }

        @Override
        public Response get(URI uri, Map<String, String> headers) {
            calls.add(uri);
            return bodies.get(Math.min(cursor++, bodies.size() - 1));
        }
    }

    private static String article(long no, Long parent, String status, String replyUserId,
                                  Integer sequence, Integer depth, String created, String title,
                                  String writer, String memberId, String clientIp) {
        return """
                {"article_no":%d,"parent_article_no":%s,"reply_status":%s,"reply_user_id":%s,
                 "reply_sequence":%s,"reply_depth":%s,"created_date":%s,"title":%s,
                 "writer":%s,"member_id":%s,"client_ip":%s,
                 "content":"고객님 안녕하세요 010-1234-5678 로 연락드리겠습니다"}
                """.formatted(no, json(parent), json(status), json(replyUserId), json(sequence),
                json(depth), json(created), json(title), json(writer), json(memberId), json(clientIp));
    }

    private static String json(Object value) {
        if (value == null) {
            return "null";
        }
        return value instanceof Number ? value.toString() : "\"" + value + "\"";
    }

    private static String envelope(String... articles) {
        return "{\"articles\":[" + String.join(",", articles) + "]}";
    }

    /** One question answered by the shop, the shape the live board is expected to produce. */
    private static String shopAnsweredPair() {
        return envelope(
                article(246L, null, "C", "seller-admin", null, null, "2026-06-01T10:00:00+09:00",
                        "배송 언제 오나요", "김구매", "buyer01", "203.0.113.9"),
                article(247L, 246L, null, null, 1, 1, "2026-06-01T14:00:00+09:00",
                        "RE: 배송 언제 오나요", "데모상점", MALL, "198.51.100.7"));
    }

    @Test
    @DisplayName("한 판매자 답변을 읽어 필드 존재만 남긴다 — 값은 하나도 나오지 않는다")
    void reducesOneAnswerToCounts() {
        StubHttp http = new StubHttp().answering(shopAnsweredPair());
        Cafe24ReplyActorProbe.Report r = new Cafe24ReplyActorProbe(http)
                .observe("tok", MALL, 6, List.of(new Cafe24ReplyActorProbe.Target(247L, 246L)), 25, 6);

        assertThat(r.ok()).isTrue();
        assertThat(r.requests()).isEqualTo(1);
        assertThat(r.requested()).isEqualTo(2);
        assertThat(r.returned()).isEqualTo(2);
        assertThat(r.replies()).isEqualTo(1);
        assertThat(r.parents()).isEqualTo(1);
        // The reply carries writer + member_id + client_ip; member_id IS the mall id, which is the
        // documented path to an answer rendered under the shop's name rather than a person's.
        assertThat(r.replyWriterPresent()).isEqualTo(1);
        assertThat(r.replyMemberIdPresent()).isEqualTo(1);
        assertThat(r.replyMemberIdEqualsMallId()).isEqualTo(1);
        assertThat(r.replyClientIpPresent()).isEqualTo(1);
        // The child carries no reply_status; the PARENT is the one marked C.
        assertThat(r.replyStatusPresentOnReply()).isZero();
        assertThat(r.parentReplyStatusC()).isEqualTo(1);
        assertThat(r.replyUserIdPresentOnParent()).isEqualTo(1);
        assertThat(r.replyUserIdPresentOnReply()).isZero();
        assertThat(r.titlePrefixed()).isEqualTo(1);
        assertThat(r.maxReplyDepth()).isEqualTo(1);
        assertThat(r.childCreatedNotBeforeParent()).isEqualTo(1);
    }

    @Test
    @DisplayName("같은 작성자로 쓴 답변 여러 건은 종류 1로 접힌다 — 이름은 해시로만 비교된다")
    void collapsesRepeatedWriterToOneClass() {
        StubHttp http = new StubHttp().answering(envelope(
                article(10L, null, "C", null, null, null, "2026-06-01T09:00:00+09:00", "질문A",
                        "구매자갑", "buyerA", "203.0.113.1"),
                article(11L, 10L, null, null, 1, 1, "2026-06-01T10:00:00+09:00", "RE: 질문A",
                        "데모상점", MALL, "198.51.100.7"),
                article(20L, null, "C", null, null, null, "2026-06-02T09:00:00+09:00", "질문B",
                        "구매자을", "buyerB", "203.0.113.2"),
                article(21L, 20L, null, null, 1, 1, "2026-06-02T10:00:00+09:00", "RE: 질문B",
                        "데모상점", MALL, "198.51.100.7")));
        Cafe24ReplyActorProbe.Report r = new Cafe24ReplyActorProbe(http).observe("tok", MALL, 6,
                List.of(new Cafe24ReplyActorProbe.Target(11L, 10L),
                        new Cafe24ReplyActorProbe.Target(21L, 20L)), 25, 6);

        assertThat(r.replies()).isEqualTo(2);
        assertThat(r.distinctReplyWriterClasses()).isEqualTo(1);
        assertThat(r.distinctReplyMemberIdClasses()).isEqualTo(1);
        assertThat(r.replyMemberIdEqualsMallId()).isEqualTo(2);
        assertThat(r.titlePrefixed()).isEqualTo(2);
    }

    @Test
    @DisplayName("응답에 client_ip가 없으면 0으로 관측된다 — READ가 볼 수 없다는 사실 자체가 결과다")
    void absentClientIpIsAnObservationNotAnError() {
        StubHttp http = new StubHttp().answering(envelope(
                article(30L, null, "C", null, null, null, "2026-06-01T09:00:00+09:00", "질문",
                        "구매자", "buyer", null),
                article(31L, 30L, null, null, 1, 1, "2026-06-01T10:00:00+09:00", "질문",
                        "데모상점", MALL, null)));
        Cafe24ReplyActorProbe.Report r = new Cafe24ReplyActorProbe(http).observe("tok", MALL, 6,
                List.of(new Cafe24ReplyActorProbe.Target(31L, 30L)), 25, 6);

        assertThat(r.ok()).isTrue();
        assertThat(r.replyClientIpPresent()).isZero();
        // Same subject as the parent — a different documented shape from the RE: one.
        assertThat(r.titleSameAsParent()).isEqualTo(1);
    }

    @Test
    @DisplayName("요청 상한을 넘기지 않고, 넘길 상황이면 예산 소진으로 보고한다")
    void stopsAtTheRequestBudget() {
        StubHttp http = new StubHttp().answering(envelope(), envelope(), envelope());
        List<Cafe24ReplyActorProbe.Target> targets = List.of(
                new Cafe24ReplyActorProbe.Target(2L, 1L),
                new Cafe24ReplyActorProbe.Target(4L, 3L),
                new Cafe24ReplyActorProbe.Target(6L, 5L));
        Cafe24ReplyActorProbe.Report r = new Cafe24ReplyActorProbe(http)
                .observe("tok", MALL, 6, targets, 2, 1);

        assertThat(r.requests()).isEqualTo(1);
        assertThat(r.budgetExhausted()).isTrue();
        assertThat(http.calls).hasSize(1);
    }

    @Test
    @DisplayName("인증 실패는 부분 관측을 반환하지 않는다")
    void anAuthFailureEndsTheObservation() {
        Cafe24HttpClient failing = new Cafe24HttpClient() {
            @Override
            public Response postForm(URI uri, Map<String, String> h, Map<String, String> f) {
                throw new AssertionError("이 관측은 쓰기를 하지 않는다.");
            }

            @Override
            public Response get(URI uri, Map<String, String> h) {
                return new Response(401, "{}", Map.of());
            }
        };
        Cafe24ReplyActorProbe.Report r = new Cafe24ReplyActorProbe(failing).observe("tok", MALL, 6,
                List.of(new Cafe24ReplyActorProbe.Target(2L, 1L)), 25, 6);

        assertThat(r.ok()).isFalse();
        assertThat(r.outcome()).isEqualTo("UNAUTHORIZED");
        assertThat(r.replies()).isZero();
    }

    @Test
    @DisplayName("우리 DB가 증명한 번호만 묻는다 — 요청 URI에 다른 article은 없다")
    void asksOnlyAboutTheProvenPair() {
        StubHttp http = new StubHttp().answering(shopAnsweredPair());
        new Cafe24ReplyActorProbe(http).observe("tok", MALL, 6,
                List.of(new Cafe24ReplyActorProbe.Target(247L, 246L)), 25, 6);

        String uri = http.calls.get(0).toString();
        assertThat(uri).contains("/boards/6/articles").contains("article_no=247,246");
        // No window, no discovery: the two parameters that would widen the read are absent.
        assertThat(uri).doesNotContain("start_date").doesNotContain("end_date");
    }

    @Test
    @DisplayName("Report가 셀 수 없는 것을 담을 수 없다 — 모든 필드가 수·플래그·결과어다")
    void theReportCarriesOnlyCounts() {
        for (RecordComponent c : Cafe24ReplyActorProbe.Report.class.getRecordComponents()) {
            if (c.getName().equals("outcome")) {
                continue;
            }
            assertThat(c.getType())
                    .describedAs("Report.%s", c.getName())
                    .isIn(int.class, boolean.class);
        }
    }

    @Test
    @DisplayName("제목 관계는 세 가지뿐이고, 부모 제목이 없으면 판정하지 않는다")
    void titleRelationIsStructural() {
        assertThat(Cafe24ReplyActorProbe.titleRelation("배송 문의", "배송 문의"))
                .isEqualTo(Cafe24ReplyActorProbe.TitleRelation.SAME_AS_PARENT);
        assertThat(Cafe24ReplyActorProbe.titleRelation("RE: 배송 문의", "배송 문의"))
                .isEqualTo(Cafe24ReplyActorProbe.TitleRelation.PREFIXED);
        assertThat(Cafe24ReplyActorProbe.titleRelation("[답변] 배송 문의", "배송 문의"))
                .isEqualTo(Cafe24ReplyActorProbe.TitleRelation.PREFIXED);
        assertThat(Cafe24ReplyActorProbe.titleRelation("안녕하세요", "배송 문의"))
                .isEqualTo(Cafe24ReplyActorProbe.TitleRelation.OTHER);
        assertThat(Cafe24ReplyActorProbe.titleRelation("RE: 배송 문의", null))
                .isEqualTo(Cafe24ReplyActorProbe.TitleRelation.ABSENT);
    }

    @Test
    @DisplayName("external id에서 article 번호를 복원하고, 모양이 아니면 건너뛴다")
    void articleNumbersComeFromStoredIdsOrNotAtAll() {
        assertThat(Cafe24ReplyActorProbeRunner.articleNo("cafe24:b6:a247")).isEqualTo(247L);
        assertThat(Cafe24ReplyActorProbeRunner.articleNo("cafe24:b6:a0")).isNull();
        assertThat(Cafe24ReplyActorProbeRunner.articleNo("naver:q:12345")).isNull();
        assertThat(Cafe24ReplyActorProbeRunner.articleNo(null)).isNull();
    }
}
