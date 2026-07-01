package com.sellerops.connector;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.community.Cafe24CommunityArticleRepository;
import com.sellerops.ingest.IngestResult;
import com.sellerops.ingest.IngestionService;
import com.sellerops.ingest.UploadType;
import com.sellerops.ingest.map.InquiryRowMapper;
import com.sellerops.ingest.map.OrderSummaryRowMapper;
import com.sellerops.ingest.map.ReviewRowMapper;
import com.sellerops.ingest.parse.FileParser;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.itemanalysis.ItemAnalysisRepository;
import com.sellerops.itemanalysis.ItemAnalysisService;
import com.sellerops.itemanalysis.RuleBasedInboxItemAnalyzer;
import com.sellerops.order.OrderDailySummaryRepository;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.ProductService;
import com.sellerops.review.ReviewRepository;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.collect.runtime.CollectionRunService;
import com.sellerops.sync.SyncJobRepository;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
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

/**
 * Slice 5: verify the grounded ESM+ REVIEW aliases through the REAL production
 * orchestrator {@link FileUploadConnector#ingest} (not the direct service
 * composition of Slice 4) on in-memory H2. This adds the {@link IngestResult}
 * assertions the service-level {@code IngestOutcome} cannot express — derived
 * status string, opened+finalized {@code syncJobId}, {@code totalRows},
 * {@code sampleErrors} — plus the "all-duplicate re-upload = SUCCESS" derivation.
 *
 * <p>Wiring follows the repo's uniform {@code @DataJpaTest} + hand-{@code new}ed
 * services convention (no {@code @SpringBootTest} exists in this project). The
 * mapped-field HEADERS are the real captured labels already committed in Slice 3
 * (schema-alias source exception); excluded columns are SYNTHETIC and all CELL
 * VALUES are synthetic. Establishes at most "backend ingest-path mapping
 * verified" — schemaMapping and dedup remain unconfirmed.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class FileUploadConnectorReviewIngestFlowTest {

    @Autowired ChannelRepository channels;
    @Autowired ReviewRepository reviews;
    @Autowired InquiryRepository inquiries;
    @Autowired OrderDailySummaryRepository orders;
    @Autowired ProductRepository products;
    @Autowired Cafe24CommunityArticleRepository communityArticles;
    @Autowired ItemAnalysisRepository analyses;
    @Autowired SyncJobRepository syncJobs;
    @Autowired ChannelConnectionStatusRepository connectionStatus;
    @Autowired SellerAccountRepository sellerAccounts;

    private FileUploadConnector connector;
    private final UUID org = UUID.randomUUID();
    private UUID channelId;

    // Synthetic excluded-column sentinels — must never reach a canonical field.
    private static final String REPLY = "REPLY-STATUS-MUST-NOT-PERSIST";
    private static final String ORDER = "ORDER-MUST-NOT-PERSIST";
    private static final String BUYER = "BUYER-MUST-NOT-PERSIST";
    // Synthetic product/body values (never real ESM+ cell content).
    private static final String PRODUCT = "합성-상품-1호";
    private static final String SKU = "SKU-합성-1";
    private static final String BODY_A = "합성-리뷰-본문-A";
    private static final String BODY_B = "합성-리뷰-본문-B";

    @BeforeEach
    void setUp() {
        ProductService productService = new ProductService(products);
        IngestionService ingestion = new IngestionService(reviews, inquiries, orders, productService,
                communityArticles, channels);
        CollectionRunService runs = new CollectionRunService(syncJobs, connectionStatus, sellerAccounts);
        ItemAnalysisService analysis = new ItemAnalysisService(inquiries, reviews, analyses,
                new RuleBasedInboxItemAnalyzer());
        connector = new FileUploadConnector(channels, new FileParser(), new ReviewRowMapper(),
                new InquiryRowMapper(), new OrderSummaryRowMapper(), ingestion, runs, analysis);
        channelId = seedGmarketChannel();
    }

    @Test
    void connectorIngestsSyntheticEsmReviewXlsxAndReturnsSuccessResult() throws Exception {
        byte[] bytes = buildEsmReviewXlsx();

        IngestResult result = connector.ingest(org, channelId, UploadType.REVIEW,
                "esm_review_synthetic.xlsx", new ByteArrayInputStream(bytes));

        assertThat(result.uploadType()).isEqualTo(UploadType.REVIEW);
        assertThat(result.totalRows()).isEqualTo(2);
        assertThat(result.successRows()).isEqualTo(2);
        assertThat(result.skippedRows()).isZero();
        assertThat(result.failedRows()).isZero();
        assertThat(result.status()).isEqualTo("SUCCESS");
        assertThat(result.syncJobId()).isNotNull();       // a sync_jobs run row was opened + finalized
        assertThat(result.errorMessage()).isNull();
        assertThat(result.sampleErrors()).isEmpty();
        assertThat(reviews.findAllByOrgId(org)).hasSize(2);
    }

    @Test
    void reUploadOfTheSameXlsxIsAnAllDuplicateSuccessThatInsertsNothing() throws Exception {
        byte[] bytes = buildEsmReviewXlsx();

        IngestResult first = connector.ingest(org, channelId, UploadType.REVIEW,
                "esm_review_synthetic.xlsx", new ByteArrayInputStream(bytes));
        assertThat(first.successRows()).isEqualTo(2);
        assertThat(reviews.findAllByOrgId(org)).hasSize(2);

        // Re-upload the identical bytes → every row dedups on content hash. An
        // all-duplicate upload is an idempotent SUCCESS (0 inserted, N skipped),
        // still records its own run row.
        IngestResult second = connector.ingest(org, channelId, UploadType.REVIEW,
                "esm_review_synthetic.xlsx", new ByteArrayInputStream(bytes));
        assertThat(second.totalRows()).isEqualTo(2);
        assertThat(second.successRows()).isZero();
        assertThat(second.skippedRows()).isEqualTo(2);
        assertThat(second.failedRows()).isZero();
        assertThat(second.status()).isEqualTo("SUCCESS");
        assertThat(second.syncJobId()).isNotNull().isNotEqualTo(first.syncJobId());
        assertThat(reviews.findAllByOrgId(org)).hasSize(2); // unchanged
    }

    /** A GMARKET (ESM+ catalog code) channel row — the connector's exists-guard prereq. */
    private UUID seedGmarketChannel() {
        Channel ch = new Channel();
        ch.setCode("GMARKET");
        ch.setNameKo("G마켓/옥션");
        ch.setStatus(ChannelStatus.AVAILABLE);
        ch.setSupportsInquiry(true);
        ch.setSupportsReview(true);
        ch.setSupportsOrder(true);
        ch.setSupportsSales(true);
        ch.setSupportsProduct(true);
        ch.setSortOrder(0);
        return channels.save(ch).getId();
    }

    /**
     * A synthetic ESM+ REVIEW export (same shape as Slice 4's fixture). Header row
     * uses the real grounded mapped headers already committed in Slice 3 plus
     * synthetic excluded columns; every data value is synthetic. The receipt-date
     * value uses a DateParse-supported ISO date (the real ESM+ date-string format
     * was never captured — only header labels were).
     */
    private byte[] buildEsmReviewXlsx() throws Exception {
        try (XSSFWorkbook wb = new XSSFWorkbook(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            Sheet sheet = wb.createSheet("Sheet0");
            Row header = sheet.createRow(0);
            String[] cols = {"리뷰 내용", "상품명", "상품 번호", "별점", "접수일시",
                    "esm_답변상태_합성", "esm_주문번호_합성", "esm_구매자_합성"};
            for (int i = 0; i < cols.length; i++) {
                header.createCell(i).setCellValue(cols[i]);
            }
            writeRow(sheet, 1, BODY_A, "5", "2026-02-03");
            writeRow(sheet, 2, BODY_B, "2", "2026-02-04");
            wb.write(out);
            return out.toByteArray();
        }
    }

    private void writeRow(Sheet sheet, int rowIdx, String body, String rating, String date) {
        Row r = sheet.createRow(rowIdx);
        r.createCell(0).setCellValue(body);
        r.createCell(1).setCellValue(PRODUCT);
        r.createCell(2).setCellValue(SKU);
        r.createCell(3).setCellValue(rating);
        r.createCell(4).setCellValue(date);
        r.createCell(5).setCellValue(REPLY);
        r.createCell(6).setCellValue(ORDER);
        r.createCell(7).setCellValue(BUYER);
    }
}
