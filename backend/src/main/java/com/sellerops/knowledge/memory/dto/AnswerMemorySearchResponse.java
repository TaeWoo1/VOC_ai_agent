package com.sellerops.knowledge.memory.dto;

import java.util.List;

/**
 * What the seller's past answers could offer this question.
 *
 * <p>{@code supersededByConflict} counts remembered answers that matched but were suppressed because
 * a stronger or newer answer on the same topic disagreed with them. Reported rather than dropped
 * silently: "예전에는 다르게 답했다" is a real thing for a seller to know, and a retrieval that hides
 * it looks like it never saw the older answer at all.
 */
public record AnswerMemorySearchResponse(String query, int memoriesSearched, int supersededByConflict,
                                         List<AnswerMemoryPassage> passages) {
}
