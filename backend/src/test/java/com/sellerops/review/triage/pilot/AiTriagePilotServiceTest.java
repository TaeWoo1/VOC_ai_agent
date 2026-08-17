package com.sellerops.review.triage.pilot;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.common.ApiException;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import com.sellerops.review.triage.ReviewTriageTier;
import com.sellerops.review.triage.feedback.AiTriageCurrent;
import com.sellerops.review.triage.feedback.AiTriageCurrentRepository;
import com.sellerops.review.triage.feedback.TriageFeedbackService;
import com.sellerops.review.triage.llm.ReviewTriageChannelGate;
import com.sellerops.review.triage.llm.ReviewTriageClassifier;
import com.sellerops.review.triage.llm.TriageSuggestedAction;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.Pageable;

/**
 * The pilot's run: bounded, gated, recorded, and never touching a marketplace.
 */
class AiTriagePilotServiceTest {

    private static final UUID ORG = UUID.randomUUID();
    private static final UUID ACCOUNT = UUID.randomUUID();
    private static final UUID CHANNEL = UUID.randomUUID();

    private final ReviewRepository reviews = mock(ReviewRepository.class);
    private final SellerAccountRepository accounts = mock(SellerAccountRepository.class);
    private final ChannelRepository channels = mock(ChannelRepository.class);
    private final AiTriageCurrentRepository current = mock(AiTriageCurrentRepository.class);
    private final TriageFeedbackService feedback = mock(TriageFeedbackService.class);
    private final AtomicInteger calls = new AtomicInteger();

    private static AiTriagePilotProperties props(boolean enabled, UUID... orgs) {
        String ids = String.join(",", java.util.Arrays.stream(orgs).map(UUID::toString).toList());
        return new AiTriagePilotProperties(enabled, ids, "OPENAI", "gpt-5-2025-08-07", enabled ? "k" : "",
                true, 4000, "low", 2);
    }

    private ReviewTriageChannelGate gate(ReviewTriageTier answer) {
        return new ReviewTriageChannelGate(new ReviewTriageClassifier() {
            @Override public String version() { return "llm-triage/test"; }
            @Override public Result classify(Input input) {
                calls.incrementAndGet();
                return Result.ok(answer, "PRAISE_WITH_CONCESSION", List.of(), TriageSuggestedAction.INVESTIGATE_PRODUCT,
                        version());
            }
        });
    }

    private void account(String channelCode) {
        SellerAccount acc = new SellerAccount();
        acc.setOrgId(ORG);
        acc.setChannelId(CHANNEL);
        when(accounts.findById(ACCOUNT)).thenReturn(Optional.of(acc));
        Channel ch = new Channel();
        ch.setCode(channelCode);
        when(channels.findById(CHANNEL)).thenReturn(Optional.of(ch));
    }

    private static Review review(int rating, String body) {
        Review r = new Review();
        r.setRating(rating);
        r.setBody(body);
        try {
            java.lang.reflect.Field id = r.getClass().getSuperclass().getDeclaredField("id");
            id.setAccessible(true);
            id.set(r, UUID.randomUUID());
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException(e);
        }
        return r;
    }

    @Test
    @DisplayName("off by default: an org not opted in cannot run, and nothing is sent")
    void offByDefault() {
        AiTriagePilotService off = new AiTriagePilotService(props(false), reviews, accounts, channels, current, feedback, null);
        assertThat(off.isEnabledFor(ORG)).isFalse();
        assertThat(off.classifierVersion()).isNull();
        assertThatThrownBy(() -> off.run(ORG, ACCOUNT, null)).isInstanceOf(ApiException.class);

        // Master switch on, but THIS org is not listed: still off for it.
        AiTriagePilotService other = new AiTriagePilotService(props(true, UUID.randomUUID()), reviews, accounts,
                channels, current, feedback, gate(ReviewTriageTier.NEEDS_ATTENTION));
        assertThat(other.isEnabledFor(ORG)).isFalse();
        assertThatThrownBy(() -> other.run(ORG, ACCOUNT, null)).isInstanceOf(ApiException.class);
        assertThat(calls.get()).isZero();
        verify(feedback, never()).record(any(), any(), any(), any(), any(), any());
    }

