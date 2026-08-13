package com.sellerops.connector.coupang;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.community.Cafe24CommunityArticleRepository;
import com.sellerops.connector.DataType;
import com.sellerops.connector.FetchPage;
import com.sellerops.connector.FetchRequest;
import com.sellerops.credential.ConnectorCredentialRepository;
import com.sellerops.credential.CredentialVault;
import com.sellerops.ingest.IngestOutcome;
import com.sellerops.ingest.IngestionService;
import com.sellerops.ingest.canonical.CanonicalInquiry;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemAuditRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemPhase;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemWriter;
import com.sellerops.order.OrderDailySummaryRepository;
import com.sellerops.product.Product;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.ProductService;
import com.sellerops.review.ReviewRepository;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
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
import org.springframework.transaction.PlatformTransactionManager;

/**
 * The join between Coupang acquisition and routine operation, over the real (H2) DB: a 상품별
 * 고객문의 collected from the official endpoint flows through the shared, channel-neutral
 * {@link IngestionService#ingestInquiries} into a common {@code Inquiry} and — only when it is
 * actually actionable — exactly one OPEN {@code InquiryWorkItem} bound to that seller connection.
 *
 * <p>This is the seam worth testing rather than either side alone. The client's own contract is
 * covered in {@code CoupangInquiriesClientTest} and the ingestion path is covered channel-neutrally
 * elsewhere; what neither proves is that Coupang's shape actually satisfies the assumptions the
 * routine spine makes — that an already-answered inquiry becomes history and not a seller task,
 * that re-sweeping the same window is a no-op, that a platform answer closes the open task, and
 * that no buyer identity is persisted along the way.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class CoupangInquiryRoutineFlowTest {

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
    private final FakeCoupangHttpClient http = new FakeCoupangHttpClient();
    private final Clock clock = Clock.fixed(Instant.parse("2026-08-05T02:00:00Z"), ZoneOffset.UTC);

    private IngestionService ingestion;
    private CoupangApiConnector connector;

    @BeforeEach
    void setUp() {
        byte[] key = new byte[32];
        new SecureRandom().nextBytes(key);
        CredentialVault vault = new CredentialVault(credentials, new ObjectMapper(),
                Base64.getEncoder().encodeToString(key), "local-test-1");
        vault.store(org, account, "API", "HMAC",
                Map.of("access_key", "AK-1", "secret_key", "SK-1", "vendor_id", "A00012345"),
                null, null, null);
        ingestion = new IngestionService(reviews, inquiries, orders, new ProductService(products),
                communityArticles, channels, new InquiryWorkItemWriter(inquiries, workItems, audits, txManager));
        CoupangSigner signer = new CoupangSigner(clock);
        connector = new CoupangApiConnector(
                new CoupangOrdersClient(http, signer, clock, "https://api-gateway.coupang.com", "apr-test"),
                new CoupangInquiriesClient(http, signer, clock, "https://api-gateway.coupang.com", "apr-test"),
                vault);
    }

    private static CoupangHttpClient.Response json(String body) {
        return new CoupangHttpClient.Response(200, body, Map.of("Content-Type", "application/json"));
    }

    private static String page(String... items) {
        return "{\"code\":200,\"message\":\"OK\",\"data\":{\"content\":[" + String.join(",", items)
                + "],\"pagination\":{\"currentPage\":1,\"totalPages\":1,\"totalElements\":" + items.length
                + ",\"countPerPage\":50}}}";
    }

    private static String inquiry(long id, String content) {
        return "{\"inquiryId\":" + id + ",\"sellerProductId\":5551,\"vendorItemId\":99,\"content\":\""
                + content + "\",\"inquiryAt\":\"2026-08-04T09:30:00\",\"buyerEmail\":\"buyer@example.com\"}";
    }

    /**
     * Collect one window and ingest it. {@code unansweredItems} are served to the NOANSWER bucket
     * and {@code answeredItems} to the ANSWERED bucket — the order the client sweeps them in.
     */
    private IngestOutcome collectAndIngest(String unansweredItems, String answeredItems) {
        http.enqueue(json(unansweredItems));
        http.enqueue(json(answeredItems));
        FetchPage collected = connector.fetch(
                new FetchRequest(org, account, "COUPANG", DataType.INQUIRY, null, 50));
        @SuppressWarnings("unchecked")
        List<CanonicalInquiry> records = (List<CanonicalInquiry>) collected.records();
        return ingestion.ingestInquiries(org, channel, account, records);
    }

    @Test
    void anUnansweredInquiryBecomesExactlyOneOpenSellerTaskOnThatConnection() {
        IngestOutcome outcome = collectAndIngest(page(inquiry(4001, "언제 배송되나요")), page());

        assertThat(outcome.success()).isEqualTo(1);
        Inquiry stored = inquiries.findAll().get(0);
        assertThat(stored.getExternalId()).isEqualTo("onlineInquiry:4001");
        assertThat(stored.getStatus()).isEqualTo("UNANSWERED");
        assertThat(stored.getInformStatus()).isEqualTo("NOANSWER");
        assertThat(stored.getSellerAccountId()).isEqualTo(account);

        List<InquiryWorkItem> tasks = workItems.findAll();
        assertThat(tasks).hasSize(1);
        assertThat(tasks.get(0).getPhase()).isEqualTo(InquiryWorkItemPhase.OPEN);
        assertThat(tasks.get(0).getSellerAccountId()).isEqualTo(account);
    }

    @Test
    void anAlreadyAnsweredInquiryIsStoredAsHistoryWithoutOpeningASellerTask() {
        IngestOutcome outcome = collectAndIngest(page(), page(inquiry(4002, "이미 답변된 문의")));

        assertThat(outcome.success()).isEqualTo(1);
        assertThat(inquiries.findAll().get(0).getStatus()).isEqualTo("ANSWERED");
        // The seller already did this work on the platform; surfacing it as a task would be noise
        // that trains the operator to ignore the queue.
        assertThat(workItems.findAll()).isEmpty();
    }

    @Test
    void reSweepingTheSameWindowChangesNothing() {
        collectAndIngest(page(inquiry(4001, "언제 배송되나요")), page());
        IngestOutcome replay = collectAndIngest(page(inquiry(4001, "언제 배송되나요")), page());

        // The routine window deliberately overlaps the last one, so this happens on every run.
        assertThat(replay.success()).isZero();
        assertThat(replay.skipped()).isEqualTo(1);
        assertThat(inquiries.findAll()).hasSize(1);
        assertThat(workItems.findAll()).hasSize(1);
    }

    @Test
    void answeringOnThePlatformFlipsTheStoredStatusAndClosesTheOpenTask() {
        collectAndIngest(page(inquiry(4001, "언제 배송되나요")), page());
        assertThat(workItems.findAll().get(0).getPhase()).isEqualTo(InquiryWorkItemPhase.OPEN);

        // Next sweep: the same inquiry now comes back in the ANSWERED bucket.
        collectAndIngest(page(), page(inquiry(4001, "언제 배송되나요")));

        assertThat(inquiries.findAll()).hasSize(1);
        assertThat(inquiries.findAll().get(0).getStatus()).isEqualTo("ANSWERED");
        // The task the seller no longer has to do is completed, not left open and not reopened.
        assertThat(workItems.findAll().get(0).getPhase()).isNotEqualTo(InquiryWorkItemPhase.OPEN);
    }

    @Test
    void noBuyerIdentityIsPersistedAnywhereOnThePath() {
        collectAndIngest(page(inquiry(4001, "언제 배송되나요")), page());

        Inquiry stored = inquiries.findAll().get(0);
        // The payload carried buyerEmail; the connector never declares it, the canonical record
        // never carries it, and ingestion never writes the author column.
        assertThat(stored.getAuthor()).isNull();
        assertThat(stored.getBody()).doesNotContain("buyer@example.com");
        assertThat(stored.getTitle()).isNull();
        // Coupang does not classify 상품 Q&A secrecy — null, not a guessed false.
        assertThat(stored.getSecret()).isNull();
    }

    @Test
    void theInquiryAttachesToTheProductByTheChannelsOwnProductId() {
        collectAndIngest(page(inquiry(4001, "언제 배송되나요")), page());

        Inquiry stored = inquiries.findAll().get(0);
        Product product = products.findById(stored.getProductId()).orElseThrow();
        assertThat(product.getSku()).isEqualTo("5551");
        // No product-name field exists on this endpoint, so the name falls back to the key rather
        // than to something invented.
        assertThat(product.getName()).isEqualTo("5551");
    }
}
