package com.sellerops.review.draft;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.sellerops.agent.llm.AgentDraftService;
import com.sellerops.agent.quota.AgentQuotaService;
import com.sellerops.agent.quota.AgentUsageKind;
import com.sellerops.agent.quota.QuotaDecision;
import com.sellerops.attention.reply.ReviewReplyDraftService;
import com.sellerops.attention.reply.ReviewReplyTemplateKey;
import com.sellerops.attention.reply.ReviewReplyTemplateService;
import com.sellerops.attention.reply.dto.ReviewReplyDraftView;
import com.sellerops.inquiry.draft.DraftEvidenceSnippets;
import com.sellerops.inquiry.draft.DraftKnowledgeState;
import com.sellerops.inquiry.draft.InquiryEvidenceRetriever;
import com.sellerops.inquiry.draft.InquiryEvidenceRetriever.InquiryEvidence;
import com.sellerops.inquiry.draft.InquiryEvidenceRetriever.ScopedPassage;
import com.sellerops.knowledge.KnowledgeScope;
import com.sellerops.review.Review;
import com.sellerops.review.draft.dto.GeneratedReviewDraftView;
import com.sellerops.reviewissue.ReviewIssueEvidenceRepository;
import com.sellerops.reviewissue.ReviewIssueRepository;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Grounded Review Drafting v1 — the four decisions this composer makes, and the one it refuses to.
 *
 * <p>The model, the retrieval and the storage are all faked; what is under test is the rule that a
 * public reply states only what the seller can prove, and that the floor when it cannot is the
 * seller's own template rather than a fluent paragraph.
 */
class ReviewDraftComposerTest {

    private static final UUID ORG = UUID.fromString("7f3a1c9e-0000-4000-8000-000000000001");
    private static final UUID REVIEW = UUID.fromString("d1e2f3a4-0000-4000-8000-000000000006");
    private static final UUID PRODUCT = UUID.fromString("0811fead-0000-4000-8000-000000000007");
    private static final String BODY = "괜찮긴한데 잘떨어지네요 실리콘으로 붙였네요";
    private static final String TEMPLATE = "저희 제품을 이용해 주셔서 감사합니다. 남겨주신 후기 잘 읽었습니다.";

    private InquiryEvidenceRetriever retriever;
    private ReviewReplyDraftService drafts;
    private ReviewDraftEvidenceRepository evidence;
    private ReviewReplyTemplateService templates;
    private AgentDraftService model;
    private AgentQuotaService quota;
    private ReviewDraftComposer composer;

    @BeforeEach
    void setUp() {
        retriever = mock(InquiryEvidenceRetriever.class);
        drafts = mock(ReviewReplyDraftService.class);
        evidence = mock(ReviewDraftEvidenceRepository.class);
        templates = mock(ReviewReplyTemplateService.class);
        model = mock(AgentDraftService.class);
        quota = mock(AgentQuotaService.class);
        ReviewIssueEvidenceRepository issueEvidence = mock(ReviewIssueEvidenceRepository.class);
        ReviewIssueRepository issues = mock(ReviewIssueRepository.class);

        when(retriever.namedProduct(ORG, PRODUCT)).thenReturn(PRODUCT);
        when(templates.resolve(eq(ORG), any(ReviewReplyTemplateKey.class)))
                .thenReturn(new ReviewReplyTemplateService.Resolved(TEMPLATE, false));
        when(drafts.currentVersion(REVIEW)).thenReturn(0);
        when(drafts.saveAs(eq(ORG), eq(REVIEW), anyString(), anyString(), anyInt(), any()))
                .thenAnswer(call -> new ReviewReplyDraftView(1, call.getArgument(3), "f".repeat(64),
                        "review-reply-v1", Instant.parse("2026-09-03T00:00:00Z")));
        when(model.isEnabledFor(ORG)).thenReturn(true);
        when(model.versionFor(ORG)).thenReturn("test-model");
        when(quota.consume(eq(ORG), eq(AgentUsageKind.DRAFT), any())).thenReturn(new QuotaDecision(true, null, 1, 200));
        when(issueEvidence.findByOrgIdAndReviewId(ORG, REVIEW)).thenReturn(List.of());

        composer = new ReviewDraftComposer(retriever, drafts, evidence, templates, model, quota,
                mock(DraftEvidenceSnippets.class), issueEvidence, issues,
                mock(com.sellerops.knowledge.candidate.KnowledgeCandidateService.class));
    }

    private static Review review() {
        Review review = new Review();
        review.setId(REVIEW);
        review.setOrgId(ORG);
        review.setProductId(PRODUCT);
        review.setRating(4);
        review.setBody(BODY);
        return review;
    }

    private void retrieval(DraftKnowledgeState state, ScopedPassage... passages) {
        // The derived constructor maps NO_LIBRARY to productOutcome ABSENT — an empty library, which is
        // what 「이 상품에 아직 지식이 없습니다」 means and what §E treats as always worth saying once.
        when(retriever.retrieveFor(eq(ORG), eq(PRODUCT), any(), any()))
                .thenReturn(new InquiryEvidence(PRODUCT, state, List.of(passages), null, 0));
    }

