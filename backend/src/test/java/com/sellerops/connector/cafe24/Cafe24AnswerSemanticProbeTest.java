package com.sellerops.connector.cafe24;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.connector.cafe24.Cafe24AnswerSemanticProbe.ArticleStructure;
import com.sellerops.connector.cafe24.Cafe24AnswerSemanticProbe.CommentStructure;
import com.sellerops.connector.cafe24.Cafe24AnswerSemanticProbe.ProbeResult;
import com.sellerops.connector.cafe24.Cafe24AnswerSemanticProbe.UrgentInquiryStructure;
import com.sellerops.connector.cafe24.Cafe24AnswerSemanticProbe.UrgentReplyStructure;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The answer-semantics probe, against the recording fake — so no test reaches the network.
 *
 * <p>Two things are asserted and they are different things: the SHAPE of each request (a diagnostic
 * that quietly grew a customer-search parameter or a year-wide window would still pass a parsing
 * test), and the fact that a person cannot travel out of the parser.
 */
class Cafe24AnswerSemanticProbeTest {

    private final FakeCafe24HttpClient http = new FakeCafe24HttpClient();
    private final Cafe24AnswerSemanticProbe probe = new Cafe24AnswerSemanticProbe(http);

    @Test
    @DisplayName("R1 reads three articles in one request, by number and nothing else")
    void theTrioIsOneRequest() {
        http.enqueue(ok("""
                {"articles":[
                  {"article_no":246,"parent_article_no":0,"reply_status":"C","reply":"T",
                   "reply_user_id":"manager01","reply_sequence":1,"reply_depth":0,
                   "created_date":"2023-08-24T10:00:00+09:00","title":"문의","content":"내용",
                   "writer":"홍길동","writer_email":"a@b.co","member_id":"buyer01",
                   "client_ip":"1.2.3.4","nick_name":"길동"}]}"""));

        probe.articlesByNumber("tok", "samplemall", 6, List.of(246L, 281L, 248L));

        assertThat(http.sent).hasSize(1);
        URI uri = http.sent.get(0).uri();
        assertThat(uri.getPath()).isEqualTo("/api/v2/admin/boards/6/articles");
        assertThat(uri.getQuery()).contains("article_no=246,281,248").contains("limit=10");
        assertThat(uri.getQuery())
                .as("no keyword, no writer_name search, no member_id — the customer is not searched for")
                .doesNotContain("search").doesNotContain("keyword").doesNotContain("member_id");
    }

    @Test
    @DisplayName("no person survives the parse — only structure and a size class")
    void theProjectionHasNoRoomForAPerson() {
        http.enqueue(ok("""
                {"articles":[
                  {"article_no":246,"parent_article_no":0,"reply_status":"C","reply":"T",
                   "reply_user_id":"manager01","reply_sequence":1,"reply_depth":0,
                   "created_date":"2023-08-24T10:00:00+09:00",
                   "title":"배송 문의드립니다","content":"주문한 상품이 아직 오지 않았습니다",
                   "writer":"홍길동","writer_email":"a@b.co","member_id":"buyer01",
                   "client_ip":"1.2.3.4","phone":"010-1234-5678"}]}"""));

        ProbeResult<List<ArticleStructure>> result =
                probe.articlesByNumber("tok", "samplemall", 6, List.of(246L));

        assertThat(result.ok()).isTrue();
        ArticleStructure row = result.value().get(0);
        assertThat(row.replyStatus()).isEqualTo("C");
        assertThat(row.replyUserIdPresent())
                .as("whether a manager id EXISTS is the finding; the id itself is not projected")
                .isTrue();
        assertThat(row.bodyBucket()).isEqualTo("SHORT");
        assertThat(row.toString())
                .doesNotContain("홍길동").doesNotContain("a@b.co").doesNotContain("buyer01")
                .doesNotContain("1.2.3.4").doesNotContain("010-")
                .doesNotContain("manager01")
                .as("and not the text either — only how much of it there was")
                .doesNotContain("주문한 상품");
    }

    @Test
    @DisplayName("a body is four words, never a quotation")
    void aBodyBecomesASizeClass() {
        assertThat(Cafe24AnswerSemanticProbe.bucket(null)).isEqualTo("NONE");
        assertThat(Cafe24AnswerSemanticProbe.bucket("   ")).isEqualTo("NONE");
        assertThat(Cafe24AnswerSemanticProbe.bucket("네")).isEqualTo("SHORT");
        assertThat(Cafe24AnswerSemanticProbe.bucket("가".repeat(200))).isEqualTo("MEDIUM");
        assertThat(Cafe24AnswerSemanticProbe.bucket("가".repeat(900))).isEqualTo("LONG");
    }

    @Test
    @DisplayName("R2 addresses the comments of exactly one article")
    void commentsAreArticleScoped() {
        http.enqueue(ok("""
                {"comments":[{"comment_no":11,"article_no":246,"parent_comment_no":0,
                  "created_date":"2023-08-25T09:00:00+09:00","content":"확인 후 답변드리겠습니다",
                  "writer":"관리자","member_id":"samplemall"}]}"""));

        ProbeResult<List<CommentStructure>> result = probe.comments("tok", "samplemall", 6, 246L);

        assertThat(http.sent.get(0).uri().toString())
                .isEqualTo("https://samplemall.cafe24api.com/api/v2/admin/boards/6/articles/246/comments");
        assertThat(http.sent.get(0).uri().getQuery()).isNull();
        CommentStructure row = result.value().get(0);
        assertThat(row.commentNo()).isEqualTo(11L);
        assertThat(row.bodyBucket()).isEqualTo("SHORT");
        assertThat(row.toString()).doesNotContain("관리자").doesNotContain("확인 후");
    }

