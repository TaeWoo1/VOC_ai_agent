package com.sellerops.ingest;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.community.Cafe24CommunityArticleRepository;
import com.sellerops.connector.ChannelConnectionStatusRepository;
import com.sellerops.connector.FileUploadConnector;
import com.sellerops.collect.runtime.CollectionRunService;
import com.sellerops.dashboard.DashboardService;
import com.sellerops.dashboard.dto.DashboardSummaryResponse;
import com.sellerops.dashboard.dto.TopProductIssue;
import com.sellerops.inbox.InboxService;
import com.sellerops.ingest.map.InquiryRowMapper;
import com.sellerops.ingest.map.OrderSummaryRowMapper;
import com.sellerops.ingest.map.ReviewRowMapper;
import com.sellerops.ingest.parse.FileParser;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemAuditRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemWriter;
import com.sellerops.itemanalysis.ItemAnalysis;
import com.sellerops.itemanalysis.ItemAnalysisRepository;
import com.sellerops.itemanalysis.ItemAnalysisService;
import com.sellerops.itemanalysis.RuleBasedInboxItemAnalyzer;
import com.sellerops.order.OrderDailySummaryRepository;
import com.sellerops.order.OrderService;
import com.sellerops.product.Product;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.ProductService;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.sync.SyncJobRepository;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
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
 * Carries ONE synthetic NAVER review export the whole way down the post-export
 * chain — upload → dedupe → product linking → item-analysis → dashboard report —
 * in a single hermetic run. The existing ingest-flow tests stop at persistence;
 * nothing previously asserted that an ingested review reaches a reporting surface,
 * and {@code DashboardService} had no test at all. {@code buildTopProductIssues}
 * is the only wired consumer of the {@code reviews.product_id} link, so this is
 * where that link's product value is actually pinned.
 *
 * <p>Wiring follows the repo's uniform {@code @DataJpaTest} + hand-{@code new}ed
 * services convention (no {@code @SpringBootTest} exists in this project). The
 * mapped-field HEADERS are the NAVER seller-center export labels already used by
 * {@code RowMapperTest}/{@code FileParserTest}; excluded columns are SYNTHETIC and
 * every CELL VALUE is synthetic — no captured export data is present.
 *
 * <p>Deliberately asserts only the time-independent outputs of
 * {@code DashboardService.summary}: it derives its windows from {@code Instant.now()}
 * / {@code LocalDate.now()} (DashboardService:49-50), so the 24h {@code newReviews}
 * and today's-orders cards are wall-clock dependent and are NOT asserted here.
 * {@code negativeReviews}, {@code todoItems} and {@code topProductIssues} are pure
 * functions of the persisted rows and are the reporting contract this test pins.
 *
 * <p>Scope of the dedupe assertion: tests run H2 with Flyway disabled and the schema
 * generated from entities, and {@code Review}/{@code Product} declare no
 * {@code @UniqueConstraint} — the PARTIAL unique indexes in {@code V2__file_ingest.sql}
 * are not expressible in JPA and do not exist here. So the re-upload test pins the
 * app-level pre-check ({@code IngestionService.existsReview}) ONLY. It does not prove
 * the DB index exists or agrees with the app's key, and {@code trySave}'s
 * constraint-violation re-probe branch is unreachable under H2. Covering that needs a
 * Postgres+Flyway harness, which this test deliberately does not attempt.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class ExportToReportChainTest {

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
    private DashboardService dashboard;
    private final UUID org = UUID.randomUUID();
    private UUID channelId;

    // Synthetic excluded-column sentinels — must never reach a canonical field.
    private static final String ORDER_NO = "ORDER-MUST-NOT-PERSIST";
    private static final String REVIEWER = "REVIEWER-MUST-NOT-PERSIST";

    // Synthetic products: 몰딩 carries both negative reviews, 케이블 carries the positive.
    private static final String PRODUCT_MOLDING = "합성-전선몰딩-1호";
    private static final String SKU_MOLDING = "SKU-합성-77";
    private static final String PRODUCT_CABLE = "합성-케이블타이-2호";
    private static final String SKU_CABLE = "SKU-합성-88";
    // Same SKU, later export, different 상품명 — proves identity is SKU-first, not name-first.
    private static final String PRODUCT_CABLE_RENAMED = "합성-케이블타이-2호-개명";

    private static final String FILENAME = "review_synthetic_naver.xlsx";

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
        dashboard = new DashboardService(inquiries, reviews, orders, products,
                new OrderService(orders, channels),
                new InboxService(inquiries, reviews, channels, products));
        channelId = seedNaverChannel();
    }

    @Test
    void syntheticNaverExportReachesTheDashboardTopProductIssueThroughTheRealChain() throws Exception {
        IngestResult result = ingest();

        // 1. Upload — the run row opened and finalized, all three rows landed.
        assertThat(result.uploadType()).isEqualTo(UploadType.REVIEW);
        assertThat(result.status()).isEqualTo("SUCCESS");
        assertThat(result.totalRows()).isEqualTo(3);
        assertThat(result.successRows()).isEqualTo(3);
        assertThat(result.skippedRows()).isZero();
        assertThat(result.failedRows()).isZero();
        assertThat(result.syncJobId()).isNotNull();
        assertThat(result.sampleErrors()).isEmpty();

        // 2. Product linking — resolve-or-create collapsed 3 rows onto 2 SKUs, and
        //    every review carries a non-null product_id (the FK the report joins on).
        assertThat(products.findAllByOrgId(org)).hasSize(2);
        assertThat(reviews.findAllByOrgId(org))
                .hasSize(3)
                .allSatisfy(r -> assertThat(r.getProductId()).isNotNull());

        // 2b. The 리뷰글번호 column really is mapped to external_id: identity comes from
        //     the export's own review id, so contentHash stays null (IngestionService:91-94).
        //     Without this, dropping the 리뷰글번호 alias would silently fall back to the
        //     content hash and every assertion here would still pass.
        assertThat(reviews.findAllByOrgId(org))
                .extracting(Review::getExternalId)
                .containsExactlyInAnyOrder("RV-1001", "RV-1002", "RV-1003");
        assertThat(reviews.findAllByOrgId(org))
                .allSatisfy(r -> assertThat(r.getContentHash()).isNull());

        // 2c. The excluded columns have no canonical slot, so their sentinels must not
        //     appear in any mapped field. Field-specific by design: a JSON-blob sweep
        //     would pass for the wrong reason.
        assertThat(reviews.findAllByOrgId(org)).allSatisfy(r -> {
            assertThat(r.getBody()).doesNotContain(ORDER_NO, REVIEWER);
            assertThat(r.getExternalId()).doesNotContain(ORDER_NO, REVIEWER);
        });
        assertThat(products.findAllByOrgId(org)).allSatisfy(p -> {
            assertThat(p.getName()).doesNotContain(ORDER_NO, REVIEWER);
            assertThat(p.getSku()).doesNotContain(ORDER_NO, REVIEWER);
        });

        // 3. Item analysis — triggered on exactly the inserted ids, one row each.
        assertThat(analyses.findAllByOrgIdOrderByCreatedAtDesc(org)).hasSize(3);
        assertThat(reviews.findAllByOrgId(org))
                .allSatisfy(r -> assertThat(analyses.existsByOrgIdAndSourceTypeAndSourceId(
                        org, "REVIEW", r.getId())).isTrue());

        // 4. Reporting — the two 몰딩 negatives surface as a single ranked issue named
        //    by the linked product; 케이블 (rating 5) is not an issue at all.
        DashboardSummaryResponse summary = dashboard.summary(org);
        assertThat(summary.cards().negativeReviews()).isEqualTo(2);
        assertThat(summary.todoItems()).contains("부정 리뷰 2건을 확인하세요.");
        assertThat(summary.topProductIssues())
                .singleElement()
                .isEqualTo(new TopProductIssue(PRODUCT_MOLDING, "부정 리뷰", 2L));
    }

    @Test
    void reUploadOfTheSameExportChangesNeitherTheAnalysesNorTheReport() throws Exception {
        IngestResult first = ingest();
        assertThat(first.successRows()).isEqualTo(3);
        List<UUID> analysisIdsAfterFirst = analysisIds();
        DashboardSummaryResponse before = dashboard.summary(org);

        // NAVER exposes 리뷰글번호, so these rows dedup on external_id (not content hash).
        IngestResult second = ingest();
        assertThat(second.totalRows()).isEqualTo(3);
        assertThat(second.successRows()).isZero();
        assertThat(second.skippedRows()).isEqualTo(3);
        assertThat(second.failedRows()).isZero();
        assertThat(second.status()).isEqualTo("SUCCESS");
        assertThat(second.syncJobId()).isNotNull().isNotEqualTo(first.syncJobId());

        // Nothing inserted → nothing re-analyzed (insertedIds is empty), no product churn,
        // and the report's row-derived fields are unchanged. A duplicate export is inert.
        // Deliberately compares only negativeReviews + topProductIssues, NOT the whole
        // response: summary() also carries clock-derived trend dates, so an isEqualTo on
        // the full DTO would flake across a midnight boundary.
        assertThat(reviews.findAllByOrgId(org)).hasSize(3);
        assertThat(products.findAllByOrgId(org)).hasSize(2);
        assertThat(analysisIds()).containsExactlyInAnyOrderElementsOf(analysisIdsAfterFirst);
        DashboardSummaryResponse after = dashboard.summary(org);
        assertThat(after.cards().negativeReviews()).isEqualTo(before.cards().negativeReviews());
        assertThat(after.topProductIssues()).isEqualTo(before.topProductIssues());
    }

    @Test
    void aSecondExportAddingANegativeReviewOvertakesTheRankingAndRelinksToItsProduct() throws Exception {
        ingest();
        assertThat(dashboard.summary(org).topProductIssues())
                .singleElement()
                .isEqualTo(new TopProductIssue(PRODUCT_MOLDING, "부정 리뷰", 2L));
        UUID cableProductId = productIdBySku(SKU_CABLE);

        // A later export: three NEW negatives on the 케이블 SKU, carrying a DIFFERENT 상품명
        // (a rename in the seller's catalog). Identity is the SKU, not the name
        // (ProductService:49-51), so these must attach to the EXISTING product row. The
        // differing name is the whole point: with a name-first resolver they would create
        // a third product and the hasSize(2) below would fail.
        // Three (not two) keeps 케이블 a strict winner — a 2-2 tie would leave the
        // ranking's sort order unpinned and the assertion below arbitrary.
        byte[] followUp = xlsx(new String[][] {
                {"RV-3001", SKU_CABLE, PRODUCT_CABLE_RENAMED, "1", "합성-리뷰-본문-D", "2026.01.05. 09:08:07"},
                {"RV-3002", SKU_CABLE, PRODUCT_CABLE_RENAMED, "2", "합성-리뷰-본문-E", "2026.01.06. 09:08:07"},
                {"RV-3003", SKU_CABLE, PRODUCT_CABLE_RENAMED, "1", "합성-리뷰-본문-F", "2026.01.07. 09:08:07"},
        });
        IngestResult result = connector.ingest(org, channelId, UploadType.REVIEW,
                FILENAME, new ByteArrayInputStream(followUp));

        assertThat(result.successRows()).isEqualTo(3);
        assertThat(products.findAllByOrgId(org)).hasSize(2);              // no new product row
        assertThat(productIdBySku(SKU_CABLE)).isEqualTo(cableProductId);  // same row, stable id
        assertThat(analyses.findAllByOrgIdOrderByCreatedAtDesc(org)).hasSize(6);

        // 케이블 now has 3 negatives vs 몰딩's 2 → it ranks first, and both appear. It is
        // still reported under its ORIGINAL name: resolveOrCreate matches on SKU and does
        // not rename the existing row, so the report follows the stored product identity.
        DashboardSummaryResponse summary = dashboard.summary(org);
        assertThat(summary.cards().negativeReviews()).isEqualTo(5);
        assertThat(summary.topProductIssues()).containsExactly(
                new TopProductIssue(PRODUCT_CABLE, "부정 리뷰", 3L),
                new TopProductIssue(PRODUCT_MOLDING, "부정 리뷰", 2L));
    }

    private IngestResult ingest() throws Exception {
        return connector.ingest(org, channelId, UploadType.REVIEW,
                FILENAME, new ByteArrayInputStream(buildNaverReviewXlsx()));
    }

    private List<UUID> analysisIds() {
        return analyses.findAllByOrgIdOrderByCreatedAtDesc(org).stream().map(ItemAnalysis::getId).toList();
    }

    private UUID productIdBySku(String sku) {
        return products.findAllByOrgId(org).stream()
                .filter(p -> sku.equals(p.getSku()))
                .map(Product::getId)
                .findFirst()
                .orElseThrow(() -> new AssertionError("no product for sku " + sku));
    }

    /** A NAVER channel row — the connector's exists-guard prereq. Non-GMARKET → dedup key v1. */
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

    /**
     * A synthetic NAVER seller-center review export: 3 rows over 2 SKUs, two of them
     * negative (rating &lt;= 2) on the SAME SKU so the report has an unambiguous top issue.
     */
    private byte[] buildNaverReviewXlsx() throws Exception {
        return xlsx(new String[][] {
                {"RV-1001", SKU_MOLDING, PRODUCT_MOLDING, "1", "합성-리뷰-본문-A", "2026.01.02. 09:08:07"},
                {"RV-1002", SKU_MOLDING, PRODUCT_MOLDING, "2", "합성-리뷰-본문-B", "2026.01.03. 09:08:07"},
                {"RV-1003", SKU_CABLE, PRODUCT_CABLE, "5", "합성-리뷰-본문-C", "2026.01.04. 09:08:07"},
        });
    }

    /**
     * Header row uses the NAVER export labels already grounded in RowMapperTest /
     * FileParserTest, plus the sensitive 상품주문번호 / 등록자 columns which have no
     * canonical slot and must never be mapped. All cell values are synthetic.
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
}
