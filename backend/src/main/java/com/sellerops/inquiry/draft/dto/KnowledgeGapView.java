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
 */
public record KnowledgeGapView(UUID productId, String topic, List<String> topics, String missingSubject,
                               String productOutcome, String policyOutcome, String applicability,
                               UUID variantId, boolean policyDeclaresTopic) {

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
                asked != null && retrieved.policyDeclares(asked));
    }

    private static String name(RetrievalOutcome outcome) {
        return outcome == null ? null : outcome.name();
    }
}
