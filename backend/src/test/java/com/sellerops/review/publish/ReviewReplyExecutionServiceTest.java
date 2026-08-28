package com.sellerops.review.publish;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.sellerops.attention.VocItemRef;
import com.sellerops.attention.reply.ReviewReplyApproval;
import com.sellerops.attention.reply.ReviewReplyApprovalRepository;
import com.sellerops.attention.reply.ReviewReplyApprovalState;
import com.sellerops.attention.reply.ReviewReplyDraft;
import com.sellerops.attention.reply.ReviewReplyDraftService;
import com.sellerops.attention.reply.ReviewReplySubmissionRef;
import com.sellerops.attention.reply.ReviewReplySubmissionRefRepository;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.common.ApiException;
import com.sellerops.identity.ExecutableIdentity;
import com.sellerops.identity.ExecutableIdentityResolver;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewReplyState;
import com.sellerops.review.ReviewRepository;
import com.sellerops.review.publish.cafe24.Cafe24ReviewCommentAdapter;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

/**
 * Service-level proof of the review execution seam (Acceptance Closure §7): every gate before the ONE POST,
 * idempotency on the command id, and the per-review double-post fence a fresh command id cannot get past.
 * Repositories are mocked because the point is the ORDER of gates and how many times the transport is
 * touched — an in-memory ledger records what would have been written.
 */
class ReviewReplyExecutionServiceTest {

    private final UUID org = UUID.randomUUID();
    private final UUID user = UUID.randomUUID();
    private final UUID accountId = UUID.randomUUID();
    private final UUID channelId = UUID.randomUUID();
    private static final String FP = "a".repeat(64);
    private static final String BODY = "합성-승인된 답글";

    private ReviewRepository reviews;
    private SellerAccountRepository accounts;
    private ChannelRepository channels;
    private ReviewReplyApprovalRepository approvals;
    private ReviewReplyDraftService drafts;
    private ReviewReplySubmissionRefRepository refs;
    private ReviewReplyExecutionRepository executions;
    private ExecutableIdentityResolver identity;
    private ReviewExecutionCapability capability;
    private Cafe24ReviewCommentAdapter adapter;
    private ReviewReplyExecutionService service;

    private Review review;
    private String actionRef;
    private final List<ReviewReplyExecution> ledger = new ArrayList<>();

    @BeforeEach
    void setUp() {
        reviews = mock(ReviewRepository.class);
        accounts = mock(SellerAccountRepository.class);
        channels = mock(ChannelRepository.class);
        approvals = mock(ReviewReplyApprovalRepository.class);
        drafts = mock(ReviewReplyDraftService.class);
        refs = mock(ReviewReplySubmissionRefRepository.class);
        executions = mock(ReviewReplyExecutionRepository.class);
        identity = mock(ExecutableIdentityResolver.class);
        capability = mock(ReviewExecutionCapability.class);
        adapter = mock(Cafe24ReviewCommentAdapter.class);
        service = new ReviewReplyExecutionService(reviews, accounts, channels, approvals, drafts, refs, executions,
                identity, capability);

        review = new Review();
        ReflectionTestUtils.setField(review, "id", UUID.randomUUID());
        review.setOrgId(org);
        review.setChannelId(channelId);
        review.setExternalId("cafe24:b4:a1234");
        review.setReplyState(ReviewReplyState.PENDING);
        actionRef = VocItemRef.forReview(review.getId());

        SellerAccount account = new SellerAccount();
        ReflectionTestUtils.setField(account, "id", accountId);
        account.setOrgId(org);
        account.setChannelId(channelId);
        Channel channel = new Channel();
        ReflectionTestUtils.setField(channel, "id", channelId);
        channel.setCode("CAFE24");

        when(accounts.findByIdAndOrgId(accountId, org)).thenReturn(Optional.of(account));
        when(reviews.findByIdAndOrgId(review.getId(), org)).thenReturn(Optional.of(review));
        when(channels.findById(channelId)).thenReturn(Optional.of(channel));
        when(identity.forReview(review)).thenReturn(ExecutableIdentity.MARKETPLACE);
        when(capability.of(org, accountId, "CAFE24")).thenReturn(new ReviewExecutionCapability.Decision(
                ReviewExecutionKind.API_EXECUTION, null));
        when(capability.cafe24Adapter()).thenReturn(adapter);
        when(executions.save(any())).thenAnswer(inv -> {
            ReviewReplyExecution row = inv.getArgument(0);
            if (row.getId() == null) ReflectionTestUtils.setField(row, "id", UUID.randomUUID());
            ledger.add(row);
            return row;
        });
        when(executions.findByOrgIdAndCommandId(eq(org), anyString())).thenAnswer(inv ->
                ledger.stream().filter(r -> r.getCommandId().equals(inv.getArgument(1))).findFirst());
        when(executions.existsByOrgIdAndReviewIdAndLaneAndStatusIn(eq(org), eq(review.getId()),
                eq(ReviewExecutionLane.API), any())).thenAnswer(inv -> ledger.stream().anyMatch(r ->
                r.getLane() == ReviewExecutionLane.API && (r.getStatus() == ReviewExecutionStatus.POSTED
                        || r.getStatus() == ReviewExecutionStatus.DELIVERY_UNKNOWN)));
        approve(1, FP);
    }

