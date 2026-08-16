package com.sellerops.review.channel;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.common.ApiException;
import com.sellerops.common.ReviewBodyFingerprint;
import com.sellerops.itemanalysis.ItemAnalysisRepository;
import com.sellerops.product.Product;
import com.sellerops.product.ProductRepository;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewReplyState;
import com.sellerops.review.ReviewRepository;
import com.sellerops.review.channel.dto.ChannelReviewDetailView;
import com.sellerops.review.channel.dto.ChannelReviewPageView;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.sync.SyncJob;
import com.sellerops.sync.SyncJobRepository;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * The channel review record.
 *
 * <p>What is under test is mostly what this surface REFUSES to imply. A list of reviews cannot say whether it
 * is all of them, so the coverage claim travels with the page. "New" is a fact about the last import rather
 * than a read flag, so it survives the operator reloading and does not decay as they page. And a sort value
 * nobody recognises is a 400 rather than the default order — a seller who asked for their worst reviews and
 * silently got their newest would read the top of the list as their worst.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class ChannelReviewServiceTest {

    @Autowired ReviewRepository reviews;
    @Autowired ProductRepository products;
    @Autowired SellerAccountRepository accounts;
    @Autowired ChannelRepository channels;
    @Autowired SyncJobRepository syncJobs;
    @Autowired ItemAnalysisRepository analyses;

    private static final String BODY = "배송도 빠르고 포장도 꼼꼼해서 아주 만족합니다";

    private ChannelReviewService service;
    private final UUID org = UUID.randomUUID();
    private SellerAccount account;
    private UUID channelId;

    @BeforeEach
    void setUp() {
        service = new ChannelReviewService(reviews, products, accounts, syncJobs, analyses);
        account = account(org, "COUPANG");
        channelId = account.getChannelId();
    }

    private SellerAccount account(UUID ownerOrg, String code) {
        Channel ch = new Channel();
        ch.setCode(code);
        ch.setNameKo(code);
        ch.setStatus(ChannelStatus.AVAILABLE);
        ch.setSupportsInquiry(true);
        ch.setSupportsReview(true);
        ch.setSupportsOrder(true);
        ch.setSupportsSales(true);
        ch.setSupportsProduct(true);
        ch.setSortOrder(0);
        channels.save(ch);

        SellerAccount acc = new SellerAccount();
        acc.setOrgId(ownerOrg);
        acc.setChannelId(ch.getId());
        acc.setConnectionStatus(ChannelStatus.PENDING);
        acc.setFileUpload(false);
        return accounts.save(acc);
    }

    private Product product(String name, String sku) {
        Product p = new Product();
        p.setOrgId(org);
        p.setName(name);
        p.setSku(sku);
        p.setStatus("ACTIVE");
        return products.save(p);
    }

    private Review review(String body, int rating, LocalDate writtenOn, Product product, Instant createdAt) {
        Review r = new Review();
        r.setOrgId(org);
        r.setChannelId(channelId);
        r.setProductId(product == null ? null : product.getId());
        r.setBody(body);
        r.setRating(rating);
        r.setNegative(rating <= 2);
        r.setReceivedAt(writtenOn.atStartOfDay(ZoneOffset.UTC).toInstant());
        r.setContentHash(UUID.randomUUID().toString());
        r.setDedupKeyVersion(2);
        r.setReplyState(ReviewReplyState.UNKNOWN);
        r.setSourceOptionId("81234567890");
        r.setMediaCount(2);
        r.setCreatedAt(createdAt);
        return reviews.save(r);
    }

    private SyncJob importAt(Instant startedAt, String status) {
        SyncJob job = new SyncJob();
        job.setOrgId(org);
        job.setChannelId(channelId);
        job.setSellerAccountId(account.getId());
        job.setDataType("REVIEW");
        job.setUploadType("REVIEW");
        job.setJobType("AGENT_HANDOFF");
        job.setMethod("SELLER_CENTER_READ");
        job.setTrigger("ACTION_WINDOW");
        job.setStartedAt(startedAt);
        job.setFinishedAt(startedAt.plusSeconds(30));
        job.setStatus(status);
        return syncJobs.save(job);
    }

    /* ───────────────────────────── the list ───────────────────────────── */

    @Test
    void lists_the_channels_reviews_with_the_product_the_screen_named() {
        Product p = product("무선 이어폰", "15411270785");
        review(BODY, 5, LocalDate.of(2026, 8, 11), p, Instant.now());

        ChannelReviewPageView view = service.list(org, account.getId(), null, null, 0, 20);

        assertThat(view.total()).isEqualTo(1);
        assertThat(view.items()).hasSize(1);
        assertThat(view.items().get(0).productName()).isEqualTo("무선 이어폰");
        assertThat(view.items().get(0).productId()).isEqualTo("15411270785");
        assertThat(view.items().get(0).vendorItemId()).isEqualTo("81234567890");
        assertThat(view.items().get(0).mediaCount()).isEqualTo(2);
        assertThat(view.items().get(0).writtenOn()).isEqualTo(LocalDate.of(2026, 8, 11));
    }

    @Test
    void puts_the_complaints_first_when_asked_and_the_newest_first_otherwise() {
        Product p = product("무선 이어폰", "15411270785");
        review("최악입니다", 1, LocalDate.of(2026, 8, 1), p, Instant.now());
        review(BODY, 5, LocalDate.of(2026, 8, 11), p, Instant.now());

        assertThat(service.list(org, account.getId(), "newest", null, 0, 20).items().get(0).rating()).isEqualTo(5);
        assertThat(service.list(org, account.getId(), "lowest", null, 0, 20).items().get(0).rating()).isEqualTo(1);
    }

    @Test
    void refuses_a_sort_it_does_not_recognise_rather_than_falling_back_to_the_default() {
        assertThatThrownBy(() -> service.list(org, account.getId(), "worst-first", null, 0, 20))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void shows_a_redacted_preview_rather_than_the_review_text() {
        Product p = product("무선 이어폰", "15411270785");
        review("연락처는 010-1234-5678 입니다 배송이 늦어서 아쉬웠습니다", 2, LocalDate.of(2026, 8, 11), p, Instant.now());

        String preview = service.list(org, account.getId(), null, null, 0, 20).items().get(0).preview();

        assertThat(preview).doesNotContain("010-1234-5678");
    }

    @Test
    void clamps_the_page_size_rather_than_letting_a_client_ask_for_everything() {
        assertThat(service.list(org, account.getId(), null, null, 0, 10_000).size())
                .isEqualTo(ChannelReviewService.MAX_PAGE_SIZE);
        assertThat(service.list(org, account.getId(), null, null, 0, 0).size())
                .isEqualTo(ChannelReviewService.DEFAULT_PAGE_SIZE);
    }

    /* ───────────────────────────── new, and coverage ───────────────────────────── */

    @Test
    void marks_the_reviews_the_last_import_brought_in_and_counts_them_over_the_whole_channel() {
        Product p = product("무선 이어폰", "15411270785");
        Instant importStart = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        review("이전에 들어온 후기", 4, LocalDate.of(2026, 8, 1), p, importStart.minusSeconds(3600));
        review(BODY, 5, LocalDate.of(2026, 8, 11), p, importStart.plusSeconds(1));
        importAt(importStart, "SUCCESS");

        ChannelReviewPageView view = service.list(org, account.getId(), "newest", null, 0, 20);

        assertThat(view.newCount()).isEqualTo(1);
        assertThat(view.items().get(0).isNew()).isTrue();
        assertThat(view.items().get(1).isNew()).isFalse();
    }

    @Test
    void dates_the_list_by_the_channel_it_listed_by_rather_than_by_one_account_on_it() {
        // Two Coupang connections in one org sit on ONE channel, and the list shows the channel's reviews —
        // every one of them, whichever connection collected them. Read per ACCOUNT, this same page would say
        // no import had ever run and mark nothing new, over rows an import had just brought in.
        SellerAccount sibling = new SellerAccount();
        sibling.setOrgId(org);
        sibling.setChannelId(channelId);
        sibling.setConnectionStatus(ChannelStatus.PENDING);
        sibling.setFileUpload(false);
        accounts.save(sibling);

        Product p = product("무선 이어폰", "15411270785");
        Instant importStart = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        review(BODY, 5, LocalDate.of(2026, 8, 11), p, importStart.plusSeconds(1));
        SyncJob job = importAt(importStart, "SUCCESS");
        job.setSellerAccountId(sibling.getId());
        syncJobs.save(job);

        ChannelReviewPageView view = service.list(org, account.getId(), "newest", null, 0, 20);

        assertThat(view.newCount()).isEqualTo(1);
        assertThat(view.items().get(0).isNew()).isTrue();
        assertThat(view.lastImportAt()).isNotNull();
    }

    @Test
    void marks_nothing_new_when_no_import_has_run() {
        Product p = product("무선 이어폰", "15411270785");
        review(BODY, 5, LocalDate.of(2026, 8, 11), p, Instant.now());

        ChannelReviewPageView view = service.list(org, account.getId(), null, null, 0, 20);

        assertThat(view.newCount()).isZero();
        assertThat(view.items().get(0).isNew()).isFalse();
        assertThat(view.lastImportAt()).isNull();
        assertThat(view.lastImportComplete()).isFalse();
    }

    @Test
    void carries_the_last_imports_coverage_claim_so_the_list_cannot_imply_completeness() {
        Instant importStart = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        importAt(importStart, "PARTIAL");

        ChannelReviewPageView view = service.list(org, account.getId(), null, null, 0, 20);

        assertThat(view.lastImportAt()).isNotNull();
        assertThat(view.lastImportComplete()).isFalse();
    }

    /* ───────────────────────────── the detail, and the channel-side ids ───────────────────────────── */

    @Test
    void hands_back_the_channel_side_identifiers_the_detail_panel_prints() {
        Product p = product("무선 이어폰", "15411270785");
        Review stored = review(BODY, 5, LocalDate.of(2026, 8, 11), p, Instant.now());

        ChannelReviewDetailView detail = service.detail(org, account.getId(), stored.getId());

        ChannelReviewDetailView.LocateTarget target = detail.locateTarget();
        assertThat(target.productId()).isEqualTo("15411270785");
        assertThat(target.vendorItemId()).isEqualTo("81234567890");
        assertThat(target.writtenOn()).isEqualTo(LocalDate.of(2026, 8, 11));
        assertThat(target.rating()).isEqualTo(5);
    }

    /**
     * The body's fingerprint is what a locate run MATCHES on, and it does not come through here. It reaches
     * the Local Agent by resolving a locateRef against {@code ChannelReviewLocateService}, so no copy of it
     * rides into the seller's browser on a view that has no use for one.
     */
    @Test
    void the_detail_carries_no_body_fingerprint() {
        Product p = product("무선 이어폰", "15411270785");
        Review stored = review(BODY, 5, LocalDate.of(2026, 8, 11), p, Instant.now());

        String rendered = service.detail(org, account.getId(), stored.getId()).locateTarget().toString();

        assertThat(rendered).doesNotContain(ReviewBodyFingerprint.of(BODY));
    }

    @Test
    void the_locate_target_names_nobody() {
        Product p = product("무선 이어폰", "15411270785");
        Review stored = review(BODY, 5, LocalDate.of(2026, 8, 11), p, Instant.now());

        assertThat(service.detail(org, account.getId(), stored.getId()).locateTarget().toString())
                .doesNotContain(BODY);
    }

    @Test
    void reads_the_whole_body_in_the_detail_where_the_list_only_previewed_it() {
        Product p = product("무선 이어폰", "15411270785");
        Review stored = review(BODY, 5, LocalDate.of(2026, 8, 11), p, Instant.now());

        ChannelReviewDetailView detail = service.detail(org, account.getId(), stored.getId());

        assertThat(detail.body()).isEqualTo(BODY);
        assertThat(detail.bodyRedacted()).isFalse();
    }

    @Test
    void redacts_the_full_body_and_says_that_it_did() {
        Product p = product("무선 이어폰", "15411270785");
        Review stored = review("문의는 010-1234-5678 로 주세요", 2, LocalDate.of(2026, 8, 11), p, Instant.now());

        ChannelReviewDetailView detail = service.detail(org, account.getId(), stored.getId());

        assertThat(detail.body()).doesNotContain("010-1234-5678");
        assertThat(detail.bodyRedacted()).isTrue();
    }

    /* ───────────────────────────── scoping ───────────────────────────── */

    @Test
    void another_orgs_review_reads_as_absent() {
        Product p = product("무선 이어폰", "15411270785");
        Review stored = review(BODY, 5, LocalDate.of(2026, 8, 11), p, Instant.now());

        assertThatThrownBy(() -> service.detail(UUID.randomUUID(), account.getId(), stored.getId()))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void a_review_from_another_channel_of_the_same_org_reads_as_absent() {
        Product p = product("무선 이어폰", "15411270785");
        Review stored = review(BODY, 5, LocalDate.of(2026, 8, 11), p, Instant.now());
        SellerAccount other = account(org, "NAVER");

        // The locate target would otherwise send the agent looking for this review on a screen it was never
        // written on — a wrong answer, not merely an odd one.
        assertThatThrownBy(() -> service.detail(org, other.getId(), stored.getId()))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void another_orgs_account_reads_as_absent() {
        assertThatThrownBy(() -> service.list(UUID.randomUUID(), account.getId(), null, null, 0, 20))
                .isInstanceOf(ApiException.class);
    }
}