    @Test
    @DisplayName("R3's window is a week, and the contract permits a year")
    void theWindowIsDeliberatelySmall() {
        http.enqueue(ok("{\"articles\":[]}"));

        probe.articlesInWindow("tok", "samplemall", 6,
                LocalDate.parse("2023-08-24"), LocalDate.parse("2023-08-31"), 100);

        String query = http.sent.get(0).uri().getQuery();
        assertThat(query).contains("start_date=2023-08-24").contains("end_date=2023-08-31");
        assertThat(LocalDate.parse("2023-08-31").toEpochDay() - LocalDate.parse("2023-08-24").toEpochDay())
                .isEqualTo(7);
    }

    @Test
    @DisplayName("R4 and R5 address the urgentinquiry resource without a customer parameter")
    void theUrgentPathIsNumericAndDated() {
        http.enqueue(ok("""
                {"reply":[{"article_no":246,"status":"T","user_id":"manager01","count":1,
                  "created_date":"2023-08-25T09:00:00+09:00","method":"E",
                  "content":"안녕하세요 고객님, 오늘 발송 예정입니다."}]}"""));
        http.enqueue(ok("""
                {"urgentinquiry":[{"article_no":246,"article_type":"normal","reply_status":"T",
                  "search_type":"O","start_date":"2023-08-24","writer":"홍길동",
                  "writer_email":"a@b.co","phone":"010-1234-5678"}]}"""));

        ProbeResult<List<UrgentReplyStructure>> reply = probe.urgentReply("tok", "samplemall", 246L);
        ProbeResult<List<UrgentInquiryStructure>> list =
                probe.urgentInquiriesOn("tok", "samplemall", LocalDate.parse("2023-08-24"), 100);

        assertThat(http.sent.get(0).uri().toString())
                .isEqualTo("https://samplemall.cafe24api.com/api/v2/admin/urgentinquiry/246/reply");
        assertThat(http.sent.get(1).uri().getQuery())
                .isEqualTo("start_date=2023-08-24&end_date=2023-08-24&limit=100");
        assertThat(reply.value().get(0).userIdPresent()).isTrue();
        assertThat(reply.value().get(0).bodyBucket()).isEqualTo("SHORT");
        assertThat(reply.value().get(0).toString()).doesNotContain("manager01").doesNotContain("고객님");
        assertThat(list.value().get(0).toString())
                .doesNotContain("홍길동").doesNotContain("a@b.co").doesNotContain("010-");
    }

    @Test
    @DisplayName("404 is an observation, and 401 is a different one")
    void outcomesAreSeparated() {
        http.enqueue(new Cafe24HttpClient.Response(404, "{}", java.util.Map.of()));
        assertThat(probe.urgentReply("tok", "samplemall", 246L).outcome()).isEqualTo("NOT_FOUND");

        http.enqueue(new Cafe24HttpClient.Response(403, "{}", java.util.Map.of()));
        assertThat(probe.urgentReply("tok", "samplemall", 246L).outcome()).isEqualTo("UNAUTHORIZED");
    }

    @Test
    @DisplayName("the verdict refuses both ways it could be wrong")
    void theVerdictRefusesToGuess() {
        assertThat(Cafe24AnswerSemanticProbeRunner.verdict(true, false, false))
                .isEqualTo("STANDARD_BOARD_REPLY_ARTICLE");
        assertThat(Cafe24AnswerSemanticProbeRunner.verdict(false, true, false))
                .isEqualTo("STANDARD_BOARD_COMMENT");
        assertThat(Cafe24AnswerSemanticProbeRunner.verdict(false, false, true))
                .isEqualTo("URGENT_INQUIRY_REPLY");
        assertThat(Cafe24AnswerSemanticProbeRunner.verdict(true, true, false))
                .as("two representations is not a choice between them")
                .isEqualTo("MULTIPLE_REPRESENTATIONS");
        assertThat(Cafe24AnswerSemanticProbeRunner.verdict(false, false, false))
                .as("absence is UNPROVEN — never \"the platform does not support it\"")
                .isEqualTo("UNPROVEN");
    }

    @Test
    @DisplayName("the probe is READ-only and names no customer-search parameter anywhere")
    void theProbeIsReadOnly() throws Exception {
        for (String file : new String[] {"Cafe24AnswerSemanticProbe.java",
                "Cafe24AnswerSemanticProbeRunner.java"}) {
            String source = Files.readString(Path.of(
                    "src/main/java/com/sellerops/connector/cafe24/" + file));
            String code = stripComments(source);
            assertThat(code).doesNotContain("postForm").doesNotContain("http.post");
            for (String forbidden : new String[] {"writer_name", "\"writer\"", "member_id",
                    "buyer_name", "writer_email", "client_ip", "\"keyword\""}) {
                assertThat(code).as("%s must not name %s", file, forbidden)
                        .doesNotContain(forbidden);
            }
        }
    }

    private static String stripComments(String source) {
        return source.replaceAll("(?s)/\\*.*?\\*/", "").replaceAll("(?m)//.*$", "");
    }

    private static Cafe24HttpClient.Response ok(String body) {
        return new Cafe24HttpClient.Response(200, body, java.util.Map.of());
    }
}
