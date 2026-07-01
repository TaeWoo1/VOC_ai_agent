package com.sellerops.ingest;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.community.Cafe24CommunityArticleRepository;
import com.sellerops.ingest.canonical.CanonicalReview;
import com.sellerops.ingest.map.MapResult;
import com.sellerops.ingest.map.ReviewRowMapper;
import com.sellerops.ingest.parse.FileParser;
import com.sellerops.ingest.parse.ParsedTable;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.order.OrderDailySummaryRepository;
import com.sellerops.product.Product;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.ProductService;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.time.Instant;
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

/**
 * Slice 4: verify the Slice 3 grounded ESM+ REVIEW aliases through the REAL
 * parse -> map -> ingest -> persist chain on in-memory H2 (the Slice 3 unit test
 * built a ParsedTable directly, bypassing FileParser). Drives a synthetic ESM+-
 * shaped .xlsx built with POI. The mapped-field HEADERS are the real captured
 * labels already committed in Slice 3 (schema-alias source exception); excluded
 * columns stay SYNTHETIC (esm_..._합성) and all CELL VALUES are synthetic. This
 * establishes at most "backend ingest-path mapping verified" — schemaMapping and
 * dedup remain unconfirmed.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class EsmReviewIngestFlowTest {

    @Autowired ReviewRepository reviews;
    @Autowired InquiryRepository inquiries;
    @Autowired OrderDailySummaryRepository orders;
    @Autowired ProductRepository products;
    @Autowired Cafe24CommunityArticleRepository communityArticles;

    private final FileParser parser = new FileParser();
    private final ReviewRowMapper mapper = new ReviewRowMapper();
    private IngestionService service;

    private final UUID org = UUID.randomUUID();
    private final UUID channel = UUID.randomUUID(); // ESM+ = GMARKET; service keys on the UUID, no FK

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
        service = new IngestionService(reviews, inquiries, orders, new ProductService(products),
                communityArticles);
    }

    @Test
    void ingestsSyntheticEsmReviewXlsxThroughRealParseMapPersistChain() throws Exception {
        List<CanonicalReview> rows = parseAndMap(buildEsmReviewXlsx());
        assertThat(rows).hasSize(2);

        IngestOutcome outcome = service.ingestReviews(org, channel, rows);
        assertThat(outcome.success()).isEqualTo(2);
        assertThat(outcome.skipped()).isZero();
        assertThat(outcome.failed()).isZero();

        List<Review> persisted = reviews.findAllByOrgId(org);
        assertThat(persisted).hasSize(2);

        Review a = persisted.stream().filter(r -> BODY_A.equals(r.getBody())).findFirst().orElseThrow();
        Review b = persisted.stream().filter(r -> BODY_B.equals(r.getBody())).findFirst().orElseThrow();

        // Grounded mapped fields persist correctly (body / rating / date), and the
        // ESM+ dedup key is the content hash (no external id column exists).
        assertThat(a.getRating()).isEqualTo(5);
        assertThat(a.isNegative()).isFalse();
        assertThat(a.getReceivedAt()).isEqualTo(Instant.parse("2026-02-03T00:00:00Z"));
        assertThat(a.getExternalId()).isNull();
        assertThat(a.getContentHash()).isNotNull().hasSize(64); // SHA-256 hex
        assertThat(a.getProductId()).isNotNull();

        assertThat(b.getRating()).isEqualTo(2);
        assertThat(b.isNegative()).isTrue(); // rating <= 2 → negative derivation
        assertThat(b.getReceivedAt()).isEqualTo(Instant.parse("2026-02-04T00:00:00Z"));

        // product / sku grounded through resolveOrCreate; one product for the shared SKU.
        Product product = products.findByOrgIdAndSku(org, SKU).orElseThrow();
        assertThat(product.getName()).isEqualTo(PRODUCT);
        assertThat(products.findAllByOrgId(org)).hasSize(1);

        // Exclusion invariant at the persistence layer: no excluded sentinel reaches any field.
        for (Review r : persisted) {
            assertThat(r.getBody()).isNotIn(REPLY, ORDER, BUYER);
            assertThat(r.getExternalId()).isNull();
        }
        assertThat(product.getName()).isNotIn(REPLY, ORDER, BUYER);
        assertThat(product.getSku()).isNotIn(REPLY, ORDER, BUYER);
    }

    @Test
    void reUploadOfTheSameSyntheticEsmXlsxDedupsByContentHash() throws Exception {
        byte[] bytes = buildEsmReviewXlsx();

        IngestOutcome first = service.ingestReviews(org, channel, parseAndMap(bytes));
        assertThat(first.success()).isEqualTo(2);
        assertThat(reviews.findAllByOrgId(org)).hasSize(2);

        // Re-parse + re-map + re-ingest the identical bytes: same channel + resolved
        // product + date + body → same content hash → every row dedups (skip-if-exists).
        IngestOutcome second = service.ingestReviews(org, channel, parseAndMap(bytes));
        assertThat(second.success()).isZero();
        assertThat(second.skipped()).isEqualTo(2);
        assertThat(reviews.findAllByOrgId(org)).hasSize(2);
    }

    private List<CanonicalReview> parseAndMap(byte[] bytes) {
        ParsedTable table = parser.parse("esm_review_synthetic.xlsx", new ByteArrayInputStream(bytes));
        MapResult<CanonicalReview> r = mapper.map(table);
        assertThat(r.errors()).isEmpty();
        return r.ok();
    }

    /**
     * A synthetic ESM+ REVIEW export. Header row uses the real grounded mapped
     * headers already committed in Slice 3 (body / product-name / product-number /
     * rating / receipt-date) plus synthetic excluded columns; every data value is
     * synthetic. The receipt-date value uses a DateParse-supported ISO date — the
     * real ESM+ date-string format was never captured (only header labels were).
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
            writeRow(sheet, 1, BODY_A, PRODUCT, SKU, "5", "2026-02-03");
            writeRow(sheet, 2, BODY_B, PRODUCT, SKU, "2", "2026-02-04");
            wb.write(out);
            return out.toByteArray();
        }
    }

    private void writeRow(Sheet sheet, int rowIdx, String body, String product, String sku,
            String rating, String date) {
        Row r = sheet.createRow(rowIdx);
        r.createCell(0).setCellValue(body);
        r.createCell(1).setCellValue(product);
        r.createCell(2).setCellValue(sku);
        r.createCell(3).setCellValue(rating);
        r.createCell(4).setCellValue(date);
        r.createCell(5).setCellValue(REPLY);
        r.createCell(6).setCellValue(ORDER);
        r.createCell(7).setCellValue(BUYER);
    }
}
