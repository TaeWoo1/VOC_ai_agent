package com.sellerops.connector.cafe24;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.ingest.canonical.CanonicalInquiry;
import com.sellerops.ingest.canonical.SourceThreadRole;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/**
 * The COMMENT answer lane — the second way a Cafe24 board-6 문의 is already answered.
 *
 * <p>Grounded in a measured event: on 2026-08-26 the shop answered article 3674 by comment
 * ({@code member_id == mall_id}, 14:56 KST). No child article appeared, {@code reply_status} stayed
 * {@code N}, and the routine sweep re-read the article at 17:43 and still stored 미답변. Approved
 * bounded READ {@code apr-c24-a3674-obs}, verdict {@code STANDARD_BOARD_COMMENT}, WRITE 0.
 *
 * <p>The tests are grouped by the claim each one defends, because the whole risk of this lane is
 * that a claim gets one notch stronger than the evidence: "a comment exists" is not "the shop
 * answered", and "the shop answered" is not "here is what the shop said".
 */
class Cafe24CommentAnswerTest {

    private static final Instant ANSWERED_AT = Instant.parse("2026-08-26T05:56:24Z"); // 14:56 KST

    private static Cafe24BoardArticleRow root(long articleNo, String replyStatus) {
        return new Cafe24BoardArticleRow(articleNo, "연동 테스트", "본문입니다", null, null,
                "2026-08-26T00:13:09+09:00", null, replyStatus, "F", null, null, 0, 1);
    }

    private static Cafe24BoardArticleRow reply(long articleNo, long parentNo) {
        return new Cafe24BoardArticleRow(articleNo, "연동 테스트", "답변입니다", null, null,
                "2026-08-26T00:20:00+09:00", null, "C", "F", null, parentNo, 1, 1);
    }

    // ------------------------------------------------------------------ the actor test

    @Nested
    @DisplayName("who wrote the comment")
    class Actor {

        @Test
        @DisplayName("the shop's own member id is the proof, and it never leaves as a value")
        void theShopIsIdentifiedByIdentity() {
            FakeCafe24HttpClient http = new FakeCafe24HttpClient();
            http.enqueue(new Cafe24HttpClient.Response(200, """
                    {"comments":[{"comment_no":39,"article_no":3674,"parent_comment_no":0,
                      "created_date":"2026-08-26T14:56:24+09:00","content":"확인했습니다",
                      "writer":"선바로","member_id":"sunbaro","client_ip":"1.2.3.4"}]}""", Map.of()));

            List<Cafe24BoardCommentRow> rows =
                    new Cafe24BoardCommentsClient(http).fetchComments("tok", "sunbaro", 6, 3674L);

            assertThat(rows).hasSize(1);
            assertThat(rows.get(0).authoredByMall()).isTrue();
            assertThat(rows.get(0).toString())
                    .as("the comparison travels; the id, the words and the writer do not")
                    .doesNotContain("sunbaro").doesNotContain("확인했습니다")
                    .doesNotContain("선바로").doesNotContain("1.2.3.4");
        }

        @Test
        @DisplayName("a customer's comment is not an answer")
        void aCustomerCommentIsNotAnAnswer() {
            FakeCafe24HttpClient http = new FakeCafe24HttpClient();
            http.enqueue(new Cafe24HttpClient.Response(200, """
                    {"comments":[{"comment_no":40,"article_no":3674,
                      "created_date":"2026-08-26T15:00:00+09:00","content":"저도 궁금해요",
                      "member_id":"buyer01"}]}""", Map.of()));

            assertThat(new Cafe24BoardCommentsClient(http)
                    .fetchComments("tok", "sunbaro", 6, 3674L).get(0).authoredByMall()).isFalse();
        }

        @Test
        @DisplayName("an unknown author fails closed — never read as the shop")
        void anUnknownAuthorIsNotTheShop() {
            assertThat(Cafe24BoardCommentsClient.authoredByMall(null, "sunbaro")).isFalse();
            assertThat(Cafe24BoardCommentsClient.authoredByMall("", "sunbaro")).isFalse();
            assertThat(Cafe24BoardCommentsClient.authoredByMall("   ", "sunbaro")).isFalse();
            assertThat(Cafe24BoardCommentsClient.authoredByMall("sunbaro", null)).isFalse();
            assertThat(Cafe24BoardCommentsClient.authoredByMall(" SunBaro ", "sunbaro"))
                    .as("the platform renders the id; case and padding are not another shop").isTrue();
        }
    }

    // ------------------------------------------------------------------ the projection

    @Nested
    @DisplayName("what a proven shop comment does to the inquiry")
    class Projection {

