package com.sellerops.connector.cafe24;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.community.Cafe24CommunityArticle;
import com.sellerops.community.Cafe24CommunityArticleRepository;
import com.sellerops.connector.DataType;
import com.sellerops.connector.FetchPage;
import com.sellerops.connector.FetchRequest;
import com.sellerops.credential.ConnectorCredentialRepository;
import com.sellerops.credential.CredentialVault;
import com.sellerops.ingest.IngestOutcome;
import com.sellerops.ingest.IngestionService;
import com.sellerops.ingest.canonical.CanonicalCommunityArticle;
import com.sellerops.ingest.canonical.CanonicalInquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemAuditRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemWriter;
import org.springframework.transaction.PlatformTransactionManager;
import com.sellerops.order.OrderDailySummaryRepository;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.ProductService;
import com.sellerops.review.ReviewRepository;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.LocalDate;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * PR D bounded persistence path, end to end over the recording fake + real (H2) DB:
 * the connector fetches a windowed page of board articles and the result is
 * persisted via {@link IngestionService#ingestCommunityArticles} — exactly the path
 * the temporary persistence verifier drives, but with no network. Proves insert,
 * idempotent no-op, in-place update, cursor advance, the REVIEW→4 / INQUIRY→6
 * routing (board 9 never reached), and that the seeded date window reaches the GET.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class Cafe24ArticlePersistenceFlowTest {

    private static final LocalDate START = LocalDate.parse("2026-01-01");
    private static final LocalDate END = LocalDate.parse("2026-06-25");

    @Autowired ReviewRepository reviews;
    @Autowired InquiryRepository inquiries;
    @Autowired OrderDailySummaryRepository orders;
    @Autowired ProductRepository products;
    @Autowired Cafe24CommunityArticleRepository communityArticles;
    @Autowired InquiryWorkItemRepository workItems;
    @Autowired InquiryWorkItemAuditRepository audits;
    @Autowired PlatformTransactionManager txManager;
    @Autowired ChannelRepository channels;
    @Autowired ConnectorCredentialRepository credentials;

    private final UUID org = UUID.randomUUID();
    private final UUID account = UUID.randomUUID();
    private final UUID channel = UUID.randomUUID();
    private final FakeCafe24HttpClient http = new FakeCafe24HttpClient();

    private CredentialVault vault;
    private IngestionService ingestion;
    private Cafe24ApiConnector connector;

    @BeforeEach
    void setUp() {
        byte[] key = new byte[32];
        new SecureRandom().nextBytes(key);
        vault = new CredentialVault(credentials, new ObjectMapper(), Base64.getEncoder().encodeToString(key),
                "local-test-1");
        vault.store(org, account, "API", "OAUTH2",
                Map.of("mall_id", "samplemall", "refresh_token", "old-refresh-token"),
                null, null, null);
        ingestion = new IngestionService(reviews, inquiries, orders, new ProductService(products),
                communityArticles, channels, new InquiryWorkItemWriter(inquiries, workItems, audits, txManager));
        connector = new Cafe24ApiConnector(
                new Cafe24Authorizer(new Cafe24TokenClient(http), vault, "app-client-id", "app-client-secret"),
                new Cafe24OrdersClient(http), new Cafe24BoardArticlesClient(http), Clock.systemUTC());
    }

    /** Drive one bounded pass through the normal path: windowed fetch → ingest. */
    private IngestOutcome runPass(DataType dataType, int boardNo, long articleNo, String content, String reply) {
        http.enqueue(FakeCafe24HttpClient.tokenOk("access-1", "old-refresh-token"));
        http.enqueue(FakeCafe24HttpClient.articlesOk(
                FakeCafe24HttpClient.article(articleNo, "제목", content, 77L, 5, null, reply)));
        String cursor = Cafe24ArticleCursor.window(boardNo, START, END).encode();
        FetchPage page = connector.fetch(new FetchRequest(org, account, "CAFE24", dataType, cursor, 3));
        @SuppressWarnings("unchecked")
        List<CanonicalCommunityArticle> records = (List<CanonicalCommunityArticle>) page.records();
        return ingestion.ingestCommunityArticles(org, channel, account, records);
    }

    /** Drive one bounded REVIEW pass over an explicit page of raw article JSON literals. */
    private IngestOutcome runReviewPass(String... articleJson) {
        http.enqueue(FakeCafe24HttpClient.tokenOk("access-1", "old-refresh-token"));
        http.enqueue(FakeCafe24HttpClient.articlesOk(articleJson));
        String cursor = Cafe24ArticleCursor.window(4, START, END).encode();
        FetchPage page = connector.fetch(new FetchRequest(org, account, "CAFE24", DataType.REVIEW, cursor, 3));
        @SuppressWarnings("unchecked")
        List<CanonicalCommunityArticle> records = (List<CanonicalCommunityArticle>) page.records();
        return ingestion.ingestCommunityArticles(org, channel, account, records);
    }

    @Test
    void secretReviewPostsAreNeverPersistedThroughTheNormalPath() {
        IngestOutcome outcome = runReviewPass(
                FakeCafe24HttpClient.article(4001L, "공개 제목", "공개 본문", 77L, 5, null, "N", "F"),
                FakeCafe24HttpClient.article(4002L, "비밀 제목", "비밀 본문", 77L, 5, null, "N", "T"),
                FakeCafe24HttpClient.article(4003L, "누락 제목", "누락 본문", 77L, 5, null, "N", null));

        // Only the public row is ingested at all — the secret / missing-flag rows were
        // dropped by the connector before mapping, so ingestion never sees them.
        assertThat(outcome.success()).isEqualTo(1);
        assertThat(outcome.insertedIds()).hasSize(1);

        List<Cafe24CommunityArticle> rows = communityArticles.findAllByOrgId(org);
        assertThat(rows).hasSize(1);
        Cafe24CommunityArticle a = rows.get(0);
        assertThat(a.getArticleNo()).isEqualTo(4001L);
        assertThat(a.getContent()).isEqualTo("공개 본문");
        // No secret post's article number, title, or body ever reaches the DB.
        assertThat(rows).noneMatch(r -> r.getArticleNo() == 4002L || r.getArticleNo() == 4003L);
        assertThat(rows).noneMatch(r -> "비밀 본문".equals(r.getContent()) || "누락 본문".equals(r.getContent()));
        assertThat(rows).noneMatch(r -> "비밀 제목".equals(r.getTitle()) || "누락 제목".equals(r.getTitle()));
    }

    @Test
    void replayingAMixedPageStoresOnlyPublicRowsWithoutDuplicating() {
        runReviewPass(
                FakeCafe24HttpClient.article(4001L, "공개 제목", "공개 본문", 77L, 5, null, "N", "F"),
                FakeCafe24HttpClient.article(4002L, "비밀 제목", "비밀 본문", 77L, 5, null, "N", "T"));
        IngestOutcome second = runReviewPass(
                FakeCafe24HttpClient.article(4001L, "공개 제목", "공개 본문", 77L, 5, null, "N", "F"),
                FakeCafe24HttpClient.article(4002L, "비밀 제목", "비밀 본문", 77L, 5, null, "N", "T"));

        // Replay is a no-op for the public row and the secret row never appears — the
        // count stays 1, no duplicate.
        assertThat(second.success()).isZero();
        assertThat(second.skipped()).isEqualTo(1);
        assertThat(communityArticles.countByOrgIdAndSellerAccountId(org, account)).isEqualTo(1);
        assertThat(communityArticles.findAllByOrgId(org)).singleElement()
                .satisfies(r -> assertThat(r.getArticleNo()).isEqualTo(4001L));
    }

    @Test
    void reviewArticlesPersistThroughTheNormalPathWithWindowedFetch() {
        IngestOutcome outcome = runPass(DataType.REVIEW, 4, 2001L, "잘 쓰고 있어요", "N");

        assertThat(outcome.success()).isEqualTo(1);
        assertThat(outcome.insertedIds()).hasSize(1);

        List<Cafe24CommunityArticle> rows = communityArticles.findAllByOrgId(org);
        assertThat(rows).hasSize(1);
        Cafe24CommunityArticle a = rows.get(0);
        assertThat(a.getBoardNo()).isEqualTo(4);
        assertThat(a.getArticleNo()).isEqualTo(2001L);
        assertThat(a.getSourceKind()).isEqualTo("REVIEW");
        assertThat(a.getReplyStatus()).isEqualTo("PENDING"); // N → PENDING
        assertThat(a.getSellerAccountId()).isEqualTo(account);

        // The seeded window reached the GET, and the cursor advanced inside the window.
        assertThat(http.sent.get(1).uri().toString())
                .contains("/api/v2/admin/boards/4/articles?")
                .contains("start_date=2026-01-01")
                .contains("end_date=2026-06-25");
    }

    @Test
    void reRunningTheSameWindowedPageIsANoOp() {
        runPass(DataType.REVIEW, 4, 2001L, "동일 본문", "N");
        IngestOutcome second = runPass(DataType.REVIEW, 4, 2001L, "동일 본문", "N");

        assertThat(second.success()).isZero();
        assertThat(second.skipped()).isEqualTo(1);
        assertThat(communityArticles.countByOrgIdAndSellerAccountId(org, account)).isEqualTo(1);
    }

    @Test
    void changedContentUpdatesInPlaceWithoutDuplicating() {
        runPass(DataType.REVIEW, 4, 2001L, "원래 본문", "N");
        IngestOutcome second = runPass(DataType.REVIEW, 4, 2001L, "수정 본문", "N");

        assertThat(second.success()).isEqualTo(1);
        assertThat(second.insertedIds()).isEmpty(); // an update, not a new insert
        List<Cafe24CommunityArticle> rows = communityArticles.findAllByOrgId(org);
        assertThat(rows).hasSize(1);
        assertThat(rows.get(0).getContent()).isEqualTo("수정 본문");
    }

    @Test
    void inquiryFetchRoutesToBoard6NeverBoard9AndLeavesTheCommunityStore() {
        http.enqueue(FakeCafe24HttpClient.tokenOk("access-1", "old-refresh-token"));
        http.enqueue(FakeCafe24HttpClient.articlesOk(
                FakeCafe24HttpClient.article(3001L, "제목", "곡면 가능?", 77L, null, null, "N")));
        String cursor = Cafe24ArticleCursor.window(6, START, END).encode();
        FetchPage page = connector.fetch(new FetchRequest(org, account, "CAFE24", DataType.INQUIRY, cursor, 3));

        // INQUIRY now produces canonical inquiries, not community articles — the
        // community/VOC store is never written for board 6; the inquiry flows to the
        // OPEN work-queue path instead (covered by Cafe24InquiryIngestionFlowTest).
        assertThat(page.records().get(0)).isInstanceOf(CanonicalInquiry.class);
        assertThat(communityArticles.findAllByOrgId(org)).isEmpty();
        // INQUIRY fans out to board 6 only — board 9 is never requested.
        assertThat(http.sent.get(1).uri().toString())
                .contains("/api/v2/admin/boards/6/articles?")
                .doesNotContain("/boards/9/");
    }
}