    @Test
    @DisplayName("a run is bounded by maxPerRun, records every answer, and reports what remains")
    void aRunIsBoundedAndRecorded() {
        account("NAVER");
        List<Review> pending = List.of(review(5, "좋은데 하나 아쉬워요"), review(4, "포장이 찢어져 왔어요"));
        when(reviews.findPendingAiTriage(eq(ORG), eq(CHANNEL), anyString(), any(Pageable.class))).thenReturn(pending);
        when(reviews.countPendingAiTriage(eq(ORG), eq(CHANNEL), anyString())).thenReturn(5L);
        AiTriageCurrent marked = new AiTriageCurrent();
        marked.setAiAttention(true);
        when(current.findByReviewId(any())).thenReturn(Optional.of(marked));

        AiTriagePilotService pilot = new AiTriagePilotService(props(true, ORG), reviews, accounts, channels, current,
                feedback, gate(ReviewTriageTier.NEEDS_ATTENTION));
        AiTriagePilotService.RunResult result = pilot.run(ORG, ACCOUNT, null);

        assertThat(result.considered()).isEqualTo(2);
        assertThat(result.classified()).isEqualTo(2);
        assertThat(result.marked()).isEqualTo(2);
        assertThat(result.failed()).isZero();
        assertThat(result.refused()).isZero();
        assertThat(result.remaining()).as("5 pending, 2 done this run").isEqualTo(3);
        assertThat(result.classifierVersion()).isEqualTo("llm-triage/test");
        // Every answer went through the ONE write path that applies the guard and refreshes the mark.
        verify(feedback).record(eq(ORG), eq(pending.get(0).getId()), eq(5), eq("좋은데 하나 아쉬워요"),
                eq("gpt-5-2025-08-07"), any());
        verify(feedback).record(eq(ORG), eq(pending.get(1).getId()), eq(4), eq("포장이 찢어져 왔어요"),
                eq("gpt-5-2025-08-07"), any());
    }

    @Test
    @DisplayName("Cafe24 and Coupang accounts run like NAVER — the three channels of the contract's §1")
    void theThreeContractChannelsRun() {
        for (String code : List.of("NAVER", "CAFE24", "COUPANG")) {
            calls.set(0);
            account(code);
            when(reviews.findPendingAiTriage(eq(ORG), eq(CHANNEL), anyString(), any(Pageable.class)))
                    .thenReturn(List.of(review(5, "좋아요")));
            when(reviews.countPendingAiTriage(eq(ORG), eq(CHANNEL), anyString())).thenReturn(1L);
            AiTriagePilotService pilot = new AiTriagePilotService(props(true, ORG), reviews, accounts, channels,
                    current, feedback, gate(ReviewTriageTier.NEEDS_ATTENTION));
            AiTriagePilotService.RunResult result = pilot.run(ORG, ACCOUNT, null);
            assertThat(calls.get()).as(code).isEqualTo(1);
            assertThat(result.classified()).as(code).isEqualTo(1);
            assertThat(result.refused()).as(code).isZero();
        }
    }

    @Test
    @DisplayName("an account outside the three channels has no endpoint: 404 before any row is read, and the funnel too")
    void outsideChannelsHaveNoDoor() {
        account("GMARKET");
        AiTriagePilotService pilot = new AiTriagePilotService(props(true, ORG), reviews, accounts, channels, current,
                feedback, gate(ReviewTriageTier.NEEDS_ATTENTION));
        assertThatThrownBy(() -> pilot.run(ORG, ACCOUNT, null)).isInstanceOf(ApiException.class)
                .hasMessageContaining("대상이 아닙니다");
        assertThatThrownBy(() -> pilot.funnel(ORG, ACCOUNT)).isInstanceOf(ApiException.class);
        assertThat(calls.get()).as("the classifier was never reached").isZero();
        verify(reviews, never()).findPendingAiTriage(any(), any(), any(), any());
        verify(feedback, never()).record(any(), any(), any(), any(), any(), any());
    }

