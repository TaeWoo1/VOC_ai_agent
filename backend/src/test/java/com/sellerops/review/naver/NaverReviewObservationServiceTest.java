package com.sellerops.review.naver;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.common.ApiException;
import com.sellerops.ingest.IngestFollowUp;
import com.sellerops.ingest.IngestOutcome;
import com.sellerops.ingest.IngestionService;
import com.sellerops.ingest.canonical.CanonicalReview;
import com.sellerops.product.ChannelProduct;
import com.sellerops.product.ChannelProductRepository;
import com.sellerops.responsibility.IdentityVerdict;
import com.sellerops.responsibility.aside.AsideMarketplaceAccess;
import com.sellerops.responsibility.aside.AsideRecipe;
import com.sellerops.responsibility.aside.ScheduledAsideJob;
import com.sellerops.responsibility.aside.ScheduledAsideJobRepository;
import com.sellerops.responsibility.aside.ScheduledAsideJobStatus;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewReplyState;
import com.sellerops.review.ReviewRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.sync.SyncJobRepository;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/**
 * <b>What a scheduled NAVER review read is allowed to become.</b>
 *
 * <p>Every assertion is a line of the unattended contract asked as a question: can a job that is not this recipe
 * deliver? can a job deliver twice? can a page nobody can prove is this store reach ingest? can a row this service
 * does not understand be stored beside the ones it does? The answers are no, and a proved read stores through the
 * one ingestion spine with the review's own id as its key.
 */
class NaverReviewObservationServiceTest {

    private static final UUID ORG = UUID.randomUUID();
    private static final UUID DEVICE = UUID.randomUUID();
    private static final UUID JOB = UUID.randomUUID();

    private final SellerAccountRepository accounts = mock(SellerAccountRepository.class);
    private final ChannelRepository channels = mock(ChannelRepository.class);
    private final ChannelProductRepository listings = mock(ChannelProductRepository.class);
    private final ScheduledAsideJobRepository jobs = mock(ScheduledAsideJobRepository.class);
    private final ReviewRepository reviews = mock(ReviewRepository.class);
    private final IngestionService ingestion = mock(IngestionService.class);
    private final IngestFollowUp followUp = mock(IngestFollowUp.class);
    private final SyncJobRepository syncJobs = mock(SyncJobRepository.class);
    private final com.sellerops.product.ProductRepository products = mock(com.sellerops.product.ProductRepository.class);

    private Channel naver;
    private SellerAccount account;
    private ScheduledAsideJob job;
    private NaverReviewObservationService service;

    @BeforeEach
    void setUp() {
        naver = new Channel();
        naver.setId(UUID.randomUUID());
        naver.setCode("NAVER");
        account = new SellerAccount();
        account.setId(UUID.randomUUID());
        account.setOrgId(ORG);
        account.setChannelId(naver.getId());
        account.setFileUpload(false);
        when(channels.findAll()).thenReturn(List.of(naver));
        when(channels.findById(naver.getId())).thenReturn(Optional.of(naver));
        when(accounts.findAllByOrgId(ORG)).thenReturn(List.of(account));
        when(accounts.findByIdAndOrgId(account.getId(), ORG)).thenReturn(Optional.of(account));

        job = new ScheduledAsideJob();
        job.setOrgId(ORG);
        job.setDeviceId(DEVICE);
        job.setRecipe(AsideRecipe.NAVER_REVIEW_OBSERVE_V1);
        job.setStatus(ScheduledAsideJobStatus.CLAIMED);
        job.setLeaseUntil(Instant.now().plusSeconds(120));
        when(jobs.findByIdAndDeviceId(JOB, DEVICE)).thenReturn(Optional.of(job));
        when(jobs.save(any())).thenAnswer(inv -> inv.getArgument(0));
        when(ingestion.ingestReviews(eq(ORG), eq(naver.getId()), anyList()))
                .thenReturn(new IngestOutcome(1, 0, 0, List.of(), List.of(UUID.randomUUID())));

        service = serviceWith(new AsideMarketplaceAccess(true, Set.of(ORG), Set.of(account.getId())));
    }

    private NaverReviewObservationService serviceWith(AsideMarketplaceAccess access) {
        return new NaverReviewObservationService(access, accounts, channels, listings, jobs, reviews, ingestion,
                followUp, syncJobs, products);
    }

    private static NaverReviewObservationRequest.Review row(String id, String productNo) {
        return new NaverReviewObservationRequest.Review(id, "2026-09-16T10:00:00.000+09:00", 5, "좋아요", productNo,
                "상품", false, 0);
    }

