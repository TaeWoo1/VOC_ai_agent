package com.sellerops.review.channel;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
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
import com.sellerops.review.channel.dto.TriageFeedbackRequests;
import com.sellerops.review.triage.ReviewTriageTier;
import com.sellerops.review.triage.feedback.TriageAction;
import com.sellerops.review.triage.feedback.TriageActionKind;
import com.sellerops.review.triage.feedback.TriageActionRepository;
import com.sellerops.review.triage.feedback.TriageBehaviorEvent;
import com.sellerops.review.triage.feedback.TriageBehaviorEventRepository;
import com.sellerops.review.triage.feedback.TriageBehaviorKind;
import com.sellerops.review.triage.feedback.TriageCorrection;
import com.sellerops.review.triage.feedback.TriageCorrectionRepository;
import com.sellerops.review.triage.feedback.TriageEventKind;
import com.sellerops.review.triage.feedback.TriageFeedbackService;
import com.sellerops.review.triage.feedback.TriageShownSource;
import com.sellerops.review.triage.pilot.AiTriagePilotService;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/**
 * The contract-§1 door and the per-channel event gate, at the one service every feedback route
 * passes through — and the read model that turns the three tables into the contract's vocabulary.
 */
class ChannelReviewFeedbackServiceTest {

    private static final UUID ORG = UUID.randomUUID();
    private static final UUID ACCOUNT = UUID.randomUUID();
    private static final UUID CHANNEL = UUID.randomUUID();

    private final ReviewRepository reviews = mock(ReviewRepository.class);
    private final SellerAccountRepository accounts = mock(SellerAccountRepository.class);
    private final ChannelRepository channels = mock(ChannelRepository.class);
    private final TriageFeedbackService feedback = mock(TriageFeedbackService.class);
    private final AiTriagePilotService pilot = mock(AiTriagePilotService.class);
    private final TriageCorrectionRepository corrections = mock(TriageCorrectionRepository.class);
    private final TriageActionRepository actions = mock(TriageActionRepository.class);
    private final TriageBehaviorEventRepository behavior = mock(TriageBehaviorEventRepository.class);

    private final ChannelReviewFeedbackService service = new ChannelReviewFeedbackService(reviews, accounts,
            channels, feedback, pilot, corrections, actions, behavior);

    private Review onChannel(String code) {
        SellerAccount acc = new SellerAccount();
        acc.setOrgId(ORG);
        acc.setChannelId(CHANNEL);
        when(accounts.findById(ACCOUNT)).thenReturn(Optional.of(acc));
        Channel ch = new Channel();
        ch.setCode(code);
        when(channels.findById(CHANNEL)).thenReturn(Optional.of(ch));
        Review r = new Review();
        r.setOrgId(ORG);
        r.setChannelId(CHANNEL);
        r.setRating(5);
        r.setBody("좋아요");
        try {
            java.lang.reflect.Field id = r.getClass().getSuperclass().getDeclaredField("id");
            id.setAccessible(true);
            id.set(r, UUID.randomUUID());
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException(e);
        }
        when(reviews.findByIdAndOrgId(r.getId(), ORG)).thenReturn(Optional.of(r));
        when(reviews.findByOrgIdAndIdIn(eq(ORG), any())).thenReturn(List.of(r));
        when(pilot.isEnabledFor(ORG)).thenReturn(true);
        return r;
    }

