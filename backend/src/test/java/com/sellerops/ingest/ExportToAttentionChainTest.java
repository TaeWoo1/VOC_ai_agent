package com.sellerops.ingest;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;

import com.sellerops.attention.OperatorAttentionService;
import com.sellerops.attention.dto.AttentionSignal;
import com.sellerops.attention.dto.OperatorAttentionSummary;
import com.sellerops.attention.source.Cafe24VocItemSource;
import com.sellerops.attention.source.IngestedReviewVocItemSource;
import com.sellerops.attention.source.VocItemSourceRegistry;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.community.Cafe24CommunityArticleRepository;
import com.sellerops.connector.ChannelConnectionStatusRepository;
import com.sellerops.connector.FileUploadConnector;
import com.sellerops.collect.runtime.CollectionRunService;
import com.sellerops.ingest.map.InquiryRowMapper;
import com.sellerops.ingest.map.OrderSummaryRowMapper;
import com.sellerops.ingest.map.ReviewRowMapper;
import com.sellerops.ingest.parse.FileParser;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemAuditRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemWriter;
import com.sellerops.itemanalysis.ItemAnalysisRepository;
import com.sellerops.itemanalysis.ItemAnalysisService;
import com.sellerops.itemanalysis.RuleBasedInboxItemAnalyzer;
import com.sellerops.order.OrderDailySummaryRepository;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.ProductService;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.sync.SyncJobRepository;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.PlatformTransactionManager;

