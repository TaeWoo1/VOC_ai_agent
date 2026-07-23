package com.sellerops.attention;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.tuple;

import com.sellerops.attention.dto.OperatorVocItem;
import com.sellerops.attention.dto.OperatorVocItemPage;
import com.sellerops.attention.source.Cafe24VocItemSource;
import com.sellerops.attention.source.VocItemSourceRegistry;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.common.ApiException;
import com.sellerops.community.Cafe24CommunityArticle;
import com.sellerops.community.Cafe24CommunityArticleRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.lang.reflect.RecordComponent;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * The attention-signal drill-down: a chosen signal type maps to the matching
 * window-scoped, metadata-only rows — over a real (H2) DB. Verifies the row
 * predicates per signal, window/null-date exclusion, pagination, and that the row
 * DTO exposes no raw content.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class OperatorAttentionItemsServiceTest {

    @Autowired SellerAccountRepository sellerAccounts;
    @Autowired ChannelRepository channels;
    @Autowired Cafe24CommunityArticleRepository articles;

    private OperatorAttentionService service;
    private final UUID org = UUID.randomUUID();
    private long nextArticleNo = 3000L;

    private static final LocalDate FROM = LocalDate.parse("2026-05-01");
    private static final LocalDate TO = LocalDate.parse("2026-05-31");

    @BeforeEach
    void setUp() {
        service = new OperatorAttentionService(sellerAccounts, channels,
                new VocItemSourceRegistry(List.of(new Cafe24VocItemSource(articles))));
    }

    @Test
    void unansweredInquiryReturnsOnlyPendingInquiries() {
        Fixture f = seedChannelAndAccount();
        article(f, "PRODUCT_INQUIRY", "2026-05-10T12:00:00+09:00", "PENDING", null);
        article(f, "PRODUCT_INQUIRY", "2026-05-11T12:00:00+09:00", "ANSWERED", null);
        article(f, "PRODUCT_INQUIRY", "2026-05-12T12:00:00+09:00", "UNKNOWN", null);
        article(f, "REVIEW", "2026-05-13T12:00:00+09:00", "PENDING", 2);   // wrong source kind

        OperatorVocItemPage p = service.attentionItems(org, f.accountId, "UNANSWERED_INQUIRY", FROM, TO, null, 0, 20);

        assertThat(p.signalType()).isEqualTo("UNANSWERED_INQUIRY");
        assertThat(p.total()).isEqualTo(1);
        assertThat(p.items()).extracting(OperatorVocItem::sourceType, OperatorVocItem::replyStatus)
                .containsExactly(tuple("INQUIRY", "PENDING"));
        assertThat(p.items()).allSatisfy(i -> {
            assertThat(i.signalType()).isEqualTo("UNANSWERED_INQUIRY");
            assertThat(i.channelCode()).isEqualTo("CAFE24");
            assertThat(i.channelNameKo()).isEqualTo("카페24");
        });
    }

    @Test
    void unknownReplyStatusReturnsOnlyUnknownInquiries() {
        Fixture f = seedChannelAndAccount();
        article(f, "PRODUCT_INQUIRY", "2026-05-10T12:00:00+09:00", "PENDING", null);
        article(f, "PRODUCT_INQUIRY", "2026-05-11T12:00:00+09:00", "UNKNOWN", null);

        OperatorVocItemPage p = service.attentionItems(org, f.accountId, "UNKNOWN_REPLY_STATUS", FROM, TO, null, 0, 20);

        assertThat(p.total()).isEqualTo(1);
        assertThat(p.items()).extracting(OperatorVocItem::replyStatus).containsExactly("UNKNOWN");
    }

    @Test
    void lowRatingReviewReturnsOneToThreeStarsAndExcludesHigherAndUnrated() {
        Fixture f = seedChannelAndAccount();
        article(f, "REVIEW", "2026-05-05T12:00:00+09:00", "UNKNOWN", 1);
        article(f, "REVIEW", "2026-05-06T12:00:00+09:00", "UNKNOWN", 2);
        article(f, "REVIEW", "2026-05-07T12:00:00+09:00", "UNKNOWN", 3);
        article(f, "REVIEW", "2026-05-08T12:00:00+09:00", "UNKNOWN", 4);   // excluded
        article(f, "REVIEW", "2026-05-09T12:00:00+09:00", "UNKNOWN", 5);   // excluded
        article(f, "REVIEW", "2026-05-10T12:00:00+09:00", "UNKNOWN", null); // excluded (null rating)

        OperatorVocItemPage p = service.attentionItems(org, f.accountId, "LOW_RATING_REVIEW", FROM, TO, null, 0, 20);

        assertThat(p.total()).isEqualTo(3);
        assertThat(p.items()).extracting(OperatorVocItem::rating).containsExactlyInAnyOrder(1, 2, 3);
        assertThat(p.items()).allSatisfy(i -> assertThat(i.sourceType()).isEqualTo("REVIEW"));
    }

    @Test
    void newReviewAndNewInquiryReturnTheirSourceType() {
        Fixture f = seedChannelAndAccount();
        article(f, "REVIEW", "2026-05-05T12:00:00+09:00", "UNKNOWN", 5);
        article(f, "PRODUCT_INQUIRY", "2026-05-06T12:00:00+09:00", "ANSWERED", null);

        OperatorVocItemPage reviews = service.attentionItems(org, f.accountId, "NEW_REVIEW", FROM, TO, null, 0, 20);
        OperatorVocItemPage inquiries = service.attentionItems(org, f.accountId, "NEW_INQUIRY", FROM, TO, null, 0, 20);

        assertThat(reviews.items()).extracting(OperatorVocItem::sourceType).containsExactly("REVIEW");
        assertThat(inquiries.items()).extracting(OperatorVocItem::sourceType).containsExactly("INQUIRY");
    }

    @Test
    void spikeDrilldownReturnsCurrentWindowRowsOnlyNotTheBaselineWindow() {
        Fixture f = seedChannelAndAccount();
        article(f, "REVIEW", "2026-05-05T12:00:00+09:00", "UNKNOWN", 5);   // current window
        article(f, "REVIEW", "2026-04-15T12:00:00+09:00", "UNKNOWN", 5);   // prior (baseline) window

        OperatorVocItemPage p = service.attentionItems(
                org, f.accountId, "RECENT_REVIEW_SPIKE_CANDIDATE", FROM, TO, null, 0, 20);

        // The spike's baseline window is compared, never listed: only the current row shows.
        assertThat(p.signalType()).isEqualTo("RECENT_REVIEW_SPIKE_CANDIDATE");
        assertThat(p.total()).isEqualTo(1);
        assertThat(p.items()).extracting(OperatorVocItem::sourceCreatedDate).containsExactly("2026-05-05");
    }

    @Test
    void excludesRowsOutsideTheWindowAndWithUnknownDate() {
        Fixture f = seedChannelAndAccount();
        article(f, "REVIEW", "2026-05-05T12:00:00+09:00", "UNKNOWN", 1);   // in window
        article(f, "REVIEW", "2026-04-30T12:00:00+09:00", "UNKNOWN", 1);   // before window
        articleUnknownDate(f, "REVIEW", "UNKNOWN", 1);                     // null source date

        OperatorVocItemPage p = service.attentionItems(org, f.accountId, "LOW_RATING_REVIEW", FROM, TO, null, 0, 20);

        assertThat(p.total()).isEqualTo(1);
        assertThat(p.items()).hasSize(1);
        assertThat(p.items().get(0).sourceCreatedDate()).isEqualTo("2026-05-05");
    }

    @Test
    void paginatesWithATotalAndCapsThePageSize() {
        Fixture f = seedChannelAndAccount();
        article(f, "REVIEW", "2026-05-05T12:00:00+09:00", "UNKNOWN", 5);
        article(f, "REVIEW", "2026-05-06T12:00:00+09:00", "UNKNOWN", 5);
        article(f, "REVIEW", "2026-05-07T12:00:00+09:00", "UNKNOWN", 5);

        OperatorVocItemPage page0 = service.attentionItems(org, f.accountId, "NEW_REVIEW", FROM, TO, null, 0, 2);
        assertThat(page0.total()).isEqualTo(3);
        assertThat(page0.page()).isEqualTo(0);
        assertThat(page0.size()).isEqualTo(2);
        assertThat(page0.items()).hasSize(2);

        OperatorVocItemPage page1 = service.attentionItems(org, f.accountId, "NEW_REVIEW", FROM, TO, null, 1, 2);
        assertThat(page1.items()).hasSize(1);

        // An over-large requested size is clamped to the ceiling.
        OperatorVocItemPage capped = service.attentionItems(org, f.accountId, "NEW_REVIEW", FROM, TO, null, 0, 1000);
        assertThat(capped.size()).isEqualTo(50);
    }

    @Test
    void rejectsAnInvertedWindow() {
        Fixture f = seedChannelAndAccount();
        assertThatThrownBy(() -> service.attentionItems(org, f.accountId, "NEW_REVIEW", TO, FROM, null, 0, 20))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void rejectsAMissingBound() {
        Fixture f = seedChannelAndAccount();
        assertThatThrownBy(() -> service.attentionItems(org, f.accountId, "NEW_REVIEW", null, TO, null, 0, 20))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void rejectsAnUnknownSignalType() {
        Fixture f = seedChannelAndAccount();
        assertThatThrownBy(() -> service.attentionItems(org, f.accountId, "NOT_A_SIGNAL", FROM, TO, null, 0, 20))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void isOrgScopedSoACrossOrgAccountReadsAsNotFound() {
        Fixture f = seedChannelAndAccount();
        assertThatThrownBy(() -> service.attentionItems(UUID.randomUUID(), f.accountId, "NEW_REVIEW", FROM, TO, null, 0, 20))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void rowDtoExposesNoRawContentFieldButCarriesSafePreview() {
        // Privacy contract: no raw body or source IDENTIFIERS. The one customer-authored
        // free-text field is the sanitized safePreview — assert it is present, raw ones are not.
        //
        // "productname" was on this list until the product-context decision: the exclusion is
        // of product IDENTITY (productNo / sku — for a NAVER export the SKU IS the channel's
        // productNo), not of the catalog DISPLAY name, which ProductService already treats as
        // display metadata and which FeedItem already shows operators. The identifier half of
        // the ban is unchanged and pinned below; only the display name was let through, and
        // deliberately, not by loosening the rule for convenience.
        var forbidden = Arrays.asList("title", "content", "body", "rawpreview", "articleno",
                "productno", "sku", "productid", "sourceid", "customerid", "orderid", "mallid");
        var fields = Arrays.stream(OperatorVocItem.class.getRecordComponents())
                .map(RecordComponent::getName).map(String::toLowerCase).toList();
        assertThat(fields).doesNotContainAnyElementsOf(forbidden);
        assertThat(fields).contains("safepreview");
        // The display name is in the contract on purpose — pin it so a later "tidy-up" that
        // drops it has to argue with a test rather than silently regress the surface.
        assertThat(fields).contains("productname");
    }

    @Test
    void mapsArticleBodyToASanitizedPreviewNeverTheRawText() {
        Fixture f = seedChannelAndAccount();
        articleWithText(f, "REVIEW", "2026-05-05T12:00:00+09:00", "UNKNOWN", 5,
                null, "배송 빨라요 연락은 010-1234-5678 로 주세요");

        OperatorVocItemPage p = service.attentionItems(org, f.accountId, "NEW_REVIEW", FROM, TO, null, 0, 20);

        String preview = p.items().get(0).safePreview();
        assertThat(preview).isNotNull().contains("[전화번호]")
                .doesNotContain("1234").doesNotContain("5678");
    }

    @Test
    void suppressesPreviewWhenContentIsAlmostEntirelyPii() {
        Fixture f = seedChannelAndAccount();
        articleWithText(f, "REVIEW", "2026-05-06T12:00:00+09:00", "UNKNOWN", 5,
                null, "010-1234-5678 buyer@example.com");

        OperatorVocItemPage p = service.attentionItems(org, f.accountId, "NEW_REVIEW", FROM, TO, null, 0, 20);

        assertThat(p.items().get(0).safePreview()).isNull();
    }

    @Test
    void previewIsNullWhenArticleHasNoText() {
        Fixture f = seedChannelAndAccount();
        articleWithText(f, "REVIEW", "2026-05-07T12:00:00+09:00", "UNKNOWN", 5, null, null);

        OperatorVocItemPage p = service.attentionItems(org, f.accountId, "NEW_REVIEW", FROM, TO, null, 0, 20);

        assertThat(p.items().get(0).safePreview()).isNull();
    }

    @Test
    void cafe24RowsCarryNoProductNameEvenWhenTheArticleHasAProductNo() {
        Fixture f = seedChannelAndAccount();
        // A community article with a product_no set — the ONLY product handle this store has.
        // It is an identifier, so it must not become a name, and there is no catalog link to
        // resolve a real one from. The row stays null: "not available on this channel".
        articleWithProductNo(f, "2026-05-08T12:00:00+09:00", 987654L, "배송 빨라요");

        OperatorVocItemPage p = service.attentionItems(org, f.accountId, "NEW_REVIEW", FROM, TO, null, 0, 20);

        assertThat(p.items()).singleElement()
                .satisfies(item -> {
                    assertThat(item.productName()).isNull();
                    // The product_no must not leak into the one free-text field either.
                    assertThat(item.safePreview()).doesNotContain("987654");
                });
    }

    // --- fixtures ------------------------------------------------------------

    private record Fixture(UUID channelId, UUID accountId) {
    }

    private Fixture seedChannelAndAccount() {
        Channel ch = new Channel();
        ch.setCode("CAFE24");
        ch.setNameKo("카페24");
        ch.setStatus(ChannelStatus.CONNECTED);
        ch.setSupportsInquiry(true);
        ch.setSupportsReview(true);
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
        sellerAccounts.save(acc);
        return new Fixture(ch.getId(), acc.getId());
    }

    private void article(Fixture f, String sourceKind, String sourceCreatedAt, String replyStatus, Integer rating) {
        saveArticle(f, sourceKind, OffsetDateTime.parse(sourceCreatedAt).toInstant(), replyStatus, rating);
    }

    private void articleUnknownDate(Fixture f, String sourceKind, String replyStatus, Integer rating) {
        saveArticle(f, sourceKind, null, replyStatus, rating, null, null);
    }

    private void articleWithText(Fixture f, String sourceKind, String sourceCreatedAt, String replyStatus,
                                 Integer rating, String title, String content) {
        saveArticle(f, sourceKind, OffsetDateTime.parse(sourceCreatedAt).toInstant(), replyStatus, rating,
                title, content);
    }

    private void saveArticle(Fixture f, String sourceKind, Instant sourceCreatedAt,
                             String replyStatus, Integer rating) {
        saveArticle(f, sourceKind, sourceCreatedAt, replyStatus, rating, null, null);
    }

    /** A review article that carries a product_no — this store's only product handle. */
    private void articleWithProductNo(Fixture f, String sourceCreatedAt, Long productNo, String content) {
        Cafe24CommunityArticle a = new Cafe24CommunityArticle();
        a.setOrgId(org);
        a.setSellerAccountId(f.accountId);
        a.setChannelId(f.channelId);
        a.setBoardNo(4);
        a.setArticleNo(nextArticleNo++);
        a.setSourceKind("REVIEW");
        a.setReplyStatus("UNKNOWN");
        a.setRating(5);
        a.setProductNo(productNo);
        a.setContent(content);
        a.setSourceCreatedAt(OffsetDateTime.parse(sourceCreatedAt).toInstant());
        a.setSourceHash("h-" + a.getArticleNo());
        a.setCollectedAt(Instant.parse("2026-05-25T00:00:00Z"));
        articles.save(a);
    }

    private void saveArticle(Fixture f, String sourceKind, Instant sourceCreatedAt,
                             String replyStatus, Integer rating, String title, String content) {
        Cafe24CommunityArticle a = new Cafe24CommunityArticle();
        a.setOrgId(org);
        a.setSellerAccountId(f.accountId);
        a.setChannelId(f.channelId);
        a.setBoardNo("REVIEW".equals(sourceKind) ? 4 : 6);
        a.setArticleNo(nextArticleNo++);
        a.setSourceKind(sourceKind);
        a.setReplyStatus(replyStatus);
        a.setRating(rating);
        a.setTitle(title);
        a.setContent(content);
        a.setSourceCreatedAt(sourceCreatedAt);
        a.setSourceHash("h-" + a.getArticleNo());
        a.setCollectedAt(Instant.parse("2026-05-25T00:00:00Z"));
        articles.save(a);
    }
}
