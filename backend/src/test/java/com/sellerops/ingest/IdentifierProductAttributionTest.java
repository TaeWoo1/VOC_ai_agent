package com.sellerops.ingest;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.channel.ChannelRepository;
import com.sellerops.community.Cafe24CommunityArticleRepository;
import com.sellerops.ingest.canonical.CanonicalInquiry;
import com.sellerops.ingest.canonical.ChannelProductRef;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.InquirySourceSubtype;
import com.sellerops.inquiry.workitem.InquiryWorkItemAuditRepository;
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
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.PlatformTransactionManager;

/**
 * An inquiry that names its product with a NUMBER is attributed by that number — or not at all.
 *
 * <p>The lane that existed before this resolved products by name and <b>created one when the name was
 * new</b>. On the canonical Demo Org that is two separate defects at once: products there genuinely
 * share a name (the reason Grouped Product Answers stopped merging by name), and a created product is
 * a listing the seller does not have, sitting in the catalogue looking like one they do. NAVER's two
 * inquiry resources both name their product with an identifier, so neither failure has to happen.
 *
 * <p>The rule is carried by the row rather than by a channel check in this service: a
 * {@link ChannelProductRef} on the canonical record IS the instruction. That is what makes it
 * impossible for a NAVER row with no product number to fall through into the create path — the ref is
 * present and empty, which resolves to nothing, which is the honest answer.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class IdentifierProductAttributionTest {

    @Autowired ReviewRepository reviews;
    @Autowired InquiryRepository inquiries;
    @Autowired OrderDailySummaryRepository orders;
    @Autowired ProductRepository products;
    @Autowired ChannelProductRepository channelProducts;
    @Autowired Cafe24CommunityArticleRepository communityArticles;
    @Autowired InquiryWorkItemRepository workItems;
    @Autowired InquiryWorkItemAuditRepository audits;
    @Autowired PlatformTransactionManager txManager;
    @Autowired ChannelRepository channels;

    private IngestionService service;
    private final UUID org = UUID.randomUUID();
    private final UUID channel = UUID.randomUUID();
    private final UUID account = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        service = new IngestionService(reviews, inquiries, orders, new ProductService(products),
                communityArticles, channels,
                new InquiryWorkItemWriter(inquiries, workItems, audits, txManager), channelProducts);
    }

    /** A catalogue listing pointing at a canonical product, the shape a PRODUCT read leaves behind. */
    private UUID listing(String externalProductId, String listingName) {
        Product product = new ProductService(products)
                .resolveOrCreate(org, listingName, "sku-" + externalProductId);

        ChannelProduct listing = new ChannelProduct();
        listing.setOrgId(org);
        listing.setChannelId(channel);
        listing.setProductId(product.getId());
        listing.setExternalProductId(externalProductId);
        listing.setChannelProductName(listingName);
        channelProducts.save(listing);
        return product.getId();
    }

    private static CanonicalInquiry naverRow(String externalId, String productNumber) {
        return new CanonicalInquiry(null, null, null, "문의 본문", "UNANSWERED",
                Instant.parse("2026-08-20T01:00:00Z"), externalId, 1, null, null, null,
                InquirySourceSubtype.NAVER_PRODUCT_QNA, ChannelProductRef.of(productNumber), null, null);
    }

    @Test
    @DisplayName("a channel identifier resolves to the one canonical product that listing belongs to")
    void anIdentifierResolvesToTheCanonicalProduct() {
        UUID productId = listing("6473457700", "선바로 일체형 전선몰딩");

        service.ingestInquiries(org, channel, account, List.of(naverRow("naver-qna:1", "6473457700")));

        Inquiry stored = inquiries.findAll().get(0);
        assertThat(stored.getProductId()).isEqualTo(productId);
        assertThat(stored.getSourceSubtype()).isEqualTo(InquirySourceSubtype.NAVER_PRODUCT_QNA);
    }

    @Test
    @DisplayName("an identifier we have no listing for leaves the inquiry unattributed and creates nothing")
    void anUnknownIdentifierCreatesNoProduct() {
        long productsBefore = products.count();

        service.ingestInquiries(org, channel, account, List.of(naverRow("naver-qna:2", "9999999999")));

        assertThat(inquiries.findAll().get(0).getProductId()).isNull();
        // The whole point: an inquiry we cannot place is a smaller, truer thing than a product we
        // invented to place it in.
        assertThat(products.count()).isEqualTo(productsBefore);
    }

    @Test
    @DisplayName("a row with no product number at all still never reaches the create path")
    void aRowWithoutAnIdentifierIsUnattributedRatherThanBucketed() {
        long productsBefore = products.count();

        service.ingestInquiries(org, channel, account, List.of(naverRow("naver-payinq:3", null)));

        assertThat(inquiries.findAll().get(0).getProductId()).isNull();
        // Not "(미지정 상품)" either — that bucket is a product row, and NAVER's customer resource makes
        // productNo optional, so this row is ordinary rather than exceptional.
        assertThat(products.count()).isEqualTo(productsBefore);
        assertThat(products.findAll()).noneMatch(p -> "(미지정 상품)".equals(p.getName()));
    }

    @Test
    @DisplayName("two listings that share a NAME are told apart, because the name is not the key")
    void identicalNamesDoNotMerge() {
        UUID first = listing("1111111111", "종이컵보관함");
        UUID second = listing("2222222222", "종이컵보관함");
        assertThat(first).isNotEqualTo(second);

        service.ingestInquiries(org, channel, account, List.of(
                naverRow("naver-qna:10", "1111111111"),
                naverRow("naver-qna:11", "2222222222")));

        assertThat(inquiries.findAll()).extracting(Inquiry::getProductId)
                .containsExactlyInAnyOrder(first, second);
    }

    @Test
    @DisplayName("a listing in another org cannot answer for this org's inquiry")
    void attributionIsOrgScoped() {
        UUID foreignOrg = UUID.randomUUID();
        Product foreign = new ProductService(products).resolveOrCreate(foreignOrg, "남의 상품", "sku-foreign");
        ChannelProduct foreignListing = new ChannelProduct();
        foreignListing.setOrgId(foreignOrg);
        foreignListing.setChannelId(channel);
        foreignListing.setProductId(foreign.getId());
        foreignListing.setExternalProductId("3333333333");
        channelProducts.save(foreignListing);

        service.ingestInquiries(org, channel, account, List.of(naverRow("naver-qna:12", "3333333333")));

        assertThat(inquiries.findAll().get(0).getProductId()).isNull();
    }

    @Test
    @DisplayName("without a listing catalogue wired, an identifier row is unattributed — never created")
    void theLaneFailsClosedWithNoCatalogue() {
        IngestionService legacyWiring = new IngestionService(reviews, inquiries, orders,
                new ProductService(products), communityArticles, channels,
                new InquiryWorkItemWriter(inquiries, workItems, audits, txManager));
        long productsBefore = products.count();

        legacyWiring.ingestInquiries(org, channel, account, List.of(naverRow("naver-qna:13", "6473457700")));

        assertThat(inquiries.findAll().get(0).getProductId()).isNull();
        assertThat(products.count()).isEqualTo(productsBefore);
    }

    @Test
    @DisplayName("the legacy name/SKU lane is untouched: a row with no ref still resolves-or-creates")
    void theNameLaneIsUnchangedForEverySourceThatUsedIt() {
        long productsBefore = products.count();

        service.ingestInquiries(org, channel, account, List.of(new CanonicalInquiry(
                "카페24 상품", "SKU-1", null, "문의", "UNANSWERED",
                Instant.parse("2026-08-20T01:00:00Z"), "cafe24:1", 1, null, null)));

        Inquiry stored = inquiries.findAll().get(0);
        assertThat(stored.getProductId()).isNotNull();
        assertThat(stored.getSourceSubtype()).isNull();
        assertThat(products.count()).isEqualTo(productsBefore + 1);
    }

    @Test
    @DisplayName("an answered inquiry keeps the platform's answer and opens no seller task")
    void anAnsweredInquiryIsHistoryNotWork() {
        listing("4444444444", "원터치 디스펜서");

        service.ingestInquiries(org, channel, account, List.of(new CanonicalInquiry(
                null, null, null, "언제 오나요?", "ANSWERED", Instant.parse("2026-08-20T01:00:00Z"),
                "naver-payinq:20", 1, "배송 문의", null, null,
                InquirySourceSubtype.NAVER_CUSTOMER_INQUIRY, ChannelProductRef.of("4444444444"),
                "내일 출고됩니다.", Instant.parse("2026-08-21T02:00:00Z"))));

        Inquiry stored = inquiries.findAll().get(0);
        assertThat(stored.getStatus()).isEqualTo("ANSWERED");
        assertThat(stored.getAnswerBody()).isEqualTo("내일 출고됩니다.");
        assertThat(stored.getAnsweredAt()).isEqualTo(Instant.parse("2026-08-21T02:00:00Z"));
        // An answered inquiry is history, never an item in the unanswered queue. Channel-neutral rule,
        // already true before this package; pinned here because NAVER is the first source that
        // collects answered rows AND their answers.
        assertThat(workItems.findAll()).isEmpty();
    }

    @Test
    @DisplayName("re-collecting the same page changes nothing and still records that we looked")
    void reCollectionIsIdempotent() {
        listing("5555555555", "판도리 조립형");
        List<CanonicalInquiry> page = List.of(naverRow("naver-qna:30", "5555555555"));

        service.ingestInquiries(org, channel, account, page);
        Instant firstSeen = inquiries.findAll().get(0).getLastSeenAt();
        var outcome = service.ingestInquiries(org, channel, account, page);

        assertThat(inquiries.count()).isEqualTo(1);
        assertThat(outcome.success()).isZero();
        assertThat(outcome.skipped()).isEqualTo(1);
        // Absence is not deletion: an unchanged row still records that the source showed it to us.
        assertThat(inquiries.findAll().get(0).getLastSeenAt()).isAfterOrEqualTo(firstSeen);
    }
}
