package com.sellerops.attention;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.tuple;

import com.sellerops.attention.dto.AttentionSignal;
import com.sellerops.attention.dto.OperatorAttentionSummary;
import com.sellerops.attention.source.Cafe24VocItemSource;
import com.sellerops.attention.source.VocItemSourceRegistry;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.common.ApiException;
import com.sellerops.community.Cafe24CommunityArticle;
import com.sellerops.community.Cafe24CommunityArticleRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * The channel-generic attention layer over collected community articles: exact
 * window-scoped counts become ranked, metadata-only signals — over a real (H2) DB.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class OperatorAttentionServiceTest {

    @Autowired SellerAccountRepository sellerAccounts;
    @Autowired ChannelRepository channels;
    @Autowired Cafe24CommunityArticleRepository articles;

    private OperatorAttentionService service;
    private final UUID org = UUID.randomUUID();
    private long nextArticleNo = 2000L;

    private static final LocalDate FROM = LocalDate.parse("2026-05-01");
    private static final LocalDate TO = LocalDate.parse("2026-05-31");

    @BeforeEach
    void setUp() {
        service = new OperatorAttentionService(sellerAccounts, channels,
                new VocItemSourceRegistry(List.of(new Cafe24VocItemSource(articles))));
    }

    @Test
    void buildsRankedSignalsFromWindowScopedCounts() {
        Fixture f = seedChannelAndAccount();

        // Reviews: 1★ + 2★ (low), 3★ (mid), 5★ (just "new"); one out-of-window.
        article(f, "REVIEW", "2026-05-05T12:00:00+09:00", "UNKNOWN", 1);
        article(f, "REVIEW", "2026-05-06T12:00:00+09:00", "UNKNOWN", 2);
        article(f, "REVIEW", "2026-05-07T12:00:00+09:00", "UNKNOWN", 3);
        article(f, "REVIEW", "2026-05-08T12:00:00+09:00", "UNKNOWN", 5);
        article(f, "REVIEW", "2026-04-01T12:00:00+09:00", "UNKNOWN", 1);   // before window
        // Inquiries: PENDING (unanswered), UNKNOWN reply, ANSWERED (neither flag).
        article(f, "PRODUCT_INQUIRY", "2026-05-10T12:00:00+09:00", "PENDING", null);
        article(f, "PRODUCT_INQUIRY", "2026-05-11T12:00:00+09:00", "UNKNOWN", null);
        article(f, "PRODUCT_INQUIRY", "2026-05-12T12:00:00+09:00", "ANSWERED", null);

        OperatorAttentionSummary s = service.attention(org, f.accountId, FROM, TO);

        assertThat(s.sellerAccountId()).isEqualTo(f.accountId);
        assertThat(s.channel()).isEqualTo("카페24");
        assertThat(s.fromDate()).isEqualTo(FROM);
        assertThat(s.toDate()).isEqualTo(TO);

        // newReviews=4, newInquiries=3, unanswered=1, unknownReply=1, low(1-2)=2, mid(3)=1.
        assertThat(s.items()).extracting(AttentionSignal::type, AttentionSignal::severity, AttentionSignal::count)
                .containsExactly(
                        tuple("UNANSWERED_INQUIRY", "HIGH", 1L),
                        tuple("LOW_RATING_REVIEW", "HIGH", 2L),
                        tuple("LOW_RATING_REVIEW", "MEDIUM", 1L),
                        tuple("NEW_INQUIRY", "MEDIUM", 3L),
                        tuple("UNKNOWN_REPLY_STATUS", "MEDIUM", 1L),
                        tuple("NEW_REVIEW", "LOW", 4L));
    }

    @Test
    void unratedReviewsNeverEnterLowOrMidRatingSignals() {
        Fixture f = seedChannelAndAccount();
        article(f, "REVIEW", "2026-05-05T12:00:00+09:00", "UNKNOWN", null);   // no rating

        OperatorAttentionSummary s = service.attention(org, f.accountId, FROM, TO);

        // Only NEW_REVIEW (count 1); no LOW_RATING_REVIEW because rating is null.
        assertThat(s.items()).extracting(AttentionSignal::type).containsExactly("NEW_REVIEW");
    }

    @Test
    void unknownDateRowsAreExcludedFromCounts() {
        Fixture f = seedChannelAndAccount();
        articleUnknownDate(f, "PRODUCT_INQUIRY", "PENDING");   // no source date → out of window

        OperatorAttentionSummary s = service.attention(org, f.accountId, FROM, TO);

        assertThat(s.items()).isEmpty();
    }

    @Test
    void emptyAccountYieldsEmptySummary() {
        Fixture f = seedChannelAndAccount();
        OperatorAttentionSummary s = service.attention(org, f.accountId, FROM, TO);
        assertThat(s.items()).isEmpty();
        assertThat(s.fromDate()).isEqualTo(FROM);
        assertThat(s.toDate()).isEqualTo(TO);
    }

    @Test
    void rejectsAnInvertedWindow() {
        Fixture f = seedChannelAndAccount();
        assertThatThrownBy(() -> service.attention(org, f.accountId, TO, FROM))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void rejectsAMissingBound() {
        Fixture f = seedChannelAndAccount();
        assertThatThrownBy(() -> service.attention(org, f.accountId, null, TO))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void isOrgScopedSoACrossOrgAccountReadsAsNotFound() {
        Fixture f = seedChannelAndAccount();
        assertThatThrownBy(() -> service.attention(UUID.randomUUID(), f.accountId, FROM, TO))
                .isInstanceOf(ApiException.class);
    }

    // --- fixtures ------------------------------------------------------------

    private record Fixture(UUID channelId, UUID accountId) {
    }

    private Fixture seedChannelAndAccount() {
        Channel ch = new Channel();
        ch.setCode("CAFE24");
        ch.setNameKo("카페24");
        ch.setStatus(ChannelStatus.CONNECTED);
        ch.setSupportsInquiry(true);
        ch.setSupportsReview(true);
        ch.setSupportsOrder(true);
        ch.setSupportsSales(true);
        ch.setSupportsProduct(true);
        ch.setSortOrder(0);
        channels.save(ch);

        SellerAccount acc = new SellerAccount();
        acc.setOrgId(org);
        acc.setChannelId(ch.getId());
        acc.setConnectionStatus(ChannelStatus.CONNECTED);
        acc.setFileUpload(false);
        sellerAccounts.save(acc);
        return new Fixture(ch.getId(), acc.getId());
    }

    private void article(Fixture f, String sourceKind, String sourceCreatedAt, String replyStatus, Integer rating) {
        saveArticle(f, sourceKind, OffsetDateTime.parse(sourceCreatedAt).toInstant(), replyStatus, rating);
    }

    private void articleUnknownDate(Fixture f, String sourceKind, String replyStatus) {
        saveArticle(f, sourceKind, null, replyStatus, null);
    }

    private void saveArticle(Fixture f, String sourceKind, Instant sourceCreatedAt,
                             String replyStatus, Integer rating) {
        Cafe24CommunityArticle a = new Cafe24CommunityArticle();
        a.setOrgId(org);
        a.setSellerAccountId(f.accountId);
        a.setChannelId(f.channelId);
        a.setBoardNo("REVIEW".equals(sourceKind) ? 4 : 6);
        // Natural key is (channel, account, board, article_no); keep it unique per row.
        a.setArticleNo(nextArticleNo++);
        a.setSourceKind(sourceKind);
        a.setReplyStatus(replyStatus);
        a.setRating(rating);
        a.setSourceCreatedAt(sourceCreatedAt);
        a.setSourceHash("h-" + a.getArticleNo());
        a.setCollectedAt(Instant.parse("2026-05-25T00:00:00Z"));
        articles.save(a);
    }
}
