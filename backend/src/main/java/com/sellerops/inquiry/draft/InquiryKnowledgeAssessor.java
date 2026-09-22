package com.sellerops.inquiry.draft;

import com.sellerops.common.MarkupText;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.draft.dto.KnowledgeGapView;
import com.sellerops.knowledge.KnowledgeTopic;
import com.sellerops.knowledge.RetrievalQuery;
import com.sellerops.knowledge.spine.KnowledgeSpineService;
import com.sellerops.knowledge.spine.SpineRetrieval;
import com.sellerops.order.fact.OrderFactLookup;
import com.sellerops.product.ProductVariantRepository;
import com.sellerops.product.catalogue.CatalogueInvestigator;
import com.sellerops.product.library.KnowledgeVariantScope;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * <b>What the company knows about one inquiry, and whether that is enough to answer it — decided once, in one
 * place.</b>
 *
 * <p>The case investigator and the draft writer used to reach this judgement through two different reads: the
 * investigator searched company rules alone and found nothing, while the draft searched product knowledge, rules and
 * past answers and wrote a grounded reply from two seller passages (NAVER product inquiry slice, 2026-09-18,
 * INVESTIGATOR_RETRIEVAL_GAP). Both now call this: the 규격 verdict computed before retrieval, the Knowledge Spine's
 * one retrieval, the answer-basis state, and the knowledge gap. A disagreement between them can only be a difference
 * in the question, never in the code that answered it.
 *
 * <p>Reads only. It files no candidate, writes no draft and calls no model; the only marketplace reach is the order
 * fact, and only when the caller says {@link OrderFactLookup#EXACT_ALLOWED}.
 */
@Component
public class InquiryKnowledgeAssessor {

    private final InquiryEvidenceRetriever retriever;
    private final KnowledgeSpineService spine;
    private final ProductVariantRepository variants;
    private final com.sellerops.product.ProductRepository products;
    private CatalogueInvestigator catalogue;

    public InquiryKnowledgeAssessor(InquiryEvidenceRetriever retriever, KnowledgeSpineService spine,
                                    ProductVariantRepository variants,
                                    com.sellerops.product.ProductRepository products) {
        this.retriever = retriever;
        this.spine = spine;
        this.variants = variants;
        this.products = products;
    }

    /**
     * @param missingSubject what the seller has not written down, in the customer's own noun — the 규격 classifier's
     *                       word when it named one, otherwise the question's remaining topic word. Null when there is
     *                       no gap or the question named nothing to ask for.
     */
    public record Assessment(UUID productId, SpecApplicability.Verdict verdict, SpineRetrieval spine,
                             AnswerBasisState basis, KnowledgeTopic asked, Set<KnowledgeTopic> named,
                             KnowledgeGapView gap, String missingSubject, CatalogueInvestigator.Finding catalogue,
                             com.sellerops.inquiry.decision.NeedDecision decision) {

        /** Before Inquiry Decision v2: no need-level decision. */
        public Assessment(UUID productId, SpecApplicability.Verdict verdict, SpineRetrieval spine,
                          AnswerBasisState basis, KnowledgeTopic asked, Set<KnowledgeTopic> named,
                          KnowledgeGapView gap, String missingSubject, CatalogueInvestigator.Finding catalogue) {
            this(productId, verdict, spine, basis, asked, named, gap, missingSubject, catalogue, null);
        }

        public Assessment(UUID productId, SpecApplicability.Verdict verdict, SpineRetrieval spine,
                          AnswerBasisState basis, KnowledgeTopic asked, Set<KnowledgeTopic> named,
                          KnowledgeGapView gap, String missingSubject) {
            this(productId, verdict, spine, basis, asked, named, gap, missingSubject, null, null);
        }

        /** Whether the only current basis is another product in the seller's catalogue. */
        public boolean groundedByCatalogue() {
            return catalogue != null && catalogue.grounds()
                    && !AnswerBasisState.of(spine.lanes().state(), verdict.applicability()).mayGenerate();
        }

        public InquiryEvidenceRetriever.InquiryEvidence retrieved() {
            return spine.lanes();
        }
    }

    /**
     * Seller-wide catalogue discovery for catalogue questions. Optional: a context without it assesses exactly as
     * before, and a catalogue read that throws is a catalogue that said nothing.
     */
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    public void setCatalogue(CatalogueInvestigator catalogue) {
        this.catalogue = catalogue;
    }

    private com.sellerops.inquiry.decision.InquiryDecisionModel decisionModel;
    private com.sellerops.inquiry.decision.InquiryEvidenceCollector collector;

    /**
     * Inquiry Decision v2 (need-level coverage). Optional: a context without it — or an org the capability is off for —
     * assesses exactly as before.
     */
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    public void setDecision(com.sellerops.inquiry.decision.InquiryDecisionModel decisionModel,
                            com.sellerops.inquiry.decision.InquiryEvidenceCollector collector) {
        this.decisionModel = decisionModel;
        this.collector = collector;
    }

    private com.sellerops.inquiry.authority.CapabilityRegistry registry;
    private com.sellerops.inquiry.authority.AuthorityFenceProperties fence;

    private com.sellerops.inquiry.resolve.CustomerGoalInterpretation goals;

    /**
     * What this inquiry's customer asked for, when something has already read the message.
     *
     * <p>Read-only by contract ({@code stored} never reaches a vendor) and optional: without it, or before any
     * reading exists, the gap subject is taken from the question as it always was. It is here rather than at the
     * three call sites because the subject is decided here, and a rule about what may be quoted to the seller that
     * holds in one caller and not the others is the defect it fixes wearing a different shape.
     */
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    public void setGoals(com.sellerops.inquiry.resolve.CustomerGoalInterpretation goals) {
        this.goals = goals;
    }

    private com.sellerops.inquiry.goal.CustomerGoalSet goalsOf(java.util.UUID orgId, Inquiry inquiry) {
        if (goals == null) {
            return null;
        }
        try {
            return goals.stored(orgId, inquiry).orElse(null);
        } catch (RuntimeException unreadable) {
            return null;   // an unavailable reading is an absence; the question itself is still evidence
        }
    }

    /**
     * Inquiry v3 WP-1: the deterministic authority layer over the v2 verdicts. Optional and default OFF — without it, or
     * with the flag off, the decision is v2.2 exactly.
     */
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    public void setAuthority(com.sellerops.inquiry.authority.CapabilityRegistry registry,
                             com.sellerops.inquiry.authority.AuthorityFenceProperties fence) {
        this.registry = registry;
        this.fence = fence;
    }

    /**
     * The assessment without seller context — the lanes alone, attributed from the passages. For hand-wired callers
     * that have a retriever and no Spring context; production wiring always injects the full spine.
     */
    public static InquiryKnowledgeAssessor withoutContext(InquiryEvidenceRetriever retriever,
                                                          ProductVariantRepository variants) {
        return new InquiryKnowledgeAssessor(retriever,
                new KnowledgeSpineService(List.of(), null, null, retriever), variants, null);
    }

    public Assessment assess(UUID orgId, Inquiry inquiry, OrderFactLookup lookup) {
        String title = MarkupText.toPlainText(inquiry.getTitle());
        String details = MarkupText.toPlainText(inquiry.getBody());
        // The 규격 is resolved BEFORE the retrieval it scopes (2026-08-27): a document about 2호 is not weak evidence
        // about a customer who said 3호.
        UUID productId = retriever.resolveProductId(orgId, inquiry);
        SpecApplicability.Verdict verdict = SpecApplicability.classify(title, details, optionsFor(orgId, productId));
        SpineRetrieval found = spine.retrieveForInquiry(orgId, inquiry, RetrievalQuery.ofCustomer(title, details),
                lookup, KnowledgeVariantScope.of(verdict.variantId()));
        AnswerBasisState basis = AnswerBasisState.of(found.lanes().state(), verdict.applicability());
        Set<KnowledgeTopic> named = namedTopics(inquiry);
        KnowledgeTopic asked = named.size() == 1 ? named.iterator().next() : null;
        // Seller-wide catalogue discovery, for a question about what the seller sells (「9oz 디스펜서도 판매하시나요」).
        // It runs after the product's own knowledge and before anything is declared missing: a question whose answer
        // is on another listing of this seller is not a gap in this seller's knowledge. It never widens a basis that
        // the lanes already settled — it only turns NO_ANSWER_BASIS into GROUNDED, and only on a product the channel
        // says is on sale now, stating the asked value in the seller's own catalogue text.
        CatalogueInvestigator.Finding catalogueFinding = investigateCatalogue(orgId, productId, title, details,
                lookup == OrderFactLookup.EXACT_ALLOWED);
        if (basis == AnswerBasisState.NO_ANSWER_BASIS && catalogueFinding != null && catalogueFinding.grounds()) {
            basis = AnswerBasisState.GROUNDED;
        }
        String subject = basis != AnswerBasisState.NO_ANSWER_BASIS ? null
                : catalogueFinding != null ? catalogueFinding.question().subject()
                : GapSubject.of(verdict, title, details, productName(orgId, productId), asked,
                        goalsOf(orgId, inquiry));
        KnowledgeGapView gap = KnowledgeGapView.of(found.lanes(), verdict, asked, named).asking(subject);
        if (basis == AnswerBasisState.NO_ANSWER_BASIS && catalogueFinding != null) {
            gap = gap.catalogueChecked(catalogueFinding.checkedKo());
        }
        if (basis == AnswerBasisState.NO_ANSWER_BASIS) {
            gap = gap.withPrecedent(precedentOf(found.lanes()));
        }
        if (decisionModel == null || collector == null || !decisionModel.enabledFor(orgId)) {
            return new Assessment(productId, verdict, found, basis, asked, named, gap, subject, catalogueFinding);
        }
        return decide(orgId, inquiry, title, details, productId, verdict, found, asked, named, catalogueFinding, lookup);
    }

    /**
     * <b>Inquiry Decision v2</b>: the basis is derived from every need the customer's message carries, not from whether
     * a current passage exists. Relevant evidence for one need no longer completes a Case with three
     * (docs/inquiry_decision_v2.md). The legacy lanes still run and are still what the draft cites; what changes is who
     * decides whether there is a basis.
     */
    private Assessment decide(UUID orgId, Inquiry inquiry, String title, String details, UUID productId,
                              SpecApplicability.Verdict verdict, SpineRetrieval found, KnowledgeTopic asked,
                              Set<KnowledgeTopic> named, CatalogueInvestigator.Finding catalogueFinding,
                              OrderFactLookup lookup) {
        String question = ((title == null ? "" : title) + "\n" + (details == null ? "" : details)).strip();
        com.sellerops.inquiry.decision.DetailCapability detail = collector.detail(orgId, productId);
        com.sellerops.product.library.KnowledgeVariantScope scope =
                com.sellerops.product.library.KnowledgeVariantScope.of(verdict.variantId());
        String orderKey = com.sellerops.inquiry.decision.EvidenceScope.orderKey(
                com.sellerops.inquiry.decision.PrecedentReuse.OrderKey.of(inquiry));
        com.sellerops.inquiry.authority.AuthorityFence.Context authority = registry == null || fence == null
                || !fence.enabled() ? null
                : new com.sellerops.inquiry.authority.AuthorityFence.Context(
                        registry.snapshot(orgId, inquiry, productId, detail, lookup),
                        found.lanes() == null ? null : found.lanes().order(), orderKey);
        com.sellerops.inquiry.decision.NeedDecision decision = com.sellerops.inquiry.decision.InquiryDecisionEngine
                .decide(orgId, question, decisionModel,
                        needs -> collector.collect(orgId, inquiry, productId, found.lanes(), catalogueFinding, scope,
                                needs), detail, new com.sellerops.inquiry.decision.EvidenceScope.CaseScope(productId,
                        orderKey), authority);
        AnswerBasisState basis = decision.basis();
        List<com.sellerops.inquiry.decision.NeedResult> open = decision.unresolved();
        String subject = basis != AnswerBasisState.NO_ANSWER_BASIS ? null
                : !open.isEmpty() ? open.get(0).need().ask()
                : GapSubject.of(verdict, title, details, productName(orgId, productId), asked,
                        goalsOf(orgId, inquiry));
        KnowledgeGapView gap = KnowledgeGapView.of(found.lanes(), verdict, asked, named).asking(subject)
                .withNeeds(views(decision));
        if (basis == AnswerBasisState.NO_ANSWER_BASIS) {
            gap = gap.withPrecedent(open.stream().flatMap(n -> n.precedents().stream())
                    .map(com.sellerops.inquiry.decision.PrecedentCandidate::memoryId).findFirst().orElse(null));
        }
        return new Assessment(productId, verdict, found, basis, asked, named, gap, subject, catalogueFinding, decision);
    }

    static List<com.sellerops.inquiry.draft.dto.NeedCoverageView> views(
            com.sellerops.inquiry.decision.NeedDecision decision) {
        return decision.needs().stream().map(n -> new com.sellerops.inquiry.draft.dto.NeedCoverageView(
                n.need().id(), n.need().ask(), n.need().type().name(), n.status().name(), n.status().labelKo(),
                n.evidence().stream().map(e -> e.kind().scopeLabelKo() + " · " + e.label()).distinct().toList(),
                n.missing(), n.askCustomer(),
                n.precedents().stream().map(com.sellerops.inquiry.decision.PrecedentCandidate::memoryId).toList(),
                n.acquirable())).toList();
    }

    /**
     * The seller's own past answer the memory lane found, when that is ALL that was found (Past Answer Prefill v1).
     *
     * <p>Only when no current passage — product knowledge or company rule — came back: a question the company's own
     * knowledge already speaks to is not one the seller should be asked to restate from memory. The past answer
     * stays what it was; it does not change the basis, and nothing here promotes it. It is handed to the one place
     * that asks the seller for knowledge, so that ask can start from what the seller already said.
     */
    static UUID precedentOf(InquiryEvidenceRetriever.InquiryEvidence lanes) {
        if (lanes == null || lanes.passages().stream().anyMatch(p -> p.scope().current())) {
            return null;
        }
        return lanes.passages().stream()
                .filter(p -> p.scope() == com.sellerops.knowledge.KnowledgeScope.PAST_ANSWER)
                .map(InquiryEvidenceRetriever.ScopedPassage::sourceId)
                .filter(java.util.Objects::nonNull)
                .findFirst()
                .orElse(null);
    }

    /** The catalogue's answer for a catalogue question; null for any other question, or when the read failed. */
    private CatalogueInvestigator.Finding investigateCatalogue(UUID orgId, UUID productId, String title,
                                                               String details, boolean mayReadDetail) {
        if (catalogue == null) {
            return null;
        }
        try {
            return catalogue.question(orgId, title, details)
                    .map(q -> catalogue.investigate(orgId, productId, q, mayReadDetail))
                    .orElse(null);
        } catch (RuntimeException unreadable) {
            return null;
        }
    }


    private String productName(UUID orgId, UUID productId) {
        return productId == null || products == null ? null : products.findById(productId)
                .filter(p -> orgId.equals(p.getOrgId()))
                .map(com.sellerops.product.OperatorProductName::displayNameOrNull).orElse(null);
    }

    private List<SpecApplicability.Option> optionsFor(UUID orgId, UUID productId) {
        return productId == null ? List.of()
                : variants.findByOrgIdAndProductId(orgId, productId).stream()
                        .filter(v -> v.getOptionName() != null && !v.getOptionName().isBlank())
                        .map(v -> new SpecApplicability.Option(v.getId(), v.getOptionName()))
                        .toList();
    }

    static Set<KnowledgeTopic> namedTopics(Inquiry inquiry) {
        return KnowledgeTopic.of((inquiry.getTitle() == null ? "" : inquiry.getTitle()) + " "
                + (inquiry.getBody() == null ? "" : inquiry.getBody()));
    }
}
