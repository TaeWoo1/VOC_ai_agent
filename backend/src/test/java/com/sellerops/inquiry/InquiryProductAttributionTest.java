package com.sellerops.inquiry;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.common.DataOrigin;
import com.sellerops.community.Cafe24CommunityArticleRepository;
import com.sellerops.ingest.IngestionService;
import com.sellerops.ingest.canonical.CanonicalInquiry;
import com.sellerops.ingest.canonical.ChannelProductRef;
import com.sellerops.inquiry.workitem.InquiryWorkItemAuditRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemPhase;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemWriter;
import com.sellerops.order.OrderDailySummaryRepository;
import com.sellerops.product.ChannelProduct;
import com.sellerops.product.ChannelProductRepository;
import com.sellerops.product.Product;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.ProductService;
import com.sellerops.review.ReviewRepository;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.data.domain.Pageable;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.PlatformTransactionManager;

/**
 * How an inquiry finds its product — and, more importantly, what it does when it cannot.
 *
 * <p>The Cafe24 backlog is the case that motivated every assertion here. Its inquiries used to reach
 * a product through {@code resolve-or-create} keyed on {@code products.sku}, carrying the mall's
 * {@code product_no} as that sku. Those are different key spaces: {@code product_no} identifies a
 * LISTING and {@code sku} is the seller's own code. When they disagreed the ingest invented a product
 * named after the number, and when the article carried no number at all it pointed the row at one
 * shared bucket. Either way {@code product_id} came out non-null, so every reader downstream — the
 * queue, the dashboard, the draft composer — was told the inquiry was attributed.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class InquiryProductAttributionTest {

    @Autowired ReviewRepository reviews;
    @Autowired InquiryRepository inquiries;
    @Autowired OrderDailySummaryRepository orders;
    @Autowired ProductRepository products;
    @Autowired ChannelProductRepository channelProducts;
    @Autowired Cafe24CommunityArticleRepository articles;
    @Autowired ChannelRepository channels;
    @Autowired InquiryWorkItemRepository workItems;
    @Autowired InquiryWorkItemAuditRepository audits;
    @Autowired PlatformTransactionManager txManager;

    private final UUID org = UUID.randomUUID();
    private final UUID account = UUID.randomUUID();
    private UUID channelId;
    private IngestionService ingestion;

    @BeforeEach
    void setUp() {
        Channel c = new Channel();
        c.setCode("CAFE24");
        c.setNameKo("카페24");
        c.setStatus(ChannelStatus.AVAILABLE);
        c.setSupportsInquiry(true);
        c.setSupportsReview(false);
        c.setSupportsOrder(false);
        c.setSupportsSales(false);
        c.setSupportsProduct(false);
        c.setSortOrder(0);
        channelId = channels.save(c).getId();
        ingestion = new IngestionService(reviews, inquiries, orders, new ProductService(products),
                articles, channels, new InquiryWorkItemWriter(inquiries, workItems, audits, txManager),
                channelProducts);
    }

    /** A canonical product with a listing on this channel, keyed by the mall's product number. */
    private UUID seedListing(String externalProductId, String sku, String name) {
        Product p = new Product();
        p.setOrgId(org);
        p.setName(name);
        p.setSku(sku);
        p.setStatus("ACTIVE");
        UUID productId = products.save(p).getId();

        ChannelProduct listing = new ChannelProduct();
        listing.setOrgId(org);
        listing.setChannelId(channelId);
        listing.setExternalProductId(externalProductId);
        listing.setProductId(productId);
        channelProducts.save(listing);
        return productId;
    }

    private static CanonicalInquiry inquiry(String externalId, String productNo) {
        return new CanonicalInquiry(null, null, null, "문의 본문", "UNANSWERED",
                Instant.parse("2026-08-20T00:00:00Z"), externalId, 1, "제목", "N", false,
                null, ChannelProductRef.of(productNo), null, null);
    }

    private Inquiry stored(String externalId) {
        return inquiries.findByOrgIdAndChannelIdAndExternalId(org, channelId, externalId).orElseThrow();
    }

    @Test
    @DisplayName("the mall's product number attributes to the listing's canonical product, exactly")
    void exactListingMatch() {
        // The sku deliberately differs from the product number — a seller who set a custom_product_code.
        // That is the shape the old sku-keyed path could not attribute and invented a product for.
        UUID productId = seedListing("91", "NA-44", "패밀리 6p");

        ingestion.ingestInquiries(org, channelId, account, List.of(inquiry("cafe24:b6:a1", "91")));

        Inquiry q = stored("cafe24:b6:a1");
        assertThat(q.getProductId()).isEqualTo(productId);
        assertThat(q.getSourceProductRef()).isEqualTo("91");
        // Nothing was created: the catalogue still holds exactly the one product seeded above.
        assertThat(products.findAll()).hasSize(1);
    }

    @Test
    @DisplayName("a product number with no listing is unattributed — and the number is kept")
    void unknownListingIsUnattributedNotInvented() {
        ingestion.ingestInquiries(org, channelId, account, List.of(inquiry("cafe24:b6:a2", "4242")));

        Inquiry q = stored("cafe24:b6:a2");
        assertThat(q.getProductId()).isNull();
        // The identifier survives, so this row is repairable by a later catalogue read. Before the
        // column existed it was spent on resolve-or-create and gone.
        assertThat(q.getSourceProductRef()).isEqualTo("4242");
        assertThat(products.findAll()).isEmpty();
    }

    @Test
    @DisplayName("no product number at all is unattributed, not bucketed into a shared placeholder")
    void noIdentifierIsUnattributed() {
        ingestion.ingestInquiries(org, channelId, account, List.of(inquiry("cafe24:b6:a3", null)));

        Inquiry q = stored("cafe24:b6:a3");
        assertThat(q.getProductId()).isNull();
        assertThat(q.getSourceProductRef()).isNull();
        // The "(미지정 상품)" row is never minted. Its existence is what made 3,415 rows read as
        // attributed while naming nothing.
        assertThat(products.findAll()).isEmpty();
    }

    @Test
    @DisplayName("a listing belonging to another org never names this org's product")
    void listingIsOrgScoped() {
        Product foreign = new Product();
        foreign.setOrgId(UUID.randomUUID());
        foreign.setName("남의 상품");
        foreign.setStatus("ACTIVE");
        UUID foreignProduct = products.save(foreign).getId();
        ChannelProduct listing = new ChannelProduct();
        listing.setOrgId(foreign.getOrgId());
        listing.setChannelId(channelId);
        listing.setExternalProductId("777");
        listing.setProductId(foreignProduct);
        channelProducts.save(listing);

        ingestion.ingestInquiries(org, channelId, account, List.of(inquiry("cafe24:b6:a4", "777")));

        assertThat(stored("cafe24:b6:a4").getProductId()).isNull();
    }

    @Test
    @DisplayName("a re-read attributes a row whose listing arrived after it did")
    void reReadRepairsAnAttributionThatWasNotPossibleBefore() {
        // The inquiry lands before the catalogue read that would explain it — the ordinary order of
        // events on a mall connected for inquiries before products.
        ingestion.ingestInquiries(org, channelId, account, List.of(inquiry("cafe24:b6:a5", "103")));
        assertThat(stored("cafe24:b6:a5").getProductId()).isNull();

        UUID productId = seedListing("103", "103", "w&b 패밀리");

        // Same row, unchanged content. The repair happens on the unchanged branch precisely because a
        // backlog that never changes again would otherwise never be attributed.
        ingestion.ingestInquiries(org, channelId, account, List.of(inquiry("cafe24:b6:a5", "103")));

        assertThat(stored("cafe24:b6:a5").getProductId()).isEqualTo(productId);
    }

    @Test
    @DisplayName("a re-read never moves an attribution that already exists")
    void reReadDoesNotOverwriteAnExistingAttribution() {
        UUID first = seedListing("55", "S-55", "원래 상품");
        ingestion.ingestInquiries(org, channelId, account, List.of(inquiry("cafe24:b6:a6", "55")));
        assertThat(stored("cafe24:b6:a6").getProductId()).isEqualTo(first);

        // The row is re-read claiming a different listing. Whatever that means, a later read is not
        // evidence against an attribution that was already matched exactly or corrected by hand.
        UUID second = seedListing("56", "S-56", "다른 상품");
        ingestion.ingestInquiries(org, channelId, account, List.of(inquiry("cafe24:b6:a6", "56")));

        assertThat(stored("cafe24:b6:a6").getProductId()).isEqualTo(first).isNotEqualTo(second);
    }

    @Test
    @DisplayName("a manufactured inquiry is stored as history and never becomes a seller task")
    void syntheticInquiryNeverOpensWorkItem() {
        CanonicalInquiry row = inquiry("cafe24:b6:a7", null);
        ingestion.ingestInquiries(org, channelId, account, List.of(row));
        Inquiry real = stored("cafe24:b6:a7");
        assertThat(workItems.findByInquiryId(real.getId())).isPresent();

        // The same shape of row, marked as something the product manufactured about itself.
        Inquiry seeded = new Inquiry();
        seeded.setOrgId(org);
        seeded.setChannelId(channelId);
        seeded.setSellerAccountId(account);
        seeded.setBody("데모 문의");
        seeded.setStatus("UNANSWERED");
        seeded.setReceivedAt(Instant.now());
        seeded.setExternalId("cafe24:b6:a8");
        seeded.setDataOrigin(DataOrigin.DEMO_SEED);
        UUID seededId = new InquiryWorkItemWriter(inquiries, workItems, audits, txManager)
                .openConnectorInquiry(seeded, account);

        // Stored — excluding it from the QUEUE is not the same as pretending it was never collected.
        assertThat(inquiries.findById(seededId)).isPresent();
        // But it is not work. The queue it would have entered ends at a marketplace send.
        assertThat(workItems.findByInquiryId(seededId)).isEmpty();
        assertThat(workItems.findByOrgIdAndPhase(org, InquiryWorkItemPhase.OPEN, Pageable.unpaged())
                .getContent()).hasSize(1);
    }
}