    private static ScopedPassage productPassage(String text) {
        return new ScopedPassage(KnowledgeScope.PRODUCT, "부착 방법", text,
                UUID.fromString("a1b2c3d4-0000-4000-8000-000000000004"),
                UUID.fromString("e5f6a7b8-0000-4000-8000-000000000005"),
                "product-knowledge/USAGE:판매자", 0.9);
    }

    private static ScopedPassage policyPassage(String text) {
        return new ScopedPassage(KnowledgeScope.ORG_OPERATIONS, "배송 안내", text,
                UUID.fromString("a1b2c3d4-0000-4000-8000-000000000006"),
                UUID.fromString("e5f6a7b8-0000-4000-8000-000000000007"),
                "org-knowledge/SHIPPING_POLICY:판매자", 0.9);
    }

    /**
     * <b>The sentence a reopen shows is the sentence the generation showed</b> — Retrieval Runtime
     * Closure v1 §1.
     *
     * <p>The stored version has carried {@code answer_basis} since Grounded Review Drafting v1 and
     * nothing read it back, so 「근거 있음 / 기본 문구」 existed only in the browser session that
     * pressed the button. It is chosen HERE, by one rule, so the two renderings of one fact cannot
     * drift: a reopen that recomputed it would have to re-run the retrieval, and two of that
     * retrieval's three stages are model calls made afresh on every search.
     */
    @Test
    @DisplayName("the basis sentence is one rule, so a reopen says what the generation said")
    void theBasisSentenceIsReadBackNotRecomputed() {
        // Exactly what the generation reports, for a grounded draft with citations.
        retrieval(DraftKnowledgeState.GROUNDED, productPassage("실리콘 표면에는 부착되지 않습니다."));
        when(model.draftReviewReply(eq(ORG), eq(BODY), any(), eq(TEMPLATE)))
                .thenReturn(java.util.Optional.of("실리콘 표면에는 부착되지 않습니다. 확인 부탁드립니다."));
        GeneratedReviewDraftView view = composer.compose(ORG, review(), BODY, "SELLER:u1");
        assertThat(view.answerBasis()).isEqualTo("GROUNDED");
        assertThat(view.answerBasisNote())
                .isEqualTo(ReviewDraftComposer.basisNoteOf("GROUNDED", true))
                .isEqualTo(ReviewDraftComposer.BASIS_GROUNDED_NOTE);

        // The same rule, applied to what a read path holds: the row's basis and whether the version
        // recorded any citations.
        assertThat(ReviewDraftComposer.basisNoteOf("NO_ANSWER_BASIS", false))
                .isEqualTo(ReviewDraftComposer.BASIS_NONE_NOTE);
        // GROUNDED with no citation rows is the template floor: a model refused after the retrieval
        // succeeded, and the sentence has to say what the seller is looking at.
        assertThat(ReviewDraftComposer.basisNoteOf("GROUNDED", false))
                .isEqualTo(ReviewDraftComposer.BASIS_NONE_NOTE);
        // Not recorded is a third statement, and the screen makes none.
        assertThat(ReviewDraftComposer.basisNoteOf(null, true)).isNull();
    }

    @Test
    @DisplayName("a draft grounded in the company's policy does not then ask for a product standard")
    void groundedIsGroundedWhicheverLaneAnsweredIt() {
        // Observed live 2026-09-03: 「배송이 너무 느려서 실망했습니다」 was answered from the shipping
        // policy and the same screen asked whether a PRODUCT standard for it existed — a grounded
        // draft asking for facts it had just used, about the wrong corpus.
        retrieval(DraftKnowledgeState.GROUNDED, policyPassage("평일 오후 2시 이전 결제 건은 당일 출고됩니다."));

        GeneratedReviewDraftView view = composer.compose(ORG, review(), BODY, "SELLER:u1");

        assertThat(view.knowledgeGaps())
                .as("nothing about the product is missing that this reply needed")
                .noneMatch(g -> "PRODUCT".equals(g.scope()));
    }

    @Test
    @DisplayName("no evidence: NO MODEL IS CALLED, the org's own template is the draft, and the gap names the customer's words")
    void withoutEvidenceNothingIsInvented() {
        retrieval(DraftKnowledgeState.NO_LIBRARY);

        GeneratedReviewDraftView view = composer.compose(ORG, review(), BODY, "SELLER:u1");

        // The strongest possible guarantee that nothing was invented: the machine that could invent
        // was never started.
        verify(model, never()).draftReviewReply(any(), any(), any(), any());
        verify(quota, never()).consume(any(), any(), any());
        assertThat(view.draft().body()).isEqualTo(TEMPLATE);
        assertThat(view.authorKind()).isEqualTo("RULE");
        assertThat(view.answerBasis()).isEqualTo("NO_ANSWER_BASIS");
        assertThat(view.evidence()).isEmpty();
        assertThat(view.templateSource()).isEqualTo("DEFAULT");

        assertThat(view.knowledgeGaps()).hasSize(1);
        assertThat(view.knowledgeGaps().get(0).scope()).isEqualTo("PRODUCT");
        assertThat(view.knowledgeGaps().get(0).subjectKind()).isEqualTo("REVIEW_TEXT");
        // Specific without classifying: the seller reads their own customer's sentence.
        assertThat(view.knowledgeGaps().get(0).question()).contains("괜찮긴한데 잘떨어지네요");
        assertThat(view.knowledgeGaps().get(0).productId()).isEqualTo(PRODUCT.toString());
    }

