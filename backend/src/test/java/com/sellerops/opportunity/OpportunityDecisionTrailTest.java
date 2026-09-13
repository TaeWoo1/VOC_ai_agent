package com.sellerops.opportunity;

import static com.sellerops.opportunity.OpportunityFixtures.PRODUCT;
import static com.sellerops.opportunity.OpportunityFixtures.issue;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.sellerops.common.ApiException;
import com.sellerops.opportunity.dto.OpportunityDraftRequest;
import com.sellerops.opportunity.dto.OpportunityEventView;
import com.sellerops.opportunity.dto.OpportunityView;
import com.sellerops.product.ProductSignalsService;
import com.sellerops.reviewissue.ReviewIssueQueryService;
import com.sellerops.reviewissue.dto.ReviewIssueView;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * <b>What the seller decided about a repeated problem, and that it survives deciding again.</b>
 *
 * <p>The service's other test asks what one call returns. This one asks what is left behind after a
 * sequence, because the defect V103 closed was only visible as a sequence: 채택 → 수정 → 보류 → 되돌림
 * used to leave the database exactly as it started, with the seller's own sentences gone.
 *
 * <p>The two repositories are stateful fakes rather than answer-once mocks — an append-only trail
 * cannot be asserted against a mock that forgets what was appended.
 */
class OpportunityDecisionTrailTest {

    private static final UUID ORG = UUID.randomUUID();
    private static final UUID ACTOR = UUID.randomUUID();
    private static final java.time.LocalDate TODAY = java.time.LocalDate.of(2026, 9, 13);
    private static final OpportunityKind FAQ = OpportunityKind.FAQ_SUPPLEMENT;

    private final ReviewIssueQueryService issues = mock(ReviewIssueQueryService.class);
    private final ProductSignalsService signals = mock(ProductSignalsService.class);
    private final KnowledgeMentionCheck knowledge = mock(KnowledgeMentionCheck.class);
    private final ImprovementOpportunityRepository decisions = mock(ImprovementOpportunityRepository.class);
    private final OpportunityDecisionEventRepository trail = mock(OpportunityDecisionEventRepository.class);
    private final OpportunityService service =
            new OpportunityService(issues, signals, knowledge, decisions, trail);

    /** The saved decision rows, by id — the fake table. */
    private final Map<UUID, ImprovementOpportunity> rows = new LinkedHashMap<>();
    /** Everything ever appended, in order. Nothing is ever removed from it. */
    private final List<OpportunityDecisionEvent> events = new ArrayList<>();

    private final ReviewIssueView adhesion = issue("접착", "탈락", 5, PRODUCT);

    @BeforeEach
    void wire() {
        when(issues.issueView(ORG, adhesion.id(), TODAY)).thenReturn(adhesion);
        when(issues.list(ORG, TODAY)).thenReturn(List.of(adhesion));
        when(knowledge.product(ORG, PRODUCT, "접착")).thenReturn(KnowledgeMention.none(2));

        when(decisions.save(any())).thenAnswer(inv -> {
            ImprovementOpportunity row = inv.getArgument(0);
            if (row.getId() == null) {
                row.setId(UUID.randomUUID());
            }
            rows.put(row.getId(), row);
            return row;
        });
        when(decisions.findWithLockByOrgIdAndIssueIdAndKind(any(), any(), any())).thenAnswer(inv ->
                rows.values().stream()
                        .filter(r -> r.getOrgId().equals(inv.getArgument(0))
                                && r.getIssueId().equals(inv.getArgument(1))
                                && r.getKind() == inv.getArgument(2))
                        .findFirst());
        when(decisions.findByOrgIdAndIssueIdIn(eq(ORG), anyCollection())).thenAnswer(inv ->
                rows.values().stream().filter(r -> r.getOrgId().equals(ORG)).toList());
        when(decisions.findByOrgIdAndStatus(eq(ORG), any())).thenAnswer(inv ->
                rows.values().stream()
                        .filter(r -> r.getOrgId().equals(ORG) && r.getStatus() == inv.getArgument(1))
                        .toList());

        when(trail.save(any())).thenAnswer(inv -> {
            OpportunityDecisionEvent e = inv.getArgument(0);
            e.setId(UUID.randomUUID());
            events.add(e);
            return e;
        });
        when(trail.findByOrgIdAndOpportunityIdInOrderByDecidedAtAsc(eq(ORG), anyCollection()))
                .thenAnswer(inv -> {
                    java.util.Collection<?> ids = inv.getArgument(1);
                    return events.stream().filter(e -> ids.contains(e.getOpportunityId())).toList();
                });
    }