    private void approve(int version, String fingerprint) {
        ReviewReplyApproval approval = new ReviewReplyApproval();
        approval.setOrgId(org);
        approval.setReviewId(review.getId());
        approval.setState(ReviewReplyApprovalState.APPROVED);
        approval.setApprovedVersion(version);
        approval.setApprovedFingerprint(fingerprint);
        when(approvals.findByOrgIdAndReviewId(org, review.getId())).thenReturn(Optional.of(approval));
        ReviewReplyDraft draft = new ReviewReplyDraft();
        draft.setBody(BODY);
        draft.setContentFingerprint(fingerprint);
        when(drafts.version(review.getId(), version)).thenReturn(Optional.of(draft));
    }

    private void withdrawn() {
        ReviewReplyApproval approval = new ReviewReplyApproval();
        approval.setOrgId(org);
        approval.setReviewId(review.getId());
        approval.setState(ReviewReplyApprovalState.WITHDRAWN);
        when(approvals.findByOrgIdAndReviewId(org, review.getId())).thenReturn(Optional.of(approval));
    }

    private ReviewExecutionView execute(String commandId, String fingerprint) {
        return service.execute(org, accountId, actionRef, commandId, fingerprint, user);
    }

    @Test
    @DisplayName("no approved head — refused before any gate, nothing recorded, nothing sent")
    void approvalRequired() {
        withdrawn();
        assertThatThrownBy(() -> execute("cmd-1", FP)).isInstanceOf(ApiException.class);
        verify(adapter, never()).post(any(), any(), any(), any());
        assertThat(ledger).isEmpty();
    }

    @Test
    @DisplayName("draft v1 approved → replaced by v2 → the v1 fingerprint the old screen holds is a 409, POST 0")
    void aSupersededApprovalCannotBeSpent() {
        approve(2, "b".repeat(64));
        assertThatThrownBy(() -> execute("cmd-1", FP)).isInstanceOf(ApiException.class)
                .hasMessageContaining("승인 상태가 바뀌었습니다");
        verify(adapter, never()).post(any(), any(), any(), any());
        assertThat(ledger).isEmpty();
    }

    @Test
    @DisplayName("a file-imported row (identity NONE) is refused as NOT_MARKETPLACE_OBJECT — the adapter is never asked")
    void executableIdentityGate() {
        when(identity.forReview(review)).thenReturn(ExecutableIdentity.NONE);
        ReviewExecutionView view = execute("cmd-1", FP);
        assertThat(view.status()).isEqualTo("REFUSED");
        assertThat(view.reason()).isEqualTo("NOT_MARKETPLACE_OBJECT");
        verify(adapter, never()).post(any(), any(), any(), any());
    }

