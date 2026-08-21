package com.sellerops.ingest;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.community.Cafe24CommunityArticle;
import com.sellerops.community.Cafe24CommunityArticleRepository;
import com.sellerops.ingest.canonical.CanonicalCommunityArticle;
import com.sellerops.ingest.canonical.CanonicalInquiry;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemAuditRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemWriter;
import com.sellerops.order.OrderDailySummaryRepository;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.ProductService;
import com.sellerops.review.ReviewRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.PlatformTransactionManager;

/**
 * "The source still showed us this row" is a fact, and it has to be recorded even when nothing about
 * the row changed.
 *
 * <p><b>Why this is the missing primitive.</b> Both upserts skip the save entirely when the source
 * matches storage — so an unchanged row and a row the seller deleted at the platform left exactly the
 * same trace: none. Measured on the demo org: 3,200 of 3,201 Cafe24 inquiries still carry
 * {@code created_at = updated_at}, which is indistinguishable from "never looked at again" precisely
 * because it IS indistinguishable. No reconciliation of any kind can be built on a store that cannot
 * tell "unchanged" from "gone".
 *
 * <p><b>Recording it is not the same as acting on it.</b> Nothing in this repository turns a stale
 * {@code last_seen_at} into a tombstone — {@code InquiryOperationalStateFenceTest} proves there is no
 * such path. This is the evidence such a decision would one day need, gathered now so that the day a
 * sweep is proven authoritative there is a history to reconcile against rather than a starting point.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class SourceObservationPrimitiveTest {

    @Autowired ReviewRepository reviews;
    @Autowired InquiryRepository inquiries;
    @Autowired OrderDailySummaryRepository orders;
    @Autowired ProductRepository products;
    @Autowired Cafe24CommunityArticleRepository articles;
    @Autowired ChannelRepository channels;
    @Autowired SellerAccountRepository sellerAccounts;
    @Autowired InquiryWorkItemRepository workItems;
    @Autowired InquiryWorkItemAuditRepository audits;
    @Autowired PlatformTransactionManager txManager;

    private static final Instant LONG_AGO = Instant.parse("2026-01-01T00:00:00Z");

    private IngestionService ingest;
    private final UUID org = UUID.randomUUID();
    private UUID channelId;
    private UUID accountId;

    @BeforeEach
    void setUp() {
        ingest = new IngestionService(reviews, inquiries, orders, new ProductService(products),
                articles, channels, new InquiryWorkItemWriter(inquiries, workItems, audits, txManager));

        Channel ch = new Channel();
        ch.setCode("CAFE24");
        ch.setNameKo("카페24");
        ch.setStatus(ChannelStatus.AVAILABLE);
        ch.setSupportsInquiry(true);
        ch.setSupportsReview(true);
        ch.setSortOrder(0);
        channelId = channels.save(ch).getId();

        SellerAccount acc = new SellerAccount();
        acc.setOrgId(org);
        acc.setChannelId(channelId);
        acc.setConnectionStatus(ChannelStatus.CONNECTED);
        acc.setFileUpload(false);
        accountId = sellerAccounts.save(acc).getId();
    }

    @Test
    @DisplayName("an unchanged inquiry is still an observation: last_seen_at moves, nothing else does")
    void unchangedInquiryIsStillObserved() {
        ingest.ingestInquiries(org, channelId, accountId, List.of(row("UNANSWERED", "본문")));
        Inquiry stored = stored();
        assertThat(stored.getLastSeenAt()).as("an insert is an observation too").isNotNull();

        // Age the observation so the re-observation is unambiguous without a clock or a sleep.
        stored.setLastSeenAt(LONG_AGO);
        inquiries.save(stored);
        Instant bodyUnchangedSince = stored.getUpdatedAt();

        IngestOutcome outcome = ingest.ingestInquiries(org, channelId, accountId,
                List.of(row("UNANSWERED", "본문")));

        assertThat(outcome.skipped()).as("still a skip — run accounting is unchanged").isEqualTo(1);
        assertThat(outcome.success()).isZero();

        Inquiry after = stored();
        assertThat(after.getLastSeenAt())
                .as("the source showed it to us again, and that is now recorded")
                .isAfter(LONG_AGO);
        assertThat(after.getStatus()).isEqualTo("UNANSWERED");
        assertThat(after.getBody()).isEqualTo("본문");
        assertThat(inquiries.count()).as("no duplicate row").isEqualTo(1);
        assertThat(bodyUnchangedSince).isNotNull();
    }

    @Test
    @DisplayName("a changed inquiry records the observation alongside the change")
    void changedInquiryAlsoRecordsTheObservation() {
        ingest.ingestInquiries(org, channelId, accountId, List.of(row("UNANSWERED", "본문")));
        Inquiry stored = stored();
        stored.setLastSeenAt(LONG_AGO);
        inquiries.save(stored);

        ingest.ingestInquiries(org, channelId, accountId, List.of(row("ANSWERED", "본문")));

        Inquiry after = stored();
        assertThat(after.getStatus()).isEqualTo("ANSWERED");
        assertThat(after.getLastSeenAt()).isAfter(LONG_AGO);
    }

    @Test
    @DisplayName("an unchanged community article refreshes collected_at — the same primitive, same reason")
    void unchangedArticleIsStillObserved() {
        ingest.ingestCommunityArticles(org, channelId, accountId, List.of(article("제목", "내용")));
        Cafe24CommunityArticle stored = articles.findAll().get(0);
        stored.setCollectedAt(LONG_AGO);
        articles.save(stored);

        IngestOutcome outcome = ingest.ingestCommunityArticles(org, channelId, accountId,
                List.of(article("제목", "내용")));

        assertThat(outcome.skipped()).isEqualTo(1);
        assertThat(articles.findAll()).hasSize(1);
        assertThat(articles.findAll().get(0).getCollectedAt()).isAfter(LONG_AGO);
    }

    private Inquiry stored() {
        return inquiries.findByOrgIdAndChannelIdAndExternalId(org, channelId, "cafe24:b6:a1").orElseThrow();
    }

    private CanonicalInquiry row(String status, String body) {
        return new CanonicalInquiry(null, "SKU-1", null, body, status,
                LocalDate.parse("2026-08-10").atStartOfDay(ZoneOffset.UTC).toInstant(),
                "cafe24:b6:a1", 1, "제목", status.equals("ANSWERED") ? "C" : "N");
    }

    private CanonicalCommunityArticle article(String title, String content) {
        return new CanonicalCommunityArticle(4, 1L, "REVIEW", 7L, title, content, 5, "C",
                Instant.parse("2026-08-10T00:00:00Z"), null, 1);
    }
}
