package com.sellerops.attention.reply;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.sellerops.attention.reply.dto.AgentReplySubmissionTargetView;
import com.sellerops.attention.triage.ReviewTriage;
import com.sellerops.attention.triage.ReviewTriageRepository;
import com.sellerops.attention.triage.TriageDisposition;
import com.sellerops.common.ApiException;
import com.sellerops.identity.ExecutableIdentity;
import com.sellerops.identity.ExecutableIdentityResolver;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewReplyState;
import com.sellerops.review.ReviewRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

/** The Local Agent's target spend (Acceptance Closure §1): every gate re-asked now, the ref spent exactly once. */
class ReviewReplySubmissionTargetServiceTest {

    private static final Instant NOW = Instant.parse("2026-08-28T03:00:00Z");
    private static final String REF = "0123456789abcdef";
    private static final String FP = "c".repeat(64);
    private final UUID org = UUID.randomUUID();
    private final UUID accountId = UUID.randomUUID();
    private final UUID channelId = UUID.randomUUID();

    private ReviewReplySubmissionRefRepository refs;
    private ReviewReplyApprovalRepository approvals;
    private ReviewReplyDraftService drafts;
    private ReviewRepository reviews;
    private SellerAccountRepository accounts;
    private ReviewTriageRepository triages;
    private ExecutableIdentityResolver identity;
    private ReviewReplySubmissionTargetService service;
    private Review review;
    private ReviewReplySubmissionRef binding;

    @BeforeEach
    void setUp() {
        refs = mock(ReviewReplySubmissionRefRepository.class);
        approvals = mock(ReviewReplyApprovalRepository.class);
        drafts = mock(ReviewReplyDraftService.class);
        reviews = mock(ReviewRepository.class);
        accounts = mock(SellerAccountRepository.class);
        triages = mock(ReviewTriageRepository.class);
        identity = mock(ExecutableIdentityResolver.class);
        service = new ReviewReplySubmissionTargetService(refs, approvals, drafts, reviews, accounts, triages, identity,
                Clock.fixed(NOW, ZoneOffset.UTC));

        review = new Review();
        ReflectionTestUtils.setField(review, "id", UUID.randomUUID());
        review.setOrgId(org);
        review.setChannelId(channelId);
        review.setRating(2);
        review.setBody("합성-리뷰 본문입니다");
        review.setExternalId("1234567890");
        review.setReceivedAt(NOW.minusSeconds(3600));
        review.setReplyState(ReviewReplyState.PENDING);
        SellerAccount account = new SellerAccount();
        ReflectionTestUtils.setField(account, "id", accountId);
        account.setOrgId(org);
        account.setChannelId(channelId);
        account.setFileUpload(false);

        binding = new ReviewReplySubmissionRef();
        binding.setOrgId(org);
        binding.setReviewId(review.getId());
        binding.setSubmissionRef(REF);
        binding.setBoundVersion(1);
        binding.setBoundFingerprint(FP);
        binding.setSellerAccountId(accountId);
        binding.setChannelId(channelId);
        binding.setExecutableIdentity("MARKETPLACE");
        binding.setExecutionMode("GUIDED_BROWSER_EXECUTION");
        binding.setExpiresAt(NOW.plusSeconds(600));

        when(refs.findByOrgIdAndSubmissionRef(org, REF)).thenReturn(Optional.of(binding));
        when(refs.markTargetResolved(eq(org), eq(REF), any())).thenReturn(1);
        when(accounts.findByIdAndOrgId(accountId, org)).thenReturn(Optional.of(account));
        when(reviews.findByIdAndOrgId(review.getId(), org)).thenReturn(Optional.of(review));
        when(identity.forReview(review)).thenReturn(ExecutableIdentity.MARKETPLACE);
        ReviewTriage triage = new ReviewTriage();
        triage.setDisposition(TriageDisposition.RESPONSE_NEEDED);
        when(triages.findByOrgIdAndReviewId(org, review.getId())).thenReturn(Optional.of(triage));
        approve(1, FP);
    }