    @Test
    @DisplayName("채택 → 수정 → 보류 → 되돌림 leaves four events, the seller's text, and a row that is open again")
    void theWholeSequenceIsAnswerable() {
        service.accept(ORG, ACTOR, adhesion.id(), FAQ, TODAY);
        service.updateDraft(ORG, ACTOR, adhesion.id(), FAQ, TODAY,
                new OpportunityDraftRequest("Q. 접착이 잘 떨어지나요", "판매자가 직접 쓴 답변"));
        service.dismiss(ORG, ACTOR, adhesion.id(), FAQ, TODAY);
        OpportunityView reopened = service.restore(ORG, ACTOR, adhesion.id(), FAQ, TODAY);

        assertThat(reopened.status()).isEqualTo("OPEN");
        assertThat(reopened.decidedAt()).isNull();
        assertThat(reopened.history()).extracting(OpportunityEventView::event)
                .containsExactly("ACCEPTED", "EDITED", "DISMISSED", "REOPENED");
        assertThat(reopened.history()).extracting(OpportunityEventView::statusFrom)
                // null on the first event — there was no standing decision to leave.
                .containsExactly(null, "ACCEPTED", "ACCEPTED", "DISMISSED");
        assertThat(reopened.history()).extracting(OpportunityEventView::statusTo)
                .containsExactly("ACCEPTED", "ACCEPTED", "DISMISSED", "OPEN");
        // What the suggestion rested on, frozen on every event.
        assertThat(reopened.history()).allSatisfy(e -> assertThat(e.evidenceCount()).isEqualTo(5));

        // The row is still there, and so is what the seller wrote.
        ImprovementOpportunity row = rows.values().iterator().next();
        assertThat(row.getStatus()).isEqualTo(OpportunityStatus.OPEN);
        assertThat(row.getDraftBody()).isEqualTo("판매자가 직접 쓴 답변");
        assertThat(events).hasSize(4);
    }

    @Test
    @DisplayName("accepting again after a dismissal returns the seller's own text, not a fresh scaffold")
    void reAcceptKeepsTheSellersWords() {
        service.accept(ORG, ACTOR, adhesion.id(), FAQ, TODAY);
        service.updateDraft(ORG, ACTOR, adhesion.id(), FAQ, TODAY,
                new OpportunityDraftRequest("내 제목", "내 본문"));
        service.dismiss(ORG, ACTOR, adhesion.id(), FAQ, TODAY);

        OpportunityView again = service.accept(ORG, ACTOR, adhesion.id(), FAQ, TODAY);
        assertThat(again.draft().title()).isEqualTo("내 제목");
        assertThat(again.draft().body()).isEqualTo("내 본문");
        assertThat(again.history()).extracting(OpportunityEventView::event)
                .containsExactly("ACCEPTED", "EDITED", "DISMISSED", "ACCEPTED");
    }

    @Test
    @DisplayName("pressing a button that changes nothing appends nothing")
    void idempotentPressesAreNotDecisions() {
        service.accept(ORG, ACTOR, adhesion.id(), FAQ, TODAY);
        service.accept(ORG, ACTOR, adhesion.id(), FAQ, TODAY);
        OpportunityView saved = service.updateDraft(ORG, ACTOR, adhesion.id(), FAQ, TODAY,
                new OpportunityDraftRequest(
                        rows.values().iterator().next().getDraftTitle(),
                        rows.values().iterator().next().getDraftBody()));
        assertThat(saved.history()).extracting(OpportunityEventView::event).containsExactly("ACCEPTED");

        // And taking back a decision nobody made writes nothing at all.
        service.restore(ORG, ACTOR, adhesion.id(), FAQ, TODAY);
        service.restore(ORG, ACTOR, adhesion.id(), FAQ, TODAY);
        assertThat(events).extracting(OpportunityDecisionEvent::getEvent)
                .containsExactly(OpportunityEvent.ACCEPTED, OpportunityEvent.REOPENED);
    }

    @Test
    @DisplayName("prepared drafts are the accepted rows re-derived — and an issue that stopped qualifying drops out")
    void preparedDraftsAreReDerived() {
        service.accept(ORG, ACTOR, adhesion.id(), FAQ, TODAY);
        assertThat(service.preparedDrafts(ORG, TODAY))
                .extracting(d -> d.opportunity().kind()).containsExactly("FAQ_SUPPLEMENT");

        // The seller resolved the problem. The decision row is untouched; the opportunity is simply
        // never derived again, so nothing may count it as prepared work.
        ReviewIssueView resolved = OpportunityFixtures.issue(adhesion.id(), "접착", "탈락", 5, PRODUCT,
                "RESOLVED", false);
        when(issues.issueView(ORG, adhesion.id(), TODAY)).thenReturn(resolved);
        assertThat(service.preparedDrafts(ORG, TODAY)).isEmpty();
        assertThat(rows.values().iterator().next().getStatus()).isEqualTo(OpportunityStatus.ACCEPTED);

        // An issue the memory no longer holds at all is the same answer, not an exception.
        when(issues.issueView(ORG, adhesion.id(), TODAY))
                .thenThrow(ApiException.notFound("이슈를 찾을 수 없습니다."));
        assertThat(service.preparedDrafts(ORG, TODAY)).isEmpty();
    }

    @Test
    @DisplayName("an org that has decided nothing pays no derivation for prepared work")
    void nothingAcceptedCostsNothing() {
        assertThat(service.preparedDrafts(ORG, TODAY)).isEmpty();
        org.mockito.Mockito.verify(issues, org.mockito.Mockito.never()).issueView(any(), any(), any());
    }
}
