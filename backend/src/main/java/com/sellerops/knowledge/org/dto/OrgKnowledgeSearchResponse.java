package com.sellerops.knowledge.org.dto;

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
                                         List<OrgKnowledgePassage> passages) {
}
