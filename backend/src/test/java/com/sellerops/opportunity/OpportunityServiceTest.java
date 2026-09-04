package com.sellerops.opportunity;

import static com.sellerops.opportunity.OpportunityFixtures.PRODUCT;
import static com.sellerops.opportunity.OpportunityFixtures.issue;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.sellerops.common.ApiException;
import com.sellerops.opportunity.dto.OpportunityDraftRequest;
import com.sellerops.opportunity.dto.OpportunityView;
import com.sellerops.product.ProductSignalsService;
import com.sellerops.reviewissue.ReviewIssueQueryService;
import com.sellerops.reviewissue.dto.ReviewIssueView;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class OpportunityServiceTest {

    private static final UUID ORG = UUID.randomUUID();
    private static final LocalDate TODAY = LocalDate.of(2026, 9, 4);

    private final ReviewIssueQueryService issues = mock(ReviewIssueQueryService.class);
    private final ProductSignalsService signals = mock(ProductSignalsService.class);
    private final KnowledgeMentionCheck knowledge = mock(KnowledgeMentionCheck.class);
    private final ImprovementOpportunityRepository decisions = mock(ImprovementOpportunityRepository.class);
    private final OpportunityService service = new OpportunityService(issues, signals, knowledge, decisions);

    private final ReviewIssueView adhesion = issue("접착", "탈락", 5, PRODUCT);

    @BeforeEach
    void wire() {
        when(issues.list(ORG, TODAY)).thenReturn(List.of(adhesion, issue("포장", "파손", 2, PRODUCT)));
        when(issues.issueView(ORG, adhesion.id(), TODAY)).thenReturn(adhesion);
        when(knowledge.product(ORG, PRODUCT, "접착")).thenReturn(KnowledgeMention.none(2));
        when(decisions.findByOrgIdAndIssueIdIn(eq(ORG), anyCollection())).thenReturn(List.of());
        when(decisions.findByOrgIdAndIssueIdAndKind(any(), any(), any())).thenReturn(Optional.empty());
        when(decisions.save(any())).thenAnswer(inv -> inv.getArgument(0));
    }

    @Test
    @DisplayName("the org list derives from the issue list, drops issues under the repeat gate, and is OPEN without a row")
    void listDerives() {
        List<OpportunityView> out = service.list(ORG, TODAY, null, null, false);
        assertThat(out).extracting(OpportunityView::kind)
                .containsExactly("FAQ_SUPPLEMENT", "PRODUCT_IMPROVEMENT_REVIEW");
        assertThat(out).allSatisfy(v -> {
            assertThat(v.status()).isEqualTo("OPEN");
            assertThat(v.issueId()).isEqualTo(adhesion.id());
            assertThat(v.evidenceCount()).isEqualTo(5);
            assertThat(v.evidenceTo()).isEqualTo("/memory/" + adhesion.id());
            assertThat(v.draft()).isNull();
        });
        OpportunityView faq = out.get(0);
        assertThat(faq.knowledge().sources()).isEqualTo(2);
        assertThat(faq.knowledge().type()).isEqualTo("USAGE");
        assertThat(faq.knowledge().topicLabelKo()).isEqualTo("접착");
        assertThat(faq.knowledge().mentions()).isZero();
        assertThat(faq.whyKo()).anySatisfy(line -> assertThat(line).contains("'접착'을(를) 다룬 내용은 없습니다"));
        assertThat(faq.nextActionKo()).isEqualTo("FAQ 초안 준비");
        assertThat(out.get(1).knowledge()).isNull();
    }

    @Test
    @DisplayName("a product list starts from the product's own issue list, not the org's")
    void productListUsesProductIssues() {
        when(signals.issuesFor(ORG, PRODUCT, TODAY)).thenReturn(List.of(adhesion));
        service.list(ORG, TODAY, PRODUCT, null, false);
        verify(signals).issuesFor(ORG, PRODUCT, TODAY);
        verify(issues, never()).list(any(), any());
    }

    @Test
    @DisplayName("accept prepares a draft from facts and remembers it; accepting again keeps the seller's edits")
    void acceptPreparesDraftOnce() {
        OpportunityView accepted = service.accept(ORG, adhesion.id(), OpportunityKind.FAQ_SUPPLEMENT, TODAY);
        assertThat(accepted.status()).isEqualTo("ACCEPTED");
        assertThat(accepted.draft().title()).startsWith("Q. 접착");
        assertThat(accepted.draft().body()).contains("근거 리뷰 5건").contains("판매자님이 채워 주세요");

        ArgumentCaptor<ImprovementOpportunity> saved = ArgumentCaptor.forClass(ImprovementOpportunity.class);
        verify(decisions).save(saved.capture());
        ImprovementOpportunity row = saved.getValue();
        row.setDraftBody("판매자가 고친 본문");
        when(decisions.findByOrgIdAndIssueIdAndKind(ORG, adhesion.id(), OpportunityKind.FAQ_SUPPLEMENT))
                .thenReturn(Optional.of(row));

        OpportunityView again = service.accept(ORG, adhesion.id(), OpportunityKind.FAQ_SUPPLEMENT, TODAY);
        assertThat(again.draft().body()).isEqualTo("판매자가 고친 본문");
    }

    @Test
    @DisplayName("dismiss drops the draft and hides the row from the default list; restore forgets the decision")
    void dismissAndRestore() {
        ImprovementOpportunity row = new ImprovementOpportunity();
        row.setOrgId(ORG);
        row.setIssueId(adhesion.id());
        row.setKind(OpportunityKind.FAQ_SUPPLEMENT);
        row.setStatus(OpportunityStatus.ACCEPTED);
        row.setDraftTitle("t");
        row.setDraftBody("b");
        row.setDecidedAt(Instant.now());
        when(decisions.findByOrgIdAndIssueIdAndKind(ORG, adhesion.id(), OpportunityKind.FAQ_SUPPLEMENT))
                .thenReturn(Optional.of(row));

        OpportunityView dismissed = service.dismiss(ORG, adhesion.id(), OpportunityKind.FAQ_SUPPLEMENT, TODAY);
        assertThat(dismissed.status()).isEqualTo("DISMISSED");
        assertThat(dismissed.draft()).isNull();
        assertThat(row.getDraftBody()).isNull();

        when(decisions.findByOrgIdAndIssueIdIn(eq(ORG), anyCollection())).thenReturn(List.of(row));
        assertThat(service.list(ORG, TODAY, null, null, false)).extracting(OpportunityView::kind)
                .containsExactly("PRODUCT_IMPROVEMENT_REVIEW");
        assertThat(service.list(ORG, TODAY, null, null, true)).extracting(OpportunityView::status)
                .containsExactly("DISMISSED", "OPEN");

        OpportunityView restored = service.restore(ORG, adhesion.id(), OpportunityKind.FAQ_SUPPLEMENT, TODAY);
        assertThat(restored.status()).isEqualTo("OPEN");
        verify(decisions).delete(row);
    }

    @Test
    @DisplayName("a decision about a kind the evidence does not yield right now is refused, not recorded")
    void undeliverableKindIsRefused() {
        // 접착 × 탈락 with nothing written yields FAQ, not 상세 보완 — so 상세 보완 cannot be accepted.
        assertThatThrownBy(() -> service.accept(ORG, adhesion.id(), OpportunityKind.PRODUCT_GUIDE_SUPPLEMENT, TODAY))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("지금 제안되지 않습니다");
        verify(decisions, never()).save(any());
    }

    @Test
    @DisplayName("editing a draft needs an accepted row and a non-empty, bounded text")
    void draftEdits() {
        assertThatThrownBy(() -> service.updateDraft(ORG, adhesion.id(), OpportunityKind.FAQ_SUPPLEMENT, TODAY,
                new OpportunityDraftRequest("t", "b")))
                .isInstanceOf(ApiException.class).hasMessageContaining("초안이 준비된 기회");

        ImprovementOpportunity row = new ImprovementOpportunity();
        row.setStatus(OpportunityStatus.ACCEPTED);
        row.setDraftTitle("t");
        row.setDraftBody("b");
        row.setDecidedAt(Instant.now());
        when(decisions.findByOrgIdAndIssueIdAndKind(ORG, adhesion.id(), OpportunityKind.FAQ_SUPPLEMENT))
                .thenReturn(Optional.of(row));
        assertThatThrownBy(() -> service.updateDraft(ORG, adhesion.id(), OpportunityKind.FAQ_SUPPLEMENT, TODAY,
                new OpportunityDraftRequest("t", "   ")))
                .isInstanceOf(ApiException.class).hasMessageContaining("모두 적어");
        assertThatThrownBy(() -> service.updateDraft(ORG, adhesion.id(), OpportunityKind.FAQ_SUPPLEMENT, TODAY,
                new OpportunityDraftRequest("t", "x".repeat(OpportunityService.BODY_MAX + 1))))
                .isInstanceOf(ApiException.class).hasMessageContaining("너무 깁니다");
        OpportunityView edited = service.updateDraft(ORG, adhesion.id(), OpportunityKind.FAQ_SUPPLEMENT, TODAY,
                new OpportunityDraftRequest(" 새 제목 ", " 새 본문 "));
        assertThat(edited.draft().title()).isEqualTo("새 제목");
        assertThat(edited.draft().body()).isEqualTo("새 본문");
    }

    @Test
    @DisplayName("the seller's own sentences travel into a 상세 보완 draft; a memo carries only counts")
    void draftsAreSellerWordsOrFacts() {
        when(knowledge.product(ORG, PRODUCT, "접착"))
                .thenReturn(new KnowledgeMention(3, 1, List.of("먼지를 닦고 붙이세요.")));
        OpportunityView guide = service.accept(ORG, adhesion.id(), OpportunityKind.PRODUCT_GUIDE_SUPPLEMENT, TODAY);
        assertThat(guide.draft().body()).contains("- 먼지를 닦고 붙이세요.");
        assertThat(guide.recommendationKo()).contains("상품 지식에는 있습니다");

        OpportunityView memo = service.accept(ORG, adhesion.id(), OpportunityKind.PRODUCT_IMPROVEMENT_REVIEW, TODAY);
        assertThat(memo.draft().body()).contains("근거 리뷰: 5건").contains("원인을 판단하지 않습니다");
    }
}
