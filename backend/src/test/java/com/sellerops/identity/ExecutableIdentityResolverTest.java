package com.sellerops.identity;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.common.DataOrigin;
import com.sellerops.community.Cafe24CommunityArticle;
import com.sellerops.community.Cafe24CommunityArticleRepository;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.review.Review;
import com.sellerops.reviewimport.ReviewImportPlan;
import com.sellerops.reviewimport.ReviewImportPlanRepository;
import com.sellerops.reviewimport.ReviewImportSegment;
import com.sellerops.reviewimport.ReviewImportSegmentAttempt;
import com.sellerops.reviewimport.ReviewImportSegmentAttemptRepository;
import com.sellerops.reviewimport.ReviewImportSegmentRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.sync.SyncJob;
import com.sellerops.sync.SyncJobRepository;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Source label ≠ executable identity, and a prefix is not authority. Every case the spec names, plus the
 * one it is really about: a CSV whose ids LOOK like the connector's is still a file.
 */
class ExecutableIdentityResolverTest {

    private final SellerAccountRepository accounts = mock(SellerAccountRepository.class);
    private final ChannelRepository channels = mock(ChannelRepository.class);
    private final Cafe24CommunityArticleRepository articles = mock(Cafe24CommunityArticleRepository.class);
    private final SyncJobRepository syncJobs = mock(SyncJobRepository.class);
    private final ReviewImportSegmentAttemptRepository attempts = mock(ReviewImportSegmentAttemptRepository.class);
    private final ReviewImportSegmentRepository segments = mock(ReviewImportSegmentRepository.class);
    private final ReviewImportPlanRepository plans = mock(ReviewImportPlanRepository.class);

    private final ExecutableIdentityResolver resolver = new ExecutableIdentityResolver(accounts, channels,
            articles, syncJobs, attempts, segments, plans);

    private final UUID org = UUID.randomUUID();
    private final UUID naverChannel = UUID.randomUUID();
    private final UUID cafe24Channel = UUID.randomUUID();
    private final UUID coupangChannel = UUID.randomUUID();
    private final SellerAccount naverApi = account(naverChannel, false);
    private final SellerAccount naverFile = account(naverChannel, true);
    private final SellerAccount cafe24Api = account(cafe24Channel, false);
    private final SellerAccount coupangApi = account(coupangChannel, false);

    @BeforeEach
    void wire() {
        when(channels.findById(naverChannel)).thenReturn(Optional.of(channel("NAVER")));
        when(channels.findById(cafe24Channel)).thenReturn(Optional.of(channel("CAFE24")));
        when(channels.findById(coupangChannel)).thenReturn(Optional.of(channel("COUPANG")));
        for (SellerAccount a : new SellerAccount[] {naverApi, naverFile, cafe24Api, coupangApi}) {
            when(accounts.findByIdAndOrgId(a.getId(), org)).thenReturn(Optional.of(a));
        }
        when(accounts.findByOrgIdAndChannelId(org, cafe24Channel)).thenReturn(Optional.of(cafe24Api));
    }

    // ── inquiries ───────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("a CSV upload row with channel NAVER and external id naver-qna:123 is NONE")
    void aFileRowWithAConnectorShapedIdIsNone() {
        Inquiry csv = inquiry(naverChannel, null, "naver-qna:123");
        assertThat(resolver.forInquiry(csv)).isEqualTo(ExecutableIdentity.NONE);

        // Same shape, bound to a FILE-UPLOAD account (the ESM import shape): still a file.
        Inquiry esm = inquiry(naverChannel, naverFile.getId(), "naver-qna:123");
        assertThat(resolver.forInquiry(esm)).isEqualTo(ExecutableIdentity.NONE);
    }

