package com.sellerops.inquiry.naver;

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
import com.sellerops.connector.naver.NaverProductQnaClient;
import com.sellerops.ingest.IngestFollowUp;
import com.sellerops.ingest.IngestOutcome;
import com.sellerops.ingest.IngestionService;
import com.sellerops.ingest.canonical.CanonicalInquiry;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.InquirySourceSubtype;
import com.sellerops.product.ChannelProduct;
import com.sellerops.product.ChannelProductRepository;
import com.sellerops.responsibility.IdentityVerdict;
import com.sellerops.responsibility.SourceCompleteness;
import com.sellerops.responsibility.aside.AsideMarketplaceAccess;
import com.sellerops.responsibility.aside.AsideRecipe;
import com.sellerops.responsibility.aside.ScheduledAsideJob;
import com.sellerops.responsibility.aside.ScheduledAsideJobRepository;
import com.sellerops.responsibility.aside.ScheduledAsideJobStatus;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.sync.SyncJobRepository;
import java.lang.reflect.RecordComponent;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/**
 * <b>What a scheduled NAVER 상품 문의 read is allowed to become.</b>
 *
 * <p>The unattended contract as questions: can another recipe's job deliver here? can a page nobody can prove is this
 * store reach ingest? does a browser-read inquiry land on the SAME row the official API writes? can a newest page with
 * a possible gap behind it claim to be a settled read? can a row this service does not understand be stored?
 */
class NaverProductInquiryObservationServiceTest {

    private static final UUID ORG = UUID.randomUUID();
    private static final UUID DEVICE = UUID.randomUUID();
    private static final UUID JOB = UUID.randomUUID();

    private final SellerAccountRepository accounts = mock(SellerAccountRepository.class);
    private final ChannelRepository channels = mock(ChannelRepository.class);
    private final ChannelProductRepository listings = mock(ChannelProductRepository.class);
    private final ScheduledAsideJobRepository jobs = mock(ScheduledAsideJobRepository.class);
    private final InquiryRepository inquiries = mock(InquiryRepository.class);
    private final IngestionService ingestion = mock(IngestionService.class);
    private final IngestFollowUp followUp = mock(IngestFollowUp.class);
    private final SyncJobRepository syncJobs = mock(SyncJobRepository.class);

    private Channel naver;
    private SellerAccount account;
    private ScheduledAsideJob job;
    private NaverProductInquiryObservationService service;

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
        job.setRecipe(AsideRecipe.NAVER_PRODUCT_INQUIRY_OBSERVE_V1);
        job.setStatus(ScheduledAsideJobStatus.CLAIMED);
        job.setLeaseUntil(Instant.now().plusSeconds(120));
        when(jobs.findByIdAndDeviceId(JOB, DEVICE)).thenReturn(Optional.of(job));
        when(jobs.save(any())).thenAnswer(inv -> inv.getArgument(0));
        when(ingestion.ingestInquiries(eq(ORG), eq(naver.getId()), eq(account.getId()), anyList()))
                .thenReturn(new IngestOutcome(1, 1, 0, List.of(), List.of(UUID.randomUUID())));
        when(listings.countOwnedListings(eq(ORG), eq(naver.getId()), anyCollection())).thenReturn(1L);