    private static NaverReviewObservationRequest request(NaverReviewObservationRequest.Review... rows) {
        return new NaverReviewObservationRequest(List.of(rows), 7);
    }

    @Test
    @DisplayName("the target is the one named NAVER account — and nothing when the lane is off or the account unnamed")
    void resolvesOnlyTheNamedAccount() {
        assertThat(service.resolve(ORG, AsideRecipe.NAVER_REVIEW_OBSERVE_V1)).get()
                .extracting(t -> t.sellerAccountId()).isEqualTo(account.getId());
        assertThat(service.resolve(ORG, AsideRecipe.COUPANG_REVIEW_OBSERVE_V1)).isEmpty();
        assertThat(serviceWith(new AsideMarketplaceAccess(false, Set.of(ORG), Set.of(account.getId())))
                .resolve(ORG, AsideRecipe.NAVER_REVIEW_OBSERVE_V1)).isEmpty();
        assertThat(serviceWith(new AsideMarketplaceAccess(true, Set.of(ORG), Set.of(UUID.randomUUID())))
                .resolve(ORG, AsideRecipe.NAVER_REVIEW_OBSERVE_V1)).isEmpty();
    }

    @Test
    @DisplayName("a proved page stores through the ingestion spine, keyed by the review's own id, and counts once")
    void aProvedPageIngests() {
        when(listings.countOwnedListings(eq(ORG), eq(naver.getId()), anyCollection())).thenReturn(1L);
        // The listing's product travels as the SKU, read out of this database — found live: without it all 52
        // stored reviews were unlinked although all 52 listings were in the catalogue.
        ChannelProduct listing = new ChannelProduct();
        listing.setOrgId(ORG);
        listing.setProductId(UUID.randomUUID());
        com.sellerops.product.Product product = new com.sellerops.product.Product();
        product.setSku("SKU-1");
        when(listings.findByChannelIdAndExternalProductId(naver.getId(), "1234567890")).thenReturn(Optional.of(listing));
        when(products.findById(listing.getProductId())).thenReturn(Optional.of(product));

        NaverReviewObservationView view = service.deliver(ORG, DEVICE, JOB, request(row("5066448224", "1234567890")));

        assertThat(view.identityVerdict()).isEqualTo("MATCH");
        assertThat(view.inserted()).isEqualTo(1);
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<CanonicalReview>> rows = ArgumentCaptor.forClass(List.class);
        verify(ingestion).ingestReviews(eq(ORG), eq(naver.getId()), rows.capture());
        CanonicalReview stored = rows.getValue().get(0);
        assertThat(stored.externalId()).isEqualTo("5066448224");
        assertThat(stored.sku()).isEqualTo("SKU-1");
        assertThat(stored.replyState()).isEqualTo(ReviewReplyState.PENDING);
        assertThat(stored.mediaObserved()).isTrue();
        assertThat(stored.productRef().externalProductId()).isEqualTo("1234567890");
        assertThat(job.getIdentityVerdict()).isEqualTo(IdentityVerdict.MATCH);
        assertThat(job.getInsertedCount()).isEqualTo(1);
        assertThat(job.getChangedCount()).isZero();

        assertThatThrownBy(() -> service.deliver(ORG, DEVICE, JOB, request(row("5066448224", "1234567890"))))
                .as("one claim, one delivery").isInstanceOf(ApiException.class);
    }

    @Test
    @DisplayName("a reply that appeared since the last read is a change, not a new review")
    void anAdvancedReplyStateIsCounted() {
        when(listings.countOwnedListings(eq(ORG), eq(naver.getId()), anyCollection())).thenReturn(1L);
        Review stored = new Review();
        stored.setReplyState(ReviewReplyState.PENDING);
        when(reviews.findByOrgIdAndChannelIdAndExternalId(ORG, naver.getId(), "5066448224"))
                .thenReturn(Optional.of(stored));
        when(ingestion.ingestReviews(eq(ORG), eq(naver.getId()), anyList()))
                .thenReturn(new IngestOutcome(0, 1, 0, List.of(), List.of()));

        NaverReviewObservationView view = service.deliver(ORG, DEVICE, JOB, request(
                new NaverReviewObservationRequest.Review("5066448224", "2026-09-16T10:00:00.000+09:00", 5, "좋아요",
                        "1234567890", "상품", true, 0)));

        assertThat(view.inserted()).isZero();
        assertThat(view.changed()).isEqualTo(1);
    }

