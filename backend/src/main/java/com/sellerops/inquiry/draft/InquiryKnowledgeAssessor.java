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
                             KnowledgeGapView gap, String missingSubject) {

        public InquiryEvidenceRetriever.InquiryEvidence retrieved() {
            return spine.lanes();
        }
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
        String subject = basis == AnswerBasisState.NO_ANSWER_BASIS
                ? subjectOf(verdict, title, details, productName(orgId, productId), asked) : null;
        return new Assessment(productId, verdict, found, basis, asked, named,
                KnowledgeGapView.of(found.lanes(), verdict, asked, named).asking(subject), subject);
    }

    /**
     * The noun to ask the seller about. The 규격 classifier's word first — it is the one the existing screens already
     * say — then the question's own remaining topic words, then the topic's name. Nothing is invented: every source
     * here is a word the customer wrote or a label this product already uses.
     */
    static String subjectOf(SpecApplicability.Verdict verdict, String title, String details, String productName,
                            KnowledgeTopic asked) {
        if (verdict.topicWord() != null && !verdict.topicWord().isBlank()) {
            return verdict.topicWord();
        }
        List<String> residual = RetrievalQuery.residualTopicWords(
                ((title == null ? "" : title) + " " + (details == null ? "" : details)).strip(), productName,
                Set.of());
        return residual.isEmpty() ? (asked == null ? null : asked.labelKo()) : residual.get(0);
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