        @Test
        @DisplayName("seller comment → parent ANSWERED, at the comment's own time")
        void aSellerCommentAnswersTheParent() {
            CanonicalInquiry q = Cafe24InquiryArticleMapper
                    .toCanonicalInquiry(6, root(3674L, "N"), 1, ANSWERED_AT);

            assertThat(q.status()).isEqualTo("ANSWERED");
            assertThat(q.answeredAt()).isEqualTo(ANSWERED_AT);
            assertThat(q.informStatus())
                    .as("the channel still says N, and we still record what it said")
                    .isEqualTo("N");
            assertThat(q.answerBody())
                    .as("the fact and its time — not the shop's words")
                    .isNull();
        }

        @Test
        @DisplayName("no proven comment → exactly the behaviour that existed before this lane")
        void withoutAProvenCommentNothingChanges() {
            CanonicalInquiry withNull = Cafe24InquiryArticleMapper
                    .toCanonicalInquiry(6, root(3674L, "N"), 1, null);
            CanonicalInquiry legacy = Cafe24InquiryArticleMapper
                    .toCanonicalInquiry(6, root(3674L, "N"), 1);

            assertThat(withNull.status()).isEqualTo("UNANSWERED");
            assertThat(withNull.answeredAt()).isNull();
            assertThat(legacy.status()).isEqualTo(withNull.status());
            assertThat(legacy.answeredAt()).isNull();
        }

        @Test
        @DisplayName("the reply-article contract is untouched: C still answers, on its own")
        void theReplyArticleContractIsUnchanged() {
            CanonicalInquiry q = Cafe24InquiryArticleMapper
                    .toCanonicalInquiry(6, root(3672L, "C"), 1, null);

            assertThat(q.status()).isEqualTo("ANSWERED");
            assertThat(q.informStatus()).isEqualTo("C");
            assertThat(q.answeredAt()).as("C says answered, not when").isNull();
        }

        @Test
        @DisplayName("a thread REPLY is never marked answered by a comment")
        void aThreadReplyIsNotAQuestion() {
            CanonicalInquiry q = Cafe24InquiryArticleMapper
                    .toCanonicalInquiry(6, reply(3673L, 3672L), 1, ANSWERED_AT);

            assertThat(q.threadRole()).isEqualTo(SourceThreadRole.REPLY);
            assertThat(q.answeredAt())
                    .as("a REPLY is not a customer waiting; a comment on it closes nothing")
                    .isNull();
        }
    }

    // ------------------------------------------------------------------ the bounded observation

    @Nested
    @DisplayName("how many requests the lane may spend, and on what")
    class Observation {

        private final FakeCafe24HttpClient http = new FakeCafe24HttpClient();
        private final Cafe24InquiryAnswerObserver observer = new Cafe24InquiryAnswerObserver(
                new Cafe24BoardArticlesClient(http), new Cafe24BoardCommentsClient(http));

        private Map<Long, Instant> observe(Set<Long> candidates) {
            return observer.observe("tok", "sunbaro", 6,
                    LocalDate.parse("2026-08-12"), LocalDate.parse("2026-08-26"), candidates);
        }

        @Test
        @DisplayName("no candidates → not one request, discovery included")
        void nothingToAskAboutCostsNothing() {
            assertThat(observe(Set.of())).isEmpty();
            assertThat(http.sent).isEmpty();
        }

        @Test
        @DisplayName("one discovery request narrows the window, then one read per commented article")
        void discoveryBoundsTheFanOut() {
            http.enqueue(ok("""
                    {"articles":[{"article_no":3674},{"article_no":3600}]}"""));
            http.enqueue(ok("""
                    {"comments":[{"comment_no":39,"article_no":3674,
                      "created_date":"2026-08-26T14:56:24+09:00","member_id":"sunbaro"}]}"""));

            Map<Long, Instant> answered = observe(Set.of(3674L, 3675L));

            assertThat(answered).containsOnlyKeys(3674L);
            assertThat(answered.get(3674L)).isEqualTo(ANSWERED_AT);
            assertThat(http.sent).as("discovery + one read — 3600 is not a candidate").hasSize(2);
            assertThat(http.sent.get(0).uri().getQuery())
                    .contains("comment=T").contains("start_date=2026-08-12");
            assertThat(http.sent.get(1).uri().getPath())
                    .isEqualTo("/api/v2/admin/boards/6/articles/3674/comments");
        }

        @Test
        @DisplayName("a comment on an article we did not ask about changes nothing")
        void anUnrelatedCommentedArticleIsNeverRead() {
            http.enqueue(ok("{\"articles\":[{\"article_no\":3600}]}"));

            assertThat(observe(Set.of(3674L))).isEmpty();
            assertThat(http.sent).as("discovery only — no comment read is spent").hasSize(1);
        }