    @Test
    @DisplayName("an account on another channel cannot address the review — 404, nothing recorded")
    void accountChannelBinding() {
        UUID other = UUID.randomUUID();
        SellerAccount stranger = new SellerAccount();
        ReflectionTestUtils.setField(stranger, "id", other);
        stranger.setOrgId(org);
        stranger.setChannelId(UUID.randomUUID());
        when(accounts.findByIdAndOrgId(other, org)).thenReturn(Optional.of(stranger));
        assertThatThrownBy(() -> service.execute(org, other, actionRef, "cmd-1", FP, user))
                .isInstanceOf(ApiException.class);
        assertThat(ledger).isEmpty();
    }

    @Test
    @DisplayName("execution switched off — REFUSED with the capability's reason, POST 0")
    void disabledFlag() {
        when(capability.of(org, accountId, "CAFE24")).thenReturn(
                ReviewExecutionCapability.Decision.unsupported(ReviewExecutionReason.EXECUTION_DISABLED));
        ReviewExecutionView view = execute("cmd-1", FP);
        assertThat(view.status()).isEqualTo("REFUSED");
        assertThat(view.reason()).isEqualTo("EXECUTION_DISABLED");
        verify(adapter, never()).post(any(), any(), any(), any());
    }

    @Test
    @DisplayName("the channel already reports a reply — 409 before any gate that could send")
    void alreadyAnsweredRefusal() {
        review.setReplyState(ReviewReplyState.ANSWERED);
        assertThatThrownBy(() -> execute("cmd-1", FP)).isInstanceOf(ApiException.class)
                .hasMessageContaining("이미 답변");
        verify(adapter, never()).post(any(), any(), any(), any());
    }

    @Test
    @DisplayName("ACCEPTED → POSTED with the read-back's verification; the same command id replays without a second POST")
    void postedOnceAndReplayed() {
        when(adapter.post(org, accountId, review.getExternalId(), BODY))
                .thenReturn(new Cafe24ReviewCommentAdapter.PostResult(Cafe24ReviewCommentAdapter.PostResult.Kind.ACCEPTED, 77L, null));
        when(adapter.verify(org, accountId, review.getExternalId(), BODY, 77L))
                .thenReturn(ReviewExecutionVerification.VERIFIED);
        ReviewExecutionView first = execute("cmd-1", FP);
        assertThat(first.status()).isEqualTo("POSTED");
        assertThat(first.verification()).isEqualTo("VERIFIED");
        assertThat(first.providerRef()).isEqualTo("77");
        assertThat(first.replayed()).isFalse();

        ReviewExecutionView again = execute("cmd-1", FP);
        assertThat(again.replayed()).isTrue();
        verify(adapter, times(1)).post(any(), any(), any(), any());
    }

    @Test
    @DisplayName("a NEW command id against a review already POSTED is refused ALREADY_EXECUTED — the transport is touched once")
    void aFreshCommandIdCannotPostTwice() {
        when(adapter.post(org, accountId, review.getExternalId(), BODY))
                .thenReturn(new Cafe24ReviewCommentAdapter.PostResult(Cafe24ReviewCommentAdapter.PostResult.Kind.ACCEPTED, 77L, null));
        when(adapter.verify(any(), any(), any(), any(), any())).thenReturn(ReviewExecutionVerification.VERIFIED);
        execute("cmd-1", FP);
        ReviewExecutionView second = execute("cmd-2", FP);
        assertThat(second.status()).isEqualTo("REFUSED");
        assertThat(second.reason()).isEqualTo("ALREADY_EXECUTED");
        verify(adapter, times(1)).post(any(), any(), any(), any());
    }

