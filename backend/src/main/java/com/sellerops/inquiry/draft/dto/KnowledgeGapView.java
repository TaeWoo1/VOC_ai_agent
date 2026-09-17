package com.sellerops.inquiry.draft.dto;

import com.sellerops.inquiry.draft.InquiryEvidenceRetriever;
import com.sellerops.inquiry.draft.SpecApplicability;
import com.sellerops.knowledge.KnowledgeTopic;
import com.sellerops.knowledge.RetrievalOutcome;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * What the retrieval established about a draft's grounding, as closed values — the same four facts
 * {@code AnswerBasisState.actionKo} turns into one sentence, returned beside it so a caller that wants
 * to ASK the seller for the missing basis (Knowledge Capture v1) reads the verdict and never parses
 * the sentence.
 *
 * <p>Nothing here is new classification: {@code topic} is the {@link KnowledgeTopic} the customer's
 * words name, {@code missingSubject} is the customer's own noun {@link SpecApplicability} already
 * quoted, the two outcomes are the lanes' own, {@code applicability} is the verdict computed once per
 * draft, and {@code policyDeclaresTopic} is whether any registered rule declares itself about the
 * asked topic. A model is not asked what is missing.
 *
 * @param productId          the product the retrieval was scoped to, or null
 * @param topic              the operating topic the question names (exactly one), or null
 * @param topics             every operating topic the question's words name — the set {@code topic} is
 *                           the single member of; a caller may disambiguate among these and no others
 * @param missingSubject     the property noun the question is about, quoted from the question, or null
 * @param productOutcome     the product-knowledge lane's outcome
 * @param policyOutcome      the org-rules lane's outcome
 * @param applicability      whether the answer depends on a 규격 and whether the customer named one
 * @param variantId          the 규격 the customer named, when they did
 * @param policyDeclaresTopic whether a registered rule declares {@code topic}; false when no topic
 * @param candidateId the 확인 필요 row this ask was filed as, or null when nothing was filed —
 *                    <b>the identity that lets answering it here close exactly it</b> (Knowledge Gap
 *                    Continuity v1). It is an id and nothing else: the screen never reads the
 *                    candidate's text, and closing is done by the id rather than by deciding that a
 *                    sentence the seller just wrote resembles an ask.
 * @param previouslyAnswered whether the seller has ALREADY answered this exact ask and the draft still
 *                    cannot use it. Two facts that look alike on screen and are not: 「아직 정보가
 *                    필요합니다」 and 「기준은 추가하셨지만 이 질문에는 아직 적용되지 않습니다」. Telling a
 *                    seller to add what they already added says their work did not happen. Identity
 *                    only — the same scope, product and question `noteGap` files by; never resemblance.
 */
public record KnowledgeGapView(UUID productId, String topic, List<String> topics, String missingSubject,
                               String productOutcome, String policyOutcome, String applicability,
                               UUID variantId, boolean policyDeclaresTopic, UUID candidateId,
                               boolean previouslyAnswered, String askedSubject) {

    /**
     * The noun the customer asked about, for a gap the seller can close.
     *
     * <p>Separate from {@link #missingSubject()}, which is the 규격 classifier's own word and drives the sentence the
     * inquiry screen already shows. This one is filled by {@code InquiryKnowledgeAssessor} from the question's
     * remaining topic words when the classifier named none, so a customer-operations case can ask for exactly the
     * thing that is missing («방수») without changing what any existing screen says.
     */
    public KnowledgeGapView asking(String subject) {
        return new KnowledgeGapView(productId, topic, topics, missingSubject, productOutcome, policyOutcome,
                applicability, variantId, policyDeclaresTopic, candidateId, previouslyAnswered, subject);
    }

    /** The same gap, now carrying the 확인 필요 row it was filed as. */
    public KnowledgeGapView filedAs(UUID candidateId) {
        return new KnowledgeGapView(productId, topic, topics, missingSubject, productOutcome,
                policyOutcome, applicability, variantId, policyDeclaresTopic, candidateId, false, askedSubject);
    }

    /** The same gap, on a question this seller has already answered once. Nothing is filed for it. */
    public KnowledgeGapView answeredBefore() {
        return new KnowledgeGapView(productId, topic, topics, missingSubject, productOutcome,
                policyOutcome, applicability, variantId, policyDeclaresTopic, null, true, askedSubject);
    }

    public static KnowledgeGapView of(InquiryEvidenceRetriever.InquiryEvidence retrieved,
                                      SpecApplicability.Verdict verdict, KnowledgeTopic asked,
                                      Set<KnowledgeTopic> named) {
        return new KnowledgeGapView(
                retrieved.productId(),
                asked == null ? null : asked.name(),
                named == null ? List.of() : named.stream().map(Enum::name).sorted().toList(),
                verdict.topicWord() == null || verdict.topicWord().isBlank() ? null : verdict.topicWord(),
                name(retrieved.productOutcome()),
                name(retrieved.policyOutcome()),
                verdict.applicability() == null ? null : verdict.applicability().name(),
                verdict.variantId(),
                asked != null && retrieved.policyDeclares(asked),
                null,
                false,
                null);
    }

    private static String name(RetrievalOutcome outcome) {
        return outcome == null ? null : outcome.name();
    }
}
