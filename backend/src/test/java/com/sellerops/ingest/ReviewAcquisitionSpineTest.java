package com.sellerops.ingest;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.attention.OperatorAttentionService;
import com.sellerops.attention.dto.AttentionSignal;
import com.sellerops.attention.dto.OperatorAttentionSummary;
import com.sellerops.attention.dto.OperatorVocItem;
import com.sellerops.attention.dto.OperatorVocItemPage;
import com.sellerops.attention.reply.ReviewReplyApprovalRepository;
import com.sellerops.attention.reply.ReviewReplyDraftRepository;
import com.sellerops.attention.source.Cafe24VocItemSource;
import com.sellerops.attention.source.IngestedReviewVocItemSource;
import com.sellerops.attention.source.VocItemSourceRegistry;
import com.sellerops.attention.triage.ReviewTriageRepository;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.collect.runtime.CollectionMethod;
import com.sellerops.collect.runtime.CollectionRunService;
import com.sellerops.common.ReviewIdFingerprint;
import com.sellerops.community.Cafe24CommunityArticleRepository;
import com.sellerops.connector.ChannelConnectionStatusRepository;
import com.sellerops.connector.FileUploadConnector;
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
import com.sellerops.review.ReviewReplyState;
import com.sellerops.review.ReviewRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.sync.SyncJobRepository;
import java.io.ByteArrayInputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import org.assertj.core.groups.Tuple;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.PlatformTransactionManager;

