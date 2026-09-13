package com.sellerops.ingest;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.connector.cafe24.Cafe24BoardArticleRow;
import com.sellerops.ingest.canonical.CanonicalCommunityArticle;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * <b>Media Presence Projection v1, end to end: vendor JSON → stored review.</b>
 *
 * <p>Every class on the path is the real one — the wire row, the mapper, the article upsert, the
 * promoter — and the only thing standing in for the marketplace is the JSON itself, shaped as the
 * vendored reference documents it and as the approved bounded READ observed it.
 *
 * <p>The three states of {@code media_count_observed} are what this pins, because a count alone
 * cannot express them: an array is a reading, an empty array is a reading of zero, and an absent key
 * is not a reading at all.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class Cafe24MediaPresenceProjectionIT {

    @Autowired ReviewRepository reviews;

    private final ObjectMapper mapper = new ObjectMapper();
    private final UUID org = UUID.randomUUID();
    private final UUID channel = UUID.randomUUID();

    /** One vendor page, mapped exactly as the connector maps it. */
    private List<CanonicalCommunityArticle> page(String articlesJson) throws Exception {
        List<Cafe24BoardArticleRow> rows = List.of(
                mapper.readValue(articlesJson, Cafe24BoardArticleRow[].class));
        List<CanonicalCommunityArticle> out = new ArrayList<>();
        int i = 1;
        for (Cafe24BoardArticleRow row : rows) {
            out.add(new CanonicalCommunityArticle(4, row.articleNo(), "REVIEW", row.productNo(),
                    row.title(), row.content(), row.rating(), row.replyStatus(),
                    Instant.parse("2026-09-01T00:00:00Z"), null, i++, row.attachmentCount()));
        }
        return out;
    }

    private Review promote(CanonicalCommunityArticle article) {
        Cafe24ReviewPromoter promoter = new Cafe24ReviewPromoter(reviews);
        assertThat(promoter.promote(org, channel, article.sourceKind(), article.boardNo(),
                article.articleNo(), article.content(), article.rating(), article.sourceCreatedAt(),
                article.productNo(), article.attachmentCount()))
                .isEqualTo(Cafe24ReviewPromoter.Outcome.PROMOTED);
        return reviews.findAll().stream()
                .filter(r -> org.equals(r.getOrgId()))
                .filter(r -> Cafe24ReviewPromoter.externalId(4, article.articleNo()).equals(r.getExternalId()))
                .findFirst().orElseThrow();
    }

    @Test
    @DisplayName("an article with two attachments becomes a review that observed two")
    void attachmentsBecomeAnObservedCount() throws Exception {
        var articles = page("""
                [{"article_no":9001,"content":"설치 사진 올립니다","rating":5,
                  "attach_file_urls":[{"name":"a.jpg","url":"https://cdn/a.jpg"},
                                      {"name":"b.jpg","url":"https://cdn/b.jpg"}]}]""");

        Review review = promote(articles.get(0));

        assertThat(review.getMediaCount()).isEqualTo(2);
        assertThat(review.isMediaCountObserved()).isTrue();
    }

    @Test
    @DisplayName("an EMPTY array becomes an observed zero — «we looked and there are none»")
    void anEmptyArrayIsAnObservedZero() throws Exception {
        Review review = promote(page("""
                [{"article_no":9002,"content":"잘 쓰고 있습니다","rating":5,"attach_file_urls":[]}]""").get(0));

        assertThat(review.getMediaCount()).isZero();
        assertThat(review.isMediaCountObserved()).isTrue();
    }

    @Test
    @DisplayName("an ABSENT key stays UNKNOWN — the zero is not an answer")
    void anAbsentKeyStaysUnknown() throws Exception {
        Review review = promote(page("""
                [{"article_no":9003,"content":"괜찮네요","rating":4}]""").get(0));

        assertThat(review.getMediaCount()).isZero();
        assertThat(review.isMediaCountObserved())
                .as("a response that did not carry the key has told us nothing")
                .isFalse();
    }

    @Test
    @DisplayName("nothing that names a file is anywhere on the review")
    void noFileNameReachesTheReview() throws Exception {
        Review review = promote(page("""
                [{"article_no":9004,"content":"사진 첨부합니다","rating":5,
                  "attach_file_urls":[{"name":"진짜파일.jpg","url":"https://cdn/진짜파일.jpg"}]}]""").get(0));

        assertThat(review.getMediaCount()).isEqualTo(1);
        assertThat(review.getBody()).isEqualTo("사진 첨부합니다");
        // The whole stored row, rendered: no filename, no URL, no host.
        assertThat(review.toString()).doesNotContain("진짜파일").doesNotContain("cdn").doesNotContain("http");
    }

    @Test
    @DisplayName("re-promoting an already promoted article changes nothing — source facts are INSERT-only")
    void alreadyPromotedArticlesAreNotRetroactivelyObserved() throws Exception {
        // Promoted before the projection existed: no count, unobserved.
        Review first = promote(page("""
                [{"article_no":9005,"content":"예전 리뷰","rating":3}]""").get(0));
        assertThat(first.isMediaCountObserved()).isFalse();

        // The same article read again, now carrying an attachment. The review is untouched: this is
        // the invariant that keeps the 134 already-promoted Cafe24 reviews out of a retroactive claim.
        var again = page("""
                [{"article_no":9005,"content":"예전 리뷰","rating":3,
                  "attach_file_urls":[{"name":"c.jpg","url":"https://cdn/c.jpg"}]}]""").get(0);
        Cafe24ReviewPromoter promoter = new Cafe24ReviewPromoter(reviews);
        assertThat(promoter.promote(org, channel, again.sourceKind(), again.boardNo(), again.articleNo(),
                again.content(), again.rating(), again.sourceCreatedAt(), again.productNo(),
                again.attachmentCount()))
                .isEqualTo(Cafe24ReviewPromoter.Outcome.ALREADY_PRESENT);

        Review after = reviews.findById(first.getId()).orElseThrow();
        assertThat(after.getMediaCount()).isZero();
        assertThat(after.isMediaCountObserved()).isFalse();
    }
}