    @Test
    @DisplayName("a connector-written NAVER Q&A row is MARKETPLACE")
    void aConnectorWrittenInquiryIsMarketplace() {
        Inquiry row = inquiry(naverChannel, naverApi.getId(), "naver-qna:123");
        assertThat(resolver.forInquiry(row)).isEqualTo(ExecutableIdentity.MARKETPLACE);
        assertThat(resolver.forInquiry(inquiry(naverChannel, naverApi.getId(), "naver-payinq:9")))
                .isEqualTo(ExecutableIdentity.MARKETPLACE);
        assertThat(resolver.forInquiry(inquiry(cafe24Channel, cafe24Api.getId(), "cafe24:b6:a247")))
                .isEqualTo(ExecutableIdentity.MARKETPLACE);
    }

    @Test
    @DisplayName("an API-bound row whose id names nothing, a synthetic row, and a wrong-channel account are NONE")
    void inquiryMisses() {
        assertThat(resolver.forInquiry(inquiry(naverChannel, naverApi.getId(), "12345")))
                .isEqualTo(ExecutableIdentity.NONE);
        Inquiry seeded = inquiry(naverChannel, naverApi.getId(), "naver-qna:1");
        seeded.setDataOrigin(DataOrigin.DEMO_SEED);
        assertThat(resolver.forInquiry(seeded)).isEqualTo(ExecutableIdentity.NONE);
        assertThat(resolver.forInquiry(inquiry(cafe24Channel, naverApi.getId(), "cafe24:b6:a1")))
                .as("account on another channel than the row").isEqualTo(ExecutableIdentity.NONE);
    }

    // ── reviews ─────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("a guided NAVER export row (SELLER_CENTER_EXPORT + launch binding) is MARKETPLACE")
    void aGuidedExportRowIsMarketplace() {
        UUID job = exportJob();
        UUID plan = UUID.randomUUID();
        UUID segment = UUID.randomUUID();
        ReviewImportSegmentAttempt attempt = new ReviewImportSegmentAttempt();
        attempt.setOrgId(org);
        attempt.setSegmentId(segment);
        attempt.setSyncJobId(job);
        when(attempts.findFirstBySyncJobId(job)).thenReturn(Optional.of(attempt));
        ReviewImportSegment seg = new ReviewImportSegment();
        seg.setPlanId(plan);
        when(segments.findByIdAndOrgId(segment, org)).thenReturn(Optional.of(seg));
        ReviewImportPlan p = new ReviewImportPlan();
        p.setSellerAccountId(naverApi.getId());
        when(plans.findByIdAndOrgId(plan, org)).thenReturn(Optional.of(p));

        Review review = review(naverChannel, "3100012345", job);
        assertThat(resolver.forReview(review)).isEqualTo(ExecutableIdentity.MARKETPLACE);
    }

    @Test
    @DisplayName("an export-method run with no launch binding, and a MANUAL_UPLOAD run, are NONE")
    void anUnboundExportAndAManualUploadAreNone() {
        UUID unbound = exportJob();
        when(attempts.findFirstBySyncJobId(unbound)).thenReturn(Optional.empty());
        assertThat(resolver.forReview(review(naverChannel, "3100012345", unbound)))
                .isEqualTo(ExecutableIdentity.NONE);

        UUID manual = job("MANUAL_UPLOAD", null);
        assertThat(resolver.forReview(review(naverChannel, "3100012345", manual)))
                .as("a NAVER-labelled CSV upload").isEqualTo(ExecutableIdentity.NONE);

        assertThat(resolver.forReview(review(naverChannel, "3100012345", null)))
                .as("no run at all").isEqualTo(ExecutableIdentity.NONE);
    }

    @Test
    @DisplayName("a Coupang handoff row (SELLER_CENTER_READ, account-bound, locate target present) is MARKETPLACE")
    void aCoupangHandoffRowIsMarketplace() {
        UUID job = job("SELLER_CENTER_READ", coupangApi.getId());
        Review review = review(coupangChannel, null, job);
        review.setProductId(UUID.randomUUID());
        review.setRating(4);
        assertThat(resolver.forReview(review)).isEqualTo(ExecutableIdentity.MARKETPLACE);

        Review noTarget = review(coupangChannel, null, job);
        noTarget.setProductId(null);
        assertThat(resolver.forReview(noTarget)).as("no provider object identity").isEqualTo(ExecutableIdentity.NONE);
    }