    @Test
    @DisplayName("a product number nobody holds cannot prove the store: UNRESOLVED, nothing stored")
    void anUnknownProductIsUnresolved() {
        when(listings.countOwnedListings(eq(ORG), eq(naver.getId()), anyCollection())).thenReturn(0L);
        when(listings.findByChannelIdAndExternalProductId(naver.getId(), "999")).thenReturn(Optional.empty());

        NaverReviewObservationView view = service.deliver(ORG, DEVICE, JOB, request(row("5066448224", "999")));

        assertThat(view.identityVerdict()).isEqualTo("UNRESOLVED");
        verify(ingestion, never()).ingestReviews(any(), any(), anyList());
        assertThat(job.getIdentityVerdict()).isEqualTo(IdentityVerdict.UNRESOLVED);
        assertThat(job.getInsertedCount()).isNull();
    }

    @Test
    @DisplayName("a product number another organisation holds proves a DIFFERENT store: MISMATCH, nothing stored")
    void anotherStoresProductIsMismatch() {
        when(listings.countOwnedListings(eq(ORG), eq(naver.getId()), anyCollection())).thenReturn(0L);
        ChannelProduct theirs = new ChannelProduct();
        theirs.setOrgId(UUID.randomUUID());
        when(listings.findByChannelIdAndExternalProductId(naver.getId(), "777")).thenReturn(Optional.of(theirs));

        NaverReviewObservationView view = service.deliver(ORG, DEVICE, JOB, request(row("5066448224", "777")));

        assertThat(view.identityVerdict()).isEqualTo("MISMATCH");
        verify(ingestion, never()).ingestReviews(any(), any(), anyList());
    }

    @Test
    @DisplayName("an empty page proves no store — it is refused, never stored as «0 reviews»")
    void anEmptyPageProvesNothing() {
        NaverReviewObservationView view = service.deliver(ORG, DEVICE, JOB, request());
        assertThat(view.identityVerdict()).isEqualTo("UNRESOLVED");
        verify(ingestion, never()).ingestReviews(any(), any(), anyList());
    }

    @Test
    @DisplayName("one row this service does not understand refuses the whole delivery")
    void oneBadRowRefusesAll() {
        for (NaverReviewObservationRequest bad : List.of(
                request(row("5066448224", "1"), row("123", "1")),
                request(row("5066448224", "1"), row("5066448224", "1")),
                request(new NaverReviewObservationRequest.Review("5066448224", "yesterday", 5, "", "1", null, false, 0)),
                request(new NaverReviewObservationRequest.Review("5066448224", "2026-09-16T10:00:00+09:00", 6, "", "1", null, false, 0)),
                request(new NaverReviewObservationRequest.Review("5066448224", "2026-09-16T10:00:00+09:00", 5, "", "1", null, null, 0)),
                new NaverReviewObservationRequest(List.of(row("5066448224", "1")), null))) {
            assertThatThrownBy(() -> service.deliver(ORG, DEVICE, JOB, bad)).isInstanceOf(ApiException.class);
        }
        verify(ingestion, never()).ingestReviews(any(), any(), anyList());
    }

    @Test
    @DisplayName("only a claimed, leased job of this recipe may deliver")
    void onlyTheRightJobDelivers() {
        job.setRecipe(AsideRecipe.CUSTOMER_OPERATIONS_FIXTURE_OBSERVE_V1);
        assertThatThrownBy(() -> service.deliver(ORG, DEVICE, JOB, request(row("5066448224", "1"))))
                .isInstanceOf(ApiException.class);
        job.setRecipe(AsideRecipe.NAVER_REVIEW_OBSERVE_V1);
        job.setStatus(ScheduledAsideJobStatus.QUEUED);
        assertThatThrownBy(() -> service.deliver(ORG, DEVICE, JOB, request(row("5066448224", "1"))))
                .isInstanceOf(ApiException.class);
        job.setStatus(ScheduledAsideJobStatus.CLAIMED);
        job.setLeaseUntil(Instant.now().minusSeconds(1));
        assertThatThrownBy(() -> service.deliver(ORG, DEVICE, JOB, request(row("5066448224", "1"))))
                .isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> service.deliver(UUID.randomUUID(), DEVICE, JOB, request(row("5066448224", "1"))))
                .as("another organisation's caller finds no job").isInstanceOf(ApiException.class);
        verify(ingestion, never()).ingestReviews(any(), any(), anyList());
    }
}
