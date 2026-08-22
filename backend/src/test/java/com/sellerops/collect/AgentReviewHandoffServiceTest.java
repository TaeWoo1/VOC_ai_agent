package com.sellerops.collect;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.collect.dto.AgentReviewHandoffRequest;
import com.sellerops.collect.dto.AgentReviewHandoffResultView;
import com.sellerops.common.ApiException;
import com.sellerops.community.Cafe24CommunityArticleRepository;
import com.sellerops.ingest.IngestFollowUp;
import com.sellerops.ingest.IngestionService;
import com.sellerops.itemanalysis.ItemAnalysisRepository;
import com.sellerops.itemanalysis.ItemAnalysisService;
import com.sellerops.itemanalysis.RuleBasedInboxItemAnalyzer;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemAuditRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemWriter;
import com.sellerops.order.OrderDailySummaryRepository;
import com.sellerops.common.DataOrigin;
import com.sellerops.product.ChannelProduct;
import com.sellerops.product.ChannelProductRepository;
import com.sellerops.product.Product;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.ProductService;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewReplyState;
import com.sellerops.review.ReviewRepository;
import com.sellerops.selleraccount.AccountSessionSlotRepository;
import com.sellerops.selleraccount.AccountSessionSlotService;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.sync.SyncJob;
import com.sellerops.sync.SyncJobRepository;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.data.domain.PageRequest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.PlatformTransactionManager;

