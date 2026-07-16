package com.sellerops.ingest;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;

import com.sellerops.attention.OperatorAttentionService;
import com.sellerops.attention.dto.AttentionSignal;
import com.sellerops.attention.dto.OperatorAttentionSummary;
import com.sellerops.attention.dto.OperatorVocItem;
import com.sellerops.attention.dto.OperatorVocItemPage;
import com.sellerops.attention.source.Cafe24VocItemSource;
import com.sellerops.attention.source.IngestedReviewVocItemSource;
import com.sellerops.attention.source.VocItemSourceRegistry;
import com.sellerops.attention.triage.ReviewTriageRepository;
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
 * would be duplicate surface that drifts. The unique value is the join: it arrives, and a
 * duplicate export does not move it.
 *
 * <p><b>Plus what the join surfaces as a product name</b>, which lives here for one reason:
 * the states that matter are ones INGEST produces, not ones a test can fairly seed by hand.
 * A row with a 상품번호 but a blank 상품명 makes {@code ProductService} store the SKU AS the
 * product's name, and a row with neither makes {@code ReviewRowMapper} mint its placeholder
 * — both invisible to any test that builds a {@code Product} directly. An earlier version of
 * this feature asserted "the SKU never surfaces" against a hand-seeded product whose name
 * and SKU differed, so the assertion could not fail on the one path where it did. Driving
 * the real upload is what makes that evidence real.
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
    @Autowired ReviewTriageRepository triage;

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
    // A distinct synthetic 상품번호 for the name-less row, so it mints its own product rather
    // than resolving onto SKU's (resolveOrCreate keys on sku and never renames an existing row).
    private static final String SKU_ONLY = "SKU-합성-88";

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
                        new IngestedReviewVocItemSource(reviews, sellerAccounts, products, triage))));

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

    // --- what the join surfaces as a product name ------------------------------------

    @Test
    void anExportRowCarryingBothNameAndSkuSurfacesTheNameAndNeverTheSku() throws Exception {
        // The positive control for the two null cases below. Without it they could both pass
        // on a chain that resolves NO name at all, and the "never leaks the SKU" assertions
        // would be worthless. This proves the pipeline genuinely produces a name here.
        ingest(xlsx(new String[][] {
                {"RV-1001", SKU, PRODUCT, "1", "합성-리뷰-본문-A", "2026.05.05."},
        }));

        OperatorVocItem item = onlyDrilledItem();

        assertThat(item.productName()).isEqualTo(PRODUCT);
        assertThat(item.toString()).doesNotContain(SKU);
    }

    @Test
    void anExportRowWithASkuButNoProductNameNeverShowsTheSkuAsItsName() throws Exception {
        // THE REGRESSION THIS EXISTS FOR. A blank 상품명 cell is not exotic — HeaderAliases.pick
        // treats blank as absent, and ReviewRowMapper's placeholder fires only when BOTH the
        // name and the sku are missing. So this row reaches ProductService with (name=null,
        // sku=SKU_ONLY), and it stores the SKU AS THE NAME. A read that trusted `name` would
        // publish 상품번호 — the channel's productNo — in the display field.
        //
        // Driven through the REAL FileUploadConnector rather than a hand-seeded product,
        // because the whole point is that INGEST produces this state: a fixture asserting on
        // a product built by hand is what let the original bug through.
        ingest(xlsx(new String[][] {
                {"RV-2001", SKU_ONLY, "", "1", "합성-리뷰-본문-상품명없음", "2026.05.05."},
        }));

        // Precondition: ingest really did store the SKU as the name. If this ever stops being
        // true the test below would pass for the wrong reason, so assert the trap is set.
        assertThat(products.findAllByOrgId(org)).singleElement().satisfies(p -> {
            assertThat(p.getSku()).isEqualTo(SKU_ONLY);
            assertThat(p.getName()).isEqualTo(SKU_ONLY);     // name == sku, straight from ingest
        });

        OperatorVocItem item = onlyDrilledItem();

        assertThat(item.productName()).isNull();
        assertThat(item.toString()).doesNotContain(SKU_ONLY);
    }

    @Test
    void anExportRowWithNeitherNameNorSkuNeverShowsIngestsPlaceholder() throws Exception {
        // Exercises the REAL placeholder path: ReviewRowMapper mints "(미지정 상품)" and passes
        // it to ProductService as a NON-NULL name, so the stored value comes from the mapper's
        // literal — not ProductService's fallback. Pinning it here means changing the mapper's
        // literal breaks this test, which a unit test driving ProductService directly would not.
        // Body deliberately avoids the placeholder's own wording — otherwise the sweep below
        // would trip on safePreview echoing the fixture rather than on a real leak.
        ingest(xlsx(new String[][] {
                {"RV-3001", "", "", "1", "합성-리뷰-본문-이름없음", "2026.05.05."},
        }));

        // Non-vacuity, and the pin itself: ingest DID mint a name for this row — the product
        // exists and is named — yet attention withholds it. Asserted WITHOUT naming the
        // literal, deliberately: the coupling is pinned by behaviour, so if ReviewRowMapper's
        // placeholder ever changes, the product stays named, the source's constant stops
        // matching, and the null assertion below fails. That is the alarm, and it does not
        // depend on this test knowing the string.
        assertThat(products.findAllByOrgId(org)).singleElement().satisfies(p -> {
            assertThat(p.getSku()).isNull();
            assertThat(p.getName()).isNotBlank();
        });

        OperatorVocItem item = onlyDrilledItem();

        assertThat(item.productName()).isNull();
        assertThat(item.toString()).doesNotContain("미지정");
    }

    // --- fixtures --------------------------------------------------------------------

    private void ingest(byte[] file) {
        IngestResult result = connector.ingest(org, channelId, UploadType.REVIEW,
                FILENAME, new ByteArrayInputStream(file));
        assertThat(result.status()).isEqualTo("SUCCESS");
    }

    /** The single row behind LOW_RATING_REVIEW — fails loudly if the chain produced none. */
    private OperatorVocItem onlyDrilledItem() {
        OperatorVocItemPage page = attention.attentionItems(
                org, accountId, "LOW_RATING_REVIEW", FROM, TO, 0, 20);
        assertThat(page.items()).hasSize(1);
        return page.items().get(0);
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
