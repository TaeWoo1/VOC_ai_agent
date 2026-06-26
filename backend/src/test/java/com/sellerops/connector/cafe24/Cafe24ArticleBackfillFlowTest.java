package com.sellerops.connector.cafe24;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.collect.BackfillWindow;
import com.sellerops.collect.SyncRunExecutor;
import com.sellerops.community.Cafe24CommunityArticle;
import com.sellerops.community.Cafe24CommunityArticleRepository;
import com.sellerops.connector.ConnectorRegistry;
import com.sellerops.connector.DataType;
import com.sellerops.connector.ChannelConnectionStatusRepository;
import com.sellerops.credential.ConnectorCredentialRepository;
import com.sellerops.credential.CredentialVault;
import com.sellerops.ingest.IngestionService;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.order.OrderDailySummaryRepository;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.ProductService;
import com.sellerops.review.ReviewRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.sync.SyncCursor;
import com.sellerops.sync.SyncCursorRepository;
import com.sellerops.sync.SyncJob;
import com.sellerops.sync.SyncJobRepository;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.LocalDate;
import java.util.ArrayList;
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
 * PR E production-runtime backfill path, end to end over the recording fake + real
 * (H2) DB: a bounded date-window backfill driven through the <b>real
 * {@link SyncRunExecutor}</b> against the <b>real {@link Cafe24ApiConnector}</b>. It
 * proves the operator window is seeded into {@code sync_cursors} by the runtime (not
 * a bypass), reaches the articles GET, advances across pages while preserving the
 * window, routes REVIEW→board 4 / INQUIRY→board 6 (board 9 never requested), and is
 * idempotent on a repeated same-window run (no duplicate rows). This offline test
 * proves the runtime shape; supervised live backfill runs then confirmed the same
 * path against the real mall (REVIEW/INQUIRY are now CONFIRMED for boards 4/6).
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class Cafe24ArticleBackfillFlowTest {

    private static final LocalDate START = LocalDate.parse("2026-01-01");
    private static final LocalDate END = LocalDate.parse("2026-06-25");
    /** Mirrors SyncRunExecutor.CURSOR_KEY (package-private there). */
    private static final String CURSOR_KEY = "primary";

    @Autowired SellerAccountRepository sellerAccounts;
    @Autowired ChannelRepository channels;
    @Autowired ReviewRepository reviews;
    @Autowired InquiryRepository inquiries;
    @Autowired OrderDailySummaryRepository orders;
    @Autowired ProductRepository products;
    @Autowired Cafe24CommunityArticleRepository communityArticles;
    @Autowired SyncJobRepository syncJobs;
    @Autowired SyncCursorRepository cursors;
    @Autowired ChannelConnectionStatusRepository connectionStatus;
    @Autowired ConnectorCredentialRepository credentials;

    private final UUID org = UUID.randomUUID();
    private final FakeCafe24HttpClient http = new FakeCafe24HttpClient();

    private SellerAccount account;
    private SyncRunExecutor executor;

    @BeforeEach
    void setUp() {
        Channel ch = new Channel();
        ch.setCode(Cafe24ApiConnector.CHANNEL_CODE);
        ch.setNameKo("카페24");
        ch.setStatus(ChannelStatus.AVAILABLE);
        ch.setSupportsReview(true);
        ch.setSupportsInquiry(true);
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
        account = sellerAccounts.save(acc);

        byte[] key = new byte[32];
        new SecureRandom().nextBytes(key);
        CredentialVault vault = new CredentialVault(credentials, new ObjectMapper(),
                Base64.getEncoder().encodeToString(key), "local-test-1");
        vault.store(org, account.getId(), "API", "OAUTH2",
                Map.of("mall_id", "samplemall", "client_id", "cid", "client_secret", "secret",
                        "refresh_token", "old-refresh-token"),
                null, null, null);

        IngestionService ingestion = new IngestionService(reviews, inquiries, orders,
                new ProductService(products), communityArticles);
        Cafe24ApiConnector connector = new Cafe24ApiConnector(new Cafe24TokenClient(http), vault,
                new Cafe24OrdersClient(http), new Cafe24BoardArticlesClient(http), Clock.systemUTC());
        ConnectorRegistry registry = new ConnectorRegistry(List.of(connector));
        executor = new SyncRunExecutor(sellerAccounts, channels, registry, ingestion,
                syncJobs, cursors, connectionStatus);
    }

    /** Enqueue one fetch's worth of responses: the token grant then a one-page article list. */
    private void enqueuePage(String... articleObjects) {
        http.enqueue(FakeCafe24HttpClient.tokenOk("access-1", "old-refresh-token"));
        http.enqueue(FakeCafe24HttpClient.articlesOk(articleObjects));
    }

    private SyncCursor cursor(DataType type) {
        return cursors.findByOrgIdAndSellerAccountIdAndDataTypeAndCursorKey(
                org, account.getId(), type.name(), CURSOR_KEY).orElseThrow();
    }

    @Test
    void seededReviewBackfillBoundsBoard4Window() {
        enqueuePage(FakeCafe24HttpClient.article(2001L, "제목", "잘 쓰고 있어요", 77L, 5, null, "N"));

        SyncJob job = executor.execute(org, account.getId(), DataType.REVIEW, "MANUAL",
                BackfillWindow.of(START, END));

        assertThat(job.getStatus()).isEqualTo("SUCCESS");
        assertThat(job.getJobType()).isEqualTo("CAFE24_API");
        assertThat(job.getSuccessRows()).isEqualTo(1);

        List<Cafe24CommunityArticle> rows = communityArticles.findAllByOrgId(org);
        assertThat(rows).hasSize(1);
        Cafe24CommunityArticle a = rows.get(0);
        assertThat(a.getBoardNo()).isEqualTo(4);
        assertThat(a.getSourceKind()).isEqualTo("REVIEW");
        assertThat(a.getReplyStatus()).isEqualTo("PENDING"); // N → PENDING

        // The operator window was seeded by the runtime and reached the GET...
        assertThat(http.sent.get(1).uri().toString())
                .contains("/api/v2/admin/boards/4/articles?")
                .contains("start_date=2026-01-01")
                .contains("end_date=2026-06-25");
        // ...and the cursor advanced inside the window, written through sync_cursors.
        assertThat(cursor(DataType.REVIEW).getCursorValue())
                .isEqualTo("b4:o1:s2026-01-01:e2026-06-25");
    }

    @Test
    void seededInquiryBackfillBoundsBoard6WindowNeverBoard9() {
        enqueuePage(FakeCafe24HttpClient.article(3001L, "제목", "곡면 가능?", 88L, null, null, "N"));

        SyncJob job = executor.execute(org, account.getId(), DataType.INQUIRY, "MANUAL",
                BackfillWindow.of(START, END));

        assertThat(job.getStatus()).isEqualTo("SUCCESS");
        Cafe24CommunityArticle a = communityArticles.findAllByOrgId(org).get(0);
        assertThat(a.getBoardNo()).isEqualTo(6);
        assertThat(a.getSourceKind()).isEqualTo("PRODUCT_INQUIRY");

        assertThat(http.sent.get(1).uri().toString())
                .contains("/api/v2/admin/boards/6/articles?")
                .contains("start_date=2026-01-01");
        assertThat(cursor(DataType.INQUIRY).getCursorValue())
                .isEqualTo("b6:o1:s2026-01-01:e2026-06-25");
        // INQUIRY fans out to board 6 only — board 9 1:1 맞춤상담 is never requested.
        assertThat(http.sent).noneMatch(s -> s.uri().toString().contains("/boards/9/"));
    }

    @Test
    void backfillAdvancesCursorAcrossPagesPreservingWindow() {
        // Page 1 is a full executor page (50 rows → hasMore), page 2 is short (→ stop).
        List<String> full = new ArrayList<>();
        for (int n = 1; n <= 50; n++) {
            full.add(FakeCafe24HttpClient.article(1000L + n, "제목", "본문" + n, 77L, 5, null, "N"));
        }
        enqueuePage(full.toArray(String[]::new));
        enqueuePage(FakeCafe24HttpClient.article(1051L, "제목", "본문51", 77L, 5, null, "N"));

        SyncJob job = executor.execute(org, account.getId(), DataType.REVIEW, "MANUAL",
                BackfillWindow.of(START, END));

        assertThat(job.getStatus()).isEqualTo("SUCCESS");
        assertThat(job.getSuccessRows()).isEqualTo(51);
        assertThat(communityArticles.countByOrgIdAndSellerAccountId(org, account.getId())).isEqualTo(51);

        // Two pages fetched: offset 0 then 50, both board 4 and both still windowed.
        assertThat(http.sent.get(1).uri().toString())
                .contains("/api/v2/admin/boards/4/articles?").contains("offset=0").contains("start_date=2026-01-01");
        assertThat(http.sent.get(3).uri().toString())
                .contains("/api/v2/admin/boards/4/articles?").contains("offset=50").contains("start_date=2026-01-01");
        assertThat(cursor(DataType.REVIEW).getCursorValue())
                .isEqualTo("b4:o51:s2026-01-01:e2026-06-25");
    }

    @Test
    void repeatedBackfillOverSameWindowIsNoOpNoDuplicates() {
        enqueuePage(FakeCafe24HttpClient.article(2001L, "제목", "동일 본문", 77L, 5, null, "N"));
        executor.execute(org, account.getId(), DataType.REVIEW, "MANUAL", BackfillWindow.of(START, END));

        // A second identical backfill re-seeds the window at offset 0 and re-fetches
        // the same row; the natural key + source_hash make it an idempotent no-op.
        enqueuePage(FakeCafe24HttpClient.article(2001L, "제목", "동일 본문", 77L, 5, null, "N"));
        SyncJob second = executor.execute(org, account.getId(), DataType.REVIEW, "MANUAL",
                BackfillWindow.of(START, END));

        assertThat(second.getStatus()).isEqualTo("SUCCESS");
        assertThat(second.getSuccessRows()).isZero();
        assertThat(second.getSkippedRows()).isEqualTo(1);
        assertThat(communityArticles.countByOrgIdAndSellerAccountId(org, account.getId())).isEqualTo(1);
        assertThat(cursor(DataType.REVIEW).getCursorValue())
                .isEqualTo("b4:o1:s2026-01-01:e2026-06-25");
    }
}