/**
 * The agent review handoff.
 *
 * <p>Three properties carry the weight, and none of them is "the reviews were saved".
 *
 * <p><b>A re-sync stores nothing.</b> The screen has no review id, so identity is the ingestion spine's content
 * hash — and the proof that it holds is a second identical handoff returning {@code stored=0}. This is the
 * idempotence the whole incremental design rests on.
 *
 * <p><b>Two reviews that differ only in rating stay two reviews.</b> That is the entire reason Coupang keys on
 * the v2 formula. Under v1 a 5-star and a 1-star review of one product on one day with the same short body
 * would fold into one row, and the fold would look exactly like dedup working.
 *
 * <p><b>The buyer has nowhere to arrive.</b> The request record rejects an unknown property rather than
 * dropping it, so a client that sent an author is refused audibly instead of silently.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class AgentReviewHandoffServiceTest {

    @Autowired SellerAccountRepository sellerAccounts;
    @Autowired ChannelRepository channels;
    @Autowired ReviewRepository reviews;
    @Autowired InquiryRepository inquiries;
    @Autowired OrderDailySummaryRepository orders;
    @Autowired ProductRepository products;
    @Autowired Cafe24CommunityArticleRepository communityArticles;
    @Autowired InquiryWorkItemRepository workItems;
    @Autowired InquiryWorkItemAuditRepository audits;
    @Autowired PlatformTransactionManager txManager;
    @Autowired SyncJobRepository syncJobs;
    @Autowired AccountSessionSlotRepository slotRepo;
    @Autowired ItemAnalysisRepository analyses;
    @Autowired ChannelProductRepository channelProducts;

    private static final String BODY_A = "배송도 빠르고 포장도 꼼꼼해서 아주 만족합니다";
    private static final String BODY_SHORT = "좋아요";
    /**
     * The 노출상품ID — what the WING 상품평 screen prints and the ONLY product identifier the agent sends.
     * It is deliberately NOT the value the catalogue is keyed by; that is {@link #SELLER_PRODUCT_ID}, and
     * keeping them different here is what makes these tests able to fail if the two are ever conflated
     * again.
     */
    private static final String PRODUCT = "15411270785";
    /** The 등록상품ID — the catalogue's listing key and the product SKU. A different id space entirely. */
    private static final String SELLER_PRODUCT_ID = "78123456789";
    private static final String OPTION = "81234567890";

    private AgentReviewHandoffService service;
    private AccountSessionSlotService slots;
    private final UUID org = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        slots = new AccountSessionSlotService(slotRepo);
        IngestionService ingestion = new IngestionService(reviews, inquiries, orders, new ProductService(products),
                communityArticles, channels, new InquiryWorkItemWriter(inquiries, workItems, audits, txManager));
        // A follow-up with only item-analysis wired: this test is about the handoff's storage and
        // gates, not about the analysis stack. IngestFollowUpTest covers the follow-up itself.
        service = new AgentReviewHandoffService(slotRepo, sellerAccounts, channels, ingestion, syncJobs,
                new IngestFollowUp(new ItemAnalysisService(inquiries, reviews, analyses,
                        new RuleBasedInboxItemAnalyzer()), null, null),
                channelProducts, products);
    }

    /* ───────────────────────────── fixtures ───────────────────────────── */

    private SellerAccount account(UUID ownerOrg, String channelCode) {
        Channel ch = new Channel();
        ch.setCode(channelCode);
        ch.setNameKo(channelCode);
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
        SellerAccount saved = sellerAccounts.save(acc);
        seedCatalog(ownerOrg, ch.getId());
        return saved;
    }

    /**
     * The catalogue a PRODUCT read would have left: ONE product keyed by 등록상품ID, and one listing that
     * also carries the 노출상품ID as its display alias.
     *
     * <p>Every review test now needs this, and that is the point of the change being tested: before it, a
     * handoff could store reviews against a product that had never been read from the channel — by making
     * one up. Now the catalogue is a precondition, so a test that forgets it fails loudly rather than
     * quietly minting a second product.
     */
    private Product seedCatalog(UUID ownerOrg, UUID channelId) {
        Product p = new Product();
        p.setOrgId(ownerOrg);
        p.setName("무선 이어폰");
        p.setSku(SELLER_PRODUCT_ID);
        p.setStatus("ACTIVE");
        products.save(p);

        ChannelProduct listing = new ChannelProduct();
        listing.setOrgId(ownerOrg);
        listing.setChannelId(channelId);
        listing.setProductId(p.getId());
        listing.setExternalProductId(SELLER_PRODUCT_ID);
        listing.setExternalDisplayProductId(PRODUCT);
        channelProducts.save(listing);
        return p;
    }

    private String slotFor(SellerAccount acc) {
        return slots.resolveSlot(acc.getOrgId(), acc.getId(), acc.getChannelId());
    }

    private AgentReviewHandoffRequest.Review review(String body, int rating, String writtenOn) {
        return new AgentReviewHandoffRequest.Review(writtenOn, rating, body, PRODUCT, OPTION,
                "무선 이어폰", 0, false);
    }

    /** A buyer who rated and wrote nothing. The body is EMPTY — never a channel's placeholder sentence. */
    private AgentReviewHandoffRequest.Review textless(int rating, String writtenOn, String optionId) {
        return new AgentReviewHandoffRequest.Review(writtenOn, rating, "", PRODUCT, optionId,
                "무선 이어폰", 0, true);
    }

    private AgentReviewHandoffRequest request(String slot, boolean complete,
                                              List<AgentReviewHandoffRequest.Review> rows) {
        // FINAL_PAGE_REACHED is the ONLY stop reason that carries complete=true: the agent completes a walk
        // when the pager itself showed the last page, and an operator saying they were done is recorded as a
        // report with complete=false. Pairing complete=true with OPERATOR_FINISHED here would encode a state
        // the agent cannot produce.
        return new AgentReviewHandoffRequest(slot, "COUPANG", complete,
                complete ? "FINAL_PAGE_REACHED" : "PAGE_UNREADABLE", rows);
    }

    /* ───────────────────────────── storing ───────────────────────────── */

    @Test
    void stores_the_reviews_it_was_handed_with_the_source_facts_the_screen_carried() {
        SellerAccount acc = account(org, "COUPANG");
        AgentReviewHandoffRequest.Review row =
                new AgentReviewHandoffRequest.Review("2026-08-11", 5, BODY_A, PRODUCT, OPTION, "무선 이어폰", 2, false);

        AgentReviewHandoffResultView result = service.handOff(org, request(slotFor(acc), true, List.of(row)));

        assertThat(result.received()).isEqualTo(1);
        assertThat(result.stored()).isEqualTo(1);
        assertThat(result.complete()).isTrue();

        Review stored = reviews.findAll().get(0);
        assertThat(stored.getBody()).isEqualTo(BODY_A);
        assertThat(stored.getRating()).isEqualTo(5);
        assertThat(stored.getSourceOptionId()).isEqualTo(OPTION);
        assertThat(stored.getMediaCount()).isEqualTo(2);
        assertThat(stored.getExternalId()).isNull();
        assertThat(stored.getContentHash()).isNotBlank();
        assertThat(stored.getDedupKeyVersion()).isEqualTo(2);
        // Coupang gives sellers no way to answer a 상품평 — there is no channel statement, and none is invented.
        assertThat(stored.getReplyState()).isEqualTo(ReviewReplyState.UNKNOWN);
        assertThat(stored.isNegative()).isFalse();
    }

    @Test
    void a_one_star_review_is_stored_as_negative_so_the_attention_surface_can_see_it() {
        SellerAccount acc = account(org, "COUPANG");

        service.handOff(org, request(slotFor(acc), true, List.of(review("최악입니다", 1, "2026-08-11"))));

        assertThat(reviews.findAll().get(0).isNegative()).isTrue();
    }

    @Test
    void re_syncing_the_same_list_stores_nothing_and_skips_everything() {
        SellerAccount acc = account(org, "COUPANG");
        String slot = slotFor(acc);
        List<AgentReviewHandoffRequest.Review> rows =
                List.of(review(BODY_A, 5, "2026-08-11"), review(BODY_SHORT, 4, "2026-08-10"));

        service.handOff(org, request(slot, true, rows));
        AgentReviewHandoffResultView second = service.handOff(org, request(slot, true, rows));

        assertThat(second.stored()).isZero();
        assertThat(second.skipped()).isEqualTo(2);
        assertThat(reviews.findAll()).hasSize(2);
    }

    @Test
    void two_reviews_that_differ_only_in_what_the_buyer_wrote_stay_two_reviews() {
        SellerAccount acc = account(org, "COUPANG");

        service.handOff(org, request(slotFor(acc), true,
                List.of(review("아주 만족합니다", 5, "2026-08-11"), review("조금 아쉬웠어요", 5, "2026-08-11"))));

        assertThat(reviews.findAll()).hasSize(2);
    }

    @Test
    void two_reviews_that_differ_only_in_rating_stay_two_reviews() {
        SellerAccount acc = account(org, "COUPANG");

        // The exact false merge v1 would produce: same product, same day, same short body, opposite scores.
        service.handOff(org, request(slotFor(acc), true,
                List.of(review(BODY_SHORT, 5, "2026-08-11"), review(BODY_SHORT, 1, "2026-08-11"))));

        assertThat(reviews.findAll()).hasSize(2);
    }

    @Test
    void a_duplicate_inside_one_handoff_is_skipped_rather_than_stored_twice() {
        SellerAccount acc = account(org, "COUPANG");

        AgentReviewHandoffResultView result = service.handOff(org, request(slotFor(acc), true,
                List.of(review(BODY_A, 5, "2026-08-11"), review(BODY_A, 5, "2026-08-11"))));

        assertThat(result.stored()).isEqualTo(1);
        assertThat(result.skipped()).isEqualTo(1);
    }

    /* ───────────────────────────── the textless review (v3) ───────────────────────────── */

    @Test
    void keys_a_textless_review_on_its_purchased_option_so_two_options_stay_two_reviews() {
        // The live finding: 86% of the account's 상품평 were rating-only, and under v2 every one of them
        // hashes on the same empty body — so two options of one product on one day at one rating collapsed.
        SellerAccount acc = account(org, "COUPANG");

        service.handOff(org, request(slotFor(acc), true,
                List.of(textless(5, "2026-08-11", "81234567890"), textless(5, "2026-08-11", "70000000000"))));

        assertThat(reviews.findAll()).hasSize(2);
        assertThat(reviews.findAll()).allSatisfy(r -> {
            assertThat(r.getDedupKeyVersion()).isEqualTo(3);
            assertThat(r.getBody()).isEmpty();
        });
    }

    @Test
    void still_merges_two_textless_reviews_of_the_SAME_option_on_one_day_at_one_rating() {
        // The residue, recorded rather than papered over: closing it needs a per-review identifier the
        // screen does not publish, and a row position or a buyer's name is not one.
        SellerAccount acc = account(org, "COUPANG");

        AgentReviewHandoffResultView result = service.handOff(org, request(slotFor(acc), true,
                List.of(textless(5, "2026-08-11", OPTION), textless(5, "2026-08-11", OPTION))));

        assertThat(result.stored()).isEqualTo(1);
        assertThat(result.skipped()).isEqualTo(1);
    }

    @Test
    void leaves_a_review_WITH_text_on_the_channel_formula() {
        // v3 applies per ROW, not per channel. Nothing about a written review changes.
        SellerAccount acc = account(org, "COUPANG");

        service.handOff(org, request(slotFor(acc), true, List.of(review(BODY_A, 5, "2026-08-11"))));

        assertThat(reviews.findAll().get(0).getDedupKeyVersion()).isEqualTo(2);
    }

    @Test
    void refuses_a_row_whose_body_and_textless_flag_disagree() {
        SellerAccount acc = account(org, "COUPANG");
        AgentReviewHandoffRequest.Review lying =
                new AgentReviewHandoffRequest.Review("2026-08-11", 5, BODY_A, PRODUCT, OPTION, null, 0, true);

        assertThatThrownBy(() -> service.handOff(org, request(slotFor(acc), true, List.of(lying))))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining(AgentReviewHandoffService.REASON_BODY_DISAGREES);
        assertThat(reviews.findAll()).isEmpty();
    }

    @Test
    void keys_a_textless_review_under_v3_even_when_the_option_cell_was_empty() {
        // WHICH formula a row uses is decided by what the row IS, never by whether one of its cells could be
        // read. An earlier form required an option id too — so the same review keyed under v3 in one reading
        // and v2 in the next, and a re-sync stored it twice. There is nothing extra to fold in here; the
        // option contributes an empty part, exactly as any absent value does.
        SellerAccount acc = account(org, "COUPANG");

        service.handOff(org, request(slotFor(acc), true, List.of(textless(5, "2026-08-11", null))));

        assertThat(reviews.findAll().get(0).getDedupKeyVersion()).isEqualTo(3);
    }

    @Test
    void stores_a_textless_review_once_across_two_sittings_however_the_option_cell_read() {
        // The regression the version flip caused: one sitting reads the option, the next does not, and the
        // seller's list grows a second copy of a review nobody wrote twice.
        SellerAccount acc = account(org, "COUPANG");
        String slot = slotFor(acc);

        service.handOff(org, request(slot, true, List.of(textless(5, "2026-08-11", null))));
        AgentReviewHandoffResultView second =
                service.handOff(org, request(slot, true, List.of(textless(5, "2026-08-11", null))));

        assertThat(second.stored()).isEqualTo(0);
        assertThat(second.skipped()).isEqualTo(1);
        assertThat(reviews.findAll()).hasSize(1);
    }

    @Test
    void bounds_one_handoff_to_the_batch_the_agent_stops_collecting_at() {
        // The agent stops its walk at this many reviews rather than spending an operator's whole sitting on
        // pages this endpoint would then refuse together. The number lives in two places by necessity — the
        // collector's session is pure and imports nothing from the wire — so each side asserts the literal,
        // and moving one alone turns that side red. Collector: MAX_ACQUISITION_REVIEWS in
        // collector/src/action-window/coupang-review/review-acquisition.ts.
        assertThat(AgentReviewHandoffRequest.MAX_REVIEWS).isEqualTo(500);
    }

    /* ───────────────────────────── the coverage claim ───────────────────────────── */

    @Test
    void records_the_import_so_the_seller_can_see_it_happened() {
        SellerAccount acc = account(org, "COUPANG");

        service.handOff(org, request(slotFor(acc), true, List.of(review(BODY_A, 5, "2026-08-11"))));

        List<SyncJob> history = syncJobs.findReviewImports(org, PageRequest.of(0, 10));
        assertThat(history).hasSize(1);
        SyncJob job = history.get(0);
        assertThat(job.getStatus()).isEqualTo("SUCCESS");
        assertThat(job.getJobType()).isEqualTo("AGENT_HANDOFF");
        assertThat(job.getMethod()).isEqualTo("SELLER_CENTER_READ");
        assertThat(job.getTotalRows()).isEqualTo(1);
        assertThat(job.getSuccessRows()).isEqualTo(1);
    }

    @Test
    void stamps_the_import_before_it_writes_so_the_reviews_it_stored_count_as_new() {
        // Found live: the import's start was stamped AFTER the rows were written, so every freshly-stored
        // review sat a few milliseconds before its own import and the review list rendered "새 상품평 0"
        // over a handoff that had just stored 22. The list decides newness by created_at >= startedAt.
        SellerAccount acc = account(org, "COUPANG");

        service.handOff(org, request(slotFor(acc), true, List.of(review(BODY_A, 5, "2026-08-11"))));

        SyncJob job = syncJobs.findReviewImports(org, PageRequest.of(0, 10)).get(0);
        Review stored = reviews.findAll().get(0);
        assertThat(job.getStartedAt()).isBeforeOrEqualTo(stored.getCreatedAt());
    }

    @Test
    void an_incomplete_walk_is_recorded_as_partial_even_though_its_reviews_were_stored() {
        SellerAccount acc = account(org, "COUPANG");

        AgentReviewHandoffResultView result =
                service.handOff(org, request(slotFor(acc), false, List.of(review(BODY_A, 5, "2026-08-11"))));

        assertThat(result.stored()).isEqualTo(1);
        assertThat(result.complete()).isFalse();
        SyncJob job = syncJobs.findReviewImports(org, PageRequest.of(0, 10)).get(0);
        assertThat(job.getStatus()).isEqualTo("PARTIAL");
        assertThat(job.getErrorMessage()).isEqualTo("PAGE_UNREADABLE");
    }

    /* ───────────────────────────── the binding ───────────────────────────── */

    @Test
    void refuses_a_slot_that_does_not_exist() {
        assertThatThrownBy(() -> service.handOff(org, request("0123456789abcdef01234567", true,
                List.of(review(BODY_A, 5, "2026-08-11")))))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining(AgentReviewHandoffService.REASON_UNKNOWN_SLOT);
        assertThat(reviews.findAll()).isEmpty();
    }

    @Test
    void gives_another_orgs_slot_the_same_answer_as_a_slot_that_is_not_real() {
        SellerAccount theirs = account(UUID.randomUUID(), "COUPANG");

        assertThatThrownBy(() -> service.handOff(org, request(slotFor(theirs), true,
                List.of(review(BODY_A, 5, "2026-08-11")))))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining(AgentReviewHandoffService.REASON_UNKNOWN_SLOT);
        assertThat(reviews.findAll()).isEmpty();
    }

    @Test
    void refuses_when_the_declared_channel_disagrees_with_the_account() {
        SellerAccount acc = account(org, "COUPANG");
        AgentReviewHandoffRequest mixedUp = new AgentReviewHandoffRequest(slotFor(acc), "NAVER", true,
                "OPERATOR_FINISHED", List.of(review(BODY_A, 5, "2026-08-11")));

        assertThatThrownBy(() -> service.handOff(org, mixedUp))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining(AgentReviewHandoffService.REASON_CHANNEL_MISMATCH);
        assertThat(reviews.findAll()).isEmpty();
    }

    @Test
    void refuses_a_channel_this_path_does_not_serve() {
        SellerAccount acc = account(org, "NAVER");
        AgentReviewHandoffRequest naver = new AgentReviewHandoffRequest(slotFor(acc), "NAVER", true,
                "OPERATOR_FINISHED", List.of(review(BODY_A, 5, "2026-08-11")));

        assertThatThrownBy(() -> service.handOff(org, naver))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining(AgentReviewHandoffService.REASON_UNSUPPORTED_CHANNEL);
        assertThat(reviews.findAll()).isEmpty();
    }

    @Test
    void refuses_a_file_upload_account_which_has_no_screen_to_read() {
        SellerAccount acc = account(org, "COUPANG");
        acc.setFileUpload(true);
        sellerAccounts.save(acc);

        assertThatThrownBy(() -> service.handOff(org, request(slotFor(acc), true,
                List.of(review(BODY_A, 5, "2026-08-11")))))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining(AgentReviewHandoffService.REASON_UNSUPPORTED_CHANNEL);
        assertThat(reviews.findAll()).isEmpty();
    }

    @Test
    void refuses_the_whole_batch_when_one_date_cannot_be_read_rather_than_importing_the_rest() {
        SellerAccount acc = account(org, "COUPANG");
        AgentReviewHandoffRequest.Review bad =
                new AgentReviewHandoffRequest.Review("2026-13-45", 5, BODY_SHORT, PRODUCT, OPTION, null, 0, false);

        assertThatThrownBy(() -> service.handOff(org, request(slotFor(acc), true,
                List.of(review(BODY_A, 5, "2026-08-11"), bad))))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining(AgentReviewHandoffService.REASON_BAD_DATE);
        assertThat(reviews.findAll()).isEmpty();
    }

    /* ─────────────────── identity: the 노출상품ID is a lookup key, never a SKU ─────────────────── */

    /**
     * The property the whole change exists for.
     *
     * <p>The agent sends 노출상품ID. The catalogue is keyed by 등록상품ID. The review must land on the
     * product the catalogue already holds — and the count of products must not move, which is the part a
     * "did it store" assertion cannot see.
     */
    @Test
    void resolves_the_review_onto_the_catalogue_product_the_display_id_points_at() {
        SellerAccount acc = account(org, "COUPANG");
        long productsBefore = products.count();

        AgentReviewHandoffResultView result =
                service.handOff(org, request(slotFor(acc), true, List.of(review(BODY_A, 5, "2026-08-11"))));

        assertThat(result.stored()).isEqualTo(1);
        assertThat(result.failed()).isZero();
        // Not one more product than the catalogue read left. This is the number that used to grow.
        assertThat(products.count()).isEqualTo(productsBefore);

        UUID catalogueProduct = products.findByOrgIdAndSku(org, SELLER_PRODUCT_ID).orElseThrow().getId();
        assertThat(reviews.findAll().get(0).getProductId()).isEqualTo(catalogueProduct);
        // And emphatically NOT a product named after the display id.
        assertThat(products.findByOrgIdAndSku(org, PRODUCT)).isEmpty();
    }

    /**
     * A display id this org holds no listing for is a counted failure — not a new product, and not a
     * silent drop. The rest of the batch still stores, because an unknown listing is an ordinary state of
     * the world and the operator turned those pages by hand.
     */
    @Test
    void a_display_id_with_no_listing_fails_the_row_and_creates_nothing() {
        SellerAccount acc = account(org, "COUPANG");
        long productsBefore = products.count();
        AgentReviewHandoffRequest.Review stranger = new AgentReviewHandoffRequest.Review(
                "2026-08-11", 4, "다른 상품 후기", "99999999999", OPTION, "모르는 상품", 0, false);

        AgentReviewHandoffResultView result = service.handOff(org, request(slotFor(acc), true,
                List.of(review(BODY_A, 5, "2026-08-11"), stranger)));

        assertThat(result.received()).isEqualTo(2);
        assertThat(result.stored()).isEqualTo(1);
        assertThat(result.failed()).isEqualTo(1);
        assertThat(products.count()).isEqualTo(productsBefore);
        assertThat(products.findByOrgIdAndSku(org, "99999999999")).isEmpty();
        assertThat(reviews.findAll()).hasSize(1);
    }

    /** An unplaceable row makes the import record PARTIAL, so the operator's history says so. */
    @Test
    void an_unresolved_row_makes_the_import_partial_even_on_a_completed_walk() {
        SellerAccount acc = account(org, "COUPANG");
        AgentReviewHandoffRequest.Review stranger = new AgentReviewHandoffRequest.Review(
                "2026-08-11", 4, "다른 상품 후기", "99999999999", OPTION, null, 0, false);

        service.handOff(org, request(slotFor(acc), true,
                List.of(review(BODY_A, 5, "2026-08-11"), stranger)));

        SyncJob job = syncJobs.findAll().get(0);
        assertThat(job.getStatus()).isEqualTo("PARTIAL");
        assertThat(job.getTotalRows()).isEqualTo(2);
        assertThat(job.getSuccessRows()).isEqualTo(1);
        assertThat(job.getFailedRows()).isEqualTo(1);
    }

    /**
     * A synthetic listing does not answer for a real review.
     *
     * <p>Seeded rows carry the display id the seller's screen would print, which is exactly how a demo
     * org's manufactured catalogue could quietly adopt live reviews. The {@code RealDataOnly} filter is
     * the mechanism; this test is the statement that the mechanism is load-bearing here.
     */
    @Test
    void a_demo_seed_listing_never_adopts_a_real_review() {
        SellerAccount acc = account(org, "COUPANG");
        // Take the real catalogue out of the way, then leave only a synthetic listing wearing the same
        // display id. Before the filter mattered, this is the row that would have answered.
        ChannelProduct real = channelProducts
                .findByOrgIdAndChannelIdAndExternalDisplayProductId(org, acc.getChannelId(), PRODUCT)
                .orElseThrow();
        real.setExternalDisplayProductId(null);
        channelProducts.save(real);

        Product seeded = new Product();
        seeded.setOrgId(org);
        seeded.setName("데모 이어폰");
        seeded.setSku("DEMO-SKU-1");
        seeded.setStatus("ACTIVE");
        seeded.setDataOrigin(DataOrigin.DEMO_SEED);
        products.save(seeded);
        ChannelProduct synthetic = new ChannelProduct();
        synthetic.setOrgId(org);
        synthetic.setChannelId(acc.getChannelId());
        synthetic.setProductId(seeded.getId());
        synthetic.setExternalProductId("DEMO-LISTING-1");
        synthetic.setExternalDisplayProductId(PRODUCT);
        synthetic.setDataOrigin(DataOrigin.DEMO_SEED);
        channelProducts.save(synthetic);

        AgentReviewHandoffResultView result =
                service.handOff(org, request(slotFor(acc), true, List.of(review(BODY_A, 5, "2026-08-11"))));

        assertThat(result.stored()).isZero();
        assertThat(result.failed()).isEqualTo(1);
        assertThat(reviews.findAll()).isEmpty();
    }

    /** Another org's listing carrying the same display id is not this org's product. */
    @Test
    void a_listing_in_another_org_does_not_answer() {
        SellerAccount acc = account(org, "COUPANG");
        UUID otherOrg = UUID.randomUUID();
        ChannelProduct mine = channelProducts
                .findByOrgIdAndChannelIdAndExternalDisplayProductId(org, acc.getChannelId(), PRODUCT)
                .orElseThrow();
        mine.setOrgId(otherOrg);
        channelProducts.save(mine);

        AgentReviewHandoffResultView result =
                service.handOff(org, request(slotFor(acc), true, List.of(review(BODY_A, 5, "2026-08-11"))));

        assertThat(result.stored()).isZero();
        assertThat(result.failed()).isEqualTo(1);
    }
}