        @Test
        @DisplayName("a customer-only comment thread leaves the article unanswered")
        void customerCommentsDoNotAnswer() {
            http.enqueue(ok("{\"articles\":[{\"article_no\":3674}]}"));
            http.enqueue(ok("""
                    {"comments":[{"comment_no":40,"article_no":3674,
                      "created_date":"2026-08-26T15:00:00+09:00","member_id":"buyer01"}]}"""));

            assertThat(observe(Set.of(3674L))).isEmpty();
        }

        @Test
        @DisplayName("a proven author with an unusable time states nothing")
        void aTimeItCannotReadIsNotAnAnswer() {
            http.enqueue(ok("{\"articles\":[{\"article_no\":3674}]}"));
            http.enqueue(ok("""
                    {"comments":[{"comment_no":39,"article_no":3674,
                      "created_date":"2026-08-26 14:56:24","member_id":"sunbaro"}]}"""));

            assertThat(observe(Set.of(3674L)))
                    .as("offset-less timestamps stay unknown here as everywhere else").isEmpty();
        }

        @Test
        @DisplayName("the earliest shop comment is the answer time")
        void theEarliestShopCommentWins() {
            http.enqueue(ok("{\"articles\":[{\"article_no\":3674}]}"));
            http.enqueue(ok("""
                    {"comments":[
                      {"comment_no":41,"article_no":3674,
                       "created_date":"2026-08-26T18:00:00+09:00","member_id":"sunbaro"},
                      {"comment_no":39,"article_no":3674,
                       "created_date":"2026-08-26T14:56:24+09:00","member_id":"sunbaro"}]}"""));

            assertThat(observe(Set.of(3674L)).get(3674L)).isEqualTo(ANSWERED_AT);
        }

        @Test
        @DisplayName("a rate limit loses the lane, never the page")
        void aRateLimitIsSurvivable() {
            http.enqueue(FakeCafe24HttpClient.rateLimited429("1"));

            assertThat(observe(Set.of(3674L))).isEmpty();
        }

        private static Cafe24HttpClient.Response ok(String body) {
            return new Cafe24HttpClient.Response(200, body, Map.of());
        }
    }

    // ------------------------------------------------------------------ the fence

    @Nested
    @DisplayName("the lane is READ")
    class Fence {

        @Test
        @DisplayName("no write verb is spelled in the comment lane")
        void theCommentLaneCannotWrite() throws Exception {
            for (String file : new String[] {"Cafe24BoardCommentsClient.java",
                    "Cafe24BoardCommentRow.java", "Cafe24InquiryAnswerObserver.java"}) {
                String code = Files.readString(Path.of(
                                "src/main/java/com/sellerops/connector/cafe24/" + file))
                        .replaceAll("(?s)/\\*.*?\\*/", "").replaceAll("(?m)//.*$", "");
                assertThat(code).doesNotContain("postJson").doesNotContain("postForm")
                        .doesNotContain("http.post").doesNotContain("DELETE");
            }
        }

        @Test
        @DisplayName("member_id is bound once, privately, and no public record can hold it")
        void theMemberIdCannotEscape() throws Exception {
            String code = Files.readString(Path.of(
                    "src/main/java/com/sellerops/connector/cafe24/Cafe24BoardCommentsClient.java"));
            String stripped = code.replaceAll("(?s)/\\*.*?\\*/", "").replaceAll("(?m)//.*$", "");
            assertThat(stripped.split("member_id", -1).length - 1).isEqualTo(1);

            String row = Files.readString(Path.of(
                    "src/main/java/com/sellerops/connector/cafe24/Cafe24BoardCommentRow.java"))
                    .replaceAll("(?s)/\\*.*?\\*/", "");
            assertThat(row).doesNotContain("memberId").doesNotContain("member_id")
                    .doesNotContain("content").doesNotContain("writer");
        }

        @Test
        @DisplayName("the target of a comment read is always exactly one article")
        void theUriIsArticleScoped() {
            assertThat(Cafe24BoardCommentsClient.commentsUri("sunbaro", 6, 3674L).toString())
                    .isEqualTo("https://sunbaro.cafe24api.com"
                            + "/api/v2/admin/boards/6/articles/3674/comments");
            assertThatThrownBy(() -> Cafe24BoardCommentsClient.commentsUri("sunbaro", 6, 0L))
                    .isInstanceOf(IllegalStateException.class);
            assertThatThrownBy(() -> Cafe24BoardCommentsClient.commentsUri("BAD_MALL", 6, 1L))
                    .isInstanceOf(IllegalStateException.class);
        }
    }
}
