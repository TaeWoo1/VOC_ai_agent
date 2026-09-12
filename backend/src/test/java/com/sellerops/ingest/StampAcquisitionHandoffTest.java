package com.sellerops.ingest;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.collect.AgentReviewHandoffService;
import com.sellerops.collect.dto.AgentReviewHandoffRequest;
import com.sellerops.collect.dto.AgentReviewHandoffResultView;
import com.sellerops.product.ChannelProduct;
import com.sellerops.product.ChannelProductRepository;
import com.sellerops.product.Product;
import com.sellerops.product.ProductRepository;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import com.sellerops.selleraccount.AccountSessionSlotService;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * **The acquisition stamp, proven at the one condition that broke it live.**
 *
 * {@code IngestionService.stampAcquisition} runs a {@code @Modifying(flushAutomatically = true)} update from a
 * caller that is deliberately NOT transactional, so the flush has nowhere to find a transaction unless the
 * method carries its own. On 2026-09-12 it did not: the first live WING read of this branch stored 9 reviews
 * and then answered the seller with an HTTP 500 and {@code stored=0}, leaving rows that were in fact written —
 * and unstamped.
 *
 * <p><b>Why the green suite could not see it, and why this class is shaped the way it is.</b> Two independent
 * reasons, and each alone is enough:
 *
 * <ul>
 *   <li>{@code @DataJpaTest} wraps every test method in a transaction, so the flush always finds one. The
 *       production condition — no transaction at all — is the single condition that slice cannot reproduce.</li>
 *   <li>{@code AgentReviewHandoffServiceTest} hand-{@code new}s {@link IngestionService}. A hand-built
 *       instance has no Spring proxy, so {@code @Transactional} on it does nothing whatsoever — a behavioural
 *       assertion written there would pass with the annotation deleted.</li>
 * </ul>
 *
 * <p>So this is a {@code @SpringBootTest}: the container's own proxied beans, no ambient transaction, its own
 * in-memory database because it commits. The assertion is the live symptom's exact inverse — the handoff
 * returns, it reports what it stored, and the rows carry the run that acquired them. Deleting the annotation
 * turns it red (verified by deletion, 2026-09-12), which is what the structural test next door cannot do.
 *
 * <p>Hermetic: no marketplace, no credentials, no network. Every body is synthetic and no buyer exists in this
 * fixture, because the request record has nowhere to put one.
 */