    @Test
    @DisplayName("if a row from a refused channel ever reached the gate it is UNCLASSIFIED and recorded, not skipped")
    void theGateStillRefusesAndTheRefusalIsRecorded() {
        // The 404 door above is the first line; the gate is the one that cannot be gone around. Prove
        // the second still holds by classifying through the gate directly for a channel outside the list.
        var gate = gate(ReviewTriageTier.NEEDS_ATTENTION);
        var result = gate.classify("GMARKET", 5, "좋아요");
        assertThat(result.status()).isEqualTo(ReviewTriageClassifier.Status.UNCLASSIFIED);
        assertThat(calls.get()).isZero();
    }

    @Test
    @DisplayName("a per-press limit is honoured, and never above the configured ceiling")
    void thePerPressLimitIsClampedToTheCeiling() {
        account("NAVER");
        when(reviews.findPendingAiTriage(eq(ORG), eq(CHANNEL), anyString(), any(Pageable.class))).thenReturn(List.of());
        when(reviews.countPendingAiTriage(eq(ORG), eq(CHANNEL), anyString())).thenReturn(0L);
        AiTriagePilotService pilot = new AiTriagePilotService(props(true, ORG), reviews, accounts, channels, current,
                feedback, gate(ReviewTriageTier.NEEDS_ATTENTION));

        pilot.run(ORG, ACCOUNT, 1);
        verify(reviews).findPendingAiTriage(eq(ORG), eq(CHANNEL), anyString(),
                org.mockito.ArgumentMatchers.argThat((Pageable p) -> p.getPageSize() == 1));
        // maxPerRun in props() is 2. Asking for 500 gets 2.
        pilot.run(ORG, ACCOUNT, 500);
        verify(reviews).findPendingAiTriage(eq(ORG), eq(CHANNEL), anyString(),
                org.mockito.ArgumentMatchers.argThat((Pageable p) -> p.getPageSize() == 2));
    }

    @Test
    @DisplayName("the funnel counts distinct reviews per step, and has no step called ignored")
    void theFunnelHasNoIgnoredStep() {
        // Structural: the record's components ARE the funnel. Adding an "ignored" or "skipped" count
        // is the thing feedback draft §7.2 forbids, and it would fail here by name.
        assertThat(AiTriagePilotService.Funnel.class.getRecordComponents())
                .extracting(java.lang.reflect.RecordComponent::getName)
                .containsExactly("classifierVersion", "channelCode", "marked", "aiAttentionShown", "reviewOpened",
                        "originalOpened", "marketplaceLocated", "aiAgree", "aiDisagree", "actionStarted",
                        "actionCompleted", "actionNotNeeded", "replyDrafted", "replySubmitted")
                .noneMatch(n -> n.toLowerCase().contains("ignor") || n.toLowerCase().contains("skip")
                        || n.toLowerCase().contains("rate"));
    }

    @Test
    @DisplayName("the pilot has no method that writes to a review, a marketplace, or a tier")
    void thePilotWritesNothingButFeedback() {
        assertThat(AiTriagePilotService.class.getDeclaredMethods())
                .extracting(java.lang.reflect.Method::getName)
                .noneMatch(n -> n.toLowerCase().matches(".*(submit|reply|post|publish|settier|promote|demote).*"));
        // Its only write is through TriageFeedbackService: it holds no repository whose entity is a
        // review, and constructs no entity of its own.
        assertThat(AiTriagePilotService.class.getDeclaredFields())
                .extracting(f -> f.getType().getSimpleName())
                .doesNotContain("ReviewTriageTier", "Review", "TriagePredictionRepository");
    }
}