    @Test
    @DisplayName("DELIVERY_UNKNOWN is recorded as unknown, not retried — and it also fences a later POST")
    void deliveryUnknownIsFinalAndFences() {
        when(adapter.post(org, accountId, review.getExternalId(), BODY))
                .thenReturn(new Cafe24ReviewCommentAdapter.PostResult(Cafe24ReviewCommentAdapter.PostResult.Kind.DELIVERY_UNKNOWN, null, null));
        ReviewExecutionView view = execute("cmd-1", FP);
        assertThat(view.status()).isEqualTo("DELIVERY_UNKNOWN");
        assertThat(view.verification()).isEqualTo("DELIVERY_UNKNOWN");
        ReviewExecutionView later = execute("cmd-2", FP);
        assertThat(later.reason()).isEqualTo("ALREADY_EXECUTED");
        verify(adapter, times(1)).post(any(), any(), any(), any());
        verify(adapter, never()).verify(any(), any(), any(), any(), any());
    }

    @Test
    @DisplayName("a read-back that cannot match the content records the weaker verification word, never VERIFIED")
    void readBackHandling() {
        when(adapter.post(org, accountId, review.getExternalId(), BODY))
                .thenReturn(new Cafe24ReviewCommentAdapter.PostResult(Cafe24ReviewCommentAdapter.PostResult.Kind.ACCEPTED, 5L, null));
        when(adapter.verify(any(), any(), any(), any(), any())).thenReturn(ReviewExecutionVerification.STATUS_UNRESOLVED);
        ReviewExecutionView view = execute("cmd-1", FP);
        assertThat(view.status()).isEqualTo("POSTED");
        assertThat(view.verification()).isEqualTo("STATUS_UNRESOLVED");
    }

    // ── guided lane ─────────────────────────────────────────────────────────────────────────

    private ReviewReplySubmissionRef binding(int version, String fingerprint, UUID boundAccount) {
        ReviewReplySubmissionRef b = new ReviewReplySubmissionRef();
        b.setOrgId(org);
        b.setReviewId(review.getId());
        b.setSubmissionRef("0123456789abcdef");
        b.setBoundVersion(version);
        b.setBoundFingerprint(fingerprint);
        b.setSellerAccountId(boundAccount);
        b.setChannelId(channelId);
        when(refs.findByOrgIdAndSubmissionRef(org, "0123456789abcdef")).thenReturn(Optional.of(b));
        return b;
    }

    @Test
    @DisplayName("observe: a ref minted for v1 after v2 was approved stamps nothing — the ledger keeps no superseded fingerprint")
    void observeRechecksTheApprovedHead() {
        binding(1, FP, accountId);
        approve(2, "b".repeat(64));
        assertThatThrownBy(() -> service.observe(org, accountId, actionRef, "cmd-o1", "0123456789abcdef",
                "COMPOSER_FILLED", user)).isInstanceOf(ApiException.class)
                .hasMessageContaining("승인 상태가 바뀌었습니다");
        assertThat(ledger).isEmpty();
    }

    @Test
    @DisplayName("observe: a ref bound to another account is refused; a matching one records COMPOSER_FILLED once")
    void observeBindsTheAccount() {
        binding(1, FP, UUID.randomUUID());
        assertThatThrownBy(() -> service.observe(org, accountId, actionRef, "cmd-o1", "0123456789abcdef",
                "COMPOSER_FILLED", user)).isInstanceOf(ApiException.class);
        binding(1, FP, accountId);
        when(executions.findTopByOrgIdAndSubmissionRefOrderByCreatedAtDesc(org, "0123456789abcdef"))
                .thenAnswer(inv -> ledger.stream().filter(r -> "0123456789abcdef".equals(r.getSubmissionRef()))
                        .reduce((a, b) -> b));
        ReviewExecutionView v = service.observe(org, accountId, actionRef, "cmd-o2", "0123456789abcdef",
                "COMPOSER_FILLED", user);
        assertThat(v.status()).isEqualTo("COMPOSER_FILLED");
        assertThat(v.verification()).isEqualTo("COMPOSER_FILLED");
        // Backwards is refused; the same state is idempotent.
        ReviewExecutionView same = service.observe(org, accountId, actionRef, "cmd-o3", "0123456789abcdef",
                "COMPOSER_FILLED", user);
        assertThat(same.replayed()).isTrue();
        assertThat(ledger).hasSize(1);
    }
}
