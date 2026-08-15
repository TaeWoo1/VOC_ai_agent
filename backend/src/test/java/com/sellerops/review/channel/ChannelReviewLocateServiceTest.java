package com.sellerops.review.channel;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.common.ApiException;
import com.sellerops.common.ReviewBodyFingerprint;
import com.sellerops.product.Product;
import com.sellerops.product.ProductRepository;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewReplyState;
import com.sellerops.review.ReviewRepository;
import com.sellerops.review.channel.dto.AgentReviewLocateTargetView;
import com.sellerops.review.channel.dto.ChannelReviewLocateRunResponse;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * `[쿠팡에서 보기]`, from the press to the agent's question.
 *
 * <p>Most of what is under test is the shape of a refusal. A token that has been spent, one that belongs to
 * another tenant, and one that never existed all get the same 404, because the caller who could tell them
 * apart is the one who should not be able to. And a review that cannot produce a usable target is refused at
 * the PRESS — so the seller is told SellerOps does not have enough to look with, rather than watching a run
 * open their browser and report that the review is not on the page.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class ChannelReviewLocateServiceTest {

    @Autowired ReviewRepository reviews;
    @Autowired ProductRepository products;
    @Autowired SellerAccountRepository accounts;
    @Autowired ChannelRepository channels;
    @Autowired ChannelReviewLocateRefRepository refs;
    @PersistenceContext EntityManager em;

    /**
     * Age a binding past its TTL.
     *
     * <p>Native, because {@code expires_at} is {@code updatable = false} — an expiry is fixed at mint and JPA
     * is right to ignore a write to it. A test that "aged" a row by setting the field and saving was silently
     * changing nothing; it only looked like it worked while the service read back the same in-memory
     * instance it had just modified.
     */
    private void expire(String ref) {
        em.createNativeQuery("update channel_review_locate_ref set expires_at = ?1 where locate_ref = ?2")
                .setParameter(1, Instant.now().minusSeconds(60))
                .setParameter(2, ref)
                .executeUpdate();
        em.flush();
        em.clear();
    }

    private static final String BODY = "배송도 빠르고 포장도 꼼꼼해서 아주 만족합니다";

    private ChannelReviewLocateService service;
    private final UUID org = UUID.randomUUID();
    private final UUID user = UUID.randomUUID();
    private SellerAccount account;
    private UUID channelId;

    @BeforeEach
    void setUp() {
        service = new ChannelReviewLocateService(reviews, products, accounts, channels, refs);
        account = account(org, "COUPANG");
        channelId = account.getChannelId();
    }

    /* ───────────────────────────── the press ───────────────────────────── */

    @Test
    void mints_an_opaque_single_use_token_for_the_pressed_review() {
        Review stored = review(BODY, 5, LocalDate.of(2026, 8, 11), product("무선 이어폰", "15411270785"));

        ChannelReviewLocateRunResponse minted = service.mint(org, account.getId(), stored.getId(), user);

        assertThat(minted.locateRef()).matches("[0-9a-f]{16}");
        assertThat(minted.channelCode()).isEqualTo("COUPANG");
    }

    /** Each press is its own binding — nothing is reused, so nothing outlives the run it was pressed for. */
    @Test
    void a_second_press_mints_a_second_token() {
        Review stored = review(BODY, 5, LocalDate.of(2026, 8, 11), product("무선 이어폰", "15411270785"));

        String first = service.mint(org, account.getId(), stored.getId(), user).locateRef();
        String second = service.mint(org, account.getId(), stored.getId(), user).locateRef();

        assertThat(first).isNotEqualTo(second);
    }

    @Test
    void refuses_a_review_belonging_to_another_org() {
        Review stored = review(BODY, 5, LocalDate.of(2026, 8, 11), product("무선 이어폰", "15411270785"));

        assertThatThrownBy(() -> service.mint(UUID.randomUUID(), account.getId(), stored.getId(), user))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void refuses_a_channel_that_has_no_locate_surface() {
        SellerAccount naver = account(org, "NAVER");
        Review stored = new Review();
        stored.setOrgId(org);
        stored.setChannelId(naver.getChannelId());
        stored.setBody(BODY);
        stored.setRating(5);
        stored.setNegative(false);
        stored.setReceivedAt(LocalDate.of(2026, 8, 11).atStartOfDay(ZoneOffset.UTC).toInstant());
        stored.setContentHash(UUID.randomUUID().toString());
        stored.setDedupKeyVersion(2);
        stored.setReplyState(ReviewReplyState.UNKNOWN);
        reviews.save(stored);

        assertThatThrownBy(() -> service.mint(org, naver.getId(), stored.getId(), user))
                .isInstanceOf(ApiException.class);
    }

    /**
     * The 노출상품ID is the first field the matcher compares, so without it every row is a mismatch. Refusing
     * at the press is the difference between "SellerOps cannot find this one" and a browser window that opens
     * and reports the review is somewhere else.
     */
    @Test
    void refuses_a_review_with_no_product_to_match_on() {
        Review stored = review(BODY, 5, LocalDate.of(2026, 8, 11), null);

        assertThatThrownBy(() -> service.mint(org, account.getId(), stored.getId(), user))
                .isInstanceOf(ApiException.class);
    }

    /* ───────────────────────────── the agent's question ───────────────────────────── */

    @Test
    void resolves_to_exactly_what_the_matcher_compares() {
        Review stored = review(BODY, 5, LocalDate.of(2026, 8, 11), product("무선 이어폰", "15411270785"));
        String ref = service.mint(org, account.getId(), stored.getId(), user).locateRef();

        AgentReviewLocateTargetView target = service.resolve(org, ref);

        assertThat(target.channelCode()).isEqualTo("COUPANG");
        assertThat(target.productId()).isEqualTo("15411270785");
        assertThat(target.vendorItemId()).isEqualTo("81234567890");
        assertThat(target.writtenOn()).isEqualTo(LocalDate.of(2026, 8, 11));
        assertThat(target.rating()).isEqualTo(5);
        // Over the STORED body, on the shared contract the collector computes in the page.
        assertThat(target.bodyFingerprint()).isEqualTo(ReviewBodyFingerprint.of(BODY));
    }

    /** No column names a person, so no rendering of the target can carry one — nor the review text. */
    @Test
    void the_resolved_target_carries_no_body_and_nobody() {
        Review stored = review(BODY, 5, LocalDate.of(2026, 8, 11), product("무선 이어폰", "15411270785"));
        String ref = service.mint(org, account.getId(), stored.getId(), user).locateRef();

        assertThat(service.resolve(org, ref).toString()).doesNotContain(BODY);
    }

    @Test
    void a_token_is_spent_the_first_time_it_is_resolved() {
        Review stored = review(BODY, 5, LocalDate.of(2026, 8, 11), product("무선 이어폰", "15411270785"));
        String ref = service.mint(org, account.getId(), stored.getId(), user).locateRef();

        service.resolve(org, ref);

        assertThatThrownBy(() -> service.resolve(org, ref)).isInstanceOf(ApiException.class);
    }

    /**
     * Single-use has to be a fact the DATABASE enforces, not a check the service makes and then writes back.
     * This pins the conditional update: with the condition removed from the UPDATE, a second spend of an
     * already-spent row would report success.
     */
    @Test
    void spending_an_already_spent_binding_reports_no_row() {
        Review stored = review(BODY, 5, LocalDate.of(2026, 8, 11), product("무선 이어폰", "15411270785"));
        String ref = service.mint(org, account.getId(), stored.getId(), user).locateRef();

        assertThat(refs.spend(ref, org, Instant.now())).isEqualTo(1);
        assertThat(refs.spend(ref, org, Instant.now())).isEqualTo(0);
    }

    /** The org check lives in the UPDATE too, so another tenant's token is never even consumed. */
    @Test
    void another_orgs_token_is_not_spendable() {
        Review stored = review(BODY, 5, LocalDate.of(2026, 8, 11), product("무선 이어폰", "15411270785"));
        String ref = service.mint(org, account.getId(), stored.getId(), user).locateRef();

        assertThat(refs.spend(ref, UUID.randomUUID(), Instant.now())).isEqualTo(0);
        assertThat(refs.findByLocateRef(ref).orElseThrow().getConsumedAt()).isNull();
    }

    /** An expired binding cannot be spent either — the TTL is in the same WHERE clause. */
    @Test
    void an_expired_binding_is_not_spendable() {
        Review stored = review(BODY, 5, LocalDate.of(2026, 8, 11), product("무선 이어폰", "15411270785"));
        String ref = service.mint(org, account.getId(), stored.getId(), user).locateRef();
        expire(ref);

        assertThat(refs.spend(ref, org, Instant.now())).isEqualTo(0);
    }

    /**
     * The matcher refuses a rating outside 1..5 before it looks at the page, so a review carrying one can
     * never be found. Refusing at the PRESS is the difference between that and a browser window opening to
     * report an expired request.
     */
    @Test
    void refuses_a_review_whose_rating_is_off_the_scale() {
        Product p = product("무선 이어폰", "15411270785");
        Review stored = review(BODY, 5, LocalDate.of(2026, 8, 11), p);
        stored.setRating(9);
        reviews.saveAndFlush(stored);

        assertThatThrownBy(() -> service.mint(org, account.getId(), stored.getId(), user))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void another_orgs_token_resolves_to_nothing() {
        Review stored = review(BODY, 5, LocalDate.of(2026, 8, 11), product("무선 이어폰", "15411270785"));
        String ref = service.mint(org, account.getId(), stored.getId(), user).locateRef();

        assertThatThrownBy(() -> service.resolve(UUID.randomUUID(), ref)).isInstanceOf(ApiException.class);
    }

    @Test
    void an_expired_token_resolves_to_nothing() {
        Review stored = review(BODY, 5, LocalDate.of(2026, 8, 11), product("무선 이어폰", "15411270785"));
        String ref = service.mint(org, account.getId(), stored.getId(), user).locateRef();
        expire(ref);

        assertThatThrownBy(() -> service.resolve(org, ref)).isInstanceOf(ApiException.class);
    }

    /** A token that never existed is refused before any lookup — and refused the same way as a spent one. */
    @Test
    void a_malformed_token_is_refused() {
        assertThatThrownBy(() -> service.resolve(org, "not-a-ref")).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> service.resolve(org, null)).isInstanceOf(ApiException.class);
    }

    /* ───────────────────────────── fixtures ───────────────────────────── */

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

    private Review review(String body, int rating, LocalDate writtenOn, Product product) {
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
        return reviews.save(r);
    }
}
