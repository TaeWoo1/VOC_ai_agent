package com.sellerops.knowledge.org.dto;

import com.sellerops.knowledge.KnowledgeTopic;
import com.sellerops.knowledge.RetrievalOutcome;
import java.util.List;

/**
 * What the org's operating rules could offer this question.
 *
 * <p>{@code documentsSearched} is reported alongside the passages so an empty result is readable:
 * zero documents means nobody has written the policy, and a non-zero count with no passages means
 * the policies exist and none of them answers this. Those are two different things for a seller to
 * do next.
 */
public record OrgKnowledgeSearchResponse(String query, int documentsSearched, int passagesSearched,
                                         List<OrgKnowledgePassage> passages, RetrievalOutcome outcome,
                                         int rejectedNotApplicable, int candidatesTried,
                                         List<KnowledgeTopic> topicsDeclared) {

    /** The pre-outcome shape: derives the outcome from the counts, as every caller used to. */
    public OrgKnowledgeSearchResponse(String query, int documentsSearched, int passagesSearched,
                                      List<OrgKnowledgePassage> passages) {
        this(query, documentsSearched, passagesSearched, passages,
                documentsSearched == 0 ? RetrievalOutcome.ABSENT
                        : passages.isEmpty() ? RetrievalOutcome.NO_RELEVANT_EVIDENCE : RetrievalOutcome.FOUND,
                0, 1, List.of());
    }

    /** Whether any registered rule declares itself about this topic — 「그 기준이 있기는 한가」. */
    public boolean declares(KnowledgeTopic topic) {
        return topic != null && topicsDeclared != null && topicsDeclared.contains(topic);
    }
}