    @Test
    @DisplayName("a Cafe24 board-4 review with its article row is MARKETPLACE; without it, NONE")
    void aCafe24ReviewNeedsItsArticle() {
        Cafe24CommunityArticle article = new Cafe24CommunityArticle();
        article.setOrgId(org);
        when(articles.findByChannelIdAndSellerAccountIdAndBoardNoAndArticleNo(cafe24Channel, cafe24Api.getId(), 4, 981L))
                .thenReturn(Optional.of(article));
        assertThat(resolver.forReview(review(cafe24Channel, "cafe24:b4:a981", null)))
                .isEqualTo(ExecutableIdentity.MARKETPLACE);

        when(articles.findByChannelIdAndSellerAccountIdAndBoardNoAndArticleNo(any(), any(), anyInt(), anyLong()))
                .thenReturn(Optional.empty());
        assertThat(resolver.forReview(review(cafe24Channel, "cafe24:b4:a982", null)))
                .as("the id is a string until the article behind it is found").isEqualTo(ExecutableIdentity.NONE);
    }

    @Test
    @DisplayName("a resolver with nothing to read answers NONE for everything")
    void theUnresolvedResolverFailsClosed() {
        ExecutableIdentityResolver none = ExecutableIdentityResolver.unresolved();
        assertThat(none.forInquiry(inquiry(naverChannel, naverApi.getId(), "naver-qna:1")))
                .isEqualTo(ExecutableIdentity.NONE);
        assertThat(none.forReview(review(cafe24Channel, "cafe24:b4:a1", null))).isEqualTo(ExecutableIdentity.NONE);
    }

    // ── fixtures ────────────────────────────────────────────────────────────────────────

    private UUID exportJob() {
        return job("SELLER_CENTER_EXPORT", null);
    }

    private UUID job(String method, UUID sellerAccountId) {
        SyncJob job = new SyncJob();
        UUID id = UUID.randomUUID();
        job.setId(id);
        job.setOrgId(org);
        job.setMethod(method);
        job.setSellerAccountId(sellerAccountId);
        when(syncJobs.findByIdAndOrgId(eq(id), eq(org))).thenReturn(Optional.of(job));
        return id;
    }

    private Review review(UUID channelId, String externalId, UUID jobId) {
        Review r = new Review();
        r.setId(UUID.randomUUID());
        r.setOrgId(org);
        r.setChannelId(channelId);
        r.setExternalId(externalId);
        r.setAcquisitionSyncJobId(jobId);
        r.setBody("합성 본문");
        r.setRating(5);
        r.setReceivedAt(Instant.parse("2026-08-20T00:00:00Z"));
        return r;
    }

    private Inquiry inquiry(UUID channelId, UUID sellerAccountId, String externalId) {
        Inquiry i = new Inquiry();
        i.setId(UUID.randomUUID());
        i.setOrgId(org);
        i.setChannelId(channelId);
        i.setSellerAccountId(sellerAccountId);
        i.setExternalId(externalId);
        i.setBody("합성 문의");
        i.setStatus("UNANSWERED");
        i.setReceivedAt(Instant.parse("2026-08-20T00:00:00Z"));
        return i;
    }

    private SellerAccount account(UUID channelId, boolean fileUpload) {
        SellerAccount a = new SellerAccount();
        a.setId(UUID.randomUUID());
        a.setOrgId(org);
        a.setChannelId(channelId);
        a.setFileUpload(fileUpload);
        return a;
    }

    private static Channel channel(String code) {
        Channel c = new Channel();
        c.setId(UUID.randomUUID());
        c.setCode(code);
        return c;
    }
}