    private void approve(int version, String fp) {
        ReviewReplyApproval a = new ReviewReplyApproval();
        a.setState(ReviewReplyApprovalState.APPROVED);
        a.setApprovedVersion(version);
        a.setApprovedFingerprint(fp);
        when(approvals.findByOrgIdAndReviewId(org, review.getId())).thenReturn(Optional.of(a));
        ReviewReplyDraft d = new ReviewReplyDraft();
        d.setBody("승인된 답글 본문");
        d.setContentFingerprint(fp);
        when(drafts.version(review.getId(), version)).thenReturn(Optional.of(d));
    }

    @Test
    @DisplayName("a live, approved, marketplace-bound ref resolves ONCE to exactly what the run needs")
    void happyPath() {
        AgentReplySubmissionTargetView view = service.resolve(org, REF);
        assertThat(view.accountId()).isEqualTo(accountId.toString());
        assertThat(view.draftBody()).isEqualTo("승인된 답글 본문");
        assertThat(view.draftVersion()).isEqualTo(1);
        assertThat(view.draftFingerprint()).isEqualTo(FP);
        assertThat(view.operation()).isEqualTo("REVIEW_REPLY");
        assertThat(view.executionMode()).isEqualTo("GUIDED_BROWSER_EXECUTION");
        assertThat(view.targetHint().rating()).isEqualTo(2);
        assertThat(view.channelReviewIdFingerprint()).matches("[0-9a-f]{64}");
        assertThat(view.asOfDate()).isEqualTo("2026-08-28");
        verify(refs).markTargetResolved(eq(org), eq(REF), any());
    }

    @Test
    @DisplayName("spent, expired, cross-org and pre-V86 refs are all the same refusal and spend nothing")
    void refusedShapes() {
        binding.setTargetResolvedAt(NOW.minusSeconds(5));
        assertThatThrownBy(() -> service.resolve(org, REF)).isInstanceOf(ApiException.class).hasMessageContaining("이미 사용된");
        binding.setTargetResolvedAt(null);
        binding.setExpiresAt(NOW.minusSeconds(1));
        assertThatThrownBy(() -> service.resolve(org, REF)).isInstanceOf(ApiException.class).hasMessageContaining("만료");
        binding.setExpiresAt(NOW.plusSeconds(60));
        binding.setSellerAccountId(null);
        assertThatThrownBy(() -> service.resolve(org, REF)).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> service.resolve(UUID.randomUUID(), REF)).isInstanceOf(ApiException.class);
        verify(refs, never()).markTargetResolved(any(), any(), any());
    }

    @Test
    @DisplayName("draft v1 approved → v2 approved → the v1 ref is refused: the approved draft is never handed to the agent")
    void staleDraftIsRefused() {
        approve(2, "d".repeat(64));
        assertThatThrownBy(() -> service.resolve(org, REF)).isInstanceOf(ApiException.class)
                .hasMessageContaining("승인 상태가 바뀌었습니다");
        verify(refs, never()).markTargetResolved(any(), any(), any());
    }

    @Test
    @DisplayName("a row that is not a marketplace object NOW, or already answered, or no longer 대응 필요 — refused")
    void worldStateGates() {
        when(identity.forReview(review)).thenReturn(ExecutableIdentity.NONE);
        assertThatThrownBy(() -> service.resolve(org, REF)).isInstanceOf(ApiException.class).hasMessageContaining("파일로");
        when(identity.forReview(review)).thenReturn(ExecutableIdentity.MARKETPLACE);
        review.setReplyState(ReviewReplyState.ANSWERED);
        assertThatThrownBy(() -> service.resolve(org, REF)).isInstanceOf(ApiException.class).hasMessageContaining("이미 답변");
        review.setReplyState(ReviewReplyState.PENDING);
        when(triages.findByOrgIdAndReviewId(org, review.getId())).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.resolve(org, REF)).isInstanceOf(ApiException.class).hasMessageContaining("대응 필요");
        verify(refs, never()).markTargetResolved(any(), any(), any());
    }

    @Test
    @DisplayName("two agents racing on one ref: the conditional UPDATE decides, the loser gets the spent refusal")
    void singleUseUnderRace() {
        when(refs.markTargetResolved(eq(org), eq(REF), any())).thenReturn(0);
        assertThatThrownBy(() -> service.resolve(org, REF)).isInstanceOf(ApiException.class).hasMessageContaining("이미 사용된");
    }
}