/**
 * Joins the two halves of the post-export chain: a synthetic NAVER export goes in
 * through the REAL {@link FileUploadConnector} and comes out as operator attention
 * signals from the REAL {@link OperatorAttentionService}. Nothing else crosses that
 * seam — {@code ExportToReportChainTest} runs upload → dashboard and stops before
 * attention, while {@code IngestedReviewVocItemSourceTest} proves reviews → attention
 * but seeds rows directly via {@code reviews.save(...)} and never uploads anything.
 *
 * <p><b>What this pins is the JOIN, not the zone.</b> The two policies that meet here
 * are ingest's UTC-midnight date ({@code DateParse.instantAtStartOfDay} →
 * {@code atStartOfDay(ZoneOffset.UTC)}) and attention's KST window
 * ({@code IngestedReviewVocItemSource.KST}). A date-only export row lands inside the
 * requested window across that seam — the property an operator depends on and that no
 * other test exercises ({@code IngestedReviewVocItemSourceTest} bypasses
 * {@code DateParse} with {@code Instant.parse}; the dashboard has no window).
 *
 * <p>It deliberately does NOT claim to pin the KST-vs-UTC choice, because for
 * file-ingested reviews that choice is not observable: {@code DateParse} quantizes
 * every export date to UTC midnight, and a UTC-midnight instant falls in the same set
 * of day-granular calendar days whether the window is bucketed in KST or UTC (the 9h
 * shift never crosses a midnight for a midnight-aligned instant). Flipping the window
 * zone leaves these assertions green — verified by mutation. The zone only bites a
 * source whose rows carry a wall-clock time of day, which the file-ingest path never
 * produces; {@code IngestedReviewVocItemSourceTest} pins the KST edge instants using
 * hand-built sub-day timestamps, which is where that distinction actually lives.
 *
 * <p>Deliberately narrow. Rating bands, unrated exclusion, cross-org isolation and the
 * KST edge instants are pinned by {@code IngestedReviewVocItemSourceTest}; product
 * linking and the dashboard by {@code ExportToReportChainTest}. Re-asserting them here
 * would be duplicate surface that drifts. The unique value is the join, so there are
 * exactly two tests: it arrives, and a duplicate export does not move it.
 *
 * <p>Wiring follows the repo's uniform {@code @DataJpaTest} + hand-{@code new}ed
 * services convention. The mapped-field HEADERS are the NAVER seller-center labels
 * already used by {@code RowMapperTest}/{@code FileParserTest}; excluded columns are
 * SYNTHETIC and every CELL VALUE is synthetic.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class ExportToAttentionChainTest {

    @Autowired ChannelRepository channels;
    @Autowired ReviewRepository reviews;
    @Autowired InquiryRepository inquiries;
    @Autowired OrderDailySummaryRepository orders;
    @Autowired ProductRepository products;
    @Autowired Cafe24CommunityArticleRepository communityArticles;
    @Autowired InquiryWorkItemRepository workItems;
    @Autowired InquiryWorkItemAuditRepository audits;
    @Autowired PlatformTransactionManager txManager;
    @Autowired ItemAnalysisRepository analyses;
    @Autowired SyncJobRepository syncJobs;
    @Autowired ChannelConnectionStatusRepository connectionStatus;
    @Autowired SellerAccountRepository sellerAccounts;

    private FileUploadConnector connector;
    private OperatorAttentionService attention;
    private final UUID org = UUID.randomUUID();
    private UUID channelId;
    private UUID accountId;

    // The window the operator asks about; every export row below sits inside it.
    private static final LocalDate FROM = LocalDate.parse("2026-05-01");
    private static final LocalDate TO = LocalDate.parse("2026-05-31");

    private static final String FILENAME = "review_synthetic_naver.xlsx";

    // Synthetic excluded-column sentinels — must never reach a canonical field.
    private static final String ORDER_NO = "ORDER-MUST-NOT-PERSIST";
    private static final String REVIEWER = "REVIEWER-MUST-NOT-PERSIST";

    private static final String PRODUCT = "합성-전선몰딩-1호";
    private static final String SKU = "SKU-합성-77";

    @BeforeEach
    void setUp() {
        ProductService productService = new ProductService(products);
        IngestionService ingestion = new IngestionService(reviews, inquiries, orders, productService,
                communityArticles, channels, new InquiryWorkItemWriter(inquiries, workItems, audits, txManager));
        CollectionRunService runs = new CollectionRunService(syncJobs, connectionStatus, sellerAccounts);
        ItemAnalysisService analysis = new ItemAnalysisService(inquiries, reviews, analyses,
                new RuleBasedInboxItemAnalyzer());
        connector = new FileUploadConnector(channels, new FileParser(), new ReviewRowMapper(),
                new InquiryRowMapper(), new OrderSummaryRowMapper(), ingestion, runs, analysis);
        // Both sources registered, as in production: NAVER resolves to the ingested-review
        // source; CAFE24 would still reach the community store.
        attention = new OperatorAttentionService(sellerAccounts, channels,
                new VocItemSourceRegistry(List.of(
                        new Cafe24VocItemSource(communityArticles),
                        new IngestedReviewVocItemSource(reviews, sellerAccounts, products))));

        channelId = seedNaverChannel();
        // EXACTLY ONE account on this channel. A second would trip the ambiguity guard
        // (reviews carry no seller_account_id) and every assertion below would pass or
        // fail for the wrong reason — an unsupported-ambiguous empty, not a real read.
        accountId = seedAccount(channelId);
    }

    @Test
    void anUploadedNaverExportBecomesOperatorAttentionSignals() throws Exception {
        IngestResult result = connector.ingest(org, channelId, UploadType.REVIEW,
                FILENAME, new ByteArrayInputStream(export()));
        assertThat(result.status()).isEqualTo("SUCCESS");
        assertThat(result.successRows()).isEqualTo(4);

        OperatorAttentionSummary summary = attention.attention(org, accountId, FROM, TO);

        assertThat(summary.channel()).isEqualTo("네이버 스마트스토어");
        // containsExactly, not contains: the ABSENCE of a signal is part of the contract.
        // 4 rows cannot raise RECENT_REVIEW_SPIKE_CANDIDATE (needs >= 5 current AND >= 2x a
        // non-zero baseline), and this store has no inquiries, so no inquiry signal may
        // appear either. A `contains` assertion would let both regressions through.
        assertThat(summary.items())
                .extracting(AttentionSignal::type, AttentionSignal::severity, AttentionSignal::count)
                .containsExactly(
                        tuple("LOW_RATING_REVIEW", "HIGH", 2L),     // 1★ + 2★
                        tuple("LOW_RATING_REVIEW", "MEDIUM", 1L),   // 3★
                        tuple("NEW_REVIEW", "LOW", 4L));            // all four, incl. the 5★
    }

    @Test
    void aDuplicateExportDedupesEveryRowAndLeavesTheAttentionItemsUnchanged() throws Exception {
        connector.ingest(org, channelId, UploadType.REVIEW,
                FILENAME, new ByteArrayInputStream(export()));
        List<AttentionSignal> before = attention.attention(org, accountId, FROM, TO).items();

        // NAVER exports 리뷰글번호, so every row keys on external_id and dedups.
        IngestResult second = connector.ingest(org, channelId, UploadType.REVIEW,
                FILENAME, new ByteArrayInputStream(export()));
        assertThat(second.status()).isEqualTo("SUCCESS");   // all-duplicate is idempotent SUCCESS
        assertThat(second.successRows()).isZero();
        assertThat(second.skippedRows()).isEqualTo(4);
        assertThat(reviews.findAllByOrgId(org)).hasSize(4);

        // The operator's signals must not budge — a re-upload is not four new bad reviews.
        assertThat(attention.attention(org, accountId, FROM, TO).items()).isEqualTo(before);
    }

    /**
     * A synthetic NAVER seller-center review export: 4 rows, two negative (1★, 2★), one
     * mid (3★), one positive (5★). Dates are the NAVER {@code yyyy.MM.dd.} form and are
     * DATE-ONLY: DateParse drops them at UTC midnight, and the attention window must
     * still bucket them inside [FROM, TO] — the cross-seam join under test.
     */
    private byte[] export() throws Exception {
        return xlsx(new String[][] {
                {"RV-1001", SKU, PRODUCT, "1", "합성-리뷰-본문-A", "2026.05.05."},
                {"RV-1002", SKU, PRODUCT, "2", "합성-리뷰-본문-B", "2026.05.06."},
                {"RV-1003", SKU, PRODUCT, "3", "합성-리뷰-본문-C", "2026.05.07."},
                {"RV-1004", SKU, PRODUCT, "5", "합성-리뷰-본문-D", "2026.05.08."},
        });
    }

    /**
     * Header row uses the NAVER export labels already grounded in RowMapperTest /
     * FileParserTest, plus the sensitive 상품주문번호 / 등록자 columns which have no
     * canonical slot. All cell values are synthetic.
     */
    private byte[] xlsx(String[][] rows) throws Exception {
        try (XSSFWorkbook wb = new XSSFWorkbook(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            Sheet sheet = wb.createSheet("Sheet0");
            Row header = sheet.createRow(0);
            String[] cols = {"리뷰글번호", "상품번호", "상품명", "구매자평점", "리뷰상세내용",
                    "리뷰등록일", "상품주문번호", "등록자"};
            for (int i = 0; i < cols.length; i++) {
                header.createCell(i).setCellValue(cols[i]);
            }
            for (int i = 0; i < rows.length; i++) {
                Row r = sheet.createRow(i + 1);
                for (int c = 0; c < rows[i].length; c++) {
                    r.createCell(c).setCellValue(rows[i][c]);
                }
                r.createCell(6).setCellValue(ORDER_NO);
                r.createCell(7).setCellValue(REVIEWER);
            }
            wb.write(out);
            return out.toByteArray();
        }
    }

    private UUID seedNaverChannel() {
        Channel ch = new Channel();
        ch.setCode("NAVER");
        ch.setNameKo("네이버 스마트스토어");
        ch.setStatus(ChannelStatus.AVAILABLE);
        ch.setSupportsInquiry(true);
        ch.setSupportsReview(true);
        ch.setSupportsOrder(true);
        ch.setSupportsSales(true);
        ch.setSupportsProduct(true);
        ch.setSortOrder(0);
        return channels.save(ch).getId();
    }

    /** The org's ONLY account on this channel — see the note in setUp. */
    private UUID seedAccount(UUID channel) {
        SellerAccount acc = new SellerAccount();
        acc.setOrgId(org);
        acc.setChannelId(channel);
        acc.setConnectionStatus(ChannelStatus.CONNECTED);
        acc.setFileUpload(true);   // these reviews arrive by seller-center export
        return sellerAccounts.save(acc).getId();
    }
}