@SpringBootTest
@ActiveProfiles("test")
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class StampAcquisitionHandoffTest {

    @DynamicPropertySource
    static void isolatedDatabase(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () ->
                "jdbc:h2:mem:sellerops_stamp_acquisition;MODE=PostgreSQL;"
                        + "DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1");
        registry.add("sellerops.seed.enabled", () -> "false");
        registry.add("sellerops.seed.channel-catalogue", () -> "false");
    }

    /** The 노출상품ID the WING 상품평 screen prints — deliberately not the key the catalogue holds. */
    private static final String DISPLAY_PRODUCT_ID = "15411270785";
    /** The 등록상품ID: the listing's key and the product's SKU. A different id space entirely. */
    private static final String SELLER_PRODUCT_ID = "78123456789";
    private static final String OPTION = "81234567890";
    private static final String BODY = "합성-리뷰-본문-만족";

    @Autowired AgentReviewHandoffService handoff;
    @Autowired AccountSessionSlotService slots;
    @Autowired SellerAccountRepository sellerAccounts;
    @Autowired ChannelRepository channels;
    @Autowired ChannelProductRepository channelProducts;
    @Autowired ProductRepository products;
    @Autowired ReviewRepository reviews;

    @Test
    @DisplayName("a handoff that inserts rows returns, reports them, and stamps every one with its run")
    void newRowsAreStoredReportedAndStamped() {
        UUID org = UUID.randomUUID();
        String slot = seed(org);

        AgentReviewHandoffResultView result = handoff.handOff(org, request(slot, List.of(
                row("2026-09-10", 5, BODY),
                row("2026-09-09", 3, ""))));

        assertThat(result.stored())
                .as("the live defect reported stored=0 for rows that were in fact written")
                .isEqualTo(2);
        assertThat(result.failed()).isZero();
        assertThat(result.importId()).isNotBlank();

        List<Review> stored = rowsOf(org);
        assertThat(stored).hasSize(2);
        assertThat(stored).allSatisfy(r -> assertThat(r.getAcquisitionSyncJobId())
                .as("an unstamped row reads as provenance NONE — the row exists and nothing says how")
                .hasToString(result.importId()));
    }

    @Test
    @DisplayName("a re-read of the same page stamps nothing new and still answers")
    void aDuplicateHandoffStampsNothingAndStillReturns() {
        UUID org = UUID.randomUUID();
        String slot = seed(org);
        AgentReviewHandoffRequest.Review row = row("2026-09-10", 5, BODY);

        String firstRun = handoff.handOff(org, request(slot, List.of(row))).importId();
        AgentReviewHandoffResultView second = handoff.handOff(org, request(slot, List.of(row)));

        assertThat(second.stored()).isZero();
        assertThat(second.skipped()).isEqualTo(1);
        assertThat(rowsOf(org)).singleElement()
                .satisfies(r -> assertThat(r.getAcquisitionSyncJobId())
                        .as("the second run inserted nothing, so it has nothing to claim")
                        .hasToString(firstRun));
    }

    /** This class commits, so every read is scoped to its own org rather than to the whole table. */
    private List<Review> rowsOf(UUID org) {
        return reviews.findAll().stream().filter(r -> org.equals(r.getOrgId())).toList();
    }

    /* ───────────────────────────── fixtures ───────────────────────────── */

    /**
     * One org's worth of the world this handoff needs. The channel is found-or-created because this class
     * COMMITS — each method's rows outlive it, which is the property under test and not an inconvenience.
     */
    private String seed(UUID org) {
        Channel ch = channels.findByCode("COUPANG").orElseGet(() -> {
            Channel fresh = new Channel();
            fresh.setCode("COUPANG");
            fresh.setNameKo("COUPANG");
            fresh.setStatus(ChannelStatus.AVAILABLE);
            fresh.setSupportsInquiry(true);
            fresh.setSupportsReview(true);
            fresh.setSupportsOrder(true);
            fresh.setSupportsSales(true);
            fresh.setSupportsProduct(true);
            fresh.setSortOrder(0);
            return channels.save(fresh);
        });

        SellerAccount acc = new SellerAccount();
        acc.setOrgId(org);
        acc.setChannelId(ch.getId());
        acc.setConnectionStatus(ChannelStatus.PENDING);
        acc.setFileUpload(false);
        sellerAccounts.save(acc);

        Product p = new Product();
        p.setOrgId(org);
        p.setName("합성-상품");
        p.setSku(SELLER_PRODUCT_ID);
        p.setStatus("ACTIVE");
        products.save(p);

        ChannelProduct listing = new ChannelProduct();
        listing.setOrgId(org);
        listing.setChannelId(ch.getId());
        listing.setProductId(p.getId());
        listing.setExternalProductId(SELLER_PRODUCT_ID);
        listing.setExternalDisplayProductId(DISPLAY_PRODUCT_ID);
        channelProducts.save(listing);

        return slots.resolveSlot(org, acc.getId(), ch.getId());
    }

    private AgentReviewHandoffRequest.Review row(String writtenOn, int rating, String body) {
        return new AgentReviewHandoffRequest.Review(writtenOn, rating, body, DISPLAY_PRODUCT_ID, OPTION,
                "합성-상품", 0, body.isBlank());
    }

    private AgentReviewHandoffRequest request(String slot, List<AgentReviewHandoffRequest.Review> rows) {
        return new AgentReviewHandoffRequest(slot, "COUPANG", false, "PAGE_LIMIT_REACHED", rows);
    }
}