/**
 * <b>Review Acquisition Spine v1 — the backend half of the joint.</b>
 *
 * <p>The collector's {@code review-acquisition-spine.test.ts} validates the COMMITTED golden export
 * ({@code contracts/review-export/naver/v1}) through the Action Window quarantine and reduces the
 * backend result to the engine's sanitized outcome. This test takes <b>the same file, byte for
 * byte</b>, and drives it through the real {@link FileUploadConnector} to operator-visible attention
 * signals. Neither side builds its own workbook: the artifact and {@code expected-rows.json} are the
 * joint, and its {@code fileSha256} is asserted here before a single row is read.
 *
 * <p><b>How this differs from {@code ExportToAttentionChainTest}.</b> That test builds a workbook
 * in-memory with POI and pins the upload→attention chain, the KST/UTC window seam, and the product
 * -name states ingest can produce. It remains the owner of all of that. What it cannot pin — because
 * its bytes exist only inside its own JVM — is that the artifact the COLLECTOR handles is the artifact
 * the backend ingests. That is the only thing this test adds, plus the two properties that ride on
 * the shared contract file: cross-port review-id fingerprint parity, and the NAVER-only source scope.
 *
 * <p><b>Offline and synthetic.</b> No live run, no marketplace, no gate consumed, no capability
 * promoted. The upload is recorded as {@code SELLER_CENTER_EXPORT} because that is the provenance an
 * Action Window handoff carries — not because any live export happened.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class ReviewAcquisitionSpineTest {

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
    @Autowired ReviewReplyDraftRepository replyDrafts;
    @Autowired ReviewReplyApprovalRepository replyApprovals;

    /** The shared contract directory — the same relative path the collector's loader resolves. */
    private static final Path CONTRACT_DIR = Path.of("..", "contracts", "review-export", "naver", "v1");
    private static final Path FIXTURE = CONTRACT_DIR.resolve("naver-review-export-v1.xlsx");
    private static final Path EMPTY_FIXTURE = CONTRACT_DIR.resolve("naver-review-export-empty-v1.xlsx");
    private static final Path EXPECTED_ROWS = CONTRACT_DIR.resolve("expected-rows.json");

    /** The multipart name an Action Window handoff sends: derived from the opaque ref, never the platform's. */
    private static final String FILENAME = "aw-00ff00ff00ff00ff.xlsx";

    private static JsonNode contract;

    private FileUploadConnector connector;
    private OperatorAttentionService attention;
    private final UUID org = UUID.randomUUID();
    private UUID naverChannelId;
    private UUID naverAccountId;
    private LocalDate from;
    private LocalDate to;

    @BeforeEach
    void setUp() throws Exception {
        contract = new ObjectMapper().readTree(Files.readString(EXPECTED_ROWS));
        from = LocalDate.parse(contract.get("window").get("from").asText());
        to = LocalDate.parse(contract.get("window").get("to").asText());

        ProductService productService = new ProductService(products);
        IngestionService ingestion = new IngestionService(reviews, inquiries, orders, productService,
                communityArticles, channels, new InquiryWorkItemWriter(inquiries, workItems, audits, txManager));
        CollectionRunService runs = new CollectionRunService(syncJobs, connectionStatus, sellerAccounts);
        ItemAnalysisService analysis = new ItemAnalysisService(inquiries, reviews, analyses,
                new RuleBasedInboxItemAnalyzer());
        connector = new FileUploadConnector(channels, new FileParser(), new ReviewRowMapper(),
                new InquiryRowMapper(), new OrderSummaryRowMapper(), ingestion, runs, analysis);
        // Both sources registered, as in production. The registry is first-wins, which is exactly what
        // the NAVER-only scope assertion below depends on.
        attention = new OperatorAttentionService(sellerAccounts, channels,
                new VocItemSourceRegistry(List.of(
                        new Cafe24VocItemSource(communityArticles),
                        new IngestedReviewVocItemSource(reviews, sellerAccounts, products, triage,
                                replyDrafts, replyApprovals))));

        naverChannelId = seedChannel("NAVER", "네이버 스마트스토어");
        // EXACTLY ONE account on this channel — a second trips the ambiguity guard (reviews carry no
        // seller_account_id) and every assertion below would pass or fail for the wrong reason.
        naverAccountId = seedAccount(naverChannelId);
    }

    // --- the joint --------------------------------------------------------------------

    @Test
    void theCommittedArtifactsAreTheOnesTheContractPins() throws Exception {
        // Asserted before anything is read: if a workbook were regenerated, every assertion below
        // would still be green while proving something about DIFFERENT bytes than the collector saw.
        assertThat(sha256(Files.readAllBytes(FIXTURE)))
                .as("contracts/review-export/naver/v1 :: fileSha256 — regenerating a workbook is a "
                        + "deliberate, visible event; update expected-rows.json in the same change")
                .isEqualTo(contract.get("fileSha256").asText());
        assertThat(sha256(Files.readAllBytes(EMPTY_FIXTURE)))
                .as("contracts/review-export/naver/v1 :: emptyFileSha256")
                .isEqualTo(contract.get("emptyFileSha256").asText());
    }

    @Test
    void theRealExportsTimestampFormParsesAndLandsInTheOperatorsWindow() throws Exception {
        // The real export writes `yyyy.MM.dd. HH:mm:ss`, not a bare date. DateParse splits on the
        // space and strips the trailing dot; the time-of-day is dropped to UTC start-of-day. Nothing
        // asserted that end to end while the fixture carried date-only values.
        assertThat(contract.get("reviewDateFormat").asText()).isEqualTo("yyyy.MM.dd. HH:mm:ss");

        ingestFixture();

        for (JsonNode row : contract.get("rows")) {
            LocalDate day = LocalDate.parse(row.get("reviewDate").asText().substring(0, 10),
                    DateTimeFormatter.ofPattern("yyyy.MM.dd"));
            Instant expected = day.atStartOfDay(ZoneOffset.UTC).toInstant();
            assertThat(reviews.findAllByOrgId(org))
                    .as("row %s receivedAt", row.get("channelReviewId").asText())
                    .anySatisfy(review -> {
                        assertThat(review.getExternalId()).isEqualTo(row.get("channelReviewId").asText());
                        assertThat(review.getReceivedAt()).isEqualTo(expected);
                    });
            assertThat(day).isBetween(from, to);   // …and inside the window the operator asks about
        }
    }

    @Test
    void theCommittedExportIngestsExactlyTheRowsTheContractDeclares() throws Exception {
        IngestResult result = ingestFixture();

        JsonNode expected = contract.get("expectedIngest");
        assertThat(result.status()).isEqualTo(expected.get("status").asText());
        assertThat(result.successRows()).isEqualTo(expected.get("successRows").asInt());
        assertThat(result.skippedRows()).isEqualTo(expected.get("skippedRows").asInt());
        assertThat(result.failedRows()).isEqualTo(expected.get("failedRows").asInt());

        // Every declared row is present, keyed on the channel's own review id.
        for (JsonNode row : contract.get("rows")) {
            String channelReviewId = row.get("channelReviewId").asText();
            assertThat(reviews.findAllByOrgId(org))
                    .as("row %s", channelReviewId)
                    .anySatisfy(review -> {
                        assertThat(review.getExternalId()).isEqualTo(channelReviewId);
                        assertThat(review.getRating()).isEqualTo(row.get("rating").asInt());
                        assertThat(review.getBody()).isEqualTo(row.get("body").asText());
                    });
        }
    }

    @Test
    void theUnmappedExportColumnsNeverReachAStoredField() throws Exception {
        ingestFixture();

        // 등록자 / 상품주문번호 / 유저정보 등록 항목 have no canonical slot, and they are the PII-class
        // columns of a real export. The fixture plants loud sentinels precisely so this has something
        // real to fail on if a mapping ever widens by accident.
        //
        // Asserted over the STORED FIELDS, not over `toString()`. These entities carry only Lombok's
        // @Getter/@Setter — no @ToString, no @Data — so `toString()` is Object's identity hash and a
        // `doesNotContain` against it can never fail. A privacy guard that cannot fail is worse than
        // none: it gets cited as evidence. Every field ingest can write is checked by name.
        JsonNode sentinels = contract.get("unmappedSentinels");
        List<Review> stored = reviews.findAllByOrgId(org);
        assertThat(stored).isNotEmpty();   // non-vacuity: there are rows to inspect
        sentinels.fieldNames().forEachRemaining(header -> {
            String sentinel = sentinels.get(header).asText();
            assertThat(stored).allSatisfy(review -> {
                assertThat(review.getBody()).doesNotContain(sentinel);
                assertThat(review.getExternalId()).doesNotContain(sentinel);
                assertThat(String.valueOf(review.getContentHash())).doesNotContain(sentinel);
            });
            assertThat(products.findAllByOrgId(org)).allSatisfy(product -> {
                assertThat(String.valueOf(product.getName())).doesNotContain(sentinel);
                assertThat(String.valueOf(product.getSku())).doesNotContain(sentinel);
            });
        });
    }

    @Test
    void theReviewIdFingerprintAgreesWithTheCollectorPortOnTheSpinesOwnData() throws Exception {
        ingestFixture();

        // The recorded values come from the contract file; the collector's TS port asserts the SAME
        // values in review-acquisition-spine.test.ts. Parity is therefore checked on the data the
        // spine actually carries, not only on the contract's abstract golden vectors.
        for (JsonNode row : contract.get("rows")) {
            String channelReviewId = row.get("channelReviewId").asText();
            assertThat(ReviewIdFingerprint.of(channelReviewId))
                    .as("review-id-fingerprint/v1 :: %s", channelReviewId)
                    .isEqualTo(row.get("reviewIdFingerprint").asText());
        }

        // …and the ids the fingerprints are taken over are the ids that were actually persisted.
        assertThat(reviews.findAllByOrgId(org))
                .extracting(Review::getExternalId)
                .containsExactlyInAnyOrderElementsOf(
                        contract.get("rows").findValuesAsText("channelReviewId"));
    }

    @Test
    void theExportsReplyStateIsPreservedRowByRow() throws Exception {
        // 답글여부 / 답글등록일시 are real columns the pipeline used to drop. On a real export a third
        // of the low-rating rows were already answered, so dropping them inflated the operator's
        // queue and pointed the guided reply flow at reviews that already had a public reply.
        ingestFixture();

        JsonNode expected = contract.get("expectedReplyState");
        for (JsonNode id : expected.get("answeredChannelReviewIds")) {
            assertThat(storedById(id.asText()).getReplyState()).isEqualTo(ReviewReplyState.ANSWERED);
        }
        for (JsonNode id : expected.get("pendingChannelReviewIds")) {
            assertThat(storedById(id.asText()).getReplyState()).isEqualTo(ReviewReplyState.PENDING);
        }
        // The reply timestamp lands on exactly the rows that carry one, at UTC start-of-day.
        expected.get("repliedAtUtcStartOfDay").fields().forEachRemaining(entry ->
                assertThat(storedById(entry.getKey()).getRepliedAt())
                        .isEqualTo(Instant.parse(entry.getValue().asText())));
        for (JsonNode id : expected.get("pendingChannelReviewIds")) {
            assertThat(storedById(id.asText()).getRepliedAt()).isNull();
        }
    }

    @Test
    void theFollowUpRowIsItsOwnReviewAndItsCopiedParentBodyCreatesNoSecondOne() throws Exception {
        // 관련리뷰상세내용 was investigated and dismissed: on a real export it duplicated the linked
        // review's own body in 1,157 of 1,157 resolvable cases. The fixture reproduces that shape (a
        // 한달사용 row carrying 관련리뷰글번호 + a copy of the parent's body), and this pins the
        // consequence — the copy must never mint a second review or leak into another row's body.
        ingestFixture();

        JsonNode followUp = contract.get("rows").get(2);          // 1000000003, 한달사용
        JsonNode parent = contract.get("rows").get(0);            // 1000000001, its 관련리뷰글번호
        assertThat(followUp.get("relatedReviewId").asText()).isEqualTo(parent.get("channelReviewId").asText());

        assertThat(reviews.findAllByOrgId(org)).hasSize(contract.get("rows").size());
        assertThat(storedById(followUp.get("channelReviewId").asText()).getBody())
                .isEqualTo(followUp.get("body").asText());        // its OWN body, not the parent's
        assertThat(reviews.findAllByOrgId(org))
                .filteredOn(r -> parent.get("body").asText().equals(r.getBody()))
                .hasSize(1);                                      // the parent's body exists exactly once
    }

    // --- operator visibility ----------------------------------------------------------

    @Test
    void theIngestedExportBecomesOperatorAttentionSignals() throws Exception {
        ingestFixture();

        OperatorAttentionSummary summary = attention.attention(org, naverAccountId, from, to);

        assertThat(summary.channel()).isEqualTo("네이버 스마트스토어");
        // containsExactly, not contains: the ABSENCE of a signal is part of what the operator sees.
        // The expected set comes from the CONTRACT, which the collector's E2E asserts against the
        // live HTTP payload and the frontend asserts its selector over — one declaration, three
        // ports, no cross-stack imports.
        assertThat(summary.items())
                .extracting(AttentionSignal::type, AttentionSignal::severity, AttentionSignal::count,
                        AttentionSignal::sourceType)
                .containsExactlyElementsOf(expectedAttentionTuples());
    }

    @Test
    void theOperatorCanDrillIntoTheReviewsNeedingAttention() throws Exception {
        ingestFixture();

        OperatorVocItemPage page = attention.attentionItems(
                org, naverAccountId, "LOW_RATING_REVIEW", from, to, 0, 20);

        // TWO, not three: the export's 2★ row carries 답글여부=Y, so the channel already answered it
        // and it leaves the queue. The count says the same — see the signals test — because the list
        // and the count apply one predicate.
        assertThat(page.items()).hasSize(2);
        assertThat(page.items()).extracting(OperatorVocItem::replyStatus)
                .doesNotContain("ANSWERED");
        // The display name resolves (the rows carry both 상품명 and 상품번호) and the SKU — the
        // channel's productNo, an identity value — never rides along.
        assertThat(page.items()).allSatisfy(item -> {
            assertThat(item.productName()).isNotBlank();
            assertThat(item.toString()).doesNotContain("SKU-");
        });
    }

    @Test
    void reIngestingTheSameExportIsIdempotentAndLeavesTheOperatorsSignalsUnmoved() throws Exception {
        ingestFixture();
        List<AttentionSignal> before = attention.attention(org, naverAccountId, from, to).items();

        IngestResult second = ingestFixture();

        JsonNode expected = contract.get("expectedReingest");
        assertThat(second.status()).isEqualTo(expected.get("status").asText());
        assertThat(second.successRows()).isEqualTo(expected.get("successRows").asInt());
        assertThat(second.skippedRows()).isEqualTo(expected.get("skippedRows").asInt());
        assertThat(reviews.findAllByOrgId(org)).hasSize(contract.get("rows").size());
        // A re-run of the loop is not six new bad reviews.
        assertThat(attention.attention(org, naverAccountId, from, to).items()).isEqualTo(before);
    }

    // --- scope ------------------------------------------------------------------------

    @Test
    void theIngestedReviewSourceServesNaverOnly() throws Exception {
        // The same export uploaded against a CAFE24 channel reaches the `reviews` store — /api/uploads
        // accepts any existing channel — but MUST NOT surface through the ingested-review source:
        // CAFE24 is owned by Cafe24VocItemSource (the community-article store), and the registry is
        // first-wins. Double-counting here would make an operator's counts depend on bean order.
        UUID cafe24Channel = seedChannel("CAFE24", "카페24");
        UUID cafe24Account = seedAccount(cafe24Channel);
        connector.ingest(org, cafe24Channel, UploadType.REVIEW, FILENAME,
                new ByteArrayInputStream(Files.readAllBytes(FIXTURE)), CollectionMethod.SELLER_CENTER_EXPORT);

        // The rows really are in the store — otherwise the assertion below would pass vacuously.
        assertThat(reviews.findAllByOrgId(org)).hasSize(contract.get("rows").size());

        assertThat(attention.attention(org, cafe24Account, from, to).items())
                .as("CAFE24 must not serve ingested reviews")
                .isEmpty();
    }

    @Test
    void anEmptyButValidExportIngestsCleanlyAndSurfacesNothing() throws Exception {
        // A quiet date range is a legitimate seller outcome, and a real header-only export has been
        // observed. It must ingest as an honest zero — not fail, and not invent activity.
        IngestResult result = connector.ingest(org, naverChannelId, UploadType.REVIEW, FILENAME,
                new ByteArrayInputStream(Files.readAllBytes(EMPTY_FIXTURE)), CollectionMethod.SELLER_CENTER_EXPORT);

        JsonNode expected = contract.get("expectedEmptyIngest");
        assertThat(result.status()).isEqualTo(expected.get("status").asText());
        assertThat(result.successRows()).isEqualTo(expected.get("successRows").asInt());
        assertThat(result.failedRows()).isEqualTo(expected.get("failedRows").asInt());
        assertThat(reviews.findAllByOrgId(org)).isEmpty();
        assertThat(attention.attention(org, naverAccountId, from, to).items()).isEmpty();
    }

    @Test
    void thatSameEmptyFileStillFailsWhenAHUMANUploadedIt() throws Exception {
        // The distinction is provenance, not emptiness — and it must be pinned in both directions or
        // the rule reads as "empty is always fine". A person who picks an empty file almost certainly
        // picked the wrong one; the Action Window hands over what the platform produced for the range
        // the seller chose. Same bytes, different question, deliberately different answer.
        IngestResult manual = connector.ingest(org, naverChannelId, UploadType.REVIEW, "review_export.xlsx",
                new ByteArrayInputStream(Files.readAllBytes(EMPTY_FIXTURE)), CollectionMethod.MANUAL_UPLOAD);

        assertThat(manual.status()).isEqualTo("FAILED");
        assertThat(manual.totalRows()).isZero();
    }

    @Test
    void anUnreadableExportIsNeverReportedAsAnHonestZero() throws Exception {
        // The guard on the rule above: a parse failure also lands with zero rows, and it must stay an
        // error. "We could not read it" must never be reported as "there was nothing in it".
        IngestResult broken = connector.ingest(org, naverChannelId, UploadType.REVIEW, FILENAME,
                new ByteArrayInputStream("not a workbook".getBytes(java.nio.charset.StandardCharsets.UTF_8)),
                CollectionMethod.SELLER_CENTER_EXPORT);

        assertThat(broken.status()).isEqualTo("FAILED");
        assertThat(broken.errorMessage()).isNotBlank();
    }

    // --- fixtures ---------------------------------------------------------------------

    /** Ingest the committed artifact exactly as an Action Window handoff would. */
    private IngestResult ingestFixture() throws Exception {
        return connector.ingest(org, naverChannelId, UploadType.REVIEW, FILENAME,
                new ByteArrayInputStream(Files.readAllBytes(FIXTURE)), CollectionMethod.SELLER_CENTER_EXPORT);
    }

    /** The contract's declared attention signals, as assertion tuples. */
    private List<Tuple> expectedAttentionTuples() {
        List<Tuple> tuples = new ArrayList<>();
        for (JsonNode signal : contract.get("expectedAttention").get("signals")) {
            tuples.add(tuple(signal.get("type").asText(), signal.get("severity").asText(),
                    signal.get("count").asLong(), signal.get("sourceType").asText()));
        }
        return tuples;
    }

    /** The stored review carrying that channel review id — fails loudly if ingest produced none. */
    private Review storedById(String channelReviewId) {
        return reviews.findAllByOrgId(org).stream()
                .filter(r -> channelReviewId.equals(r.getExternalId()))
                .findFirst()
                .orElseThrow(() -> new AssertionError("no stored review for " + channelReviewId));
    }

    private static String sha256(byte[] bytes) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    }

    private UUID seedChannel(String code, String nameKo) {
        Channel ch = new Channel();
        ch.setCode(code);
        ch.setNameKo(nameKo);
        ch.setStatus(ChannelStatus.AVAILABLE);
        ch.setSupportsInquiry(true);
        ch.setSupportsReview(true);
        ch.setSupportsOrder(true);
        ch.setSupportsSales(true);
        ch.setSupportsProduct(true);
        ch.setSortOrder(0);
        return channels.save(ch).getId();
    }

    /** The org's ONLY account on that channel — see the note in setUp. */
    private UUID seedAccount(UUID channel) {
        SellerAccount acc = new SellerAccount();
        acc.setOrgId(org);
        acc.setChannelId(channel);
        acc.setConnectionStatus(ChannelStatus.CONNECTED);
        acc.setFileUpload(true);   // these reviews arrive by seller-center export
        return sellerAccounts.save(acc).getId();
    }
}