        service = serviceWith(new AsideMarketplaceAccess(true, Set.of(ORG), Set.of(account.getId())));
    }

    private NaverProductInquiryObservationService serviceWith(AsideMarketplaceAccess access) {
        return new NaverProductInquiryObservationService(access, accounts, channels, listings, jobs, inquiries,
                ingestion, followUp, syncJobs);
    }

    private static NaverProductInquiryObservationRequest.Inquiry row(String id, String createdAt, boolean answered) {
        return new NaverProductInquiryObservationRequest.Inquiry(id, createdAt, "몇 가닥까지 들어가나요?", answered, true,
                "13250364547");
    }

    private static NaverProductInquiryObservationRequest page(int pageSize, int total,
                                                              NaverProductInquiryObservationRequest.Inquiry... rows) {
        return new NaverProductInquiryObservationRequest(List.of(rows), pageSize, total, "2026-06-18", "2026-09-17");
    }

    @Test
    @DisplayName("the target is the one named NAVER account for THIS recipe — nothing for the review recipe, the lane off, or an unnamed account")
    void resolvesOnlyTheNamedAccount() {
        assertThat(service.resolve(ORG, AsideRecipe.NAVER_PRODUCT_INQUIRY_OBSERVE_V1)).get()
                .extracting(t -> t.sellerAccountId()).isEqualTo(account.getId());
        assertThat(service.resolve(ORG, AsideRecipe.NAVER_REVIEW_OBSERVE_V1)).isEmpty();
        assertThat(serviceWith(new AsideMarketplaceAccess(false, Set.of(ORG), Set.of(account.getId())))
                .resolve(ORG, AsideRecipe.NAVER_PRODUCT_INQUIRY_OBSERVE_V1)).isEmpty();
        assertThat(serviceWith(new AsideMarketplaceAccess(true, Set.of(ORG), Set.of(UUID.randomUUID())))
                .resolve(ORG, AsideRecipe.NAVER_PRODUCT_INQUIRY_OBSERVE_V1)).isEmpty();
    }

    @Test
    @DisplayName("a whole-period page stores through the inquiry spine as EXACTLY the row the official API writes")
    void aProvedPageIngestsAsTheApiRow() {
        NaverProductInquiryObservationView view = service.deliver(ORG, DEVICE, JOB, page(8, 2,
                row("689162087", "2026-09-17T01:52:31.332+00:00", false),
                row("687632554", "2026-09-04T16:03:15.130+00:00", true)));

        assertThat(view.identityVerdict()).isEqualTo("MATCH");
        assertThat(view.coverage()).isEqualTo("BOUNDED");
        assertThat(view.inserted()).isEqualTo(1);
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<CanonicalInquiry>> rows = ArgumentCaptor.forClass(List.class);
        // The exact connection is passed, so a new unanswered inquiry opens its work item as the API path does.
        verify(ingestion).ingestInquiries(eq(ORG), eq(naver.getId()), eq(account.getId()), rows.capture());
        CanonicalInquiry browser = rows.getValue().get(0);
        CanonicalInquiry api = apiRowFor(689162087L, "2026-09-17T01:52:31.332+00:00", "몇 가닥까지 들어가나요?", false,
                13250364547L);
        assertThat(browser).isEqualTo(api);
        assertThat(rows.getValue().get(1).status()).isEqualTo("ANSWERED");
        assertThat(job.getDeliveryCompleteness()).isEqualTo(SourceCompleteness.BOUNDED);
        assertThat(job.getInsertedCount()).isEqualTo(1);
        verify(followUp).afterInquiryIngest(eq(ORG), anyList());

        assertThatThrownBy(() -> service.deliver(ORG, DEVICE, JOB, page(8, 1,
                row("689162087", "2026-09-17T01:52:31.332+00:00", false))))
                .as("one claim, one delivery").isInstanceOf(ApiException.class);
    }

    /** The official API client's own mapping, so the equality above is against the real writer, not a copy of it. */
    private static CanonicalInquiry apiRowFor(long questionId, String createDate, String question, boolean answered,
                                              long productId) {
        try {
            Class<?> qna = Class.forName("com.sellerops.connector.naver.NaverProductQnaClient$Qna");
            var ctor = qna.getDeclaredConstructor(Arrays.stream(qna.getRecordComponents())
                    .map(RecordComponent::getType).toArray(Class[]::new));
            ctor.setAccessible(true);
            Object q = ctor.newInstance(questionId, createDate, question, null, answered, productId);
            var map = NaverProductQnaClient.class.getDeclaredMethod("toCanonical", qna, int.class);
            map.setAccessible(true);
            return (CanonicalInquiry) map.invoke(null, q, 1);
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException(e);
        }
    }

    @Test
    @DisplayName("the newest page of a longer period is BOUNDED only when its oldest row was already stored")
    void aPageThatReachesStoredHistoryIsBounded() {
        when(inquiries.findByOrgIdAndChannelIdAndExternalId(ORG, naver.getId(), "naver-qna:687632554"))
                .thenReturn(Optional.of(new Inquiry()));

        NaverProductInquiryObservationView view = service.deliver(ORG, DEVICE, JOB, page(2, 11,
                row("689162087", "2026-09-17T01:52:31.332+00:00", false),
                row("687632554", "2026-09-04T16:03:15.130+00:00", true)));

        assertThat(view.coverage()).isEqualTo("BOUNDED");
        assertThat(job.getDeliveryCompleteness()).isEqualTo(SourceCompleteness.BOUNDED);
    }

    @Test
    @DisplayName("…and PARTIAL when an inquiry could be behind the page unseen — stored, but not a settled baseline")
    void aPageWithAPossibleGapIsPartial() {
        when(inquiries.findByOrgIdAndChannelIdAndExternalId(any(), any(), any())).thenReturn(Optional.empty());

        NaverProductInquiryObservationView view = service.deliver(ORG, DEVICE, JOB, page(2, 11,
                row("689162087", "2026-09-17T01:52:31.332+00:00", false),
                row("687632554", "2026-09-04T16:03:15.130+00:00", true)));

        assertThat(view.coverage()).isEqualTo("PARTIAL");
        assertThat(job.getDeliveryCompleteness()).isEqualTo(SourceCompleteness.PARTIAL);
        verify(ingestion).ingestInquiries(eq(ORG), eq(naver.getId()), eq(account.getId()), anyList());
    }

    @Test
    @DisplayName("changed is ingest's update count — an inquiry answered since the last read")
    void anUpdateIsChangedNotNew() {
        when(ingestion.ingestInquiries(eq(ORG), eq(naver.getId()), eq(account.getId()), anyList()))
                .thenReturn(new IngestOutcome(1, 0, 0, List.of(), List.of()));

        NaverProductInquiryObservationView view = service.deliver(ORG, DEVICE, JOB, page(8, 1,
                row("689162087", "2026-09-17T01:52:31.332+00:00", true)));

        assertThat(view.inserted()).isZero();
        assertThat(view.changed()).isEqualTo(1);
        assertThat(job.getChangedCount()).isEqualTo(1);
    }

    @Test
    @DisplayName("a product number nobody holds, or another organisation holds, stores nothing")
    void anUnprovedStoreStoresNothing() {
        when(listings.countOwnedListings(eq(ORG), eq(naver.getId()), anyCollection())).thenReturn(0L);
        ChannelProduct elsewhere = new ChannelProduct();
        elsewhere.setOrgId(UUID.randomUUID());
        when(listings.findByChannelIdAndExternalProductId(naver.getId(), "13250364547"))
                .thenReturn(Optional.of(elsewhere));

        NaverProductInquiryObservationView view = service.deliver(ORG, DEVICE, JOB, page(8, 1,
                row("689162087", "2026-09-17T01:52:31.332+00:00", false)));

        assertThat(view.identityVerdict()).isEqualTo("MISMATCH");
        verify(ingestion, never()).ingestInquiries(any(), any(), any(), anyList());
        assertThat(job.getIdentityVerdict()).isEqualTo(IdentityVerdict.MISMATCH);
        assertThat(job.getInsertedCount()).isNull();
        assertThat(job.getDeliveryCompleteness()).isNull();
    }

    @Test
    @DisplayName("an empty page proves no store: UNRESOLVED, and never «0 inquiries»")
    void anEmptyPageIsUnresolved() {
        NaverProductInquiryObservationView view = service.deliver(ORG, DEVICE, JOB, page(8, 0));

        assertThat(view.identityVerdict()).isEqualTo("UNRESOLVED");
        verify(ingestion, never()).ingestInquiries(any(), any(), any(), anyList());
    }

    @Test
    @DisplayName("a page this service does not understand stores nothing at all")
    void anUnderstoodPageOrNothing() {
        assertThatThrownBy(() -> service.deliver(ORG, DEVICE, JOB, page(8, 2,
                row("687632554", "2026-09-04T16:03:15.130+00:00", true),
                row("689162087", "2026-09-17T01:52:31.332+00:00", false))))
                .as("not newest-first: «the newest page» would not be a bound").isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> service.deliver(ORG, DEVICE, JOB, page(8, 11,
                row("689162087", "2026-09-17T01:52:31.332+00:00", false))))
                .as("a short first page of a longer period is a page still drawing").isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> service.deliver(ORG, DEVICE, JOB, page(8, 1,
                row("naver-qna:1", "2026-09-17T01:52:31.332+00:00", false))))
                .as("an id that is not a bare questionId").isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> service.deliver(ORG, DEVICE, JOB, page(8, 1,
                new NaverProductInquiryObservationRequest.Inquiry("689162087", "2026-09-17T01:52:31.332+00:00", "q",
                        null, false, "13250364547"))))
                .as("no answered flag").isInstanceOf(ApiException.class);
        verify(ingestion, never()).ingestInquiries(any(), any(), any(), anyList());
        assertThat(job.getIdentityVerdict()).isNull();
    }

    @Test
    @DisplayName("another recipe's job cannot deliver here")
    void onlyThisRecipesJob() {
        job.setRecipe(AsideRecipe.NAVER_REVIEW_OBSERVE_V1);
        assertThatThrownBy(() -> service.deliver(ORG, DEVICE, JOB, page(8, 1,
                row("689162087", "2026-09-17T01:52:31.332+00:00", false)))).isInstanceOf(ApiException.class);
    }

    @Test
    @DisplayName("the request has no field for the buyer, and the canonical row keeps no secrecy flag the API does not publish")
    void noBuyerFieldAndNoSecretColumn() {
        assertThat(Arrays.stream(NaverProductInquiryObservationRequest.Inquiry.class.getRecordComponents())
                .map(RecordComponent::getName))
                .containsExactly("questionId", "createdAt", "body", "answered", "secret", "channelProductNo");
        CanonicalInquiry mapped = NaverProductInquiryObservationService.canonical(List.of(
                row("689162087", "2026-09-17T01:52:31.332+00:00", false))).get(0);
        assertThat(mapped.isSecret()).isNull();
        assertThat(mapped.author()).isNull();
        assertThat(mapped.sourceSubtype()).isEqualTo(InquirySourceSubtype.NAVER_PRODUCT_QNA);
        assertThat(mapped.externalId()).isEqualTo("naver-qna:689162087");
    }
}