    @Test
    @DisplayName("with evidence: the model writes inside it, the version is stamped MODEL, and the citations are stored")
    void withEvidenceTheModelWritesInsideIt() {
        retrieval(DraftKnowledgeState.GROUNDED,
                productPassage("표면의 먼지와 기름기를 닦아낸 뒤 눌러 붙여 주세요."));
        when(model.draftReviewReply(eq(ORG), eq(BODY), any(), eq(TEMPLATE)))
                .thenReturn(Optional.of("후기 감사합니다. 부착 전 표면의 먼지를 닦아 주시면 더 잘 붙습니다."));

        GeneratedReviewDraftView view = composer.compose(ORG, review(), BODY, "SELLER:u1");

        assertThat(view.authorKind()).isEqualTo("MODEL");
        assertThat(view.answerBasis()).isEqualTo("GROUNDED");
        assertThat(view.draft().body()).contains("표면의 먼지");
        assertThat(view.evidence()).hasSize(1);
        assertThat(view.evidence().get(0).kind()).isEqualTo("PRODUCT_KNOWLEDGE");
        assertThat(view.evidence().get(0).scopeLabel()).isEqualTo("상품 정보");
        assertThat(view.evidence().get(0).snippet()).contains("먼지와 기름기");
        verify(evidence).save(any(ReviewDraftEvidence.class));
        // The product lane answered, so there is nothing to ask for.
        assertThat(view.knowledgeGaps()).isEmpty();
    }

    @Test
    @DisplayName("an unsupported promise is REFUSED, not edited — the template floor is saved instead")
    void anUnsupportedPromiseFallsBackToTheTemplate() {
        retrieval(DraftKnowledgeState.GROUNDED,
                productPassage("표면의 먼지와 기름기를 닦아낸 뒤 눌러 붙여 주세요."));
        when(model.draftReviewReply(eq(ORG), eq(BODY), any(), eq(TEMPLATE)))
                .thenReturn(Optional.of("불편을 드려 죄송합니다. 교환 도와드리겠습니다."));

        GeneratedReviewDraftView view = composer.compose(ORG, review(), BODY, "SELLER:u1");

        assertThat(view.draft().body()).isEqualTo(TEMPLATE);
        assertThat(view.authorKind()).isEqualTo("RULE");
        assertThat(view.unavailableMessage()).isEqualTo(ReviewDraftComposer.UNSUPPORTED_CLAIM);
        // Nothing was cited, because nothing the model wrote survived.
        assertThat(view.evidence()).isEmpty();
        verify(evidence, never()).save(any(ReviewDraftEvidence.class));
        // The basis is still GROUNDED: the evidence existed. What failed was the machinery, and the
        // two are different questions — the same separation the inquiry lane makes.
        assertThat(view.answerBasis()).isEqualTo("GROUNDED");
    }

    @Test
    @DisplayName("a spent budget is an operational fact, never a statement about the seller's knowledge")
    void anExhaustedBudgetFallsBackWithoutBlamingTheLibrary() {
        retrieval(DraftKnowledgeState.GROUNDED, productPassage("표면을 닦아낸 뒤 붙여 주세요."));
        when(quota.consume(eq(ORG), eq(AgentUsageKind.DRAFT), any()))
                .thenReturn(new QuotaDecision(false, QuotaDecision.Reason.DAILY_LLM_CALLS, 200, 200));

        GeneratedReviewDraftView view = composer.compose(ORG, review(), BODY, "SELLER:u1");

        assertThat(view.draft().body()).isEqualTo(TEMPLATE);
        assertThat(view.unavailableMessage()).isNotNull();
        assertThat(view.unavailableMessage()).doesNotContain("답변 기준");
        verify(model, never()).draftReviewReply(any(), any(), any(), any());
    }

    @Test
    @DisplayName("the org's own wording is reported as the org's, and is what a floor draft says")
    void theOrgTemplateIsReportedAsSuch() {
        retrieval(DraftKnowledgeState.NO_MATCH);
        when(templates.resolve(eq(ORG), any(ReviewReplyTemplateKey.class)))
                .thenReturn(new ReviewReplyTemplateService.Resolved("선바로입니다. 후기 감사합니다.", true));

        GeneratedReviewDraftView view = composer.compose(ORG, review(), BODY, "SELLER:u1");

        assertThat(view.draft().body()).isEqualTo("선바로입니다. 후기 감사합니다.");
        assertThat(view.templateSource()).isEqualTo("ORG");
        assertThat(view.templateCategory()).isEqualTo("positive_reply");
    }
}