    @Test
    @DisplayName("outside the three channels every route is a 404, and nothing is written")
    void outsideChannelsHaveNoRoute() {
        Review r = onChannel("GMARKET");
        assertThatThrownBy(() -> service.correct(ORG, ACCOUNT, r.getId(),
                new TriageFeedbackRequests.Correction(true, null))).isInstanceOf(ApiException.class)
                .hasMessageContaining("대상이 아닙니다");
        assertThatThrownBy(() -> service.act(ORG, ACCOUNT, r.getId(), TriageActionKind.ACTION_STARTED, null))
                .isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> service.observe(ORG, ACCOUNT, new TriageFeedbackRequests.Behavior(List.of(
                new TriageFeedbackRequests.Behavior.Event(r.getId(), TriageBehaviorKind.REVIEW_OPENED)))))
                .isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> service.events(ORG, ACCOUNT, r.getId())).isInstanceOf(ApiException.class);
        verify(feedback, never()).correctReview(any(), any(), any(), any(), anyBoolean(), any(), anyBoolean());
        verify(feedback, never()).act(any(), any(), any(), any(), any(), any(), anyBoolean());
        verify(feedback, never()).observe(any(), any(), anyBoolean());
    }

    @Test
    @DisplayName("a reply event on a Coupang review is refused — the channel has no reply feature, and none is faked")
    void coupangRefusesReplyEvents() {
        Review r = onChannel("COUPANG");
        for (TriageActionKind kind : List.of(TriageActionKind.REPLY_DRAFTED, TriageActionKind.REPLY_SUBMITTED)) {
            assertThatThrownBy(() -> service.act(ORG, ACCOUNT, r.getId(), kind, null))
                    .as("%s", kind).isInstanceOf(ApiException.class).hasMessageContaining("기록할 수 없는");
        }
        verify(feedback, never()).act(any(), any(), any(), any(), any(), any(), anyBoolean());
        // The three common acts pass.
        service.act(ORG, ACCOUNT, r.getId(), TriageActionKind.ACTION_COMPLETED, null);
        verify(feedback).act(eq(ORG), eq(r.getId()), eq(5), eq("좋아요"), eq(TriageActionKind.ACTION_COMPLETED),
                any(), eq(true));
    }

    @Test
    @DisplayName("Cafe24 has no reply flow built either; NAVER's guided flow admits the reply kinds")
    void replyKindsFollowTheTable() {
        Review cafe = onChannel("CAFE24");
        assertThatThrownBy(() -> service.act(ORG, ACCOUNT, cafe.getId(), TriageActionKind.REPLY_DRAFTED, null))
                .isInstanceOf(ApiException.class);
        Review naver = onChannel("NAVER");
        service.act(ORG, ACCOUNT, naver.getId(), TriageActionKind.REPLY_DRAFTED, null);
        verify(feedback).act(eq(ORG), eq(naver.getId()), any(), any(), eq(TriageActionKind.REPLY_DRAFTED), any(), eq(true));
    }

    @Test
    @DisplayName("silver a channel cannot produce is dropped: ORIGINAL_OPENED / MARKETPLACE_LOCATED only where there is a locate surface")
    @SuppressWarnings("unchecked")
    void locateSilverIsChannelGated() {
        Review naver = onChannel("NAVER");
        service.observe(ORG, ACCOUNT, new TriageFeedbackRequests.Behavior(List.of(
                new TriageFeedbackRequests.Behavior.Event(naver.getId(), TriageBehaviorKind.ORIGINAL_OPENED),
                new TriageFeedbackRequests.Behavior.Event(naver.getId(), TriageBehaviorKind.MARKETPLACE_LOCATED),
                new TriageFeedbackRequests.Behavior.Event(naver.getId(), TriageBehaviorKind.REVIEW_OPENED))));
        ArgumentCaptor<List<TriageFeedbackService.Observation>> captor = ArgumentCaptor.forClass(List.class);
        verify(feedback).observe(eq(ORG), captor.capture(), eq(true));
        assertThat(captor.getValue()).extracting(TriageFeedbackService.Observation::kind)
                .containsExactly(TriageBehaviorKind.REVIEW_OPENED);

        Review coupang = onChannel("COUPANG");
        service.observe(ORG, ACCOUNT, new TriageFeedbackRequests.Behavior(List.of(
                new TriageFeedbackRequests.Behavior.Event(coupang.getId(), TriageBehaviorKind.ORIGINAL_OPENED),
                new TriageFeedbackRequests.Behavior.Event(coupang.getId(), TriageBehaviorKind.MARKETPLACE_LOCATED))));
        verify(feedback, org.mockito.Mockito.times(2)).observe(eq(ORG), captor.capture(), eq(true));
        assertThat(captor.getValue()).extracting(TriageFeedbackService.Observation::kind)
                .containsExactly(TriageBehaviorKind.ORIGINAL_OPENED, TriageBehaviorKind.MARKETPLACE_LOCATED);
    }

    @Test
    @DisplayName("the review's events read back in the contract's vocabulary, oldest first, and a correction reads as agree/disagree with what was shown")
    void eventsReadAsTheContract() {
        Review r = onChannel("COUPANG");
        Instant t0 = Instant.parse("2026-08-17T00:00:00Z");
        TriageBehaviorEvent shown = new TriageBehaviorEvent();
        shown.setKind(TriageBehaviorKind.AI_ATTENTION_SHOWN);
        shown.setShownSource(TriageShownSource.AI);
        shown.setShownTier(ReviewTriageTier.NEEDS_ATTENTION);
        shown.setOccurredAt(t0);
        TriageBehaviorEvent located = new TriageBehaviorEvent();
        located.setKind(TriageBehaviorKind.MARKETPLACE_LOCATED);
        located.setShownSource(TriageShownSource.AI);
        located.setOccurredAt(t0.plusSeconds(20));
        when(behavior.findByReviewIdOrderByOccurredAtAsc(r.getId())).thenReturn(List.of(shown, located));
        TriageAction started = new TriageAction();
        started.setKind(TriageActionKind.ACTION_STARTED);
        started.setShownSource(TriageShownSource.AI);
        started.setActedAt(t0.plusSeconds(30));
        when(actions.findByReviewIdOrderByActedAtDesc(r.getId())).thenReturn(List.of(started));
        TriageCorrection c = new TriageCorrection();
        c.setShownSource(TriageShownSource.AI);
        c.setShownTier(ReviewTriageTier.NEEDS_ATTENTION);
        c.setCorrectedTier(ReviewTriageTier.NEEDS_ATTENTION);
        c.setCorrectedAt(t0.plusSeconds(10));
        when(corrections.findByReviewId(r.getId())).thenReturn(Optional.of(c));

        List<TriageFeedbackRequests.EventView> events = service.events(ORG, ACCOUNT, r.getId());
        assertThat(events).extracting(TriageFeedbackRequests.EventView::kind).containsExactly(
                TriageEventKind.AI_ATTENTION_SHOWN, TriageEventKind.AI_AGREE, TriageEventKind.MARKETPLACE_LOCATED,
                TriageEventKind.ACTION_STARTED);
        assertThat(events).allSatisfy(e -> assertThat(e.shownSource()).isEqualTo("AI"));

        // The same answer on a RULES-shown row is evidence about the rule, and reads as such: shown
        // 확인 필요, seller says 필요 없음 → RULE_DISAGREE.
        c.setShownSource(TriageShownSource.RULES);
        c.setCorrectedTier(ReviewTriageTier.WATCH);
        assertThat(service.events(ORG, ACCOUNT, r.getId())).extracting(TriageFeedbackRequests.EventView::kind)
                .contains(TriageEventKind.RULE_DISAGREE).doesNotContain(TriageEventKind.AI_DISAGREE);
        // Shown FYI by the rule, seller says 확인 필요 → also a disagreement with the rule, not an "agree"
        // because the word 확인 필요 was pressed.
        c.setShownTier(ReviewTriageTier.FYI);
        c.setCorrectedTier(ReviewTriageTier.NEEDS_ATTENTION);
        assertThat(service.events(ORG, ACCOUNT, r.getId())).extracting(TriageFeedbackRequests.EventView::kind)
                .contains(TriageEventKind.RULE_DISAGREE);
        c.setCorrectedTier(ReviewTriageTier.FYI);
        assertThat(service.events(ORG, ACCOUNT, r.getId())).extracting(TriageFeedbackRequests.EventView::kind)
                .contains(TriageEventKind.RULE_AGREE);
    }
}
